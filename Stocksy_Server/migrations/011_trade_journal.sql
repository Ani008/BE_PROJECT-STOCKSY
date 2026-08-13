-- =============================================================
-- Trade Journal — v1
-- Adds: indicator snapshot captured on every fill, plus a journal
-- entry generated when a position is fully closed (round trip).
-- =============================================================

-- Snapshot of RSI/VWAP/volume-ratio at the exact moment a trade fills.
-- Captured once, at insert time, in executionEngine.js — never
-- recomputed later. NULL when indicators weren't available yet
-- (e.g. instrument just started ticking, or market-data pipeline was
-- briefly down) — the journal rule engine treats missing fields as
-- "no signal", it never guesses.
ALTER TABLE trades
  ADD COLUMN IF NOT EXISTS indicator_snapshot JSONB;

-- One row per completed round trip (position fully closed). Pairs the
-- trade that opened the position with the trade that closed it, plus
-- both indicator snapshots, so the card and the weekly pattern view
-- can be built without re-deriving anything from the raw trades table.
CREATE TABLE IF NOT EXISTS trade_journal_entries (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet_id        UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  position_id      UUID REFERENCES positions(id),
  instrument_key   VARCHAR(100) NOT NULL,
  symbol           VARCHAR(30) NOT NULL,
  name             VARCHAR(200),

  entry_trade_id   UUID REFERENCES trades(id),
  exit_trade_id    UUID NOT NULL REFERENCES trades(id),

  side             order_side NOT NULL,       -- BUY (long round trip) or SELL (short round trip)
  quantity         NUMERIC(12, 4) NOT NULL,
  entry_price      NUMERIC(18, 4),
  exit_price       NUMERIC(18, 4) NOT NULL,
  entry_at         TIMESTAMPTZ,
  exit_at          TIMESTAMPTZ NOT NULL,
  holding_seconds  INTEGER,
  realised_pnl     NUMERIC(18, 2) NOT NULL,

  entry_snapshot   JSONB,                     -- indicator_snapshot copied from entry trade
  exit_snapshot    JSONB,                     -- indicator_snapshot copied from exit trade

  rule_ids         TEXT[] NOT NULL DEFAULT '{}',  -- which rules fired, for the weekly pattern view
  insights         JSONB NOT NULL DEFAULT '[]',   -- rendered {ruleId, plainText, whyItHurt, tryNextTime, technicalText}[]

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_journal_user ON trade_journal_entries(user_id);
CREATE INDEX idx_journal_user_created ON trade_journal_entries(user_id, created_at DESC);
CREATE INDEX idx_journal_wallet ON trade_journal_entries(wallet_id);
-- GIN index so "how often did rule X fire this week" aggregations are cheap.
CREATE INDEX idx_journal_rule_ids ON trade_journal_entries USING GIN (rule_ids);
