-- =============================================================
-- SUPPLY CHANGE REPORTS
-- A user files a form when a company changes a supplier/customer
-- (e.g. "Tata Steel replaced supplier X with Y").
-- Stored as PENDING; a reviewer can later approve it and apply it
-- to supply_links. Depends on 013_supply_chain.sql.
-- =============================================================

CREATE TABLE IF NOT EXISTS supply_change_reports (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- the company whose graph changed (the centre of the graph)
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

  submitted_by    UUID REFERENCES users(id) ON DELETE SET NULL,

  -- which side of the graph changed
  relation_side   VARCHAR(10) NOT NULL
                  CHECK (relation_side IN ('SUPPLIER', 'CUSTOMER')),

  -- REPLACED = old -> new, ADDED = new only, REMOVED = old only
  change_type     VARCHAR(10) NOT NULL
                  CHECK (change_type IN ('REPLACED', 'ADDED', 'REMOVED')),

  -- Free-text names as typed in the form. The *_id columns are filled
  -- when the name/symbol matches a row in companies, else stay NULL.
  old_party_name  VARCHAR(200),
  old_party_id    UUID REFERENCES companies(id) ON DELETE SET NULL,
  new_party_name  VARCHAR(200),
  new_party_id    UUID REFERENCES companies(id) ON DELETE SET NULL,

  item            VARCHAR(120) NOT NULL,   -- e.g. 'Iron ore'
  reason          TEXT,
  source_url      TEXT,
  effective_date  DATE,

  status          VARCHAR(10) NOT NULL DEFAULT 'PENDING'
                  CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_change_parties CHECK (
    (change_type = 'REPLACED' AND old_party_name IS NOT NULL AND new_party_name IS NOT NULL) OR
    (change_type = 'ADDED'    AND new_party_name IS NOT NULL) OR
    (change_type = 'REMOVED'  AND old_party_name IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_scr_company   ON supply_change_reports (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scr_submitter ON supply_change_reports (submitted_by);
CREATE INDEX IF NOT EXISTS idx_scr_status    ON supply_change_reports (status);

DROP TRIGGER IF EXISTS trg_scr_updated ON supply_change_reports;
CREATE TRIGGER trg_scr_updated
  BEFORE UPDATE ON supply_change_reports
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ROLLBACK:
--   DROP TABLE IF EXISTS supply_change_reports;