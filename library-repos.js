const
    https = require('https'),
    yaml = require('js-yaml');

const LIBRARIES_YAML_URL = 'https://raw.githubusercontent.com/compiler-explorer/infra/main/bin/yaml/libraries.yaml';

// Hosting types used by libraries.yaml, and how each one spells a commit url.
const HOSTS = {
    github: { base: 'https://github.com', commit_path: 'commit' },
    gitlab: { base: 'https://gitlab.com', commit_path: '-/commit' },
    bitbucket: { base: 'https://bitbucket.org', commit_path: 'commits' },
};

const FETCH_TIMEOUT_MS = 10000;

const TEMPLATE_RE = /\{\{(.*?)\}\}/g;
const CONTEXT_RE = /^context\[(-?\d+)\]$/;
const REPLACE_RE = /^replace\(\s*'([^']*)'\s*,\s*'([^']*)'\s*(?:,\s*(\d+)\s*)?\)$/;

function normalize_id(library_id) {
    return library_id.replace(/-/g, '_').toLowerCase();
}

function normalize_version(version) {
    return String(version).replace(/^v/, '');
}

// `targets` is a list of version strings, or of {name, url} objects for the tarball libraries.
function target_names(node) {
    if (!Array.isArray(node.targets)) return [];

    return node.targets
        .map((target) => (target && typeof target === 'object' ? target.name : target))
        .filter((name) => typeof name === 'string');
}

// A library's own versions plus those of the build variants nested below it, which share its repo.
function all_target_names(node) {
    let names = target_names(node);
    for (const value of Object.values(node)) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            names = names.concat(all_target_names(value));
        }
    }
    return names;
}

function replace_n(str, search, replacement, count) {
    if (!search) return str;

    let result = '';
    let rest = str;
    let done = 0;
    while (done < count) {
        const idx = rest.indexOf(search);
        if (idx < 0) break;
        result += rest.slice(0, idx) + replacement;
        rest = rest.slice(idx + search.length);
        done++;
    }
    return result + rest;
}

/**
 * infra expands libraries.yaml with full jinja2; we only support the tiny subset that
 * `repo:` values actually use today (`context[-1]`, optionally piped through `replace`).
 * Anything else yields null, which just means we show no repo link for that library.
 */
function expand_template(value, context) {
    if (!value.includes('{{')) return value;
    if (value.includes('{%') || value.includes('{#')) return null;

    let failed = false;
    const expanded = value.replace(TEMPLATE_RE, (_match, expression) => {
        const parts = expression.split('|').map((part) => part.trim());

        const context_match = CONTEXT_RE.exec(parts[0]);
        if (!context_match) {
            failed = true;
            return '';
        }

        const idx = parseInt(context_match[1], 10);
        let result = idx < 0 ? context[context.length + idx] : context[idx];
        if (result === undefined) {
            failed = true;
            return '';
        }

        for (const filter of parts.slice(1)) {
            const replace_match = REPLACE_RE.exec(filter);
            if (!replace_match) {
                failed = true;
                return '';
            }
            const count = replace_match[3] === undefined ? Infinity : parseInt(replace_match[3], 10);
            result = replace_n(result, replace_match[1], replace_match[2], count);
        }

        return result;
    });

    return failed ? null : expanded;
}

function fetch_url(url) {
    return new Promise((resolve, reject) => {
        // Startup waits on this, so never let a hung connection hold the server back.
        const req = https.get(url, { headers: { Accept: 'text/plain' }, timeout: FETCH_TIMEOUT_MS }, (resp) => {
            if (resp.statusCode !== 200) {
                resp.resume();
                reject(new Error(`${url} returned ${resp.statusCode}`));
                return;
            }
            let data = '';
            resp.on('data', (chunk) => data += chunk);
            resp.on('end', () => resolve(data));
        });
        req.on('timeout', () => {
            req.destroy(new Error(`${url} timed out after ${FETCH_TIMEOUT_MS}ms`));
        });
        req.on('error', reject);
    });
}

/**
 * Resolves a library id to its upstream repository, using infra's libraries.yaml as the
 * source of truth. Entries there are nested (groups of libraries) and inherit `repo`/`type`
 * from their ancestors, so we walk the tree and record every node that declares `targets`.
 */
class LibraryRepos {
    constructor(url) {
        this.url = url || LIBRARIES_YAML_URL;
        this.by_language = {};
    }

    make_entry(properties, context) {
        if (!properties.repo) return null;

        const host = HOSTS[properties.type];
        if (!host) return null;

        const repo = expand_template(properties.repo, context);
        if (!repo) return null;

        const parts = repo.split('/');
        if (parts.length !== 2 || !parts[0] || !parts[1]) return null;

        return {
            owner: parts[0],
            name: parts[1],
            host: properties.type,
            commit_url_prefix: `${host.base}/${repo}/${host.commit_path}/`,
        };
    }

    add_candidate(maps, library_id, candidate) {
        if (!library_id) return;

        for (const [map, key] of [[maps.exact, library_id], [maps.normalized, normalize_id(library_id)]]) {
            const candidates = map.get(key);
            if (candidates) candidates.push(candidate);
            else map.set(key, [candidate]);
        }
    }

    collect(node, context, inherited, maps) {
        const properties = { ...inherited };
        for (const key of ['repo', 'type']) {
            if (typeof node[key] === 'string') properties[key] = node[key];
        }

        // A node with `targets` is a library, and anything nested below it is a build variant of
        // that same library (eastl.built, proxy.microsoft.older) rather than a library of its own.
        if ('targets' in node) {
            const entry = this.make_entry(properties, context);
            if (entry) {
                const candidate = { entry, versions: new Set(all_target_names(node).map(normalize_version)) };
                this.add_candidate(maps, context[context.length - 1], candidate);

                // A parent without `targets` is either a group of libraries (beman, nightly) or a
                // library whose versions are split over several repos (proxy, which builds <= 4.0.1
                // from microsoft/proxy and the rest from ngcpp/proxy). Only the latter makes the
                // parent key a library id, and the two are indistinguishable here, so register
                // under it as well and let the version decide between the candidates.
                if (context.length > 2) this.add_candidate(maps, context[context.length - 2], candidate);
            }
            return;
        }

        for (const [key, value] of Object.entries(node)) {
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                this.collect(value, context.concat([key]), properties, maps);
            }
        }
    }

    async refresh() {
        const parsed = yaml.load(await fetch_url(this.url));
        const languages = (parsed && parsed.libraries) || {};

        const by_language = {};
        for (const [language, libraries] of Object.entries(languages)) {
            const maps = { exact: new Map(), normalized: new Map() };
            for (const [library_id, node] of Object.entries(libraries)) {
                if (node && typeof node === 'object' && !Array.isArray(node)) {
                    this.collect(node, [language, library_id], {}, maps);
                }
            }
            by_language[language] = maps;
        }

        this.by_language = by_language;
    }

    get(language, library_id, library_version) {
        const maps = this.by_language[language];
        if (!maps || !library_id) return null;

        const candidates = maps.exact.get(library_id) || maps.normalized.get(normalize_id(library_id));
        if (!candidates) return null;
        if (candidates.length === 1 || library_version === undefined) return candidates[0].entry;

        const version = normalize_version(library_version);
        const match = candidates.find((candidate) => candidate.versions.has(version));
        return (match || candidates[0]).entry;
    }
}

module.exports = {
    LibraryRepos
};
