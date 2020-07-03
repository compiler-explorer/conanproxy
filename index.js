
const
    _ = require('underscore'),
    fs = require('fs').promises,
    { BuildAnnotations } = require('./build-annotations'),
    { BuildLogging } = require('./build-logging'),
    express = require('express'),
    expressjwt = require('express-jwt'),
    jwt = require('jsonwebtoken'),
    httpProxy = require('http-proxy'),
    http = require('http'),
    https = require('https');

const
    webServer = express();

const conanserverurl = 'http://127.0.0.1:9300';
const ceserverurl = 'https://godbolt.org';

const userhome = "/home/ce";
const conanserverroot = userhome + "/.conan_server";

let compilernames = null;
let allLibrariesAndVersions = null;

let availableLibrariesAndVersions = {};
let availableLibraryIds = [];

let modifiedDt = null;

const annotations = new BuildAnnotations(conanserverroot);
const buildlogging = new BuildLogging(userhome + "/buildlogs.db");
const jwtsecret = process.env.CESECRET;
const cepassword = process.env.CEPASSWORD;

async function getConanBinaries(library, version) {
    return new Promise((resolve, reject) => {
        const filteredlibrary = library.match(/([\w_-]*)/i)[1];
        const filteredversion = version.match(/([\w0-9_.-]*)/i)[1];
        if (filteredlibrary && filteredversion) {
            const libandver = `${filteredlibrary}/${filteredversion}`;

            const url = `${conanserverurl}/v1/conans/${libandver}/${libandver}/search`;
            console.log('calling ' + url);
            http.get(url, (resp) => {
                let data = '';
                resp.on('data', (chunk) => data += chunk);
                resp.on('end', () => {
                    let jsdata = null;
                    try {
                        jsdata = JSON.parse(data);
                    } catch (e) {
                        resolve({});
                        return;
                    }

                    const setPerCompiler = {};
                    const setOfCombinations = [];
                    _.each(jsdata, (obj) => {
                        const compilerid = obj.settings['compiler.version'];
                        const compilername = compilernames[compilerid];
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
                                combinations: []
                            };
                        }

                        setPerCompiler[compilerid].combinations.push(idx);
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

async function refreshCECompilers() {
    return new Promise((resolve, reject) => {
        https.get(`${ceserverurl}/api/compilers`, { headers: { Accept: 'application/json' } }, (resp) => {
            let data = '';
            resp.on('data', (chunk) => data += chunk);
            resp.on('end', () => {
                const jsdata = JSON.parse(data);
                const compilers = {};
                _.each(jsdata, (obj) => {
                    compilers[obj.id] = obj.name;
                });
                compilernames = compilers;
                resolve(true);
            });
        }).on('error', (err) => {
            console.error(err);
            reject(err);
        });
    });
}

async function refreshCELibraries() {
    return new Promise((resolve, reject) => {
        https.get(`${ceserverurl}/api/libraries/c++`, { headers: { Accept: 'application/json' } }, (resp) => {
            let data = '';
            resp.on('data', (chunk) => data += chunk);
            resp.on('end', () => {
                allLibrariesAndVersions = JSON.parse(data);
                resolve(true);
            });
        }).on('error', (err) => {
            console.error(err);
            reject(err);
        });
    });
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
            bodyData = req.body;
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
            let ceLib = _.find(allLibrariesAndVersions, (lib) => lib.id === libraryId);
            if (!ceLib && forceall) ceLib = { name: libraryId, versions: {} };
            if (ceLib) {
                fs.opendir(`${conanserverroot}/data/${libraryId}`).then(async (versionDirs) => {
                    for await (const versionDir of versionDirs) {
                        let ceVersion = _.find(ceLib.versions, ver => ver.version === versionDir.name);
                        if (!ceVersion && forceall) ceVersion = { id: versionDir.name.replace(reDot, '') };
                        if (ceVersion) {
                            if (!availableLibrariesAndVersions[libraryId]) {
                                availableLibrariesAndVersions[libraryId] = {
                                    name: ceLib.name,
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
        .use(express.json())
        .use(expressjwt({
            secret: jwtsecret,
            algorithms: ['HS256']
        }).unless({
            path: [
                '/libraries.html',
                '/favicon.ico',
                '/login',
                '/healthcheck',
                '/reinitialize',
                '/libraries',
                /^\/binaries\/.*/,
                {
                    url: /^\/annotations\/.*/,
                    methods: ['GET', 'OPTIONS']
                },
                /^\/v1\/.*/,
                /^\/v2\/.*/,
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
            const all = await getConanBinaries(req.params.libraryid, req.params.version);
            res.send(all);
        })
        .get('/annotations/:libraryid/:version/:buildhash', expireshourly, async (req, res) => {
            const data = await annotations.readAnnotations(req.params.libraryid, req.params.version, req.params.buildhash);
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
                data.compiler_flags,
                data.logging
            );
            res.send("OK");
        })
        .post('/buildsucces', nocache, async (req, res) => {
            const data = req.body;
            buildlogging.setBuildFixed(
                data.library,
                data.library_version,
                data.compiler,
                data.compiler_version,
                data.arch,
                data.libcxx,
                data.compiler_flags,
                data.logging
            );
            res.send("OK");
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
        .use(express.static('html'))
        .listen(1080);
}

buildlogging.connect().then(refreshCECompilers).then(refreshCELibraries).then(() => {
    return refreshConanLibraries(true);
}).then(main);
