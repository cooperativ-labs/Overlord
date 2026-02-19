-- Make title nullable to allow AI-generated titles.
-- The UI derives a display title from the first 60 chars of `objective` when title is null.
ALTER TABLE tickets ALTER COLUMN title DROP NOT NULL;
