const pug = require('pug');

const {DynamoDBClient, QueryCommand} = require('@aws-sdk/client-dynamodb');

const TABLE_NAME = 'library-build-history';
const COMPILER_INDEX = 'compiler-library-index';

function parse_library_key(library_str) {
    const parts = library_str.split('#');
    return {
        library: parts[0],
        library_version: parts[1],
        commit_hash: parts[2],
    };
}

function parse_compiler_key(compiler_str) {
    const parts = compiler_str.split('#');
    return {
        compiler: parts[0],
        compiler_version: parts[1],
        arch: parts[2],
        libcxx: parts[3],
    };
}

async function query_all_pages(ddbClient, params) {
    const items = [];
    let lastEvaluatedKey;
    do {
        const result = await ddbClient.send(new QueryCommand({...params, ExclusiveStartKey: lastEvaluatedKey}));
        items.push(...(result.Items || []));
        lastEvaluatedKey = result.LastEvaluatedKey;
    } while (lastEvaluatedKey);
    return items;
}

async function fetch_compiler_variants_from_canonicals(ddbClient, canonical_library_keys) {
    const variants_by_id = new Map();

    for (const lib_key of canonical_library_keys) {
        try {
            const items = await query_all_pages(ddbClient, {
                TableName: TABLE_NAME,
                ProjectionExpression: '#c',
                KeyConditionExpression: '#l = :lib_key',
                ExpressionAttributeNames: {'#l': 'library', '#c': 'compiler'},
                ExpressionAttributeValues: {':lib_key': {S: lib_key}},
            });
            for (const item of items) {
                const compiler_str = item.compiler.S;
                const {compiler_version} = parse_compiler_key(compiler_str);
                if (!compiler_version) continue;
                if (!variants_by_id.has(compiler_version)) {
                    variants_by_id.set(compiler_version, new Set());
                }
                variants_by_id.get(compiler_version).add(compiler_str);
            }
        } catch (e) {
            console.error(`Failed to query canonical library ${lib_key}: ${e.message}`);
        }
    }

    const result = new Map();
    for (const [id, set] of variants_by_id) {
        result.set(id, [...set]);
    }
    return result;
}

class CompilerVariantsCache {
    constructor(canonical_library_keys) {
        this.ddbClient = new DynamoDBClient({region: 'us-east-1'});
        this.canonical_library_keys = canonical_library_keys;
        this.variants_by_id = new Map();
    }

    async refresh() {
        this.variants_by_id = await fetch_compiler_variants_from_canonicals(this.ddbClient, this.canonical_library_keys);
    }

    get_variants(compiler_id) {
        return this.variants_by_id.get(compiler_id) || [];
    }
}

class CppCompilerBuildResultsView {
    constructor(compilernames, compilersemvers, variantsCache) {
        this.results_view = pug.compileFile('views/compiler_build_results.pug');
        this.compilernames = compilernames;
        this.compilersemvers = compilersemvers;
        this.variantsCache = variantsCache;
        this.ddbClient = new DynamoDBClient({region: 'us-east-1'});
    }

    async query_rows_for_variant(compiler_str) {
        return query_all_pages(this.ddbClient, {
            TableName: TABLE_NAME,
            IndexName: COMPILER_INDEX,
            ProjectionExpression: '#l,#c,success',
            KeyConditionExpression: '#c = :c',
            ExpressionAttributeNames: {'#l': 'library', '#c': 'compiler'},
            ExpressionAttributeValues: {':c': {S: compiler_str}},
        });
    }

    async get(compiler_id) {
        const variant_strs = this.variantsCache.get_variants(compiler_id);

        const all_items = (await Promise.all(variant_strs.map(v => this.query_rows_for_variant(v)))).flat();

        const variant_set = new Set();
        const grouped = new Map();

        for (const item of all_items) {
            const lib = parse_library_key(item.library.S);
            const comp = parse_compiler_key(item.compiler.S);
            if (comp.compiler_version !== compiler_id) continue;

            const variant_key = `${comp.arch}|${comp.libcxx}`;
            variant_set.add(variant_key);

            const row_key = `${lib.library}#${lib.library_version}#${lib.commit_hash}`;
            if (!grouped.has(row_key)) {
                grouped.set(row_key, {
                    library: lib.library,
                    library_version: lib.library_version,
                    commit_hash: lib.commit_hash,
                    cells: {},
                });
            }
            grouped.get(row_key).cells[variant_key] = {
                success: item.success.BOOL ? 'ok' : 'failed',
                arch: comp.arch,
                libcxx: comp.libcxx,
                logging_url: item.success.BOOL ? '' :
                    `/getlogging_forcommit/${lib.library}/${lib.library_version}/${lib.commit_hash}/${compiler_id}/${comp.arch || ' '}/${comp.libcxx || ' '}`,
                package_url: item.success.BOOL ?
                    `/downloadpkg/${lib.library}/${lib.library_version}/${compiler_id}/${comp.arch || ' '}/${comp.libcxx || ' '}` : '',
            };
        }

        const variants = [...variant_set].map(k => {
            const [arch, libcxx] = k.split('|');
            return {key: k, arch, libcxx};
        }).sort((a, b) => (a.arch + a.libcxx).localeCompare(b.arch + b.libcxx));

        const rows = [...grouped.values()]
            .sort((a, b) => {
                if (a.library !== b.library) return a.library.localeCompare(b.library);
                if (a.library_version !== b.library_version) return a.library_version.localeCompare(b.library_version);
                return a.commit_hash.localeCompare(b.commit_hash);
            })
            .map(row => ({
                ...row,
                cells: variants.map(v => row.cells[v.key] || null),
            }));

        const total_cells = rows.reduce((n, r) => n + r.cells.filter(c => c).length, 0);
        const succeeded_cells = rows.reduce((n, r) => n + r.cells.filter(c => c && c.success === 'ok').length, 0);
        const distinct_libs_succeeded = new Set(
            rows.filter(r => r.cells.some(c => c && c.success === 'ok')).map(r => r.library)
        ).size;
        const distinct_libs_total = new Set(rows.map(r => r.library)).size;

        return await this.results_view({
            compiler: {
                id: compiler_id,
                name: this.compilernames[compiler_id] || compiler_id,
                semver: this.compilersemvers[compiler_id] || '',
            },
            variants,
            rows,
            summary: {
                total_cells,
                succeeded_cells,
                failed_cells: total_cells - succeeded_cells,
                distinct_libs_succeeded,
                distinct_libs_total,
            },
        });
    }
}

module.exports = {
    CompilerVariantsCache,
    CppCompilerBuildResultsView
};
