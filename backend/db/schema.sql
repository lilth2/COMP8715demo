-- Australian R&D Intelligent Directory — PostgreSQL schema (version 1)
--
-- Replaces the single-JSON-file store with real relational tables. The in-process rules
-- engine (admin/dataset-core.js) is unchanged: backend/db/pg-store.js loads these tables into
-- the same in-memory tree shape dataset-core.js already expects, applies operations with it,
-- then writes back only the rows that changed, inside one transaction.
--
-- Design notes:
--   * Every row that admins can edit directly carries a `version` integer, bumped on every
--     write, used for optimistic-concurrency checks (reject a save against a stale version
--     instead of silently overwriting a concurrent edit).
--   * `published_snapshot` is stored as JSONB because it is an opaque, already-validated copy
--     of the record at publish time (exactly what dataset-core.js produces) — not a substitute
--     for normalized columns, which is why every actual field also has its own column.
--   * relationship_types is new: it turns the relationship "type" from a hardcoded enum into
--     real reference data with a stable id, a separate editable display name, a colour, and a
--     flag protecting the two system types (hosted_by, shares_research_theme) that the rules
--     engine depends on structurally.

BEGIN;

CREATE TABLE IF NOT EXISTS schema_meta (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  version INTEGER NOT NULL
);

-- ---------------------------------------------------------------- accounts & sessions
CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL UNIQUE,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'stakeholder')),
  display_name TEXT,
  environment TEXT NOT NULL DEFAULT 'production' CHECK (environment IN ('production', 'uat')),
  disabled_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_accounts_role_env ON accounts (role, environment);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  remote_addr TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions (account_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);

-- ---------------------------------------------------------------------- reference data
CREATE TABLE IF NOT EXISTS relationship_types (
  id TEXT PRIMARY KEY CHECK (id ~ '^[a-z0-9_-]{1,80}$'),
  display_name TEXT NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 120),
  color TEXT,
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT
);

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY CHECK (id ~ '^[a-z0-9-]{1,120}$'),
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1
);

-- -------------------------------------------------------------------------- node tables
-- actors, projects and themes share the same lifecycle columns (status/published_snapshot/
-- version/audit fields); kept as three tables (not one polymorphic table) because each has a
-- distinct, meaningfully different column set, matching dataset-core.js's own COLLECTIONS.
CREATE TABLE IF NOT EXISTS actors (
  id TEXT PRIMARY KEY CHECK (id ~ '^[a-z0-9-]{1,120}$'),
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  state TEXT,
  summary TEXT NOT NULL DEFAULT '',
  data_confidence TEXT NOT NULL DEFAULT 'needs-review',
  sectors TEXT[] NOT NULL DEFAULT '{}',
  themes TEXT[] NOT NULL DEFAULT '{}',
  website TEXT,
  last_updated DATE,
  source_notes TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  published_snapshot JSONB,
  -- Cosmetic/display-only fields carried over from the original seed data (hostOrPartners,
  -- activeInitiatives, chiefScientist, capability, accessModel, collaborationSignal,
  -- industryPartners, relatedFacilities) that are not referenced by any constraint, foreign key
  -- or query in dataset-core.js. Kept as a bounded JSONB sidecar rather than new columns per
  -- field, and rather than this becoming the whole-record store the brief warns against: every
  -- field dataset-core.js actually validates, queries or joins on on (id, status, themes,
  -- website, confidence, relationships, etc.) is its own real column above.
  extra JSONB NOT NULL DEFAULT '{}'::jsonb,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id TEXT NOT NULL REFERENCES actors(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('head', 'branch')),
  state TEXT NOT NULL,
  city TEXT,
  focus TEXT,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_addresses_actor ON addresses (actor_id);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY CHECK (id ~ '^[a-z0-9-]{1,120}$'),
  name TEXT NOT NULL,
  host_id TEXT REFERENCES actors(id) ON DELETE SET NULL,
  state TEXT,
  summary TEXT NOT NULL DEFAULT '',
  data_confidence TEXT NOT NULL DEFAULT 'needs-review',
  themes TEXT[] NOT NULL DEFAULT '{}',
  last_updated DATE,
  evidence_snippet TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  published_snapshot JSONB,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS themes (
  id TEXT PRIMARY KEY CHECK (id ~ '^[a-z0-9-]{1,120}$'),
  name TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  data_confidence TEXT NOT NULL DEFAULT 'needs-review',
  last_updated DATE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  published_snapshot JSONB,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------- relationships
CREATE TABLE IF NOT EXISTS relationships (
  id TEXT PRIMARY KEY CHECK (id ~ '^[a-z0-9-]{1,120}$'),
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  type TEXT NOT NULL REFERENCES relationship_types(id),
  confidence TEXT NOT NULL DEFAULT 'needs-review',
  intensity TEXT NOT NULL DEFAULT 'weak' CHECK (intensity IN ('weak', 'medium', 'strong')),
  evidence TEXT NOT NULL DEFAULT '',
  last_updated DATE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  published_snapshot JSONB,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (source_id <> target_id)
);
CREATE INDEX IF NOT EXISTS idx_relationships_source ON relationships (source_id);
CREATE INDEX IF NOT EXISTS idx_relationships_target ON relationships (target_id);
CREATE INDEX IF NOT EXISTS idx_relationships_type ON relationships (type);
-- Node ids are unique across actors/projects/themes at the application layer (dataset-core.js
-- enforces this); no cross-table FK is possible in Postgres for a polymorphic reference, so
-- source_id/target_id are validated by the application before every write, same as today.

CREATE TABLE IF NOT EXISTS layout_positions (
  node_id TEXT PRIMARY KEY,
  x DOUBLE PRECISION NOT NULL,
  y DOUBLE PRECISION NOT NULL
);

-- -------------------------------------------------------------------------- import tracking
CREATE TABLE IF NOT EXISTS import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_filename TEXT NOT NULL,
  file_fingerprint TEXT NOT NULL,
  sheet_name TEXT,
  imported_by TEXT NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  mode TEXT NOT NULL CHECK (mode IN ('add-only', 'update-by-id')),
  row_count INTEGER NOT NULL DEFAULT 0,
  created_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'committed' CHECK (status IN ('committed', 'rolled-back'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_import_batches_fingerprint ON import_batches (file_fingerprint, sheet_name)
  WHERE status = 'committed';

CREATE TABLE IF NOT EXISTS import_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  source_row_number INTEGER NOT NULL,
  record_type TEXT NOT NULL,
  record_id TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('created', 'updated', 'skipped', 'error')),
  detail TEXT,
  raw_row JSONB
);
CREATE INDEX IF NOT EXISTS idx_import_rows_batch ON import_rows (batch_id);

-- -------------------------------------------------------------------------------- audit log
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "timestamp" TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  record_type TEXT NOT NULL,
  record_id TEXT,
  batch_id UUID REFERENCES import_batches(id) ON DELETE SET NULL,
  label TEXT,
  details TEXT,
  result TEXT NOT NULL DEFAULT 'success' CHECK (result IN ('success', 'denied', 'error'))
);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log ("timestamp" DESC);

-- ------------------------------------------------------------------------------- feedback
CREATE TABLE IF NOT EXISTS feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('bug', 'suggestion')),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  description TEXT NOT NULL,
  repro_steps TEXT,
  expected_result TEXT,
  actual_result TEXT,
  related_page TEXT,
  related_record_id TEXT,
  screenshot_path TEXT,
  submitted_by UUID NOT NULL REFERENCES accounts(id),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  app_version TEXT,
  current_page TEXT,
  request_id TEXT,
  idempotency_key TEXT,
  status TEXT NOT NULL DEFAULT 'New' CHECK (status IN ('New', 'Investigating', 'Fixed', 'Ready for retest', 'Closed')),
  status_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status_updated_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_feedback_submitted_by ON feedback (submitted_by);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback (status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_feedback_idempotency ON feedback (submitted_by, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

INSERT INTO schema_meta (id, version) VALUES (1, 1)
  ON CONFLICT (id) DO NOTHING;

INSERT INTO relationship_types (id, display_name, color, is_system) VALUES
  ('collaborates_with', 'Collaborates with', '#2a78d6', false),
  ('funded_by', 'Funded by', '#eb6834', false),
  ('hosted_by', 'Hosted by', '#5b6472', true),
  ('provides_infrastructure_to', 'Provides infrastructure to', '#1baf7a', false),
  ('supports_sector', 'Supports sector', '#eb6834', false),
  ('shares_research_theme', 'Shares research theme', '#8b1b61', true),
  ('located_in_precinct', 'Located in precinct', '#1baf7a', false),
  ('industry_partner_of', 'Industry partner of', '#eb6834', false),
  ('potential_connection', 'Potential connection', '#aab2c0', false)
ON CONFLICT (id) DO NOTHING;

COMMIT;
