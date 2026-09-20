
# API

The proxy forwards all /v1 and /v2 API calls to Conan, everything there should be as usual.

Note that the Conan passthrough only ever lists packages that *exist*. If a library/compiler
combination is absent from `/v1` (or from `/binaries`), that says nothing about why: it may never
have been attempted, or it may have been attempted and failed. The endpoints under
[Build failures and logs](#build-failures-and-logs) are what tell those two cases apart.

## Listings

### GET `/libraries`

To get a list of available libraries and versions, this includes library and version information from Compiler-Explorer.

### GET `/libraries/cpp`, `/libraries/rust`, `/libraries/fortran`, `/libraries/go`

The same document as `/libraries`, filtered down to the libraries of one language. Anything not
tagged with that language is left out; the entries themselves are unchanged.

### GET `/binaries/:libraryid/:version`

To get a list of available binaries and for what compiler and configuration they were built.

Note: version here needs to be a full version name (e.g. 7.0.0 and not 700)


### GET `/compilerfailurerates`

A list to indicate the failure rate of compilers (comparatively, not exactly)


### GET `/allfailedbuilds`

A complete list of recently failed builds.

This list is unsorted and unfiltered. This might change in the future.

### POST `/hasfailedbefore`

To query if a certain build configuration has failed before for a particular library and version.

The name is somewhat of a misnomer, as it will not return true if the build has succeeded recently or if it was never built.

Payload example:
```
{
    "library": "fmt",
    "library_version": "4.0.0",
    "compiler": "gcc",
    "compiler_version": "gcc-embed-trunk",
    "arch": "x86_64",
    "libcxx": "libstdc++",
    "flagcollection": ""
}
```

Returns:
```
{
    "response": true
}
```


### POST `/whathasfailedbefore`

To query if a certain build configuration has failed before for a particular library and version.

If the build has failed before, it will include the commithash with which it failed (if that was supplied with `/buildfailed`)

Payload example:
```
{
    "library": "fmt",
    "library_version": "4.0.0",
    "compiler": "gcc",
    "compiler_version": "gcc-embed-trunk",
    "arch": "x86_64",
    "libcxx": "libstdc++",
    "flagcollection": ""
}
```

Returns:
```
{
    "response": true,
    "commithash": "1234abcd"
}
```

### GET `/annotations/:libraryid/:version`

Every annotation held for a library version, in one call, rather than one build hash at a time.

Returns an array with one entry per build hash found on disk, each holding the `annotation` (the
same document the call below returns) and the `buildinfo` read from Conan's own `conaninfo.txt`:

```
[
    {
        "buildhash": "16ee6b51398740e37d34e117ee3defa26bd4104e",
        "annotation": { "commithash": "7eddbfed", "cxx11": true, ... },
        "buildinfo": { ... }
    }
]
```

Returns an empty array if the library version has no packages at all.

### GET `/annotations/:libraryid/:version/:buildhash`

Annotations are json documents that are saved next to a certain library version and build.

This usually includes the commit hash (if built nightly), whether or not the binary is probably cxx11 ABI compatible, and which machine and OS ABI was detected by readelf.

Example:

`/annotations/fmt/trunk/16ee6b51398740e37d34e117ee3defa26bd4104e`

Returns:
```
{
    "commithash": "7eddbfed",
    "cxx11": true,
    "machine": "Intel 80386",
    "osabi": "UNIX - GNU"
}
```


## Downloads

These redirect (302) to the package tarball on the Conan server rather than serving it themselves.

Packages for proprietary compilers (Intel ICC, MSVC, QNX, EDG) are never handed out. The
five-argument form below rejects them with a 403; the three-argument form usually returns 404
instead, because those compilers have more than one binary per library version and so fail its
single-binary check before the restriction is even consulted.

### GET `/downloadcshared/:libraryid/:version`

Redirects to the `cshared` build of a library version — the one built for use from C. Only works
when exactly one `cshared` binary exists for that version; returns 404 otherwise.

### GET `/downloadpkg/:libraryid/:version/:compiler`

Redirects to the package built by a given compiler, e.g. `/downloadpkg/fmt/10.0.0/g131`.

This only resolves when that compiler has exactly one binary for the version. A library built for
several architectures or standard libraries will have more than one, so use the five-argument form
below for those. Returns 404 when nothing matches.

### GET `/downloadpkg/:library/:library_version/:compiler_version/:arch/:libcxx`

Redirects to the package for one fully specified build combination, e.g.
`/downloadpkg/fmt/10.0.0/g131/x86_64/libstdc%2B%2B`.

`libcxx` needs url-encoding: `libstdc++` becomes `libstdc%2B%2B`. Combinations with no architecture
or no libcxx are addressed with a literal space (`%20`) in that position, since an empty path
segment would not route.

Returns 404 when nothing matches.


## Build failures and logs

A build that is missing from Conan was either never attempted or attempted and failed. These are
the endpoints that say which.

### GET `/failedbuilds/:library/:library_version`

The build combinations that were attempted for a library version and failed, one record per
combination:

```
[
    {
        "compiler": "gcc",
        "compiler_version": "g161",
        "arch": "x86_64",
        "libcxx": "libstdc++",
        "compiler_flags": "",
        "commithash": "6.7.0"
    }
]
```

The absence of a combination here means it was never attempted; its presence means it was attempted
and failed. That distinction is the point of this endpoint — Conan itself cannot tell you the
difference, because it only ever lists packages that exist.

Only failures are returned; successful builds are not listed. Use the `commithash` from a record
here as the `:commithash` for `/getlogging_forcommit` below.

### GET `/getlogging/:library/:library_version/:arch/:dt`

The stored build log for a library version, architecture and build timestamp, served as a text
attachment.

`:dt` is the `build_dt` of the build, in `YYYYMMDDHHMMSS` form, as returned by `/allfailedbuilds`.
An architecture that is empty is addressed with a literal space (`%20`). If several builds share
that timestamp and architecture, their logs are concatenated, separated by
`--- More entries ---`. Returns 404 when no log is stored, and logs trimmed by the age-based
cleanup come back as the single line `Log eliminated due to age`.

Both logging endpoints send `Content-Type: text/html` regardless of content; it is the
`Content-Disposition` header that makes browsers save it as a `.txt` file.

### GET `/getlogging_forcommit/:library/:library_version/:commithash/:compiler_version/:arch/:libcxx`

The stored build log for one exact build combination, served as a text attachment. This is usually
the one you want after `/failedbuilds` has told you which combination failed.

```
/getlogging_forcommit/qt/6.7.0/6.7.0/g161/x86_64/libstdc%2B%2B
```

Two things to watch:

* `libcxx` needs url-encoding — `libstdc++` is `libstdc%2B%2B` — and an empty `arch` or `libcxx` is
  addressed with a literal space (`%20`).
* `:commithash` is whatever was recorded with `/buildfailed`, which for a released library version
  is frequently just the version string (`6.7.0`) rather than a git hash. Take it from the
  `/failedbuilds` record or from `/whathasfailedbefore`, both of which return it, instead of
  guessing.

What comes back is the whole captured build output, which begins with the generated `#!/bin/sh`
build script — compiler paths, flags, the `cmake` invocation — and only then the compiler output.
The first screenful is therefore never the failure; the logs run to hundreds of kilobytes, so skip
to the end.

Returns 404 when no log is stored for that combination.

### GET `/cpp_library_build_results/:library/:library_version/:commit_hash`

An **HTML** page (not JSON) summarising how one commit of a library built across every compiler,
with per-compiler links to the log or to the package. Build history comes from the DynamoDB
`library-build-history` table, so this covers more than the recent failures in the local database.

```
/cpp_library_build_results/fmt/trunk/7eddbfed
```

A `?allcompilers=1` query parameter is accepted and currently has no effect — the compressed view
it used to select is commented out in the template.

### GET `/cpp_compiler_build_results/:compiler_id`

An **HTML** page (not JSON), the same data from the other direction: how every library fared for
one compiler, e.g. `/cpp_compiler_build_results/g161`. Also sourced from DynamoDB, and covers all
architecture/libcxx variants of that compiler id.


## Service

### GET `/healthcheck`

Returns `OK`. No authentication.

### GET `/reinitialize`

Re-reads everything the proxy caches at startup: the compiler and library lists from
Compiler-Explorer, the packages on the Conan server, the library repository mapping and the
compiler variants. Returns `done` once that has finished.

No authentication, and it does real work on every call, so do not put it behind anything that
retries.

## Secure API

The following calls require authentication. This is done by posting to `/login` and using the resulting token in the `Authentication` header.


### POST `/login`

Login requires only a password. When it matches to the known password, this will return token to be used in calls that require authentication.

Payload example:
```
{
    "password": "123"
}
```

Returns:
```
{
    "token": "abcdefg..."
}
```

Subsequent calls will require the token to be used in the `Authentication` header.

In this examples' case:

* `Authentication: Bearer abcdefg...`


### POST `/annotations/:libraryid/:version/:buildhash`

Save a json document to a specific library version and buildhash. The build needs to be available in Conan for this call to succeed.


### POST `/buildfailed`

Indicate that a build has failed. Can include logging.

Payload example:
```
{
    "library": "fmt",
    "library_version": "4.0.0",
    "compiler": "gcc",
    "compiler_version": "gcc-embed-trunk",
    "arch": "x86_64",
    "libcxx": "libstdc++",
    "flagcollection": "",
    "logging": "This was a complete failure, never try to build this again!",
    "commithash": "1234abcd"
}
```


### POST `/buildsuccess`

Indicate that a build has succeeded. This actually clears the buildfailed status for the given library version and configuration.

Payload example:
```
{
    "library": "fmt",
    "library_version": "4.0.0",
    "compiler": "gcc",
    "compiler_version": "g101",
    "arch": "x86_64",
    "libcxx": "libstdc++",
    "flagcollection": ""
}
```


### POST `/clearbuildstatusforcompiler`

For when a compiler has been fixed and libraries should attempt to build for this compiler again.

Payload example:
```
{
    "compiler": "gcc",
    "compiler_version": "g101"
}
```


### POST `/clearbuildstatusforlibrary`

Clear build failure status for a library so builds will be re-attempted. Optionally filter by version.

Payload example (clear all versions):
```
{
    "library": "fmt"
}
```

Payload example (clear specific version):
```
{
    "library": "fmt",
    "library_version": "10.0.0"
}
```
