"""
price_tool.py  —  exact-price control for stop-loss testing when the market is closed.

Writes `stock:{instrument_key}` in the SAME shape websocket_client.py does, so
orderService.getLivePrice() reads it exactly like a real tick.

Run from backend_py/ (needs backend_py/.env with REDIS_HOST / REDIS_PORT / REDIS_PASSWORD).
IMPORTANT: point this at a LOCAL/TEST Redis. Never at production Redis while real users trade.

  python3 price_tool.py set      --instrument "NSE_EQ|INE002A01018" --price 1223.0
  python3 price_tool.py ramp     --instrument "NSE_EQ|INE002A01018" --from 1223.0 --to 1222.3 --steps 8 --interval 0.5
  python3 price_tool.py wick     --instrument "NSE_EQ|INE002A01018" --base 1223.0 --to 1222.4 --hold 0.3
  python3 price_tool.py blackout --instrument "NSE_EQ|INE002A01018" --seconds 12 --restore 1222.4
  python3 price_tool.py delete   --instrument "NSE_EQ|INE002A01018"
  python3 price_tool.py show     --instrument "NSE_EQ|INE002A01018"
"""

import argparse
import json
import os
import time

import redis
from dotenv import load_dotenv

load_dotenv()

r = redis.Redis(
    host=os.getenv("REDIS_HOST"),
    port=int(os.getenv("REDIS_PORT")),
    password=os.getenv("REDIS_PASSWORD"),
    ssl=False,
    decode_responses=True,
)


def write_price(instrument_key, ltp):
    feed = {
        "ltpc": {
            "ltp": ltp,
            "ltt": str(int(time.time() * 1000)),
            "ltq": "1",
            "cp": ltp,
        }
    }
    r.set(f"stock:{instrument_key}", json.dumps(feed))
    r.setex(f"stock_live:{instrument_key}", 90, "1")
    r.set(f"stock_ts:{instrument_key}", str(time.time()))
    print(f"  ltp -> {ltp}")


def cmd_set(a):
    write_price(a.instrument, a.price)


def cmd_ramp(a):
    steps = max(a.steps, 1)
    for i in range(steps + 1):
        price = a.from_price + (a.to - a.from_price) * i / steps
        write_price(a.instrument, round(price, 2))
        time.sleep(a.interval)


def cmd_wick(a):
    # Dip to a price and come straight back — tests the "1s polling can miss it" limit.
    write_price(a.instrument, a.base)
    time.sleep(0.5)
    write_price(a.instrument, a.to)
    time.sleep(a.hold)
    write_price(a.instrument, a.base)


def cmd_blackout(a):
    # Price key disappears (feed outage / Redis hiccup) -> worker sees NO_LTP.
    r.delete(f"stock:{a.instrument}")
    print(f"  stock key DELETED for {a.seconds}s")
    time.sleep(a.seconds)
    if a.restore is not None:
        write_price(a.instrument, a.restore)


def cmd_delete(a):
    r.delete(f"stock:{a.instrument}")
    print("  stock key deleted")


def cmd_show(a):
    print(r.get(f"stock:{a.instrument}"))


def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("set")
    s.add_argument("--instrument", required=True)
    s.add_argument("--price", type=float, required=True)
    s.set_defaults(fn=cmd_set)

    s = sub.add_parser("ramp")
    s.add_argument("--instrument", required=True)
    s.add_argument("--from", dest="from_price", type=float, required=True)
    s.add_argument("--to", type=float, required=True)
    s.add_argument("--steps", type=int, default=8)
    s.add_argument("--interval", type=float, default=0.5)
    s.set_defaults(fn=cmd_ramp)

    s = sub.add_parser("wick")
    s.add_argument("--instrument", required=True)
    s.add_argument("--base", type=float, required=True)
    s.add_argument("--to", type=float, required=True)
    s.add_argument("--hold", type=float, default=0.3)
    s.set_defaults(fn=cmd_wick)

    s = sub.add_parser("blackout")
    s.add_argument("--instrument", required=True)
    s.add_argument("--seconds", type=float, default=12)
    s.add_argument("--restore", type=float, default=None)
    s.set_defaults(fn=cmd_blackout)

    s = sub.add_parser("delete")
    s.add_argument("--instrument", required=True)
    s.set_defaults(fn=cmd_delete)

    s = sub.add_parser("show")
    s.add_argument("--instrument", required=True)
    s.set_defaults(fn=cmd_show)

    a = p.parse_args()
    # argparse stores --from as from_price only on ramp
    a.fn(a)


if __name__ == "__main__":
    main()