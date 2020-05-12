
const
    _ = require('underscore'),
    fs = require('fs'),
    express = require('express'),
    httpProxy = require('http-proxy'),
    http = require('http'),
    https = require('https');

const
    webServer = express();

// const conanserverurl = 'http://127.0.0.1:9300';
// const ceserverurl = 'https://godbolt.org'

// let compilernames = null;
// let allLibrariesAndVersions = null;

// let availableLibrariesAndVersions = [];

// async function fetchCompilers() {
// return new Promise((resolve, reject) => {
//     https.get(`${ceserverurl}/api/compilers`, {headers: {'Accept': 'application/json'}}, (resp) => {
//         let data = '';
//         resp.on('data', (chunk) => data += chunk);
//         resp.on('end', () => {
//             const jsdata = JSON.parse(data);
//             const compilers = {};
//             _.each(jsdata, (obj) => {
//                 compilers[obj.id] = obj.name;
//             });
//             compilernames = compilers
//             resolve(true);
//         })
//     }).on('error', (err) => {
//         console.error(err);
//         reject(err);
//     });
// });
// }

// async function fetchAllLibraries() {
// return new Promise((resolve, reject) => {
//     https.get(`${ceserverurl}/api/libraries/c++`, {headers: {'Accept': 'application/json'}}, (resp) => {
//         let data = '';
//         resp.on('data', (chunk) => data += chunk);
//         resp.on('end', () => {
//             allLibrariesAndVersions = JSON.parse(data);
//             resolve(true);
//         })
//     }).on('error', (err) => {
//         console.error(err);
//         reject(err);
//     });
// });
// }

// async function fetchPackages(library, version) {
// return new Promise((resolve, reject) => {
//     const filteredlibrary = library.match(/([\w_-]*)/i)[1];
//     const filteredversion = version.match(/([\w0-9_\.]*)/i)[1];
//     if (filteredlibrary && filteredversion) {
//         const libandver = `${filteredlibrary}/${filteredversion}`;

//         http.get(`${conanserverurl}/v1/conans/${libandver}/${libandver}/search`, (resp) => {
//             let data = '';
//             resp.on('data', (chunk) => data += chunk);
//             resp.on('end', () => {
//                 const jsdata = JSON.parse(data);
//                 const setPerCompiler = {};
//                 const setOfCombinations = [];
//                 _.each(jsdata, (obj) => {
//                     const compilerid = obj.settings['compiler.version'];
//                     const compilername = compilernames[compilerid];
//                     const relevantSettings = _.omit(obj.settings, (val, key) => key.indexOf('compiler') === 0);
//                     const settingsWithoutCompiler = _.map(
//                         relevantSettings,
//                         (val, key) => `${key}=${val}`).join(',');

//                     let idx = setOfCombinations.indexOf(settingsWithoutCompiler);
//                     if (idx === -1) {
//                         idx = setOfCombinations.length;
//                         setOfCombinations.push(settingsWithoutCompiler);
//                     }

//                     if (!setPerCompiler[compilerid]) {
//                         setPerCompiler[compilerid] = {
//                             name: compilername,
//                             combinations: []
//                         };
//                     }

//                     setPerCompiler[compilerid].combinations.push(idx);
//                 })

//                 resolve({
//                     possibleCombinations: setOfCombinations,
//                     perCompiler: setPerCompiler
//                 });
//             })
//         }).on('error', (err) => {
//             reject(err);
//         });
//     } else {
//         reject('Not a valid library or version');
//     }
// });
// }

// async function fetchAndFilter() {
// await fetchCompilers();
// await fetchAllLibraries();

// let librarypromises = _.map(allLibrariesAndVersions, (library) => {
//     return new Promise((resolve) => {
//         let versionpromises = _.map(library.versions, (version, verid) => {
//             return fetchPackages(library.id, version.version)
//                 .then((sets) => {
//                     return {
//                         libraryid: library.id,
//                         libraryname: library.name,
//                         verionid: verid,
//                         version: version.version,
//                         sets: sets
//                     };
//                 })
//                 .catch(() => false);
//         });

//         Promise.all(versionpromises).then((all) => {
//             resolve(_.filter(all, item => item !== false));
//         });
//     });
// })

// return Promise.all(librarypromises).then((libandver) => {
//     return libandver;
// });
// }

// fetchAndFilter().then((filteredLibraries) => {
// availableLibrariesAndVersions = filteredLibraries;

// console.log(availableLibrariesAndVersions);

// webServer
//     .get('/compilers', async (req, res) => {
//         res.send(await fetchCompilers());
//     })
//     .get('/built_libraries', (req, res) => {
//         res.send({libraries: {}})
//     })
//     .get('/binaries/:library/:version', async (req, res) => {
//         const binaries = await fetchPackages(req.params.library, req.params.version);
//         res.send(binaries);
//     })
//     .use((req, res, next) => {
//         res.send({status: 404, message: `page "${req.path}" could not be found`});
//     })
//     .listen(10240);

// });

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

const conanRemote = {
    target: "http://127.0.0.1:9300"
};

webServer
    .get('/hello', async (req, res) => {
        res.send('hello, world!');
    })
    .get('/libraries', async (req, res) => {
        fs.dir("/home/ce/.conan_server").then((dirdata) => {
            console.log(dirdata);
            res.send('blabla');
        });
    })
    .use((req, res, next) => {
        proxy.web(req, res, { target: conanRemote.target, changeOrigin: true }, e => {
            next(e);
        });
    })
    .listen(10240);
