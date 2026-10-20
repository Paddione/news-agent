-- Topic groups: a hand-set weight over several topics. A topic's effective weight is its own times its group's.
CREATE TABLE topic_groups (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  weight REAL NOT NULL DEFAULT 1.0,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

ALTER TABLE keywords ADD COLUMN group_id INTEGER REFERENCES topic_groups (id) ON DELETE SET NULL;
