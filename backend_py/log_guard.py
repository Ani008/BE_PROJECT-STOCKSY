# backend_py/log_guard.py
import os
import builtins
from dotenv import load_dotenv

load_dotenv()  # guarantee .env is loaded before we check DEBUG_LOGS,
                # even if this module is imported before the script's own load_dotenv()

DEBUG_LOGS = os.getenv("DEBUG_LOGS", "true").lower() == "true"
_real_print = builtins.print

def _guarded_print(*args, **kwargs):
    if DEBUG_LOGS:
        _real_print(*args, **kwargs)

builtins.print = _guarded_print