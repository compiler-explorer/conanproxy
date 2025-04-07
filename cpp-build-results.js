const
    pug = require('pug'),
    { BuildLogging } = require('./build-logging'),
    { BuildAnnotations } = require('./build-annotations'),
    _ = require('underscore'),
    semver = require('semver');

const {DynamoDBClient, ScanCommand} = require ('@aws-sdk/client-dynamodb');

class CppBuildResultsView {
    /**
     * 
     * @param {BuildLogging} logging 
     * @param {BuildAnnotations} annotations
     */
    constructor(logging, annotations, conanfunc, compilernames, compilersemvers) {
        this.results_view = pug.compileFile('views/library_build_results.pug');

        this.logging = logging;
        this.annotations = annotations;
        this.conanfunc = conanfunc;
        this.compilernames = compilernames;
        this.compilersemvers = compilersemvers;

        this.ddbClient = new DynamoDBClient({region: 'us-east-1'});
    }

    extract_compiler_details(compiler_str) {
        const compiler_arr = compiler_str.split('#');
        const id = compiler_arr[1];
        return {
            compiler: compiler_arr[0],
            compiler_version: id,
            arch: compiler_arr[2],
            libcxx: compiler_arr[3],
            compiler_name: this.compilernames[id],
            compiler_semver: this.compilersemvers[id],
        };
    }

    create_library_key(library, library_version, commit_hash) {
        return `${library}#${library_version}#${commit_hash}`;
    }

    async list_all_results(lib_key) {
        const scanCommand = new ScanCommand({
            TableName: 'library-build-history',
            ProjectionExpression: 'compiler,success',
            FilterExpression: '#library=:lib_key',
            ExpressionAttributeNames: {
                '#library': 'library',
            },
            ExpressionAttributeValues: {
                ':lib_key': {
                    S: lib_key,
                },
            },
        });

        return this.ddbClient.send(scanCommand);
    }

    async get(library, library_version, commit_hash, show_all_compilers) {
        const lib_key = this.create_library_key(library, library_version, commit_hash);
        const scan_result = await this.list_all_results(lib_key);

        const latest_results = await this.logging.getBuildResultsForCommit(library, library_version, commit_hash);

        const has_logging = (compiler_version, arch, libcxx) => {
            return !!latest_results.find((res) => res.compiler_version === compiler_version && res.arch === arch && res.libcxx === libcxx);
        };

        const compilers_with_results = _.map(scan_result.Items, (item) => {
            const compiler_details = this.extract_compiler_details(item.compiler.S);
            let logging_url = '';
            let package_url = '';
            if (!item.success.BOOL && has_logging(compiler_details.compiler_version, compiler_details.arch, compiler_details.libcxx)) {
                logging_url = `/getlogging_forcommit/${library}/${library_version}/${commit_hash}/${compiler_details.compiler_version}/${compiler_details.arch || ' '}/${compiler_details.libcxx || ' '}`;
            } else if (item.success.BOOL) {
                // TODO: how to make sure user knows this is the latest package and might not be for this commit?
                package_url = `/downloadpkg/${library}/${library_version}/${compiler_details.compiler_version}/${compiler_details.arch || ' '}/${compiler_details.libcxx || ' '}`;
            }

            return {
                ...compiler_details,
                success: item.success.BOOL ? 'ok' : 'failed',
                logging_url,
                package_url,
            }
        });

        compilers_with_results.sort((a, b) => a.compiler_version > b.compiler_version);

        const succeeded_compilers = compilers_with_results.filter(result => result.success === 'ok');

        const total = compilers_with_results.length;
        const succeeded = succeeded_compilers.length;
        const failed = total - succeeded;

        const gcc_semvers = succeeded_compilers.filter(result => result.compiler === 'gcc').map(result => semver.parse(result.compiler_semver)).filter(Boolean);
        const min_gcc_ver = _.first(semver.sort(gcc_semvers));

        const clang_semvers = succeeded_compilers.filter(result => result.compiler === 'clang').map(result => semver.parse(result.compiler_semver)).filter(Boolean);
        const min_clang_ver = _.first(semver.sort(clang_semvers));

        let repo_owner = "";
        let repo_name = "";
        if (library === "fmt") {
          repo_owner = "fmtlib";
          repo_name = "fmt"
        } else if (library === "beman_iterator_interface") {
          repo_owner = "bemanproject";
          repo_name = "iterator_interface"
        } else {
          repo_owner = "notsupported"
          repo_name = "notsupported"
        }
    
        return await this.results_view({
            lib: {
                commit_url: `https://github.com/${repo_owner}/${repo_name}/commit/${commit_hash}`,
                commit_hash: commit_hash,
                repo_owner,
                repo_name,
                name: `${library}`,
                version: `${library_version}`
            },
            view: {
                show_all_compilers
            },
            summary: {
                total,
                failed,
                succeeded,
                min_gcc_ver,
                min_clang_ver
            },
            compilers: compilers_with_results,
        });
    }

    // async get(library, library_version, commit_hash, show_all_compilers) {
    //     const compilers = await this.logging.listPossibleCompilers();
    //     const results = await this.logging.getBuildResultsForCommit(library, library_version, commit_hash);

    //     const binaries = await this.conanfunc(library, library_version);

    //     const compilers_with_results_prom = compilers.map(async (compiler) => {
    //         const found = results.find((result) => 
    //             result.compiler === compiler.compiler && result.compiler_version === compiler.compiler_version && result.arch === compiler.arch && result.libcxx === compiler.libcxx);

    //         const comp = this.compilernames[compiler.compiler_version];
    //         let compiler_name = comp;
    //         if (!compiler_name) {
    //             compiler_name = compiler.compiler_version;
    //         }
    //         compiler_name = compiler_name.replaceAll('-', '_');

    //         if (found) {
    //             const statustext = found.success ? 'ok' : 'failed';
    //             const statuscolor = found.success ? 'green' : 'red';

    //             return {
    //                 ...compiler,
    //                 compiler_name,
    //                 success: statustext,
    //                 static_badge_link: `https://img.shields.io/badge/${compiler_name}-${statustext}-${statuscolor}`,
    //                 buildhash: ''
    //             };
    //         } else {
    //             const bins = binaries.perCompiler[compiler.compiler_version];
    //             if (bins) {
    //                 const foundIdx = binaries.possibleCombinations.findIndex((result) =>
    //                     result.arch === compiler.arch && result['compiler.libcxx'] === compiler.libcxx
    //                 );

    //                 if (foundIdx >= 0) {
    //                     const comboIdx = bins.combinations.findIndex(comboid => comboid === foundIdx);
    //                     if (comboIdx >= 0) {
    //                         const buildhash = bins.hashes[comboIdx];

    //                         const anno = await this.annotations.readAnnotations(library, library_version, buildhash);
    //                         if (commit_hash === anno.commithash) {
    //                             const statustext = 'ok';
    //                             const statuscolor = 'green';
    //                             return {
    //                                 ...compiler,
    //                                 compiler_name,
    //                                 success: statustext,
    //                                 static_badge_link: `https://img.shields.io/badge/${compiler_name}-${statustext}-${statuscolor}`,
    //                                 buildhash: buildhash
    //                             };
    //                         }
    //                     }
    //                 }

    //                 const statustext = 'unknown';
    //                 const statuscolor = 'orange';
    //                 return {
    //                     ...compiler,
    //                     compiler_name,
    //                     success: statustext,
    //                     static_badge_link: '',
    //                     buildhash: ''
    //                 };
    //             }
    //             return {...compiler, success: '?', buildhash: ''};
    //         }
    //     });

    //     let compilers_with_results = await Promise.all(compilers_with_results_prom);
    //     if (!show_all_compilers) {
    //         compilers_with_results = _.filter(compilers_with_results, (result) => result.static_badge_link);
    //     }

    //     for (const result of compilers_with_results) {
    //         const lib_key = `${library}#${library_version}#${commit_hash}`;
    //         const compiler_key = `${result.compiler}#${result.compiler_version}#${result.arch}#${result.libcxx}`;

    //         const putCommand = new PutItemCommand({
    //             TableName: 'library-build-history',
    //             Item: {
    //                 library: {
    //                     S: lib_key,
    //                 },
    //                 compiler: {
    //                     S: compiler_key,
    //                 },
    //                 success: {
    //                     BOOL: result.success === 'ok',
    //                 }
    //             },
    //         });
    //         await this.ddbClient.send(putCommand);
    //     }

    //     return await this.results_view({
    //         lib: {
    //             commit_url: `https://github.com/fmtlib/fmt/commit/${commit_hash}`,
    //             commit_hash: commit_hash,
    //             name: library,
    //         },
    //         view: {
    //             show_all_compilers
    //         },
    //         compilers: compilers_with_results,
    //         results: results,
    //     });
    // }
};

module.exports = {
    CppBuildResultsView
};
