
# API

The proxy forwards all /v1 and /v2 API calls to Conan, everything there should be as usual.

## Listings

### GET `/libraries`

To get a list of available libraries and versions, this includes library and version information from Compiler-Explorer.

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
