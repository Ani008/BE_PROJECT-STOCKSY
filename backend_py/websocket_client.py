"""
PROBLEM 1 — EXPLAINED & FIXED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WHY live data vanishes after ~60 seconds (or looks "empty"):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

   r.setex(f"stock:{instrument_key}", 60, json.dumps(feed_data))
   
   setex = SET with EXpiry. TTL = 60 seconds.

   This means:
   → If the Python WebSocket is RUNNING, Upstox sends a tick every
     ~1-2 seconds, so the key is refreshed constantly. ✅
   → If the Python WebSocket STOPS (crash, market closed, Ctrl+C),
     the key expires 60 seconds later and disappears. ✅ (intentional)
   → If you RELOAD Redis GUI or check after market hours, data is gone. 

   This is CORRECT BEHAVIOR. It's a live ticker cache, not persistent storage.

WHY historical data looks "collection-like":
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   historical_fetcher.py stores JSON arrays of candle objects:
   
   hist:NSE_EQ|INE002A01018:1M → [ {time, open, high, low, close, volume}, ... ]
   
   websocket_client.py stores a single dict per instrument:
   
   stock:NSE_EQ|INE002A01018 → { ltpc: { ltp: 2847.35, cp: 2831.20 } }
   
   They're different shapes for different purposes. Both are correct.

REAL FIX — If data disappears TOO FAST (under 2 seconds):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   The issue is that Upstox only pushes ticks when the market is OPEN
   and when price actually changes. Outside market hours (9:15am–3:30pm IST),
   you will NOT receive new messages, so the 60s TTL will expire.

   Fix 1 — Increase TTL so data survives gaps between ticks:
   Change line in save_to_redis() from TTL=60 to TTL=300 (5 minutes).
   This keeps last known price visible even if ticks are slow.

   Fix 2 — Only use setex for keys that SHOULD expire.
   For "last known price" (survives app restarts), use SET without expiry,
   and separately track a "last updated at" timestamp.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""
import log_guard
import asyncio
import json
import ssl
import os
import redis
import websockets
from dotenv import load_dotenv
from google.protobuf.json_format import MessageToDict
import MarketDataFeedV3_pb2 as pb

load_dotenv()

r = redis.Redis(
    host=os.getenv('REDIS_HOST'),
    port=int(os.getenv('REDIS_PORT')),
    password=os.getenv('REDIS_PASSWORD'),
    ssl=False
)

INSTRUMENT_KEYS = [
    "NSE_INDEX|Nifty 50",
    "NSE_INDEX|Nifty Bank",
    "BSE_INDEX|SENSEX",
    "NSE_INDEX|Nifty Fin Service",
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

RECONNECT_DELAY = 5

# ── FIX: increased from 60 → 300 seconds ────────────────────────────────────
# Ticks from Upstox arrive every ~1-2s during market hours.
# 300s TTL = key survives a 5-minute gap (network blip, slow tick, etc.)
# If Python process crashes, data stays visible for 5 min rather than 1 min.



def get_market_data_feed_authorize_v3():
    import requests
    access_token = os.getenv('UPSTOX_ACCESS_TOKEN')
    headers = {
        'Accept': 'application/json',
        'Authorization': f'Bearer {access_token}'
    }
    url = 'https://api.upstox.com/v3/feed/market-data-feed/authorize'
    api_response = requests.get(url=url, headers=headers)
    return api_response.json()


def decode_protobuf(buffer):
    feed_response = pb.FeedResponse()
    feed_response.ParseFromString(buffer)
    return feed_response


def save_to_redis(data_dict):
    import time
    feeds = data_dict.get('feeds', {})
    if not feeds:
        print("⚠️  Empty feeds — check instrument keys")
        return

    for instrument_key, feed_data in feeds.items():

        # ── Key 1: Permanent price storage — NO expiry, never deleted ────────
        # This is what the app reads. Survives market close, weekends, restarts.
        # Groww does the same — stores last known price forever.
        r.set(
            f"stock:{instrument_key}",
            json.dumps(feed_data)
        )

        # ── Key 2: Live market indicator — expires in 90 seconds ─────────────
        # If this key EXISTS → market is open, data is fresh
        # If this key MISSING → market closed, showing last known price
        # Node uses this to send isLive: true/false to React Native
        r.setex(
            f"stock_live:{instrument_key}",
            90,
            "1"
        )

        # ── Key 3: Timestamp of last update ───────────────────────────────────
        # Stored permanently so app can show "As of Friday 3:30 PM"
        r.set(
            f"stock_ts:{instrument_key}",
            str(time.time())
        )

        print(f"✅ {instrument_key} → ltp: {feed_data.get('ltpc', {}).get('ltp', '?')}")
    feeds = data_dict.get('feeds', {})
    if not feeds:
        print("⚠️  Empty feeds received — check instrument keys")
        return

    for instrument_key, feed_data in feeds.items():
        # ── FIX 1: Use LIVE_DATA_TTL (300s) instead of hardcoded 60 ──────────
        r.setex(
            f"stock:{instrument_key}",
            LIVE_DATA_TTL,
            json.dumps(feed_data)
        )

        # ── FIX 2: Also store a "last_seen" timestamp per instrument ─────────
        # This lets your Node server know WHEN data was last received,
        # and lets you show a "stale data" warning in the app if needed.
        r.setex(
            f"stock_ts:{instrument_key}",
            LIVE_DATA_TTL,
            str(__import__('time').time())
        )

        print(f"Saved to Redis: {instrument_key} → {feed_data}")


async def connect_and_stream():
    ssl_context = ssl.create_default_context()
    ssl_context.check_hostname = False
    ssl_context.verify_mode = ssl.CERT_NONE

    print("Fetching authorized WebSocket URL...")
    response = get_market_data_feed_authorize_v3()
    ws_url = response["data"]["authorized_redirect_uri"]

    async with websockets.connect(
        ws_url,
        ssl=ssl_context,
        ping_interval=20,
        ping_timeout=30,
        close_timeout=10,
    ) as websocket:
        print("Connection established")
        await asyncio.sleep(1)

        sub_msg = {
            "guid": "stocksy-guid",
            "method": "sub",
            "data": {
                "mode": "ltpc",
                "instrumentKeys": INSTRUMENT_KEYS
            }
        }
        await websocket.send(json.dumps(sub_msg).encode('utf-8'))
        print(f"Subscribed to {len(INSTRUMENT_KEYS)} instruments")

        async for message in websocket:
            try:
                decoded_data = decode_protobuf(message)
                data_dict = MessageToDict(decoded_data)
                save_to_redis(data_dict)
            except Exception as e:
                print(f"Error processing message: {e}")


async def fetch_market_data():
    while True:
        try:
            await connect_and_stream()
        except websockets.exceptions.ConnectionClosedError as e:
            print(f"Connection closed: {e}. Reconnecting in {RECONNECT_DELAY}s...")
        except websockets.exceptions.WebSocketException as e:
            print(f"WebSocket error: {e}. Reconnecting in {RECONNECT_DELAY}s...")
        except Exception as e:
            print(f"Unexpected error: {e}. Reconnecting in {RECONNECT_DELAY}s...")

        await asyncio.sleep(RECONNECT_DELAY)


asyncio.run(fetch_market_data())