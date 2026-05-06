--------------------------------------------------------------------------------
-- Up
--------------------------------------------------------------------------------

-- /failedbuilds reads (compiler, compiler_version, arch, libcxx,
-- compiler_flags, commithash) for every row matching (library,
-- library_version, success=0). The PR #72 index made the lookup fast, but
-- SQLite still has to read each row from the table to extract those
-- columns -- and the `latest` table has a large `logging` column (build
-- log text, often tens of KB) so each row sits in its own page or two.
-- For boost_bin/1.85.0 (~113 rows) that's ~10MB of mostly-irrelevant log
-- data per cold query, which on EBS gp2 takes 8-15s.
--
-- A covering index that includes all SELECT columns turns the query
-- index-only: no row reads, no `logging` payload. Index size: ~177K rows
-- * ~150 bytes = ~26MB, easily cached in RAM.
--
-- The previous narrower index is dropped because the new one's leading
-- prefix (library, library_version) serves the same single-key lookups.

DROP INDEX IF EXISTS idx_latest_lib_ver;

CREATE INDEX IF NOT EXISTS idx_latest_failedbuilds
    ON latest(library, library_version, success, compiler, compiler_version, arch, libcxx, compiler_flags, commithash);

--------------------------------------------------------------------------------
-- Down
--------------------------------------------------------------------------------

DROP INDEX IF EXISTS idx_latest_failedbuilds;
CREATE INDEX IF NOT EXISTS idx_latest_lib_ver ON latest(library, library_version);
