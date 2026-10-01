CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  disabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower ON users(lower(email));
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS sessions_owner ON sessions(owner_id,expires_at);
CREATE TABLE IF NOT EXISTS rates (
  key TEXT PRIMARY KEY,
  window_start TIMESTAMPTZ NOT NULL,
  count INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS usage (
  id UUID PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK(kind IN ('generate','grade')),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  upstream_model TEXT NOT NULL,
  input_price NUMERIC NOT NULL,
  output_price NUMERIC NOT NULL,
  cached_price NUMERIC,
  reserved_usd NUMERIC NOT NULL,
  actual_usd NUMERIC,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cached_input_tokens INTEGER,
  reasoning_output_tokens INTEGER,
  status TEXT NOT NULL CHECK(status IN ('reserved','complete','uncertain','usage_unavailable')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS usage_owner ON usage(owner_id,created_at);
