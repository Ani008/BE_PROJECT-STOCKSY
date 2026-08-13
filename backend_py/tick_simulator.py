"""
tick_simulator.py
────────────────────────────────────────────────────────────────────────────
Test tool for the Trade Journal feature when the real market/Upstox feed
isn't running (market closed, no access token handy, etc).

It drives the EXACT SAME code path production ticks do — indicator_engine
.on_tick() — so RSI/VWAP/volume-ratio are computed by the real logic, not
a hand-crafted mock. It also writes `stock:{instrument_key}` in the same
shape the real websocket_client.py writes it, so orderService.getLivePrice()
(used by the order-fill engine) reads it exactly like a real tick.

Time is simulated (not real-time) so you don't have to wait 15+ real
minutes for RSI(14) to have enough candle history — see --minutes below.

USAGE
─────
  # 1) Seed baseline history so RSI/VWAP have enough candles (run once
  #    per instrument per test session):
  python3 tick_simulator.py seed --instrument "NSE_EQ|INE002A01018" --price 812 --minutes 20

  # 2) Push a fast upward spike (mimics the PDF's SBIN "chasing" entry —
  #    overbought RSI, above VWAP, high volume, all in one move):
  python3 tick_simulator.py spike --instrument "NSE_EQ|INE002A01018" --to 828

  #    → now go place a BUY in the app/Postman. It'll fill near 828 and
  #      snapshot RSI>70 / above-VWAP / high-volume.

  # 3) Push a small normal pullback (mimics the "premature exit on a
  #    normal dip" scenario — RSI drifts back to neutral, not oversold):
  python3 tick_simulator.py dip --instrument "NSE_EQ|INE002A01018" --to 820

  #    → now place a SELL for the full quantity. It closes the position,
  #      which triggers journal generation. Check trade_journal_entries.

  # Anytime: check what indicators currently look like without pushing anything:
  python3 tick_simulator.py show --instrument "NSE_EQ|INE002A01018"

Run this from backend_py/ (same folder as indicator_engine.py) so the
import below resolves, and make sure backend_py/.env has REDIS_HOST /
REDIS_PORT / REDIS_PASSWORD set (same file websocket_client.py uses).
"""

import argparse
import json
import os
import random
import time as real_time

import redis
from dotenv import load_dotenv

import indicator_engine

load_dotenv()

r = redis.Redis(
    host=os.getenv('REDIS_HOST'),
    port=int(os.getenv('REDIS_PORT')),
    password=os.getenv('REDIS_PASSWORD'),
    ssl=False,
    decode_responses=True,
)

# ── Simulated clock ──────────────────────────────────────────────────────
# indicator_engine.py calls time.time() directly. We advance a fake clock
# and monkeypatch it in, so "20 minutes" of candle history can be built in
# under a second instead of making you wait 20 real minutes. This only
# affects this standalone process — the real server is untouched.
_fake_now = real_time.time()


def _fake_time():
    return _fake_now


indicator_engine.time.time = _fake_time


def _advance(seconds):
    global _fake_now
    _fake_now += seconds


def _write_stock_key(instrument_key, ltp, ltq):
    """Mirrors the exact shape websocket_client.py writes, so
    orderService.getLivePrice() reads it identically to a real tick."""
    feed_data = {"ltpc": {"ltp": ltp, "ltq": ltq, "cp": ltp}}
    r.set(f"stock:{instrument_key}", json.dumps(feed_data))
    r.setex(f"stock_ts:{instrument_key}", 300, str(real_time.time()))


def _tick(instrument_key, price, qty):
    price = round(price, 2)
    _write_stock_key(instrument_key, price, qty)
    indicator_engine.on_tick(r, instrument_key, price, qty)


# ── Commands ──────────────────────────────────────────────────────────────

def cmd_seed(args):
    """Build `minutes` completed 1-min candles of calm, neutral price
    action around `price`, so RSI(14) has enough history and VWAP/volume
    baselines exist before you start testing scenarios."""
    price = args.price
    print(f"Seeding {args.minutes} minutes of baseline history for {args.instrument} around ₹{price}...")

    for m in range(args.minutes):
        # 4 ticks per simulated minute, small random walk (±0.15%)
        for _ in range(4):
            price += price * random.uniform(-0.0015, 0.0015)
            qty = random.randint(50, 200)
            _tick(args.instrument, price, qty)
        _advance(60)  # roll into the next minute

    show_indicators(args.instrument)
    print("✅ Baseline seeded. Now run `spike` or `dip` to set up a scenario.")


def cmd_spike(args):
    """Fast move to a new price within the CURRENT simulated minute, with
    elevated volume — mimics a sudden spike (high RSI change, likely
    crosses above VWAP, high volume-ratio)."""
    from_price = args.from_price or _last_price(args.instrument) or args.to
    print(f"Spiking {args.instrument}: {from_price} → {args.to} (elevated volume, same minute)...")

    steps = 6
    for i in range(1, steps + 1):
        price = from_price + (args.to - from_price) * (i / steps)
        qty = random.randint(400, 900)  # elevated volume vs the ~50-200 baseline
        _tick(args.instrument, price, qty)
        # no _advance() here — stays inside the same simulated minute so
        # the still-forming candle's volume-so-far (compared against the
        # completed-candle baseline) is what shows up as volume_ratio.
        # Rolling the minute over here would reset volume-so-far to ~0 and
        # make the NEXT (tiny) candle look artificially quiet instead.

    show_indicators(args.instrument)
    print(f"✅ Live price is now ₹{args.to}. Go place your order now, while this minute is still \"live\" —")
    print("   that's the snapshot that gets captured at fill time.")


def cmd_dip(args):
    """Small, gentle pullback — mimics normal movement, not a real
    reversal (RSI should land in the neutral 40-60 zone, not oversold)."""
    from_price = args.from_price or _last_price(args.instrument) or args.to
    print(f"Dipping {args.instrument}: {from_price} → {args.to} (normal volume, gentle move)...")

    steps = 5
    for i in range(1, steps + 1):
        price = from_price - (from_price - args.to) * (i / steps)
        qty = random.randint(60, 180)  # normal volume, not a spike
        _tick(args.instrument, price, qty)
        # Small time advances between ticks (not a full minute) so this
        # still lands in roughly the current/next candle without diluting
        # volume-so-far the way a full rollover would.
        _advance(10)

    show_indicators(args.instrument)
    print(f"✅ Live price is now ₹{args.to}. Go place your closing order now.")


def cmd_show(args):
    show_indicators(args.instrument)

def cmd_scenario(args):
    # IMPORTANT: seed + spike + dip all run in this SAME process so
    # indicator_engine._state (RSI/VWAP/volume history) is preserved.
    cmd_seed(argparse.Namespace(instrument=args.instrument, price=args.price, minutes=args.minutes))
    print("\n" + "=" * 60)
    print("ENTRY SETUP — SPIKE")
    print("=" * 60)
    cmd_spike(argparse.Namespace(instrument=args.instrument, to=args.spike_to, from_price=None))
    print("\n🟢 ENTRY WINDOW READY")
    print("Place the BUY in Stocksy only if this is your paper/dev order path.")
    input("Press ENTER after the BUY has completely filled... ")
    print("\n" + "=" * 60)
    print("EXIT SETUP — DIP")
    print("=" * 60)
    cmd_dip(argparse.Namespace(instrument=args.instrument, to=args.dip_to, from_price=None))
    print("\n🔴 EXIT WINDOW READY")
    print("Place the SELL for the FULL quantity.")
    input("Press ENTER after the SELL has completely filled... ")
    print("\n" + "=" * 60)
    print("FINAL STATE")
    print("=" * 60)
    show_indicators(args.instrument)
    print("\n✅ Scenario finished. Check trade_journal_entries / GET /api/journal.")


def _last_price(instrument_key):
    raw = r.get(f"stock:{instrument_key}")
    if not raw:
        return None
    return json.loads(raw).get("ltpc", {}).get("ltp")


def show_indicators(instrument_key):
    raw = r.get(f"indicators:{instrument_key}")
    stock_raw = r.get(f"stock:{instrument_key}")
    print("─" * 60)
    print(f"stock:{instrument_key}      = {stock_raw}")
    print(f"indicators:{instrument_key} = {raw}")
    print("─" * 60)


# ── CLI ───────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Simulate ticks to test the Trade Journal pipeline offline.")
    sub = parser.add_subparsers(dest="command", required=True)

    p_seed = sub.add_parser("seed", help="Build baseline candle history for an instrument")
    p_seed.add_argument("--instrument", required=True)
    p_seed.add_argument("--price", type=float, required=True)
    p_seed.add_argument("--minutes", type=int, default=20)
    p_seed.set_defaults(func=cmd_seed)

    p_spike = sub.add_parser("spike", help="Fast high-volume move upward (or downward)")
    p_spike.add_argument("--instrument", required=True)
    p_spike.add_argument("--to", type=float, required=True)
    p_spike.add_argument("--from", dest="from_price", type=float, default=None)
    p_spike.set_defaults(func=cmd_spike)

    p_dip = sub.add_parser("dip", help="Gentle normal-volume pullback")
    p_dip.add_argument("--instrument", required=True)
    p_dip.add_argument("--to", type=float, required=True)
    p_dip.add_argument("--from", dest="from_price", type=float, default=None)
    p_dip.set_defaults(func=cmd_dip)

    p_show = sub.add_parser("show", help="Print current stock/indicators redis keys")
    p_show.add_argument("--instrument", required=True)
    p_show.set_defaults(func=cmd_show)

    p_scenario = sub.add_parser("scenario", help="Recommended single-process test: seed + spike + manual BUY + dip + manual SELL")
    p_scenario.add_argument("--instrument", required=True)
    p_scenario.add_argument("--price", type=float, default=812)
    p_scenario.add_argument("--minutes", type=int, default=20)
    p_scenario.add_argument("--spike-to", type=float, default=828)
    p_scenario.add_argument("--dip-to", type=float, default=820)
    p_scenario.set_defaults(func=cmd_scenario)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()