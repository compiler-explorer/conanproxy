--------------------------------------------------------------------------------
-- Up
--------------------------------------------------------------------------------

-- The PRIMARY KEY on `latest` is (library, compiler, library_version, ...), with
-- `compiler` sitting between `library` and `library_version`. Lookups by
-- (library, library_version) -- the new /failedbuilds/:lib/:ver endpoint --
-- can only use the leading `library` prefix and degrade to a full scan filtered
-- by library_version. On a 177K-row DB on EBS gp2 that's ~11s cold. This index
-- makes the lookup O(log n).

CREATE INDEX IF NOT EXISTS idx_latest_lib_ver ON latest(library, library_version);

--------------------------------------------------------------------------------
-- Down
--------------------------------------------------------------------------------

DROP INDEX IF EXISTS idx_latest_lib_ver;
