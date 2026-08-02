import log_guard
import asyncio
import json
import os
import time
import redis
import requests
from dotenv import load_dotenv

load_dotenv()

# ─── Redis connection ─────────────────────────────────────────────────────────
r = redis.Redis(
    host=os.getenv('REDIS_HOST'),
    port=int(os.getenv('REDIS_PORT')),
    password=os.getenv('REDIS_PASSWORD'),
    ssl=False
)

# ─── Instruments to fetch historical data for ────────────────────────────────
# Same list as your websocket_client.py INSTRUMENT_KEYS
INSTRUMENT_KEYS = [
    "NSE_INDEX|Nifty 50",
    "NSE_INDEX|Nifty Bank",
    "NSE_EQ|INE040A01034",
    "NSE_EQ|INE090A01021",
    "NSE_EQ|INE062A01020",
    "NSE_EQ|INE238A01034",
    "NSE_EQ|INE296A01032",
    "NSE_EQ|INE237A01036",
    "NSE_EQ|INE795G01014",
    "NSE_EQ|INE918I01026",
    "NSE_EQ|INE467B01029",
    "NSE_EQ|INE009A01021",
    "NSE_EQ|INE075A01022",
    "NSE_EQ|INE860A01027",
    "NSE_EQ|INE669C01036",
    "NSE_EQ|INE214T01019",
    "NSE_EQ|INE002A01018",
    "NSE_EQ|INE213A01029",
    "NSE_EQ|INE029A01011",
    "NSE_EQ|INE752E01010",
    "NSE_EQ|INE733E01010",
    "NSE_EQ|INE585B01010",
    "NSE_EQ|INE1TAE01010",
    "NSE_EQ|INE917I01010",
    "NSE_EQ|INE066A01021",
    "NSE_EQ|INE158A01026",
    "NSE_EQ|INE030A01027",
    "NSE_EQ|INE154A01025",
    "NSE_EQ|INE239A01024",
    "NSE_EQ|INE016A01026",
    "NSE_EQ|INE216A01030",
    "NSE_EQ|INE044A01036",
    "NSE_EQ|INE089A01031",
    "NSE_EQ|INE059A01026",
    "NSE_EQ|INE361B01024",
    "NSE_EQ|INE081A01020",
    "NSE_EQ|INE038A01020",
    "NSE_EQ|INE019A01038",
    "NSE_EQ|INE522F01014",
    "NSE_EQ|INE397D01024",
    "NSE_EQ|INE742F01042",
    "NSE_EQ|INE364U01010",
    "NSE_EQ|INE481G01011",
    "NSE_EQ|INE018A01030",
    "NSE_EQ|INE047A01021",
    "NSE_EQ|INE423A01024",
    "NSE_EQ|INE1NPP01017",

    "NSE_EQ|INE205A01025",
    "NSE_EQ|INE263A01024",
    "NSE_EQ|INE053F01010",
    "NSE_EQ|INE040H01021",
]

# ─── Range config ─────────────────────────────────────────────────────────────
# Each range: (interval, from_days_ago, ttl_seconds, fetch_every_seconds)
RANGE_CONFIG = {
    "1D": ("30minute", 1,   5 * 60,       5 * 60),       # 5 min TTL, fetch every 5 min
    "1W": ("day",      7,   60 * 60,      60 * 60),       # 1 hour TTL, fetch every 1 hour
    "1M": ("day",      30,  6 * 60 * 60,  6 * 60 * 60),  # 6 hour TTL, fetch every 6 hours
    "3M": ("day",      90,  24 * 60 * 60, 24 * 60 * 60), # 24 hour TTL, fetch every 24 hours
    "1Y": ("week",     365, 24 * 60 * 60, 24 * 60 * 60), # 24 hour TTL, fetch every 24 hours
}

# ─── Helpers ─────────────────────────────────────────────────────────────────

def get_date_str(days_ago):
    from datetime import datetime, timedelta
    d = datetime.now() - timedelta(days=days_ago)
    return d.strftime("%Y-%m-%d")

def get_today_str():
    from datetime import datetime
    return datetime.now().strftime("%Y-%m-%d")

def get_access_token():
    return os.getenv('UPSTOX_ACCESS_TOKEN')

def fetch_historical(instrument_key, interval, from_date, to_date):
    """Fetch OHLC candles from Upstox for one instrument."""
    encoded_key = requests.utils.quote(instrument_key, safe='')
    url = f"https://api.upstox.com/v2/historical-candle/{encoded_key}/{interval}/{to_date}/{from_date}"

    headers = {
        'Accept': 'application/json',
        'Authorization': f'Bearer {get_access_token()}'
    }

    response = requests.get(url, headers=headers, timeout=10)

    if response.status_code != 200:
        print(f"  ✗ {instrument_key} [{interval}]: HTTP {response.status_code}")
        return None

    data = response.json()
    candles = data.get('data', {}).get('candles', [])

    # Format for Lightweight Charts: { time (unix seconds), open, high, low, close, volume }
    formatted = []
    for c in reversed(candles):  # Upstox sends newest first, reverse for chart
        try:
            formatted.append({
                "time":   int(c[0][:10].replace("-", "")),  # YYYYMMDD as int for day candles
                "open":   c[1],
                "high":   c[2],
                "low":    c[3],
                "close":  c[4],
                "volume": c[5],
            })
        except Exception:
            continue

    return formatted

def save_to_redis(instrument_key, range_label, candles, ttl):
    """Save candle data to Redis with TTL."""
    redis_key = f"hist:{instrument_key}:{range_label}"
    r.setex(redis_key, ttl, json.dumps(candles))
    print(f"  ✓ Saved hist:{instrument_key}:{range_label} ({len(candles)} candles, TTL {ttl}s)")

def should_fetch(instrument_key, range_label, fetch_every):
    """
    Check if we should fetch fresh data.
    We track last fetch time in Redis so we don't re-fetch before TTL expires.
    """
    tracker_key = f"hist_fetched:{instrument_key}:{range_label}"
    last_fetched = r.get(tracker_key)

    if last_fetched is None:
        return True  # Never fetched

    elapsed = time.time() - float(last_fetched)
    return elapsed >= fetch_every

def mark_fetched(instrument_key, range_label, fetch_every):
    """Record that we just fetched this instrument+range."""
    tracker_key = f"hist_fetched:{instrument_key}:{range_label}"
    r.setex(tracker_key, int(fetch_every * 2), str(time.time()))

# ─── Main fetch loop ──────────────────────────────────────────────────────────

def fetch_all():
    """
    Fetch historical data for all instruments and all ranges.
    Skips instruments that were recently fetched (respects TTL schedule).
    """
    print(f"\n[{get_today_str()}] Starting historical data fetch...")

    for range_label, (interval, days_ago, ttl, fetch_every) in RANGE_CONFIG.items():
        print(f"\nRange: {range_label} (interval={interval}, days={days_ago})")
        from_date = get_date_str(days_ago)
        to_date = get_today_str()

        for instrument_key in INSTRUMENT_KEYS:
            if not should_fetch(instrument_key, range_label, fetch_every):
                continue  # skip — still fresh

            try:
                candles = fetch_historical(instrument_key, interval, from_date, to_date)
                if candles:
                    save_to_redis(instrument_key, range_label, candles, ttl)
                    mark_fetched(instrument_key, range_label, fetch_every)
                # Small delay between requests to be polite to Upstox
                time.sleep(0.2)
            except Exception as e:
                print(f"  ✗ Error fetching {instrument_key}: {e}")

    print("\n✅ Fetch cycle complete.")

# ─── Run continuously ─────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("Historical fetcher started. Checking every 5 minutes...")
    while True:
        try:
            fetch_all()
        except Exception as e:
            print(f"Fetch cycle error: {e}")
        # Check every 5 minutes — individual instruments skip if not due yet
        time.sleep(5 * 60)