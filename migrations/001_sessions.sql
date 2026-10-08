CREATE TABLE IF NOT EXISTS twinwatch_sessions (
  owner_hash text NOT NULL,
  id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  data jsonb NOT NULL,
  PRIMARY KEY (owner_hash, id)
);
CREATE INDEX IF NOT EXISTS idx_twinwatch_sessions_owner_created ON twinwatch_sessions (owner_hash, created_at DESC);
