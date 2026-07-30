-- =============================================================
-- ACCOUNT DELETION SUPPORT
-- =============================================================

-- ── Fix latent bug: `trades` currently has NO ON DELETE action on its
-- FKs (order_id, wallet_id, user_id), which defaults to NO ACTION.
-- orders/wallets/positions all CASCADE from users, but trades does NOT
-- cascade from orders/wallets — so deleting a user who has any trade
-- history would currently fail with a foreign key violation, since
-- Postgres tries to CASCADE-delete their orders while trades still
-- reference those orders. Fixing that here so account deletion actually
-- works end-to-end, not just for brand-new accounts with no trades.
ALTER TABLE trades DROP CONSTRAINT IF EXISTS trades_order_id_fkey;
ALTER TABLE trades
  ADD CONSTRAINT trades_order_id_fkey
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;

ALTER TABLE trades DROP CONSTRAINT IF EXISTS trades_wallet_id_fkey;
ALTER TABLE trades
  ADD CONSTRAINT trades_wallet_id_fkey
  FOREIGN KEY (wallet_id) REFERENCES wallets(id) ON DELETE CASCADE;

ALTER TABLE trades DROP CONSTRAINT IF EXISTS trades_user_id_fkey;
ALTER TABLE trades
  ADD CONSTRAINT trades_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- ── account_deletions — the permanent record kept AFTER a user deletes
-- their account.
--
-- Deliberately NOT a FK to users(id): the whole point is that this row
-- survives after the user row (and everything cascading from it —
-- wallets, positions, orders, trades, wallet_transactions,
-- account_transactions, order_events) is gone. It stores a lightweight
-- snapshot (who they were, what their account looked like at the moment
-- of deletion), not the full transactional history — that's an
-- intentional trade-off: real erasure of the person's data, with just
-- enough left behind for support/compliance/fraud-pattern lookups
-- ("did this email delete and re-create accounts to farm demo
-- balance?"), not a full duplicate ledger sitting outside the cascade.
CREATE TABLE IF NOT EXISTS account_deletions (
  id                            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  original_user_id              UUID NOT NULL,
  full_name                     VARCHAR(150),
  username                      VARCHAR(50),
  email                         VARCHAR(255) NOT NULL,
  provider                      VARCHAR(20),

  final_demo_balance            NUMERIC(18, 2) NOT NULL DEFAULT 0,
  wallets_closed                INTEGER NOT NULL DEFAULT 0,
  total_wallet_balance_debited  NUMERIC(18, 2) NOT NULL DEFAULT 0,
  open_positions_closed         INTEGER NOT NULL DEFAULT 0,
  total_orders_placed           INTEGER NOT NULL DEFAULT 0,
  total_trades_executed         INTEGER NOT NULL DEFAULT 0,

  account_created_at            TIMESTAMPTZ,
  deleted_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_account_deletions_email ON account_deletions(email);
CREATE INDEX IF NOT EXISTS idx_account_deletions_original_user ON account_deletions(original_user_id);
CREATE INDEX IF NOT EXISTS idx_account_deletions_deleted_at ON account_deletions(deleted_at DESC);