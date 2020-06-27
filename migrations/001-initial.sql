--------------------------------------------------------------------------------
-- Up
--------------------------------------------------------------------------------

CREATE TABLE latest (
    library TEXT NOT NULL,
    library_version TEXT NOT NULL,
    compiler TEXT NOT NULL,
    compiler_version TEXT NOT NULL,
    build_dt INTEGER NOT NULL,
    compiler_libcxx TEXT NOT NULL,
    compiler_flags TEXT NOT NULL,
    succes INTEGER NOT NULL,
    logging TEXT,
    PRIMARY KEY (library,compiler,library_version,compiler_version,compiler_libcxx,compiler_flags)
);

--------------------------------------------------------------------------------
-- Down
--------------------------------------------------------------------------------

DROP TABLE latest;
