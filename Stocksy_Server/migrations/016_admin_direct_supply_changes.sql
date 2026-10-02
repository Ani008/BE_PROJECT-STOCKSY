-- =============================================================
-- Simplify: admin enters a change -> applied to supply_links immediately.
-- No pending / approval. supply_change_reports becomes a plain
-- history log ("what changed, when, by whom").
-- Run after 015.
-- =============================================================

-- who is allowed to enter supply changes
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- no more PENDING / APPROVED
ALTER TABLE supply_change_reports DROP COLUMN IF EXISTS status;

-- Make yourself admin (change the email):
--   UPDATE users SET is_admin = TRUE WHERE email = 'your@email.com';