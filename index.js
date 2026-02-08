const
    _ = require('underscore'),
    fs = require('fs').promises,
    { BuildAnnotations, RemoteAnnotations } = require('./build-annotations'),
    { BuildLogging } = require('./build-logging'),
    { CppBuildResultsView } = require('./cpp-build-results'),
    { is_restricted_compiler } = require('./compiler-restrictions'),
    path = require('path'),
    express = require('express'),
    { expressjwt } = require('express-jwt'),
    jwt = require('jsonwebtoken'),
    cors = require('cors'),
    httpProxy = require('http-proxy'),
    http = require('http'),
    https = require('https');

const
    webServer = express();

const conanserverurl = process.env.CONANSERVERURL || 'http://127.0.0.1:9300';
const ceserverurl = 'https://godbolt.org';

const userhome = "/home/ce";
const conanserverroot = userhome + "/.conan_server";
const buildlogspath = conanserverroot + '/buildslogs.db';

let compilernames = null;
let compilersemvers = null;
let allRustLibrariesAndVersions = null;
let allCppLibrariesAndVersions = null;
let allFortranLibrariesAndVersions = null;
let allGoLibrariesAndVersions = null;

let availableLibrariesAndVersions = {};
let availableLibraryIds = [];

let modifiedDt = null;

const annotations = new BuildAnnotations(conanserverroot);
const buildlogging = new BuildLogging(buildlogspath);
const jwtsecret = process.env.CESECRET;
const cepassword = process.env.CEPASSWORD;

async function getConanBinaries(library, version) {
    return new Promise((resolve, reject) => {
        const filteredlibrary = library.match(/([\w_-]*)/i)[1];
        const filteredversion = version.match(/([\w0-9_.-]*)/i)[1];
        if (filteredlibrary && filteredversion) {
            const libandver = `${filteredlibrary}/${filteredversion}`;

            const url = `${conanserverurl}/v1/conans/${libandver}/${libandver}/search`;
            http.get(url, (resp) => {
                let data = '';
                resp.on('data', (chunk) => data += chunk);
                resp.on('end', () => {
                    let jsdata = null;
                    try {
                        jsdata = JSON.parse(data);
                    } catch (e) {
                        reject(e);
                        return;
                    }

                    const setPerCompiler = {};
                    const setOfCombinations = [];
                    _.each(jsdata, (obj, hash) => {
                        const compilerid = obj.settings['compiler.version'];
                        const compilername = compilernames[compilerid];
                        const compilertype = obj.settings['compiler'];
                        const relevantSettings = _.omit(obj.settings, (val, key) => key.indexOf('compiler') === 0 &&
                            key.indexOf('compiler.libcxx') === -1);
                        const settingsWithoutCompiler = JSON.stringify(relevantSettings);

                        let idx = setOfCombinations.indexOf(settingsWithoutCompiler);
                        if (idx === -1) {
                            idx = setOfCombinations.length;
                            setOfCombinations.push(settingsWithoutCompiler);
                        }

                        if (!setPerCompiler[compilerid]) {
                            setPerCompiler[compilerid] = {
                                name: compilername,
                                compilertype: compilertype,
                                is_restricted: is_restricted_compiler(compilerid, compilertype),
                                combinations: [],
                                hashes: []
                            };
                        }

                        setPerCompiler[compilerid].combinations.push(idx);
                        setPerCompiler[compilerid].hashes.push(hash);
                    });

                    const orderedByCompilerId = {};
                    Object.keys(setPerCompiler).sort().forEach((key) => {
                        orderedByCompilerId[key] = setPerCompiler[key];
                    });

                    resolve({
                        possibleCombinations: _.map(setOfCombinations, (combo) => JSON.parse(combo)),
                        perCompiler: orderedByCompilerId
                    });
                });
            }).on('error', (err) => {
                reject(err);
            });
        } else {
            reject('Not a valid library or version');
        }
    });
}

async function getPackageUrl(libid, version, hash) {
    return new Promise((resolve, reject) => {
        const encLibid = encodeURIComponent(libid);
        const encVersion = encodeURIComponent(version);
        const libUrl = `${conanserverurl}/v1/conans/${encLibid}/${encVersion}/${encLibid}/${encVersion}`;
        const url = `${libUrl}/packages/${hash}/download_urls`;

        http.get(url, (resp) => {
            let data = '';
            resp.on('data', (chunk) => data += chunk);
            resp.on('end', () => {
                let jsdata = null;
                try {
                    jsdata = JSON.parse(data);
                    resolve(jsdata);
                    return;
                } catch (e) {
                    reject(`No package found at ${url}`);
                    return;
                }
            });
        }).on('error', (err) => {
            reject(err);
        });
    });
}

async function refreshCECompilers() {
    return new Promise((resolve, reject) => {
        https.get(`${ceserverurl}/api/compilers`, { headers: { Accept: 'application/json' } }, (resp) => {
            let data = '';
            resp.on('data', (chunk) => data += chunk);
            resp.on('end', () => {
                const jsdata = JSON.parse(data);
                const compilers = {};
                const compilers_semvers = {};
                _.each(jsdata, (obj) => {
                    compilers[obj.id] = obj.name;
                    compilers_semvers[obj.id] = obj.semver;
                });
                compilernames = compilers;
                compilersemvers = compilers_semvers;
                resolve(true);
            });
        }).on('error', (err) => {
            console.error(err);
            reject(err);
        });
    });
}

function fetchCELibraries(language) {
    return new Promise((resolve, reject) => {
        https.get(`${ceserverurl}/api/libraries/${language}`, { headers: { Accept: 'application/json' } }, (resp) => {
            let data = '';
            resp.on('data', (chunk) => data += chunk);
            resp.on('end', () => {
                resolve(JSON.parse(data));
            });
        }).on('error', (err) => {
            console.error(err);
            reject(err);
        });
    });
}

async function refreshCELibraries() {
    const [cpp, rust, fortran, go] = await Promise.all([
        fetchCELibraries('c++'),
        fetchCELibraries('rust'),
        fetchCELibraries('fortran'),
        fetchCELibraries('go'),
    ]);
    allCppLibrariesAndVersions = cpp;
    allRustLibrariesAndVersions = rust;
    allFortranLibrariesAndVersions = fortran;
    allGoLibrariesAndVersions = go;
}

function newProxy() {
    const proxy = httpProxy.createProxyServer({});

    proxy.on('proxyReq', function (proxyReq, req) {
        if (!req.body || !Object.keys(req.body).length) {
            return;
        }

        const contentType = proxyReq.getHeader('Content-Type');
        let bodyData;

        if (contentType === 'application/json') {
            bodyData = JSON.stringify(req.body);
        }

        if (contentType === 'application/x-www-form-urlencoded') {
            if (typeof req.body !== 'string') {
                bodyData = _.map(req.body, (value, key) => {
                    return encodeURIComponent(key) + '=' + encodeURIComponent(value);
                }).join('&');
            } else {
                bodyData = req.body;
            }
        }

        if (bodyData) {
            proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
            proxyReq.write(bodyData);
        }
    });

    return proxy;
}

async function refreshConanLibraries(forceall) {
    availableLibraryIds = [];
    availableLibrariesAndVersions = {};
    const reDot = new RegExp(/\./, 'g');

    fs.opendir(`${conanserverroot}/data`).then(async (libraryDirs) => {
        for await (const libraryDir of libraryDirs) {
            const libraryId = libraryDir.name;
            availableLibraryIds.push(libraryId);
            let language = 'cpp';
            let ceLib;

            if (libraryId.startsWith('go_')) {
                ceLib = _.find(allGoLibrariesAndVersions, (lib) => `go_${lib.id}` === libraryId);
                if (ceLib) language = 'go';
            } else {
                ceLib = _.find(allCppLibrariesAndVersions, (lib) => lib.id === libraryId);
                if (!ceLib) {
                    ceLib = _.find(allRustLibrariesAndVersions, (lib) => lib.id === libraryId);
                    if (ceLib) {
                        language = 'rust';
                    } else {
                        ceLib = _.find(allFortranLibrariesAndVersions, (lib) => lib.id === libraryId);
                        if (ceLib) {
                            language = 'fortran';
                        } else {
                            ceLib = _.find(allGoLibrariesAndVersions, (lib) => lib.id === libraryId);
                            if (ceLib) language = 'go';
                        }
                    }
                }
            }

            if (!ceLib && forceall) ceLib = { name: libraryId, versions: {} };

            if (ceLib) {
                fs.opendir(`${conanserverroot}/data/${libraryId}`).then(async (versionDirs) => {
                    for await (const versionDir of versionDirs) {
                        let ceVersion = _.find(ceLib.versions, ver => ver.version === versionDir.name || ver.lookupversion === versionDir.name);
                        if (!ceVersion && forceall) ceVersion = { id: versionDir.name.replace(reDot, '') };
                        if (ceVersion) {
                            if (!availableLibrariesAndVersions[libraryId]) {
                                availableLibrariesAndVersions[libraryId] = {
                                    name: ceLib.name,
                                    language: language,
                                    versions: {}
                                };
                            }

                            availableLibrariesAndVersions[libraryId].versions[ceVersion.id] = versionDir.name;
                        }
                    }
                });
            }
        }
    });
}

function nocache(req, res, next) {
    res.header('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    res.header('Expires', '-1');
    res.header('Pragma', 'no-cache');
    next();
}

function expireshourly(req, res, next) {
    res.header('Cache-Control', 'max-age=3600, must-revalidate');
    next();
}

function libraryexpireheaders(req, res, next) {
    res.header('Cache-Control', 'max-age=3600, must-revalidate');
    res.header('Last-Modified', modifiedDt);
    next();
}

async function login(password) {
    return new Promise((resolve, reject) => {
        if (password === cepassword) {
            resolve({
                token: jwt.sign({
                    sub: {
                        admin: true,
                        logintime: new Date().toUTCString()
                    }
                }, jwtsecret, {
                    algorithm: 'HS256',
                    expiresIn: '12h'
                })
            });
        } else {
            reject('Invalid login');
        }
    });
}

function main() {
    modifiedDt = new Date();
    const proxy = newProxy();

    webServer
        .use(cors())
        .use(express.json({
            limit: '10mb'
        }))
        .use(express.urlencoded({
            limit: '10mb'
        }))
        .use(expressjwt({
            secret: jwtsecret,
            algorithms: ['HS256']
        }).unless({
            path: [
                '/',
                '/index.html',
                '/libraries.html',
                '/libraries_rust.html',
                '/libraries_cpp.html',
                '/libraries_fortran.html',
                '/libraries_go.html',
                '/compilerfailurerates.html',
                '/failedbuilds.html',
                '/usage.html',
                '/usage-d3.html',
                '/compiler_usage.html',
                '/conan.css',
                '/favicon.ico',
                '/login',
                '/healthcheck',
                '/reinitialize',
                '/libraries/cpp',
                '/libraries/rust',
                '/libraries/fortran',
                '/libraries/go',
                '/libraries',
                '/compilerfailurerates',
                '/hasfailedbefore',
                '/whathasfailedbefore',
                '/allfailedbuilds',
                '/gh-commits.js',
                /^\/getlogging\/.*/,
                /^\/getlogging_forcommit\/.*/,
                /^\/binaries\/.*/,
                /^\/downloadcshared\/.*/,
                /^\/downloadpkg\/.*/,
                /^\/cpp_library_build_results\/.*/,
                '/fontawesome-free.min.css',
                /^\/webfonts\/.*/,
                {
                    url: /^\/annotations\/.*/,
                    methods: ['GET', 'OPTIONS']
                },
                /^\/v1\/.*/,
                /^\/v2\/.*/
            ]
        }))
        .post('/login', nocache, async (req, res) => {
            try {
                const resultbody = await login(req.body.password);
                res.send(resultbody);
            } catch (e) {
                console.error(e);
                res.sendStatus(403);
            }
        })
        .get('/healthcheck', nocache, async (req, res) => {
            res.send('OK');
        })
        .get('/reinitialize', nocache, async (req, res) => {
            await refreshCECompilers();
            await refreshCELibraries();
            await refreshConanLibraries(true);
            modifiedDt = new Date();
            res.send('done');
        })
        .options('/libraries/cpp', libraryexpireheaders, async (req, res) => {
            res.send();
        })
        .get('/libraries/cpp', libraryexpireheaders, async (req, res) => {
            const filteredlibs = {};
            _.each(availableLibrariesAndVersions, (lib, id) => {
                if (lib.language === 'cpp') filteredlibs[id] = lib;
            });
            res.send(filteredlibs);
        })
        .options('/libraries/rust', libraryexpireheaders, async (req, res) => {
            res.send();
        })
        .get('/libraries/rust', libraryexpireheaders, async (req, res) => {
            const filteredlibs = {};
            _.each(availableLibrariesAndVersions, (lib, id) => {
                if (lib.language === 'rust') filteredlibs[id] = lib;
            });
            res.send(filteredlibs);
        })
        .options('/libraries/fortran', libraryexpireheaders, async (req, res) => {
            res.send();
        })
        .get('/libraries/fortran', libraryexpireheaders, async (req, res) => {
            const filteredlibs = {};
            _.each(availableLibrariesAndVersions, (lib, id) => {
                if (lib.language === 'fortran') filteredlibs[id] = lib;
            });
            res.send(filteredlibs);
        })
        .options('/libraries/go', libraryexpireheaders, async (req, res) => {
            res.send();
        })
        .get('/libraries/go', libraryexpireheaders, async (req, res) => {
            const filteredlibs = {};
            _.each(availableLibrariesAndVersions, (lib, id) => {
                if (lib.language === 'go') filteredlibs[id] = lib;
            });
            res.send(filteredlibs);
        })
        .options('/libraries', libraryexpireheaders, async (req, res) => {
            res.send();
        })
        .get('/libraries', libraryexpireheaders, async (req, res) => {
            res.send(availableLibrariesAndVersions);
        })
        .options('/binaries/:libraryid/:version', libraryexpireheaders, async (req, res) => {
            res.send();
        })
        .get('/binaries/:libraryid/:version', libraryexpireheaders, async (req, res) => {
            try {
                const all = await getConanBinaries(req.params.libraryid, req.params.version);
                res.send(all);
            } catch (e) {
                console.error(e);
                res.send({});
            }
        })
        .options('/downloadcshared/:libraryid/:version', libraryexpireheaders, async (req, res) => {
            res.send();
        })
        .get('/downloadcshared/:libraryid/:version', libraryexpireheaders, async (req, res) => {
            let found = false;
            try {
                const all = await getConanBinaries(req.params.libraryid, req.params.version);
                for (const id of Object.keys(all.perCompiler)) {
                    const compiler = all.perCompiler[id];

                    if (id === 'cshared' && compiler && compiler.hashes && compiler.hashes.length === 1) {
                        const hash = compiler.hashes[0];
                        const url = await getPackageUrl(req.params.libraryid, req.params.version, hash);
                        if (url && url['conan_package.tgz']) {
                            found = true;
                            res.redirect(302, url['conan_package.tgz']);
                            return;
                        }
                    }
                }

                if (!found) res.sendStatus(404);
            } catch (e) {
                console.error(e);
                res.send(e);
            }
        })
        .options('/downloadpkg/:libraryid/:version/:compiler', libraryexpireheaders, async (req, res) => {
            res.send();
        })
        .get('/downloadpkg/:libraryid/:version/:compiler', libraryexpireheaders, async (req, res) => {
            let found = false;
            try {
                const all = await getConanBinaries(req.params.libraryid, req.params.version);
                for (const id of Object.keys(all.perCompiler)) {
                    const compiler = all.perCompiler[id];

                    // note: only works if there's only 1 binary for the given compiler
                    if (id === req.params.compiler && compiler && compiler.hashes && compiler.hashes.length === 1) {
                        if (is_restricted_compiler(id, compiler.compilertype)) {
                            res.sendStatus(403);
                            return;
                        }

                        const hash = compiler.hashes[0];
                        const url = await getPackageUrl(req.params.libraryid, req.params.version, hash);
                        if (url && url['conan_package.tgz']) {
                            found = true;
                            res.redirect(302, url['conan_package.tgz']);
                            return;
                        }
                    }
                }

                if (!found) res.sendStatus(404);
            } catch (e) {
                console.error(e);
                res.send(e);
            }
        })
        .options('/downloadpkg/:library/:library_version/:compiler_version/:arch/:libcxx', libraryexpireheaders, async (req, res) => {
            res.send();
        })
        .get('/downloadpkg/:library/:library_version/:compiler_version/:arch/:libcxx', libraryexpireheaders, async (req, res) => {
            let found = false;
            try {
                const all = await getConanBinaries(req.params.library, req.params.library_version);
                const compiler = all.perCompiler[req.params.compiler_version];
                const combinationIdxes = [];
                for (let idx = 0; idx < all.possibleCombinations.length; idx++) {
                    const combo = all.possibleCombinations[idx];
                    if (combo.arch === req.params.arch.trim() &&
                        combo['compiler.libcxx'] === req.params.libcxx.trim()) {
                        combinationIdxes.push(idx);
                    }
                }

                if (combinationIdxes.length > 0 && compiler) {
                    if (is_restricted_compiler(req.params.compiler_version, compiler.compilertype)) {
                        res.sendStatus(403);
                        return;
                    }

                    for (let combinationIdx of combinationIdxes) {
                        const hashIdx = compiler.combinations.indexOf(combinationIdx);
                        if (hashIdx !== -1) {
                            const hash = compiler.hashes[hashIdx];
                            const url = await getPackageUrl(req.params.library, req.params.library_version, hash);
                            if (url && url['conan_package.tgz']) {
                                found = true;
                                res.redirect(302, url['conan_package.tgz']);
                                return;
                            }
                        }
                    }
                }

                if (!found)
                    res.send(404);
            } catch (e) {
                console.error(e);
                res.send(e);
            }
        })
        .get('/annotations/:libraryid/:version/:buildhash', expireshourly, async (req, res) => {
            const data = await annotations.readAnnotations(req.params.libraryid, req.params.version, req.params.buildhash);
            res.send(data);
        })
        .get('/annotations/:libraryid/:version', expireshourly, async (req, res) => {
            const data = await annotations.readAllAnnotations(req.params.libraryid, req.params.version);
            res.send(data);
        })
        .post('/annotations/:libraryid/:version/:buildhash', nocache, async (req, res) => {
            const data = req.body;
            try {
                await annotations.writeAnnotations(req.params.libraryid, req.params.version, req.params.buildhash, data);
                res.send("OK");
            } catch(e) {
                res.sendStatus(404);
            }
        })
        .post('/buildfailed', nocache, async (req, res) => {
            const data = req.body;
            buildlogging.setBuildFailed(
                data.library,
                data.library_version,
                data.compiler,
                data.compiler_version,
                data.arch,
                data.libcxx,
                data.flagcollection,
                data.logging,
                data.commithash
            );
            res.send("OK");
        })
        .post('/buildsuccess', nocache, async (req, res) => {
            const data = req.body;
            buildlogging.setBuildFixed(
                data.library,
                data.library_version,
                data.compiler,
                data.compiler_version,
                data.arch,
                data.libcxx,
                data.flagcollection,
                data.logging
            );
            res.send("OK");
        })
        .post('/clearbuildstatusforcompiler', nocache, async (req, res) => {
            const data = req.body;
            buildlogging.clearBuildStatusForCompiler(
                data.compiler,
                data.compiler_version
            );
            res.send("OK");
        })
        .get('/compilerfailurerates', expireshourly, async (req, res) => {
            const failurerates = await buildlogging.getCompilerFailureRates();
            res.send(failurerates);
        })
        .post('/hasfailedbefore', expireshourly, async (req, res) => {
            const data = req.body;
            const answer = await buildlogging.hasFailedBefore(
                data.library,
                data.library_version,
                data.compiler,
                data.compiler_version,
                data.arch,
                data.libcxx,
                data.flagcollection
            );
            res.send({
                response: answer.failedbefore
            });
        })
        .post('/whathasfailedbefore', expireshourly, async (req, res) => {
            const data = req.body;
            const answer = await buildlogging.hasFailedBefore(
                data.library,
                data.library_version,
                data.compiler,
                data.compiler_version,
                data.arch,
                data.libcxx,
                data.flagcollection
            );
            res.send({
                response: answer.failedbefore,
                commithash: answer.commithash
            });
        })
        .options('/allfailedbuilds', expireshourly, async (req, res) => {
            res.send();
        })
        .get('/allfailedbuilds', expireshourly, async (req, res) => {
            const builds = await buildlogging.listBuilds();
            res.send(builds);
        })
        .get('/webfonts/:font', async (req, res) => {
            res.send(await fs.readFile(path.join('node_modules/@fortawesome/fontawesome-free/webfonts', req.params.font)));
        })
        .get('/fontawesome-free.min.css', async (req, res) => {
            res.setHeader('Content-Type', 'text/css; charset=utf-8');
            res.send(await fs.readFile('node_modules/@fortawesome/fontawesome-free/css/all.min.css'));
        })
        .options('/getlogging', expireshourly, async (req, res) => {
            res.send();
        })
        .get('/getlogging/:library/:library_version/:arch/:dt', expireshourly, async (req, res) => {
            const logging = await buildlogging.getLogging(req.params.library, req.params.library_version, req.params.arch.trim(), req.params.dt);

            if (logging) {
                const entry = logging[0];

                if (logging.length > 1) {
                    const filename = entry.library + "_" + entry.library_version + "_" + entry.compiler_version + "_" + entry.build_dt + ".txt";
                    let content = '';
                    for (const item of logging) {
                        content = content + item.logging + '\n\n--- More entries ---\n\n';
                    }
                    res.header('Content-Disposition', 'attachment; filename="' + filename +'"').send(content);
                } else if (entry && entry.library && entry.library_version && entry.compiler_version && entry.build_dt && entry.logging) {
                    const filename = entry.library + "_" + entry.library_version + "_" + entry.compiler_version + "_" + entry.build_dt + ".txt";
                    res.header('Content-Disposition', 'attachment; filename="' + filename +'"').send(entry.logging);
                } else {
                    res.sendStatus(404);
                }
            } else {
                res.sendStatus(404);
            }
        })
        .options('/getlogging_forcommit', expireshourly, async (req, res) => {
            res.send();
        })
        .get('/getlogging_forcommit/:library/:library_version/:commithash/:compiler_version/:arch/:libcxx', expireshourly, async (req, res) => {
            const logging = await buildlogging.getLoggingForCommit(req.params.library, req.params.library_version, req.params.commithash,
                req.params.compiler_version, req.params.arch.trim(), req.params.libcxx.trim());

            if (logging) {
                const entry = logging[0];

                if (logging.length >= 1) {
                    const filename = `${entry.library}_${entry.library_version}_${entry.commithash}` +
                        `_${entry.compiler_version}_${entry.arch}_${entry.libcxx}_${entry.build_dt}.txt`;
                    let content = '';
                    for (const item of logging) {
                        content = content + item.logging;
                        if (logging.length > 1) {
                            content = content + '\n\n--- More entries ---\n\n';
                        }
                    }
                    res.header('Content-Disposition', 'attachment; filename="' + filename +'"').send(content);
                } else {
                    res.sendStatus(404);
                }
            } else {
                res.sendStatus(404);
            }
        })
        .use('/cpp_library_build_results/:library/:library_version/:commit_hash', async (req, res) => {
            const view = new CppBuildResultsView(
                buildlogging,
                new RemoteAnnotations(conanserverurl),
                getConanBinaries,
                compilernames,
                compilersemvers
            );
            res.send(await view.get(req.params.library, req.params.library_version, req.params.commit_hash, req.query.allcompilers === '1'));
        })
        .use('/v1', (req, res, next) => {
            req.url = `/v1${req.url}`;
            proxy.web(req, res, { target: conanserverurl, changeOrigin: true }, e => {
                next(e);
            });
        })
        .use('/v2', (req, res, next) => {
            req.url = `/v2${req.url}`;
            proxy.web(req, res, { target: conanserverurl, changeOrigin: true }, e => {
                next(e);
            });
        })
        .use('/', (req, res, next) => {
            if (req.url === "/") req.url = "/index.html";
            next();
        })
        .use(express.static('html'))
        .listen(1080);
}

buildlogging.connect().then(refreshCECompilers).then(refreshCELibraries).then(() => {
    return refreshConanLibraries(true);
}).then(main);
