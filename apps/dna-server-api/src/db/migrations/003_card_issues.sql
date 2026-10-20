-- A card turned into a GitHub issue: one issue per card, in the configured inbox repo.
CREATE TABLE card_issues (
  card_id INTEGER PRIMARY KEY REFERENCES cards (id),
  repo TEXT NOT NULL,
  number INTEGER NOT NULL,
  url TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
);
