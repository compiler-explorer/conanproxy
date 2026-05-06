--------------------------------------------------------------------------------
-- Up
--------------------------------------------------------------------------------

-- Migration 003 cleared `logging` for entries older than 2024-01-01. Since
-- then the DB has grown to ~17GB, dominated by the `logging` text column on
-- `latest` rows. Anything older than ~6 months is unlikely to be inspected
-- and the build log retained for it costs disk and per-row read cost
-- (the latter mostly fixed by the covering index in 005, but the disk space
-- and table scans elsewhere still benefit).
--
-- The cutoff is fixed; build_dt format is YYYYMMDDHHMMSS local time.
--
-- Note: this UPDATE doesn't shrink the DB file. Freed page bytes are reused
-- by future inserts; to reclaim disk space, run VACUUM in a maintenance
-- window after this migration is deployed (it's not part of the migration
-- because VACUUM cannot run inside the migration's transaction).

UPDATE latest
   SET logging = 'Log eliminated due to age'
 WHERE build_dt < 20251106000000
   AND logging IS NOT NULL
   AND logging != 'Log eliminated due to age';

--------------------------------------------------------------------------------
-- Down
--------------------------------------------------------------------------------
