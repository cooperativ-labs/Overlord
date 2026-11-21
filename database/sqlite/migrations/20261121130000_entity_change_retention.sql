PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS entity_change_retention (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  retained_through INTEGER NOT NULL DEFAULT 0 CHECK (retained_through >= 0)
);
INSERT OR IGNORE INTO entity_change_retention (id, retained_through) VALUES (1, 0);
