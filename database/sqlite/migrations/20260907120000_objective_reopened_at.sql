-- Explicit objective run boundary (coo:879, contract v133).
--
-- A completed objective can be set back to draft and run again, and every
-- delivery, terminal session, and file change from the earlier run is kept.
-- Until now the mission panel had to guess where one run ended and the next
-- began from delivery order, which fails when a run leaves no delivery or more
-- than one, and `completed_at` cannot help because re-completion overwrites it.
--
-- `reopened_at` is stamped by the objective update transaction whenever an
-- objective that has already executed (`executing`, `pending_delivery`, or
-- `complete`) is set back to `draft`. It is last-wins, so it always marks the
-- start of the latest run: evidence rows at or after it belong to that run,
-- rows before it to earlier runs. A post-delivery re-attach is not a reopen.
-- No backfill: rows that predate the column keep the delivery-order fallback.

PRAGMA foreign_keys = ON;

ALTER TABLE objectives ADD COLUMN reopened_at TEXT
  CHECK (reopened_at IS NULL OR reopened_at GLOB '????-??-??T??:??:??.???Z');
