-- =============================================================
-- PRICE ALERTS (notify-only — no auto order placement)
-- =============================================================

CREATE TYPE alert_direction AS ENUM ('ABOVE', 'BELOW');
CREATE TYPE alert_status AS ENUM ('ACTIVE', 'TRIGGERED', 'CANCELLED');

CREATE TABLE IF NOT EXISTS price_alerts (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  instrument_key   VARCHAR(100) NOT NULL,
  symbol           VARCHAR(30) NOT NULL,
  name             VARCHAR(200),

  target_price     NUMERIC(18, 4) NOT NULL CHECK (target_price > 0),

  -- ABOVE = notify once LTP rises to/above target_price (set when target
  --         was above the price at creation time — "notify me if it goes up to X")
  -- BELOW = notify once LTP falls to/below target_price ("notify me if it dips to X")
  -- Decided automatically at creation time by comparing target_price to the
  -- live price then — the person only ever enters one number, same as
  -- Zerodha/Groww's simple alert flow.
  direction        alert_direction NOT NULL,

  status           alert_status NOT NULL DEFAULT 'ACTIVE',
  triggered_at     TIMESTAMPTZ,
  triggered_price  NUMERIC(18, 4),

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_price_alerts_user ON price_alerts(user_id);
CREATE INDEX idx_price_alerts_status ON price_alerts(status);
CREATE INDEX idx_price_alerts_instrument ON price_alerts(instrument_key);