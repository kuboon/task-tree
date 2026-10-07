-- Key-value storage for DPoP sessions (web/server/lib/kv_d1.ts).
CREATE TABLE kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  expires_at INTEGER,
  version INTEGER NOT NULL DEFAULT 0
);
