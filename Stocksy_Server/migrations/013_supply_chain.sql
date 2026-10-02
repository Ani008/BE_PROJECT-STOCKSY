-- =============================================================
-- STOCK GRAPH (supply chain) — v1
-- Adds: companies + supply_links.
--
-- Model: ONE row in supply_links = ONE arrow "supplier -> customer".
--   LEFT  side of a stock's graph  = rows where customer_id = that stock
--   RIGHT side of a stock's graph  = rows where supplier_id = that stock
-- Each relationship is stored once and shows up on both companies'
-- graphs automatically ("Coal India supplies NTPC" is also NTPC's
-- left side). Never insert the reverse arrow.
--
-- instrument_key is deliberately NOT stored here. The API looks it up
-- from config/instruments.js by nse_symbol, so there is no second copy
-- to drift out of date. A company is "tappable" in the app only if its
-- nse_symbol exists in instruments.js.
-- =============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- -------------------------------------------------------------
-- companies: every box that can appear on a graph, listed or not
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS companies (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  name          VARCHAR(200) NOT NULL,

  -- NSE ticker exactly as used in config/instruments.js (e.g. TATAMOTORS).
  -- NULL for unlisted / government / foreign companies.
  nse_symbol    VARCHAR(30) UNIQUE,

  -- listed      = trades on NSE
  -- unlisted    = private company or unlisted subsidiary
  -- government  = ministry, state utility, public body (e.g. Indian Railways)
  -- foreign     = company listed/based outside India
  company_type  VARCHAR(20) NOT NULL DEFAULT 'listed'
                CHECK (company_type IN ('listed', 'unlisted', 'government', 'foreign')),

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- a company marked "listed" must have a ticker
  CONSTRAINT chk_listed_has_symbol
    CHECK (company_type <> 'listed' OR nse_symbol IS NOT NULL)
);

-- stops "Tata Steel" being added twice under different rows
CREATE UNIQUE INDEX IF NOT EXISTS uq_companies_name_lower
  ON companies (LOWER(name));

-- -------------------------------------------------------------
-- supply_links: one arrow per row, supplier -> customer
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS supply_links (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  supplier_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  customer_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

  -- short label shown under the company name, e.g. 'Thermal coal'
  item          VARCHAR(120) NOT NULL,

  -- where the researcher found it (nullable for demo data)
  source_url    TEXT,
  confidence    VARCHAR(10) NOT NULL DEFAULT 'MEDIUM'
                CHECK (confidence IN ('HIGH', 'MEDIUM', 'LOW')),

  -- API only returns published rows. Seed demo data as TRUE,
  -- keep unreviewed research FALSE until a teammate verifies it.
  is_published  BOOLEAN NOT NULL DEFAULT FALSE,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_no_self_supply CHECK (supplier_id <> customer_id),
  CONSTRAINT uq_supply_link UNIQUE (supplier_id, customer_id, item)
);

-- left side of a graph:  WHERE customer_id = $1
-- right side of a graph: WHERE supplier_id = $1
CREATE INDEX IF NOT EXISTS idx_supply_links_customer ON supply_links (customer_id);
CREATE INDEX IF NOT EXISTS idx_supply_links_supplier ON supply_links (supplier_id);

-- -------------------------------------------------------------
-- updated_at triggers (set_updated_at() is created in 001_oms_schema.sql)
-- -------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_companies_updated ON companies;
CREATE TRIGGER trg_companies_updated
  BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_supply_links_updated ON supply_links;
CREATE TRIGGER trg_supply_links_updated
  BEFORE UPDATE ON supply_links
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -------------------------------------------------------------
-- VIEW (handy for debugging / the repository query):
-- one readable row per published arrow
-- -------------------------------------------------------------
CREATE OR REPLACE VIEW vw_supply_chain_edges AS
  SELECT
    l.id,
    s.name        AS supplier_name,
    s.nse_symbol  AS supplier_symbol,
    s.company_type AS supplier_type,
    c.name        AS customer_name,
    c.nse_symbol  AS customer_symbol,
    c.company_type AS customer_type,
    l.item,
    l.source_url,
    l.confidence
  FROM supply_links l
  JOIN companies s ON s.id = l.supplier_id
  JOIN companies c ON c.id = l.customer_id
  WHERE l.is_published = TRUE;

-- -------------------------------------------------------------
-- ROLLBACK (run manually if you need to undo this migration):
--   DROP VIEW  IF EXISTS vw_supply_chain_edges;
--   DROP TABLE IF EXISTS supply_links;
--   DROP TABLE IF EXISTS companies;
-- -------------------------------------------------------------
