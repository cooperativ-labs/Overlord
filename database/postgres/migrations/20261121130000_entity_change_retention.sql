CREATE TABLE IF NOT EXISTS entity_change_retention (
  id integer PRIMARY KEY CHECK (id = 1),
  retained_through bigint NOT NULL DEFAULT 0 CHECK (retained_through >= 0)
);
INSERT INTO entity_change_retention (id, retained_through) VALUES (1, 0) ON CONFLICT DO NOTHING;
