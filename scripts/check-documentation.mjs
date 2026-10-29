#!/usr/bin/env node

/**
 * Surveyor advisory documentation diagnostics.
 *
 * This checker validates structural integrity and maintained review evidence.
 * Behavioral truth belongs to the authorized task's source review and tests;
 * optional task profiles own their temporary working material and staging.
 */

import crypto from 'node:crypto';
import {isUtf8} from 'node:buffer';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';

const DEFAULT_CONFIG_PATH = 'docs/policies/documentation-check.json';
const METADATA_RE = /<!--\s*documentation-metadata\s*\r?\n([\s\S]*?)-->/i;
const INLINE_LINK_RE = /!?\[[^\]]*\]\(([^)\n]+)\)/g;
const REFERENCE_LINK_RE = /^\s*\[[^\]]+\]:\s*(\S+)/gm;
const NPM_RUN_RE = /\bnpm\s+run\s+([A-Za-z0-9:_-]+)/g;
const INLINE_CODE_RE = /(?<!`)`([^`\n]+)`(?!`)/g;
const EXTERNAL_TARGET_RE = /^(?:https?:|mailto:|tel:|javascript:|data:|#|\/)/i;

function parseArguments(argv) {
    const options = {
        root: process.cwd(),
        configPath: DEFAULT_CONFIG_PATH,
        strict: false,
        fingerprintOnly: false,
        jsonPath: null,
        profilesOnly: false,
        context: false,
        selectedProfiles: [],
        ownedPaths: [],
        purpose: null,
        expectedContext: null,
        noProfile: false,
        referenceRoot: null,
    };

    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === '--strict') {
            options.strict = true;
        } else if (argument === '--fingerprint') {
            options.fingerprintOnly = true;
        } else if (argument === '--profiles') {
            options.profilesOnly = true;
        } else if (argument === '--context') {
            options.context = true;
        } else if (argument === '--no-profile') {
            options.noProfile = true;
        } else if (['--profile', '--path', '--purpose', '--expect-context'].includes(argument)) {
            index += 1;
            if (!argv[index] || argv[index].startsWith('--')) {
                throw new Error(`${argument} requires a value`);
            }
            if (argument === '--profile') options.selectedProfiles.push(argv[index]);
            if (argument === '--path') options.ownedPaths.push(argv[index]);
            if (argument === '--purpose') options.purpose = argv[index];
            if (argument === '--expect-context') options.expectedContext = argv[index];
        } else if (argument === '--json') {
            index += 1;
            if (!argv[index]) {
                throw new Error('--json requires an output path');
            }
            options.jsonPath = argv[index];
        } else if (argument === '--config') {
            index += 1;
            if (!argv[index]) {
                throw new Error('--config requires a path');
            }
            options.configPath = argv[index];
        } else if (argument === '--root') {
            index += 1;
            if (!argv[index]) {
                throw new Error('--root requires a path');
            }
            options.root = argv[index];
        } else if (argument === '--reference-root') {
            index += 1;
            if (!argv[index] || argv[index].startsWith('--')) {
                throw new Error('--reference-root requires a path');
            }
            options.referenceRoot = argv[index];
        } else if (argument === '--help' || argument === '-h') {
            options.help = true;
        } else {
            throw new Error(`Unknown argument: ${argument}`);
        }
    }

    options.root = path.resolve(options.root);
    options.configPath = path.resolve(options.root, options.configPath);
    if (options.jsonPath) {
        options.jsonPath = path.resolve(options.root, options.jsonPath);
    }
    if (options.expectedContext) options.expectedContext = path.resolve(options.root, options.expectedContext);
    if (options.referenceRoot) options.referenceRoot = path.resolve(options.root, options.referenceRoot);
    if ([options.profilesOnly, options.context, options.fingerprintOnly].filter(Boolean).length > 1) {
        throw new Error('--profiles, --context and --fingerprint are separate modes');
    }
    if (options.noProfile && options.selectedProfiles.length) throw new Error('--no-profile and --profile are mutually exclusive');
    if (options.referenceRoot && (options.profilesOnly || options.context || options.fingerprintOnly)) {
        throw new Error('--reference-root applies only to a documentation report');
    }
    if (!options.context && (options.noProfile || options.selectedProfiles.length || options.ownedPaths.length
        || options.purpose !== null || options.expectedContext)) {
        throw new Error('--profile, --path, --purpose and --expect-context require --context');
    }
    return options;
}

function printHelp() {
    console.log(`Usage: node scripts/check-documentation.mjs [options]\n\n` +
        `Options:\n` +
        `  --strict            Report all known stale terms, including tracked migration debt (advisory)\n` +
        `  --fingerprint       Print the current documentation source fingerprint and exit\n` +
        `  --profiles          List optional current profiles as JSON; absence is normal\n` +
        `  --context           Emit policy/profile context and a caller-held continuation receipt\n` +
        `  --profile <path>    Explicitly select a discovered profile (repeatable; context only)\n` +
        `  --no-profile        Explicitly select no profile when reviewing changed scope\n` +
        `  --purpose <text>    Record the caller's task purpose without inferring approval\n` +
        `  --path <path>       Record an owned repository path (repeatable; context only)\n` +
        `  --expect-context <path> Compare a prior context/receipt on resume or handoff\n` +
        `  --json <path>       Write the full result as JSON\n` +
        `  --config <path>     Use a different configuration file\n` +
        `  --root <path>       Check a different repository root\n` +
        `  --reference-root <path> Project authored-path counts from this source tree without changing configuration\n` +
        `  -h, --help          Show this help`);
}

function toPosix(value) {
    return value.split(path.sep).join('/');
}

function lineNumber(text, offset) {
    return text.slice(0, offset).split('\n').length;
}

function normalizeLinkTarget(rawTarget) {
    let target = rawTarget.trim();
    if (target.startsWith('<')) {
        const close = target.indexOf('>');
        if (close >= 0) {
            target = target.slice(1, close);
        }
    } else {
        target = target.split(/\s+["']/u, 1)[0];
    }
    return target.trim();
}

function isExcluded(relativePath, excludedDirectories) {
    const parts = relativePath.split('/');
    return parts.some(part => excludedDirectories.includes(part));
}

/** Return sorted authored regular-file paths using the existing exclusion rules.
 * Directory/file symlinks are not followed; callers reuse this inventory rather
 * than construct a different scanner for fingerprints or scoped drift evidence.
 * An optional visitor sees each nonexcluded entry before type filtering, allowing
 * a scoped caller to reject redirections without changing default traversal. */
export function walkFiles(root, excludedDirectories, visitEntry = null) {
    const files = [];

    function walk(directory) {
        const entries = fs.readdirSync(directory, {withFileTypes: true})
            .sort((left, right) => left.name.localeCompare(right.name));
        for (const entry of entries) {
            const absolute = path.join(directory, entry.name);
            const relative = toPosix(path.relative(root, absolute));
            if (isExcluded(relative, excludedDirectories)) {
                continue;
            }
            // A symbolic link is intentionally not traversed below. The visitor
            // still sees it, so scoped evidence cannot silently miss redirection.
            if (visitEntry) visitEntry({relative, absolute, entry});
            if (entry.isDirectory()) {
                walk(absolute);
            } else if (entry.isFile()) {
                files.push(relative);
            }
        }
    }

    walk(root);
    return files.sort();
}

/** Match an exact authored path or a subtree rule ending in a slash. */
export function pathMatchesRule(relativePath, rule) {
    if (rule.endsWith('/')) {
        return relativePath.startsWith(rule);
    }
    return relativePath === rule;
}

/** Fingerprint configured authored sources and return their exact sorted inventory.
 * Historical baseline comparison remains a separate advisory operation. */
export function computeSourceFingerprint(root, config) {
    const excludedDirectories = config.excludedDirectories ?? [];
    const allFiles = walkFiles(root, excludedDirectories);
    const excludedPaths = config.fingerprint?.excludedPaths ?? [];
    const excludedExtensions = config.fingerprint?.excludedExtensions ?? [];
    const files = allFiles.filter(relativePath => {
        if (excludedPaths.some(rule => pathMatchesRule(relativePath, rule))) {
            return false;
        }
        return !excludedExtensions.some(extension => relativePath.endsWith(extension));
    });

    const normalization = config.fingerprint?.textNormalization ?? 'none';
    if (!['none', 'crlf-to-lf'].includes(normalization)) {
        throw new Error(`Unsupported fingerprint text normalization: ${normalization}`);
    }
    const hash = crypto.createHash('sha256');
    for (const relativePath of files) {
        hash.update(relativePath, 'utf8');
        hash.update('\0');
        const bytes = fs.readFileSync(path.join(root, relativePath));
        // Normalize only UTF-8 text. Binary assets remain byte-sensitive.
        const content = normalization === 'crlf-to-lf' && !bytes.includes(0) && isUtf8(bytes)
            ? Buffer.from(bytes.toString('utf8').replace(/\r\n/gu, '\n'), 'utf8')
            : bytes;
        hash.update(content);
        hash.update('\0');
    }

    return {
        algorithm: 'sha256',
        value: hash.digest('hex'),
        files,
    };
}

export function parseMetadata(text) {
    const match = METADATA_RE.exec(text);
    if (!match) {
        return null;
    }

    const metadata = {};
    for (const rawLine of match[1].split(/\r?\n/u)) {
        const line = rawLine.trim();
        if (!line) {
            continue;
        }
        const separator = line.indexOf(':');
        if (separator < 1) {
            continue;
        }
        const key = line.slice(0, separator).trim();
        const value = line.slice(separator + 1).trim();
        metadata[key] = value;
    }
    return metadata;
}

/** Expose the existing metadata owner's exact comment span for read-only delta
 * composition. Preserve parseMetadata's established return contract for callers
 * which need only the authored fields, and keep offsets in the original text. */
export function parseMetadataBlock(text) {
    const match = METADATA_RE.exec(text);
    if (!match) return null;
    return {metadata: parseMetadata(match[0]), start: match.index,
        end: match.index + match[0].length, content: match[0]};
}

function collectMarkdownFiles(root, config) {
    return walkFiles(root, config.excludedDirectories ?? [])
        .filter(relativePath => relativePath.endsWith('.md'));
}

/** Accept canonical repository-relative spelling before resolving a profile path.
 * Reject traversal, drive-relative paths and URL delimiters on every host, so a
 * Windows-authored manifest cannot escape when inspected on another platform. */
function normalizedRelativePath(value) {
    if (typeof value !== 'string' || !value || value.includes('\\') || /[:\0?#]/u.test(value)
        || path.posix.isAbsolute(value) || path.win32.isAbsolute(value) || /^[A-Za-z]:/u.test(value)
        || value.endsWith('/') || path.posix.normalize(value) !== value) return null;

    const parts = value.split('/');
    if (parts.includes('.') || parts.includes('..')) return null;
    return value;
}

/** Match the host filesystem's case rule consistently without changing the authored
 * path used in diagnostics. Windows aliases must share duplicate and lookup keys. */
export function repositoryPathKey(value) {
    return process.platform === 'win32' ? value.toLowerCase() : value;
}

/** Check real containment as well as lexical spelling, including existing parents
 * of a destination which has not been created. Profile maps are read-only evidence;
 * a symlink must not make an outside source appear owned by a profile. */
function physicallyContained(root, directory, relativePath) {
    try {
        const base = fs.realpathSync(path.join(root, directory));
        let existing = path.join(root, relativePath);
        while (!fs.existsSync(existing)) {
            const parent = path.dirname(existing);
            if (parent === existing) return false;
            existing = parent;
        }
        const difference = path.relative(base, fs.realpathSync(existing));
        return difference === '' || (difference !== '..' && !difference.startsWith(`..${path.sep}`)
            && !path.isAbsolute(difference));
    } catch {
        return false;
    }
}

/** Parse named Markdown amendment payloads without interpreting task operations.
 * Offsets refer to the original string, including CRLF. Callers share this grammar
 * for final-location link review and temporary composition; malformed blocks never
 * supply a partial payload map. IDs are stable letters followed by letters,
 * digits, underscores or hyphens; nesting and duplicate ownership are forbidden. */
export function parseDocumentationDelta(text) {
    const blocks = [];
    const errors = [];
    const identifiers = new Set();
    let active = null;

    // Inspect only delta marker comments. Other Markdown comments, including the
    // document metadata, remain ordinary authored text outside payload ranges.
    for (const marker of text.matchAll(/<!--[\s\S]*?-->/gu)) {
        const body = marker[0].slice(4, -3).trim();
        if (!/^\/?delta\b/u.test(body)) continue;
        const match = /^(\/?delta):([A-Za-z][A-Za-z0-9_-]*)$/u.exec(body);
        if (!match) {
            errors.push({line: lineNumber(text, marker.index), message: 'Malformed documentation delta marker'});
            continue;
        }
        const closing = match[1].startsWith('/');
        const id = match[2];
        if (!closing) {
            if (active || identifiers.has(id)) {
                errors.push({line: lineNumber(text, marker.index), message: `Nested or duplicate documentation delta ${id}`});
                continue;
            }
            identifiers.add(id);
            active = {id, start: marker.index, contentStart: marker.index + marker[0].length};
        } else if (!active || active.id !== id) {
            errors.push({line: lineNumber(text, marker.index), message: `Unexpected closing documentation delta ${id}`});
        } else {
            blocks.push({...active, contentEnd: marker.index, end: marker.index + marker[0].length,
                content: text.slice(active.contentStart, marker.index)});
            active = null;
        }
    }
    if (active) errors.push({line: lineNumber(text, active.start), message: `Unclosed documentation delta ${active.id}`});
    return {blocks: errors.length ? [] : blocks, errors};
}

/** Read a profile's optional replacement map without interpreting its task rules.
 * Every source belongs to that profile's declared staging subtree (or its own
 * subtree when no staging directory is declared); destinations stay in the repo.
 * A malformed map supplies no partial overlay which could conceal another error. */
function readProfileReplacements(root, profile, errors) {
    const manifestName = profile.metadata['replacement-manifest'];
    if (!manifestName) return [];

    const manifestRelative = normalizedRelativePath(manifestName);
    const stagingName = profile.metadata['staging-directory'];
    const stagingRelative = stagingName ? normalizedRelativePath(stagingName) : null;
    if (!manifestRelative || (stagingName && !stagingRelative)) {
        errors.push({type: 'invalid-profile-replacement-map', path: profile.path,
            message: `${profile.path} must declare normalized relative manifest/staging paths inside its own directory`});
        return [];
    }

    // A profile may be useful before it has replacement candidates or a manifest.
    const manifestPath = path.posix.join(profile.directory, manifestRelative);
    const absoluteManifest = path.join(root, manifestPath);
    if (!fs.existsSync(absoluteManifest)) return [];
    if (!fs.lstatSync(absoluteManifest).isFile() || !physicallyContained(root, profile.directory, manifestPath)) {
        errors.push({type: 'invalid-profile-replacement-map', path: profile.path,
            message: `${profile.path} replacement manifest must be an owned regular file`});
        return [];
    }

    let manifest;
    try {
        manifest = JSON.parse(fs.readFileSync(absoluteManifest, 'utf8'));
    } catch (error) {
        errors.push({type: 'invalid-profile-replacement-map', path: manifestPath,
            message: `${manifestPath} is not a readable JSON replacement map: ${error.message}`});
        return [];
    }
    if (!manifest || Array.isArray(manifest) || !Array.isArray(manifest.replacements)) {
        errors.push({type: 'invalid-profile-replacement-map', path: manifestPath,
            message: `${manifestPath} requires a replacements array of source/target records`});
        return [];
    }
    const stagingMode = manifest.stagingMode ?? 'replacements';
    if (!['replacements', 'deltas'].includes(stagingMode)) {
        errors.push({type: 'invalid-profile-replacement-map', path: manifestPath,
            message: `${manifestPath} declares unsupported stagingMode ${stagingMode}`});
        return [];
    }

    const stagingDirectory = stagingRelative ? path.posix.join(profile.directory, stagingRelative) : profile.directory;
    const replacements = [];
    const sources = new Set();
    const targets = new Set();
    const initialErrors = errors.length;
    for (const entry of manifest.replacements) {
        const source = normalizedRelativePath(entry?.source);
        const target = normalizedRelativePath(entry?.target);
        const sourceOwned = source?.startsWith(`${stagingDirectory}/`);
        if (!source || !target || !sourceOwned || !fs.existsSync(path.join(root, source))
            || !fs.lstatSync(path.join(root, source)).isFile()
            || !physicallyContained(root, profile.directory, source)
            || !physicallyContained(root, stagingDirectory, source)
            || !physicallyContained(root, '', target)) {
            errors.push({type: 'invalid-profile-replacement-map', path: manifestPath,
                source: entry?.source, target: entry?.target,
                message: `${manifestPath} replacement sources must be owned staged files and targets normalized repository paths`});
            continue;
        }

        // Reject ambiguous ownership rather than choose the first candidate silently.
        const sourceKey = repositoryPathKey(source);
        const targetKey = repositoryPathKey(target);
        if (sources.has(sourceKey) || targets.has(targetKey)) {
            errors.push({type: 'duplicate-profile-replacement', path: manifestPath, source, target,
                message: `${manifestPath} repeats a replacement source or destination: ${source} -> ${target}`});
        }
        sources.add(sourceKey);
        targets.add(targetKey);
        let blocks = [];
        if (stagingMode === 'deltas') {
            try {
                const delta = parseDocumentationDelta(fs.readFileSync(path.join(root, source), 'utf8'));
                for (const error of delta.errors) {
                    errors.push({type: 'invalid-profile-delta', path: source, ...error});
                }
                blocks = delta.blocks;
            } catch (error) {
                // Unavailable temporary bytes cannot abort declaration inventory
                // or make the publisher lose otherwise available canonical Help.
                errors.push({type: 'invalid-profile-delta', path: source,
                    message: `${source} cannot supply readable delta payloads: ${error.message}`});
            }
        }
        replacements.push({source, target, targetKey, profile: profile.path, stagingMode, blocks});
    }
    return errors.length === initialErrors ? replacements : [];
}

/** Discover current profiles directly under docs' immediate child directories.
 * Ordinary metadata is validated once by the existing owner. Discovery adds only
 * the activation declaration and optional safe map; absence never creates a finding
 * or directory. Link and classification checks consume this same result. */
export function discoverTaskProfiles(root, config, validatedMetadata = null) {
    const result = {profiles: [], profileDirectories: [], replacementsBySource: new Map(), deltasBySource: new Map(),
        mappedTargetsBySource: new Map(), sourcesByTarget: new Map(), errors: []};
    const docsPath = path.join(root, 'docs');
    if (!fs.existsSync(docsPath)) return result;
    // Importing callers may supply a previously validated inventory. Bootstrap
    // validates only possible profile headers, without running global diagnostics.
    const profileFiles = fs.readdirSync(docsPath, {withFileTypes: true})
        .filter(entry => entry.isDirectory() && profileMarkerPresent(path.join(docsPath, entry.name, 'PROFILE.md'))
            && fs.lstatSync(path.join(docsPath, entry.name, 'PROFILE.md')).isFile())
        .map(entry => `docs/${entry.name}/PROFILE.md`);
    const metadata = validatedMetadata ?? validateMetadata(root, config, profileFiles);
    const metadataByPath = new Map(metadata.records.map(record => [record.path, record.metadata]));
    const invalidMetadataPaths = new Set(metadata.errors.map(error => error.path));
    const entries = fs.readdirSync(docsPath, {withFileTypes: true})
        .sort((left, right) => left.name.localeCompare(right.name));
    const canonicalDirectories = new Set(Object.values(config.documentClassification?.categories ?? {}).map(repositoryPathKey));
    const candidates = [];

    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const directory = `docs/${entry.name}`;
        const profilePath = `${directory}/PROFILE.md`;
        if (!profileMarkerPresent(path.join(root, profilePath))) continue;
        // Publication needs every declared temporary directory, even when its
        // marker is inactive or invalid. Canonical category owners cannot be
        // reclassified or excluded from a release by placing a marker there.
        result.profileDirectories.push(directory);
        if (canonicalDirectories.has(repositoryPathKey(directory))) {
            result.errors.push({type: 'task-profile-role-conflict', path: profilePath,
                message: `${profilePath} cannot declare the canonical ${directory} owner as temporary task material`});
            continue;
        }
        const profileMetadata = metadataByPath.get(profilePath);
        const unreadableMetadata = metadata.errors.find(error => error.path === profilePath
            && error.type === 'unreadable-document-metadata');
        if (unreadableMetadata) {
            result.errors.push({type: 'unreadable-task-profile', path: profilePath, message: unreadableMetadata.message});
            continue;
        }
        if (!profileMetadata || invalidMetadataPaths.has(profilePath)
            || !fs.lstatSync(path.join(root, profilePath)).isFile()
            || !profileMetadata['activation-scope'] || !physicallyContained(root, '', profilePath)) {
            result.errors.push({type: 'invalid-task-profile', path: profilePath,
                message: `${profilePath} requires valid document metadata, an activation-scope and an owned regular file`});
            continue;
        }
        if (profileMetadata.status !== 'current') continue;
        const profile = {path: profilePath, directory, metadata: profileMetadata};
        result.profiles.push(profile);
        candidates.push(...readProfileReplacements(root, profile, result.errors));
    }

    // Separate collection from publication: colliding profiles cannot pick an
    // arbitrary future document according to directory traversal order.
    const targetOwners = new Map();
    const duplicateTargets = new Set();
    for (const candidate of candidates) {
        if (targetOwners.has(candidate.targetKey)) {
            duplicateTargets.add(candidate.targetKey);
            result.errors.push({type: 'duplicate-profile-replacement', path: candidate.profile,
                source: candidate.source, target: candidate.target,
                message: `${candidate.profile} repeats another profile's replacement destination ${candidate.target}`});
        }
        targetOwners.set(candidate.targetKey, candidate);
    }
    for (const candidate of candidates) {
        if (duplicateTargets.has(candidate.targetKey)) continue;
        const sourceKey = repositoryPathKey(candidate.source);
        result.mappedTargetsBySource.set(sourceKey, candidate.target);
        if (candidate.stagingMode === 'deltas') result.deltasBySource.set(sourceKey, candidate);
        else result.replacementsBySource.set(sourceKey, candidate.target);
        result.sourcesByTarget.set(repositoryPathKey(candidate.target), candidate.source);
    }
    return result;
}

/** Inventory the marker itself, including an invalid dangling symbolic link.
 * Publication must not leak temporary material just because its marker cannot
 * supply valid current instructions. Other filesystem errors remain visible. */
function profileMarkerPresent(filename) {
    try {
        fs.lstatSync(filename);
        return true;
    } catch (error) {
        if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false;
        throw error;
    }
}

/** Find the profile owning working material without hard-coding a task directory. */
function owningTaskProfile(relativePath, discovery) {
    for (const profile of discovery.profiles) {
        if (relativePath.startsWith(`${profile.directory}/`)) return profile;
    }
    return null;
}

/** Read a current context source by its repository identity. Missing or unsafe
 * sources are review findings, not an excuse to reuse stale handoff content. */
function readContextSource(root, relativePath, role, findings, owningDirectory = '') {
    if (!normalizedRelativePath(relativePath) || !physicallyContained(root, owningDirectory, relativePath)
        || !fs.existsSync(path.join(root, relativePath)) || !fs.lstatSync(path.join(root, relativePath)).isFile()) {
        findings.push({type: 'context-source-unavailable', path: relativePath,
            message: `${relativePath} is not a readable current repository context source`});
        return {path: relativePath, role, sha256: null, content: null};
    }
    try {
        const bytes = fs.readFileSync(path.join(root, relativePath));
        return {path: relativePath, role, sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
            content: bytes.toString('utf8')};
    } catch (error) {
        findings.push({type: 'context-source-unavailable', path: relativePath,
            message: `${relativePath} cannot supply current context: ${error.message}`});
        return {path: relativePath, role, sha256: null, content: null};
    }
}

/** Read caller-held continuation evidence. Authorization and unresolved decisions
 * are caller statements, never derived from task text, paths or profile discovery. */
function readExpectedContext(filename, findings) {
    if (!filename) return null;
    try {
        // Accept either the complete prior delivery or its receipt alone. Check
        // the identity envelope before using its selection or task paths; the
        // caller's decision statements remain unverified data carried separately.
        const document = JSON.parse(fs.readFileSync(filename, 'utf8'));
        const receipt = document?.receipt ?? document;
        if (!receipt || receipt.schemaVersion !== 1 || receipt.kind !== 'agent-context-receipt'
            || typeof receipt.repository !== 'string' || !Array.isArray(receipt.selectedProfiles)
            || !receipt.selectedProfiles.every(value => normalizedRelativePath(value))
            || !Array.isArray(receipt.sources) || !receipt.task || !Array.isArray(receipt.task.paths)
            || !receipt.task.paths.every(value => typeof value === 'string')
            || (receipt.task.purpose !== null && typeof receipt.task.purpose !== 'string')
            || !receipt.sources.every(source => source && normalizedRelativePath(source.path)
                && (source.sha256 === null || /^[a-f0-9]{64}$/u.test(source.sha256)))) {
            throw new Error('Expected an agent-context receipt with repository, task, selected profiles and source identities');
        }
        return receipt;
    } catch (error) {
        findings.push({type: 'invalid-expected-context', path: filename,
            message: `Continuation evidence cannot be read: ${error.message}`});
        return null;
    }
}

/** List direct owned Markdown references for selected profiles. This is not a
 * recursive documentation crawler: activation is explicit, and the caller still
 * selects which referenced procedures apply to its actual task. */
function profileWorkingReferences(root, profile, text) {
    const references = new Set();
    // Read only direct Markdown references owned by the selected profile. Links
    // to general policies, another task or executable source do not activate or
    // traverse those owners implicitly.
    for (const match of [...text.matchAll(INLINE_LINK_RE), ...text.matchAll(REFERENCE_LINK_RE)]) {
        const target = normalizeLinkTarget(match[1]);
        if (!target || EXTERNAL_TARGET_RE.test(target)) continue;
        let pathPart;
        try {
            pathPart = decodeURIComponent(target.split('#', 1)[0].split('?', 1)[0]);
        } catch {
            continue; // The normal advisory link report owns malformed links.
        }
        const relativePath = toPosix(path.relative(root, path.resolve(root, path.posix.dirname(profile.path), pathPart)));
        if (relativePath.endsWith('.md') && relativePath !== profile.path
            && relativePath.startsWith(`${profile.directory}/`)) references.add(relativePath);
    }
    return [...references].sort();
}

/** Compare exact source identities and the caller's explicit task scope on resume.
 * A previous unresolved review stays visible until the caller reconciles its held
 * evidence; refreshing bytes alone cannot certify reading or renew authorization. */
function compareExpectedContext(root, expected, task, selected, sources, findings) {
    if (!expected) return;
    if (repositoryPathKey(path.resolve(expected.repository)) !== repositoryPathKey(fs.realpathSync(root))) {
        findings.push({type: 'context-repository-changed', message: 'Continuation evidence belongs to a different repository'});
    }
    if (expected.task.purpose !== task.purpose || JSON.stringify(expected.task.paths) !== JSON.stringify(task.paths)
        || JSON.stringify(expected.selectedProfiles) !== JSON.stringify(selected)) {
        findings.push({type: 'context-scope-changed', message: 'Task purpose, owned paths or selected profiles changed; review their applicability'});
    }
    const previousSources = new Map(expected.sources.map(source => [repositoryPathKey(source.path), source]));
    const currentSources = new Map(sources.map(source => [repositoryPathKey(source.path), source]));
    for (const source of sources) {
        const previous = previousSources.get(repositoryPathKey(source.path));
        if (!previous || previous.sha256 !== source.sha256) {
            findings.push({type: 'context-source-changed', path: source.path,
                message: `${source.path} differs from the caller-held context; read its current content before continuing`});
        }
    }
    for (const source of expected.sources) {
        if (!currentSources.has(repositoryPathKey(source.path))) {
            findings.push({type: 'context-source-removed', path: source.path,
                message: `${source.path} no longer supplies the selected context`});
        }
    }
    if (Array.isArray(expected.reviewRequired) && expected.reviewRequired.length) {
        findings.push({type: 'unresolved-context-review', message: 'The held receipt still records an unresolved context review'});
    }
}

/** Produce current policy and optional profile context without a fingerprint,
 * baseline prerequisite, automatic profile activation or repository registry.
 * The caller owns receipt storage and task/approval history. Output exposes exact
 * source bytes and freshness evidence, not proof that a person or agent read them. */
function buildAgentContext(root, discovery, options) {
    const findings = [...discovery.errors];
    const expected = readExpectedContext(options.expectedContext, findings);
    const selected = [...new Set(options.selectedProfiles.length || options.noProfile
        ? options.selectedProfiles : expected?.selectedProfiles ?? [])].sort();
    const ownedPaths = options.ownedPaths.length ? options.ownedPaths : expected?.task.paths ?? [];
    const task = {purpose: options.purpose ?? expected?.task.purpose ?? null, paths: [...new Set(ownedPaths)].sort()};
    for (const relativePath of [...selected, ...task.paths]) {
        const normalized = typeof relativePath === 'string' ? normalizedRelativePath(relativePath.replace(/\/$/u, '')) : null;
        if (!normalized || !physicallyContained(root, '', normalized)) {
            findings.push({type: 'invalid-context-path', path: relativePath,
                message: `${relativePath} is not a contained repository context path`});
        }
    }

    // General governance is always delivered. Profile bodies are initially
    // candidates; only explicit caller selection loads their owned references.
    const sources = [];
    for (const relativePath of ['AGENTS.md', 'docs/policies/DOCUMENTATION_POLICY.md', 'docs/policies/DEVELOPMENT_POLICY.md']) {
        sources.push(readContextSource(root, relativePath, 'governance', findings));
    }
    const available = [];
    const selectedKeys = new Set(selected.map(repositoryPathKey));
    const discoveredKeys = new Set();
    for (const profile of discovery.profiles) {
        const source = readContextSource(root, profile.path, 'profile', findings, profile.directory);
        const isSelected = selectedKeys.has(repositoryPathKey(profile.path));
        discoveredKeys.add(repositoryPathKey(profile.path));
        available.push({...source, activationScope: profile.metadata['activation-scope'], selected: isSelected,
            application: isSelected ? 'caller-selected; applicability requires task review' : 'candidate; not applied'});
        if (!isSelected) continue;
        sources.push(source);
        const manifest = profile.metadata['replacement-manifest'];
        if (manifest && normalizedRelativePath(manifest)) {
            const manifestPath = path.posix.join(profile.directory, manifest);
            if (fs.existsSync(path.join(root, manifestPath))) {
                sources.push(readContextSource(root, manifestPath, 'profile-manifest', findings, profile.directory));
            }
        }
        for (const reference of profileWorkingReferences(root, profile, source.content ?? '')) {
            sources.push(readContextSource(root, reference, 'selected-profile-reference', findings, profile.directory));
        }
    }
    for (const relativePath of selected) {
        if (!discoveredKeys.has(repositoryPathKey(relativePath))) {
            findings.push({type: 'selected-profile-unavailable', path: relativePath,
                message: `Previously or explicitly selected profile ${relativePath} is missing, inactive or invalid; review the handoff`});
        }
    }
    compareExpectedContext(root, expected, task, selected, sources, findings);

    // Preserve supplied decision history verbatim as caller-held statements. The
    // tool deliberately supplies no CLI string which can manufacture approval.
    const handoff = {authorization: expected?.authorization ?? null,
        unresolvedDecisions: expected?.unresolvedDecisions ?? null,
        selectionReasons: expected?.selectionReasons ?? null};
    const receipt = {schemaVersion: 1, kind: 'agent-context-receipt', repository: fs.realpathSync(root),
        issuedAt: new Date().toISOString(), task, selectedProfiles: selected,
        sources: sources.map(source => ({path: source.path, role: source.role, sha256: source.sha256})),
        ...handoff, reviewRequired: findings};
    return {schemaVersion: 1, kind: 'agent-context', advisory: true,
        state: findings.length ? 'review-required' : 'current-identities', task,
        profiles: {available, selected, selectedCount: selected.length}, sources, handoff,
        reviewRequired: findings, receipt,
        limitations: ['Source delivery does not prove reading or host injection.',
            'Task purpose, paths and profile selection do not grant approval.',
            'The caller must review applicable procedures and reconcile stale handoff evidence.']};
}

function collectLinkErrors(root, markdownFiles, discovery) {
    const links = [];
    const errors = [];

    for (const relativePath of markdownFiles) {
        const absolutePath = path.join(root, relativePath);
        const replacement = discovery.replacementsBySource.get(repositoryPathKey(relativePath));
        const delta = discovery.deltasBySource.get(repositoryPathKey(relativePath));
        const text = fs.readFileSync(absolutePath, 'utf8');
        const matches = [
            ...text.matchAll(INLINE_LINK_RE),
            ...text.matchAll(REFERENCE_LINK_RE),
        ].sort((left, right) => left.index - right.index);

        for (const match of matches) {
            const target = normalizeLinkTarget(match[1]);
            if (!target || EXTERNAL_TARGET_RE.test(target)) {
                continue;
            }
            const pathPart = decodeURIComponent(target.split('#', 1)[0].split('?', 1)[0]);
            if (!pathPart) {
                continue;
            }
            // Candidate bytes use their final document location. Only candidates
            // see the staged overlay; future files cannot hide broken live links.
            const payload = delta?.blocks.find(block => match.index >= block.contentStart && match.index < block.contentEnd);
            const finalTarget = replacement ?? (payload ? delta.target : null);
            const documentPath = path.join(root, finalTarget ?? relativePath);
            const resolved = path.resolve(path.dirname(documentPath), pathPart);
            const resolvedRelative = toPosix(path.relative(root, resolved));
            const counterpart = finalTarget ? discovery.sourcesByTarget.get(repositoryPathKey(resolvedRelative)) : null;
            const checkedPath = counterpart ? path.join(root, counterpart) : resolved;
            const occurrence = {
                path: relativePath,
                line: lineNumber(text, match.index),
                target,
                resolved: resolvedRelative,
            };
            links.push(occurrence);
            if (!fs.existsSync(checkedPath)) {
                errors.push({
                    type: 'broken-link',
                    message: `${relativePath}:${occurrence.line} points to missing target ${target}`,
                    ...occurrence,
                });
            }
        }
    }

    return {links, errors};
}

function normalizeRepositoryPathToken(rawToken, config) {
    let token = rawToken.trim().replace(/^["']|["']$/gu, '');
    if (!token || /\s/u.test(token) || /[{}$*<>|]/u.test(token)) {
        return null;
    }

    token = token.replace(/[.,;)]$/u, '');
    token = token.split('#', 1)[0];
    token = token.replace(/:\d+(?:-\d+)?$/u, '');

    const prefixes = config.documentedPathPrefixes ?? [];
    const exactRootNames = new Set(config.documentedRootPaths ?? []);
    const looksLikeRepositoryPath = prefixes.some(prefix => token.startsWith(prefix)) || exactRootNames.has(token);
    if (!looksLikeRepositoryPath) {
        return null;
    }

    const hasExtension = path.posix.basename(token).includes('.');
    if (!hasExtension && !token.endsWith('/')) {
        return null;
    }
    return token;
}

/** Read authored path occurrences once for live reports and assembled projections.
 * Filesystem presence does not affect the count of a documented local/generated path. */
function collectRepositoryPathReferences(root, config, markdownFiles) {
    const references = [];
    for (const relativePath of markdownFiles) {
        const text = fs.readFileSync(path.join(root, relativePath), 'utf8');
        for (const match of text.matchAll(INLINE_CODE_RE)) {
            const repositoryPath = normalizeRepositoryPathToken(match[1], config);
            if (!repositoryPath) {
                continue;
            }
            const occurrence = {
                document: relativePath,
                line: lineNumber(text, match.index),
                repositoryPath,
            };
            references.push(occurrence);
        }
    }
    return references;
}

/** Preserve fixed live-tree expectations while accounting for a deliberate document
 * projection. Its reference delta moves the expected count by the same amount, so
 * an existing source mismatch remains a finding rather than approving itself. */
function collectRepositoryPathErrors(root, config, markdownFiles, referenceRoot) {
    const references = collectRepositoryPathReferences(root, config, markdownFiles);
    const referenceOccurrences = referenceRoot
        ? collectRepositoryPathReferences(referenceRoot, config, collectMarkdownFiles(referenceRoot, config)) : references;
    const allowlisted = [];
    const errors = [];
    const projection = [];
    const allowlist = config.documentedPathAllowlist ?? [];

    // Validate every final-path occurrence independently of projection accounting.
    // An omitted task directory cannot excuse a genuinely missing target path.
    for (const occurrence of references) {
        const {repositoryPath} = occurrence;
        if (fs.existsSync(path.resolve(root, repositoryPath))) {
            continue;
        }

        const allowed = allowlist.find(entry => entry.path === repositoryPath);
        if (allowed) {
            allowlisted.push({...occurrence, reason: allowed.reason, package: allowed.package});
        } else {
            errors.push({
                type: 'missing-documented-repository-path',
                path: occurrence.document,
                line: occurrence.line,
                repositoryPath,
                message: `${occurrence.document}:${occurrence.line} references missing repository path ${repositoryPath}`,
            });
        }
    }

    for (const entry of allowlist) {
        // Count authored references, not missing files: generated/local files may
        // exist in a developer checkout but are absent in CI before setup.
        const actualCount = references.filter(occurrence => occurrence.repositoryPath === entry.path).length;
        const referenceCount = referenceOccurrences.filter(occurrence => occurrence.repositoryPath === entry.path).length;
        const projectionDelta = actualCount - referenceCount;
        const expectedCount = entry.expectedOccurrences + projectionDelta;
        if (referenceRoot) projection.push({repositoryPath: entry.path, configuredExpected: entry.expectedOccurrences,
            referenceActual: referenceCount, projectedActual: actualCount, projectedExpected: expectedCount});
        if (actualCount !== expectedCount) {
            errors.push({
                type: 'documented-path-allowlist-count-mismatch',
                repositoryPath: entry.path,
                expected: expectedCount,
                actual: actualCount,
                package: entry.package,
                ...(referenceRoot ? {referenceExpected: entry.expectedOccurrences, referenceActual: referenceCount} : {}),
                message: referenceRoot
                    ? `${entry.path} has ${actualCount} projected documented reference(s); expected ${expectedCount}; `
                    + `source retains ${referenceCount} reference(s) against configured ${entry.expectedOccurrences}`
                    : `${entry.path} has ${actualCount} documented reference(s); configuration expects ${entry.expectedOccurrences}`,
            });
        }
    }

    return {references, allowlisted, errors, projection};
}

function collectNpmScriptErrors(root, markdownFiles) {
    const packagePath = path.join(root, 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    const scripts = new Set(Object.keys(packageJson.scripts ?? {}));
    const references = [];
    const errors = [];

    for (const relativePath of markdownFiles) {
        const text = fs.readFileSync(path.join(root, relativePath), 'utf8');
        for (const match of text.matchAll(NPM_RUN_RE)) {
            const script = match[1];
            const occurrence = {
                path: relativePath,
                line: lineNumber(text, match.index),
                script,
            };
            references.push(occurrence);
            if (!scripts.has(script)) {
                errors.push({
                    type: 'missing-npm-script',
                    message: `${relativePath}:${occurrence.line} references missing npm script ${script}`,
                    ...occurrence,
                });
            }
        }
    }

    return {references, definedScripts: [...scripts].sort(), errors};
}

/** Validate authored headers, configured verification identifiers and source
 * anchors using the existing metadata parser. Unavailable reads remain findings
 * so optional discovery can retain a marker's declared temporary ownership. */
function validateMetadata(root, config, markdownFiles) {
    const errors = [];
    const records = [];
    const exemptions = new Set(config.metadataExemptions ?? []);
    const baselineIds = new Set((config.baselines ?? []).map(baseline => baseline.id));
    const requiredFields = config.requiredMetadataFields ?? [];
    const allowedStatuses = new Set(config.allowedDocumentStatuses ?? []);

    for (const relativePath of markdownFiles) {
        if (exemptions.has(relativePath)) {
            continue;
        }
        let text;
        try {
            text = fs.readFileSync(path.join(root, relativePath), 'utf8');
        } catch (error) {
            // In particular, an unreadable regular PROFILE marker still declares
            // temporary ownership. Keep its inventory and report unavailable
            // metadata instead of aborting all optional profile discovery.
            errors.push({type: 'unreadable-document-metadata', path: relativePath,
                message: `${relativePath} cannot supply readable document metadata: ${error.message}`});
            continue;
        }
        const metadata = parseMetadata(text);
        if (!metadata) {
            errors.push({
                type: 'missing-metadata',
                path: relativePath,
                message: `${relativePath} has no documentation-metadata header`,
            });
            continue;
        }
        records.push({path: relativePath, metadata});

        for (const field of requiredFields) {
            if (!metadata[field]) {
                errors.push({
                    type: 'missing-metadata-field',
                    path: relativePath,
                    field,
                    message: `${relativePath} metadata is missing ${field}`,
                });
            }
        }

        if (metadata.status && allowedStatuses.size > 0 && !allowedStatuses.has(metadata.status)) {
            errors.push({
                type: 'invalid-document-status',
                path: relativePath,
                status: metadata.status,
                message: `${relativePath} uses unsupported documentation status ${metadata.status}`,
            });
        }

        if (metadata['last-verified'] && !/^\d{4}-\d{2}-\d{2}$/u.test(metadata['last-verified'])) {
            errors.push({
                type: 'invalid-verification-date',
                path: relativePath,
                value: metadata['last-verified'],
                message: `${relativePath} last-verified must use YYYY-MM-DD`,
            });
        }

        if (metadata['verification-baseline'] && !baselineIds.has(metadata['verification-baseline'])) {
            errors.push({
                type: 'unknown-verification-baseline',
                path: relativePath,
                value: metadata['verification-baseline'],
                message: `${relativePath} references unknown verification baseline ${metadata['verification-baseline']}`,
            });
        }

        const anchors = (metadata['source-anchors'] ?? '')
            .split(';')
            .map(anchor => anchor.trim().replace(/^`|`$/gu, ''))
            .filter(Boolean);
        for (const anchor of anchors) {
            if (anchor === 'repository-tree') {
                continue;
            }
            const pathPart = anchor.split('#', 1)[0];
            if (!fs.existsSync(path.resolve(root, pathPart))) {
                errors.push({
                    type: 'missing-source-anchor',
                    path: relativePath,
                    anchor,
                    message: `${relativePath} references missing source anchor ${anchor}`,
                });
            }
        }
    }

    return {records, errors};
}

function compileForbiddenTerms(config) {
    return (config.forbiddenTerms ?? []).map(term => {
        const flags = new Set((term.flags ?? '').split(''));
        flags.add('g');
        return {
            ...term,
            regex: new RegExp(term.pattern, [...flags].join('')),
        };
    });
}

function collectStaleTerms(root, config, markdownFiles, strict) {
    const occurrences = [];
    const errors = [];
    const deferred = [];
    const terms = compileForbiddenTerms(config);
    const debtEntries = config.deferredStaleTerms ?? [];

    for (const relativePath of markdownFiles) {
        const text = fs.readFileSync(path.join(root, relativePath), 'utf8');
        for (const term of terms) {
            term.regex.lastIndex = 0;
            for (const match of text.matchAll(term.regex)) {
                const occurrence = {
                    termId: term.id,
                    path: relativePath,
                    line: lineNumber(text, match.index),
                    excerpt: match[0].replace(/\s+/gu, ' ').slice(0, 180),
                };
                occurrences.push(occurrence);
                const debt = debtEntries.find(entry => entry.termId === term.id && entry.path === relativePath);
                if (debt && !strict) {
                    deferred.push({...occurrence, package: debt.package, findingIds: debt.findingIds ?? []});
                } else {
                    errors.push({
                        type: 'forbidden-stale-term',
                        message: `${relativePath}:${occurrence.line} contains forbidden stale term ${term.id}`,
                        ...occurrence,
                    });
                }
            }
        }
    }

    for (const debt of debtEntries) {
        const actualCount = occurrences.filter(
            occurrence => occurrence.termId === debt.termId && occurrence.path === debt.path,
        ).length;
        if (actualCount !== debt.expectedOccurrences) {
            errors.push({
                type: 'migration-debt-count-mismatch',
                termId: debt.termId,
                path: debt.path,
                expected: debt.expectedOccurrences,
                actual: actualCount,
                package: debt.package,
                message: `${debt.path} has ${actualCount} occurrence(s) of ${debt.termId}; migration ledger expects ${debt.expectedOccurrences}`,
            });
        }
    }

    return {occurrences, deferred, errors};
}

/** Check the policy-owned source location and authored references. Equivalent source
 * expressions are deliberately not interpreted as runtime proof; synthetic application
 * tests exercise actual selection, while alias conflicts remain visible for human review. */
function validateCanonicalUserGuide(root, config, markdownFiles) {
    const errors = [];
    const canonical = config.canonicalUserGuideDirectory;
    const canonicalPath = path.join(root, canonical);
    if (!canonical || !fs.existsSync(canonicalPath) || !fs.statSync(canonicalPath).isDirectory()) {
        errors.push({
            type: 'missing-canonical-user-guide-directory',
            message: `Canonical user-guide directory does not exist: ${canonical}`,
        });
    }

    const helpController = path.join(root, config.helpController);
    if (!fs.existsSync(helpController)) {
        errors.push({
            type: 'missing-help-controller',
            message: `Configured help controller does not exist: ${config.helpController}`,
        });
    }

    // Source spelling cannot establish the runtime trust boundary. The controller
    // may compose the fixed path through named variables without changing it.
    // Independently specified synthetic application tests protect source selection;
    // this advisory checker verifies the native corpus and its maintained references.

    for (const relativePath of markdownFiles) {
        const text = fs.readFileSync(path.join(root, relativePath), 'utf8');
        const match = /docs\/(?:user-docs|frontend-help)\b/giu.exec(text);
        if (match) {
            errors.push({
                type: 'ambiguous-user-guide-path',
                path: relativePath,
                line: lineNumber(text, match.index),
                message: `${relativePath} references a retired user-help alias (${match[0]}); review the conflict against ${canonical}`,
            });
        }
    }

    return errors;
}

/** Inspect the shared release publication declaration, without executing it.
 * Existing callers may additionally admit their configured explicit Help-tree
 * copy; the Help-authoring report retains its full-documentation-copy boundary.
 * Actual publisher byte preservation belongs to its isolated CLI regressions. */
export function declaresDocumentationPublication(root, workflow, canonicalUserGuideDirectory = null) {
    if (/cp\s+-R\s+docs\s+release\/docs/u.test(workflow)) return true;
    if (canonicalUserGuideDirectory) {
        const canonical = canonicalUserGuideDirectory.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
        if (new RegExp(`cp\\s+-R\\s+${canonical}\\s+release/${canonical}`, 'u').test(workflow)) return true;
    }

    // A dangling command or redirected/non-file executable cannot establish the
    // actual release wiring. This is structural evidence, never runtime proof.
    const publisher = 'scripts/package-documentation.mjs';
    return /node\s+scripts\/package-documentation\.mjs\s+--destination\s+release\/docs(?:\s|$)/u.test(workflow)
        && fs.existsSync(path.join(root, publisher)) && fs.lstatSync(path.join(root, publisher)).isFile()
        && physicallyContained(root, '', publisher);
}

/** Report packaging declaration drift without controlling release continuation. */
function validateReleaseBundle(root, config) {
    const errors = [];
    const workflowPath = path.join(root, config.releaseWorkflow);
    if (!fs.existsSync(workflowPath)) {
        return [{
            type: 'missing-release-workflow',
            message: `Release workflow does not exist: ${config.releaseWorkflow}`,
        }];
    }

    const workflow = fs.readFileSync(workflowPath, 'utf8');
    if (!declaresDocumentationPublication(root, workflow, config.canonicalUserGuideDirectory)) {
        errors.push({
            type: 'release-missing-user-guides',
            message: `${config.releaseWorkflow} does not copy ${config.canonicalUserGuideDirectory} into the release bundle`,
        });
    }
    return errors;
}

/** Classify maintained documentation from the explicit policy and discovered profiles. Findings
 * request human review; this diagnostic never moves/deletes documents or reinterprets
 * an ADR as permission to rewrite the governing policy. Non-Markdown assets are checked
 * too. Mapped guide candidates use their final category, while actual runtime Help
 * and decision owners remain physical canonical locations, never staging aliases. */
function validateDocumentClassification(root, config, discovery) {
    const classification = config.documentClassification;
    if (!classification || !Array.isArray(classification.rootAllowlist)
        || !classification.categories || typeof classification.categories !== 'object') {
        return [{type: 'missing-document-classification-config',
            message: 'Documentation classification requires an explicit policy-owned root allowlist and category locations'}];
    }
    const errors = [];
    const docsPath = path.join(root, 'docs');
    if (!fs.existsSync(docsPath)) return errors;
    const rootAllowlist = new Set(classification.rootAllowlist);
    const categories = Object.entries(classification.categories);
    for (const category of ['policy', 'decision', 'backlog', 'feature', 'userHelp']) {
        if (!Object.hasOwn(classification.categories, category)) {
            errors.push({type: 'invalid-document-classification-config', category,
                message: `Documentation policy classification is missing the ${category} location`});
        }
    }
    const metadataByPath = new Map();

    for (const name of rootAllowlist) {
        if (typeof name !== 'string' || path.posix.basename(name) !== name) {
            errors.push({type: 'invalid-document-classification-config',
                message: 'Root documentation allowlist entries must be individual filenames'});
        }
    }
    for (const [category, directory] of categories) {
        if (typeof directory !== 'string' || !directory.startsWith('docs/') || path.posix.normalize(directory) !== directory
            || directory.includes('\\')) {
            errors.push({type: 'invalid-document-classification-config', category,
                message: `Category ${category} must name a fixed directory beneath docs/`});
        }
    }
    if (errors.length) return errors;

    const files = walkFiles(docsPath, config.excludedDirectories ?? []);
    for (const file of files) {
        const relativePath = `docs/${file}`;
        const replacement = discovery.replacementsBySource.get(repositoryPathKey(relativePath));
        const mappedTarget = discovery.mappedTargetsBySource.get(repositoryPathKey(relativePath));
        const destination = replacement ?? relativePath;
        const destinationFile = destination.startsWith('docs/') ? destination.slice('docs/'.length) : destination;
        const rootDocument = !destinationFile.includes('/');
        const profile = owningTaskProfile(relativePath, discovery);
        const classified = replacement === 'README.md'
            || (destination.startsWith('docs/') && (rootDocument ? rootAllowlist.has(destinationFile)
                : categories.some(([_category, directory]) => destination.startsWith(`${directory}/`))))
            || (!replacement && profile !== null);
        if (!classified) {
            errors.push({type: 'unclassified-document', path: relativePath,
                message: `${relativePath} has no approved documentation category; classify it through review, never automatic deletion`});
        }
        // Role ownership also covers assets/configuration, not just prose. A map
        // cannot turn a staged image into runtime Help or stage active governance.
        const targetsDecision = mappedTarget?.startsWith(`${classification.categories.decision}/`);
        if (targetsDecision) {
            errors.push({type: 'misplaced-decision-document', path: relativePath,
                message: `${relativePath} is a decision record outside ${classification.categories.decision}; review its intended owner`});
        }
        if (mappedTarget?.startsWith(`${classification.categories.policy}/`)) {
            errors.push({type: 'misplaced-governance-document', path: relativePath,
                message: `${relativePath} stages active policy governance rather than maintaining its canonical owner`});
        }
        if (mappedTarget?.startsWith(`${classification.categories.userHelp}/`)) {
            errors.push({type: 'misplaced-user-help-document', path: relativePath,
                message: `${relativePath} stages runtime Help outside ${classification.categories.userHelp}`});
        }
        if (!file.toLowerCase().endsWith('.md')) continue;
        const metadata = parseMetadata(fs.readFileSync(path.join(root, relativePath), 'utf8'));
        if (metadata) metadataByPath.set(relativePath, metadata);
        const inDecision = relativePath.startsWith(`${classification.categories.decision}/`);
        if (/^DEC-\d+/u.test(path.posix.basename(file)) && !inDecision && !targetsDecision) {
            errors.push({type: 'misplaced-decision-document', path: relativePath,
                message: `${relativePath} is a decision record outside ${classification.categories.decision}; review its intended owner`});
        }
    }

    for (const [relativePath, metadata] of metadataByPath) {
        const inHelp = relativePath.startsWith(`${classification.categories.userHelp}/`);
        const inProfile = owningTaskProfile(relativePath, discovery) !== null;
        const inDecision = relativePath.startsWith(`${classification.categories.decision}/`);
        // The repository README is a general entry for several audiences, exactly
        // as its live counterpart outside docs/. This does not admit staged Help.
        const projectEntry = discovery.replacementsBySource.get(repositoryPathKey(relativePath)) === 'README.md';
        if (/(?:^|;)\s*(?:end users|users)\s*(?:;|$)/iu.test(metadata.audience ?? '') && !inHelp && !projectEntry) {
            errors.push({type: 'misplaced-user-help-document', path: relativePath,
                message: `${relativePath} declares end-user content outside ${classification.categories.userHelp}`});
        }
        if ((metadata.status === 'migration-pending' || metadata['canonical-merge-target']) && !inProfile && !inDecision) {
            errors.push({type: 'misplaced-migration-document', path: relativePath,
                message: `${relativePath} declares a pending task amendment outside an approved profile or canonical decision owner`});
        }
    }
    return errors;
}

function validateCurrentBaseline(config, fingerprint) {
    const errors = [];
    const baselines = config.baselines ?? [];
    const ids = baselines.map(baseline => baseline.id);
    const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
    for (const id of duplicateIds) {
        errors.push({
            type: 'duplicate-verification-baseline',
            baseline: id,
            message: `Verification baseline is defined more than once: ${id}`,
        });
    }

    const current = baselines.find(baseline => baseline.id === config.currentBaseline);
    if (!current) {
        errors.push({
            type: 'missing-current-verification-baseline',
            baseline: config.currentBaseline,
            message: `Current verification baseline is not registered: ${config.currentBaseline}`,
        });
        return {current: null, matches: false, errors};
    }

    if (!/^sha256:[a-f0-9]{64}$/u.test(current.sourceFingerprint ?? '')) {
        errors.push({
            type: 'invalid-source-fingerprint',
            baseline: current.id,
            value: current.sourceFingerprint,
            message: `Baseline ${current.id} has an invalid SHA-256 source fingerprint`,
        });
    }

    const expected = `sha256:${fingerprint.value}`;
    const matches = current.sourceFingerprint === expected;
    if (!matches) {
        errors.push({
            type: 'source-baseline-mismatch',
            baseline: current.id,
            expected,
            actual: current.sourceFingerprint,
            message: `Current source fingerprint ${expected} is not registered by baseline ${current.id}`,
        });
    }

    return {current, matches, errors};
}

function buildReport(root, config, strict, referenceRoot = null) {
    const markdownFiles = collectMarkdownFiles(root, config);
    const fingerprint = computeSourceFingerprint(root, config);
    const metadata = validateMetadata(root, config, markdownFiles);
    const profiles = discoverTaskProfiles(root, config, metadata);
    const links = collectLinkErrors(root, markdownFiles, profiles);
    const npmScripts = collectNpmScriptErrors(root, markdownFiles);
    const repositoryPaths = collectRepositoryPathErrors(root, config, markdownFiles, referenceRoot);
    const staleTerms = collectStaleTerms(root, config, markdownFiles, strict);
    const canonicalErrors = validateCanonicalUserGuide(root, config, markdownFiles);
    const releaseErrors = validateReleaseBundle(root, config);
    const classificationErrors = validateDocumentClassification(root, config, profiles);
    const baseline = validateCurrentBaseline(config, fingerprint);

    const errors = [
        ...baseline.errors,
        ...links.errors,
        ...npmScripts.errors,
        ...repositoryPaths.errors,
        ...metadata.errors,
        ...profiles.errors,
        ...staleTerms.errors,
        ...canonicalErrors,
        ...releaseErrors,
        ...classificationErrors,
    ];

    return {
        schemaVersion: 1,
        advisory: true,
        mode: strict ? 'strict' : 'migration',
        repository: root,
        currentBaseline: config.currentBaseline,
        sourceFingerprint: `sha256:${fingerprint.value}`,
        sourceFingerprintFileCount: fingerprint.files.length,
        sourceFingerprintTextNormalization: config.fingerprint?.textNormalization ?? 'none',
        baselineMatchesCurrent: baseline.matches,
        summary: {
            markdownFiles: markdownFiles.length,
            internalLinks: links.links.length,
            brokenLinks: links.errors.length,
            npmRunReferences: npmScripts.references.length,
            missingNpmScripts: npmScripts.errors.length,
            documentedRepositoryPathReferences: repositoryPaths.references.length,
            allowlistedMissingPathReferences: repositoryPaths.allowlisted.length,
            missingDocumentedRepositoryPaths: repositoryPaths.errors.length,
            metadataRecords: metadata.records.length,
            metadataErrors: metadata.errors.length,
            taskProfiles: profiles.profiles.length,
            stagedReplacements: profiles.replacementsBySource.size,
            stagedDeltas: profiles.deltasBySource.size,
            profileErrors: profiles.errors.length,
            classificationErrors: classificationErrors.length,
            staleTermOccurrences: staleTerms.occurrences.length,
            deferredStaleTermOccurrences: staleTerms.deferred.length,
            totalErrors: errors.length,
        },
        errors,
        deferredMigrationDebt: staleTerms.deferred,
        staleTermOccurrences: staleTerms.occurrences,
        documentedRepositoryPaths: repositoryPaths.references,
        ...(referenceRoot ? {documentedPathReferenceProjection: {referenceRepository: referenceRoot,
                counts: repositoryPaths.projection}} : {}),
        allowlistedMissingDocumentedPaths: repositoryPaths.allowlisted,
        metadata: metadata.records,
        sourceFingerprintFiles: fingerprint.files,
    };
}

function printReport(report) {
    const summary = report.summary;
    console.log(`Surveyor documentation report (${report.mode} mode; advisory)`);
    console.log(`Repository: ${report.repository}`);
    if (report.documentedPathReferenceProjection) {
        console.log(`Authored-path counts projected from: ${report.documentedPathReferenceProjection.referenceRepository}; `
            + 'configured source expectations and inherited drift are retained');
    }
    console.log(`Source fingerprint: ${report.sourceFingerprint}`);
    console.log(`Current baseline matches source: ${report.baselineMatchesCurrent ? 'yes' : 'no'}`);
    console.log(
        `Markdown: ${summary.markdownFiles}; links: ${summary.internalLinks}; broken: ${summary.brokenLinks}; ` +
        `metadata errors: ${summary.metadataErrors}; missing npm scripts: ${summary.missingNpmScripts}; ` +
        `missing documented paths: ${summary.missingDocumentedRepositoryPaths}`,
    );
    console.log(
        `Stale terms: ${summary.staleTermOccurrences}; tracked migration debt: ` +
        `${summary.deferredStaleTermOccurrences}; errors: ${summary.totalErrors}`,
    );

    if (report.errors.length > 0) {
        console.log('\nFindings (non-blocking):');
        for (const error of report.errors) {
            console.log(`  - ${error.message}`);
        }
    }

    if (report.deferredMigrationDebt.length > 0) {
        const byPackage = new Map();
        for (const occurrence of report.deferredMigrationDebt) {
            byPackage.set(occurrence.package, (byPackage.get(occurrence.package) ?? 0) + 1);
        }
        console.log('\nTracked migration debt (advisory in every mode):');
        for (const [packageId, count] of [...byPackage.entries()].sort()) {
            console.log(`  - ${packageId}: ${count} occurrence(s)`);
        }
    }
}

function main() {
    let options;
    try {
        options = parseArguments(process.argv.slice(2));
    } catch (error) {
        console.error(error.message);
        process.exitCode = 2;
        return;
    }

    if (options.help) {
        printHelp();
        return;
    }

    if (!fs.existsSync(path.join(options.root, 'package.json'))) {
        console.error(`${options.root} does not look like the Surveyor repository: package.json is missing`);
        process.exitCode = 2;
        return;
    }
    if (!fs.existsSync(options.configPath)) {
        console.error(`Documentation checker configuration is missing: ${options.configPath}`);
        process.exitCode = 2;
        return;
    }

    const config = JSON.parse(fs.readFileSync(options.configPath, 'utf8'));
    if (options.profilesOnly || options.context) {
        const discovery = discoverTaskProfiles(options.root, config);
        const result = options.context ? buildAgentContext(options.root, discovery, options)
            : {schemaVersion: 1, kind: 'task-profile-discovery', advisory: true,
                profiles: discovery.profiles, profileDirectories: discovery.profileDirectories, errors: discovery.errors,
                limitations: ['Discovery is not activation or implementation approval; missing profiles are normal.']};
        const json = `${JSON.stringify(result, null, 2)}\n`;
        console.log(json.trimEnd());
        if (options.jsonPath) {
            fs.mkdirSync(path.dirname(options.jsonPath), {recursive: true});
            fs.writeFileSync(options.jsonPath, json, 'utf8');
        }
        process.exitCode = 0;
        return;
    }
    if (options.fingerprintOnly) {
        const fingerprint = computeSourceFingerprint(options.root, config);
        console.log(`sha256:${fingerprint.value}`);
        return;
    }

    const report = buildReport(options.root, config, options.strict, options.referenceRoot);
    printReport(report);

    if (options.jsonPath) {
        fs.mkdirSync(path.dirname(options.jsonPath), {recursive: true});
        fs.writeFileSync(options.jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
        console.log(`\nJSON written to ${options.jsonPath}`);
    }

    // Findings are diagnostic data, not a prerequisite for application delivery.
    process.exitCode = 0;
}

// Shared read-only owners are importable by task guards and packaging diagnostics;
// importing them must never execute a CLI, scan a repository or write a report.
if (process.argv[1] && repositoryPathKey(path.resolve(process.argv[1]))
    === repositoryPathKey(fileURLToPath(import.meta.url))) main();
