CREATE TABLE investigations (
  repo TEXT NOT NULL,
  number INTEGER NOT NULL,
  card_id INTEGER REFERENCES cards (id),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'done', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  route TEXT CHECK (route IN ('local', 'fallback')),
  model TEXT,
  report_md TEXT,
  targets_json TEXT,
  comment_url TEXT,
  error TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (repo, number)
);
