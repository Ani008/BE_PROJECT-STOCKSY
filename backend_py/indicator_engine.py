"""
indicator_engine.py
────────────────────────────────────────────────────────────────────────────
Builds 1-minute OHLCV candles from the live tick stream (mode="ltpc", so we
get last-traded-price + last-traded-qty per tick — no cumulative daily
volume is available in this subscription mode) and computes, per
instrument, the three signals the Trade Journal feature needs:

  - RSI(14)        — Wilder's smoothing over 1-min candle closes
  - VWAP            — session-cumulative sum(ltp * ltq) / sum(ltq), reset
                       at the first tick of each new trading day
  - volume_ratio    — this minute's traded qty vs the average of the last
                       N completed candles' traded qty (a proxy for "is
                       this an unusually busy minute")

Design notes:
  - This is called once per tick from websocket_client.py's save_to_redis()
    loop, so every tick is seen exactly once (a separate polling process
    would miss ticks between polls, since `stock:{key}` only ever holds
    the latest tick).
  - State is kept in-process (per instrument). If this process restarts
    mid-session, RSI/VWAP rebuild from scratch — acceptable for v1; the
    values converge again within a few minutes of ticks. A future version
    could seed from `hist:{key}:1D` on startup.
  - Nothing here blocks or slows down the existing tick-save path — any
    exception is caught and logged, never raised, so a bug in indicator
    math can never take down the live price feed.
  - Written for use in an intraday PAPER TRADING simulator. These indicators
    exist to generate reflective, after-the-fact coaching messages about a
    user's own simulated trades — not live buy/sell signals.
"""

import json
import time
from collections import deque
from datetime import datetime

# Keep indicators fresh only while ticks are flowing — same spirit as the
# existing stock_live TTL. If ticks stop (market closed / process down),
# this key expires and Node treats indicators as unavailable rather than
# serving stale RSI/VWAP for a snapshot.
INDICATOR_TTL_SECONDS = 120

RSI_PERIOD = 14
MAX_CLOSES = 60          # enough history for RSI(14) + headroom
MAX_VOLUME_SAMPLES = 20  # candles used to build the "average minute volume" baseline
MAX_STORED_CANDLES = 50  # capped 1-min candle history kept in Redis per instrument


class _InstrumentState:
    __slots__ = (
        "minute_bucket", "open", "high", "low", "close", "volume",
        "closes", "candle_volumes", "session_date", "cum_pv", "cum_vol",
    )

    def __init__(self):
        self.minute_bucket = None
        self.open = self.high = self.low = self.close = None
        self.volume = 0.0
        self.closes = deque(maxlen=MAX_CLOSES)
        self.candle_volumes = deque(maxlen=MAX_VOLUME_SAMPLES)
        self.session_date = None
        self.cum_pv = 0.0   # sum(price * qty) since session start
        self.cum_vol = 0.0  # sum(qty) since session start


_state = {}  # instrument_key -> _InstrumentState


def _minute_floor(ts):
    return int(ts // 60) * 60


def _compute_rsi(closes):
    """Wilder's RSI over a list of closes. Needs RSI_PERIOD+1 closes minimum."""
    if len(closes) < RSI_PERIOD + 1:
        return None

    gains = []
    losses = []
    for i in range(1, len(closes)):
        delta = closes[i] - closes[i - 1]
        gains.append(max(delta, 0))
        losses.append(max(-delta, 0))

    # Wilder smoothing: seed with simple average of first RSI_PERIOD
    # deltas, then exponentially smooth the rest.
    avg_gain = sum(gains[:RSI_PERIOD]) / RSI_PERIOD
    avg_loss = sum(losses[:RSI_PERIOD]) / RSI_PERIOD

    for i in range(RSI_PERIOD, len(gains)):
        avg_gain = (avg_gain * (RSI_PERIOD - 1) + gains[i]) / RSI_PERIOD
        avg_loss = (avg_loss * (RSI_PERIOD - 1) + losses[i]) / RSI_PERIOD

    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return round(100 - (100 / (1 + rs)), 2)


def _finalize_candle(redis_client, instrument_key, st):
    """Push the just-completed 1-min candle into history and recompute
    indicators from it. Called on minute rollover."""
    if st.open is None:
        return

    st.closes.append(st.close)
    st.candle_volumes.append(st.volume)

    candle = {
        "time": st.minute_bucket,
        "open": st.open,
        "high": st.high,
        "low": st.low,
        "close": st.close,
        "volume": st.volume,
    }

    try:
        key = f"candles:1m:{instrument_key}"
        redis_client.lpush(key, json.dumps(candle))
        redis_client.ltrim(key, 0, MAX_STORED_CANDLES - 1)
        redis_client.expire(key, 60 * 60 * 12)  # survive the trading day
    except Exception as e:
        print(f"[indicator_engine] candle store failed for {instrument_key}: {e}")


def _write_indicators(redis_client, instrument_key, st, ltp):
    rsi = _compute_rsi(list(st.closes) + ([st.close] if st.close is not None else []))
    vwap = round(st.cum_pv / st.cum_vol, 2) if st.cum_vol > 0 else None

    avg_vol = (
        sum(st.candle_volumes) / len(st.candle_volumes)
        if st.candle_volumes else None
    )
    volume_ratio = (
        round(st.volume / avg_vol, 2) if avg_vol and avg_vol > 0 else None
    )

    payload = {
        "rsi": rsi,
        "vwap": vwap,
        "volume_ratio": volume_ratio,
        "ltp": ltp,
        "ts": time.time(),
    }

    try:
        redis_client.setex(
            f"indicators:{instrument_key}",
            INDICATOR_TTL_SECONDS,
            json.dumps(payload),
        )
    except Exception as e:
        print(f"[indicator_engine] indicator write failed for {instrument_key}: {e}")


def on_tick(redis_client, instrument_key, ltp, ltq):
    """Call once per tick, per instrument. Never raises."""
    try:
        if ltp is None:
            return
        ltp = float(ltp)
        # ltq (last traded qty) can be 0/missing on some tick types
        # (e.g. a pure LTP-only update) — treat as a zero-volume print
        # rather than skipping the price update.
        qty = float(ltq) if ltq else 0.0

        now = time.time()
        today = datetime.now().strftime("%Y-%m-%d")
        bucket = _minute_floor(now)

        st = _state.get(instrument_key)
        if st is None:
            st = _InstrumentState()
            _state[instrument_key] = st

        # New trading day → reset the session VWAP accumulator.
        if st.session_date != today:
            st.session_date = today
            st.cum_pv = 0.0
            st.cum_vol = 0.0

        # Minute rollover → finalize the previous candle before starting a new one.
        if st.minute_bucket is not None and bucket != st.minute_bucket:
            _finalize_candle(redis_client, instrument_key, st)
            st.open = st.high = st.low = st.close = None
            st.volume = 0.0

        if st.minute_bucket != bucket:
            st.minute_bucket = bucket

        if st.open is None:
            st.open = st.high = st.low = st.close = ltp
        else:
            st.high = max(st.high, ltp)
            st.low = min(st.low, ltp)
            st.close = ltp
        st.volume += qty

        st.cum_pv += ltp * qty
        st.cum_vol += qty

        _write_indicators(redis_client, instrument_key, st, ltp)
    except Exception as e:
        # Indicator math must never take down the live tick pipeline.
        print(f"[indicator_engine] on_tick error for {instrument_key}: {e}")
