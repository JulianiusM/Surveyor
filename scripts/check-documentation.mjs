#!/usr/bin/env node

/**
 * Surveyor documentation structural gate.
 *
 * This checker intentionally validates structural integrity and migration
 * bookkeeping. Behavioral truth is verified by the work-package-specific
 * reviews and tests recorded in docs/DOCUMENTATION_MIGRATION_STATUS.md.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const DEFAULT_CONFIG_PATH = 'docs/documentation-check.json';
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
    };

    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === '--strict') {
            options.strict = true;
        } else if (argument === '--fingerprint') {
            options.fingerprintOnly = true;
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
    return options;
}

function printHelp() {
    console.log(`Usage: node scripts/check-documentation.mjs [options]\n\n` +
        `Options:\n` +
        `  --strict            Fail on all known stale terms, including tracked migration debt\n` +
        `  --fingerprint       Print the current documentation source fingerprint and exit\n` +
        `  --json <path>       Write the full result as JSON\n` +
        `  --config <path>     Use a different configuration file\n` +
        `  --root <path>       Check a different repository root\n` +
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

function walkFiles(root, excludedDirectories) {
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

function pathMatchesRule(relativePath, rule) {
    if (rule.endsWith('/')) {
        return relativePath.startsWith(rule);
    }
    return relativePath === rule;
}

function computeSourceFingerprint(root, config) {
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

    const hash = crypto.createHash('sha256');
    for (const relativePath of files) {
        hash.update(relativePath, 'utf8');
        hash.update('\0');
        hash.update(fs.readFileSync(path.join(root, relativePath)));
        hash.update('\0');
    }

    return {
        algorithm: 'sha256',
        value: hash.digest('hex'),
        files,
    };
}

function parseMetadata(text) {
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

function collectMarkdownFiles(root, config) {
    return walkFiles(root, config.excludedDirectories ?? [])
        .filter(relativePath => relativePath.endsWith('.md'));
}

function collectLinkErrors(root, markdownFiles) {
    const links = [];
    const errors = [];

    for (const relativePath of markdownFiles) {
        const absolutePath = path.join(root, relativePath);
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
            const resolved = path.resolve(path.dirname(absolutePath), pathPart);
            const occurrence = {
                path: relativePath,
                line: lineNumber(text, match.index),
                target,
                resolved: toPosix(path.relative(root, resolved)),
            };
            links.push(occurrence);
            if (!fs.existsSync(resolved)) {
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

function collectRepositoryPathErrors(root, config, markdownFiles) {
    const references = [];
    const allowlisted = [];
    const errors = [];
    const allowlist = config.documentedPathAllowlist ?? [];

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
            if (fs.existsSync(path.resolve(root, repositoryPath))) {
                continue;
            }

            const allowed = allowlist.find(entry => entry.path === repositoryPath);
            if (allowed) {
                allowlisted.push({...occurrence, reason: allowed.reason, package: allowed.package});
            } else {
                errors.push({
                    type: 'missing-documented-repository-path',
                    path: relativePath,
                    line: occurrence.line,
                    repositoryPath,
                    message: `${relativePath}:${occurrence.line} references missing repository path ${repositoryPath}`,
                });
            }
        }
    }

    for (const entry of allowlist) {
        const actualCount = allowlisted.filter(occurrence => occurrence.repositoryPath === entry.path).length;
        if (actualCount !== entry.expectedOccurrences) {
            errors.push({
                type: 'documented-path-allowlist-count-mismatch',
                repositoryPath: entry.path,
                expected: entry.expectedOccurrences,
                actual: actualCount,
                package: entry.package,
                message: `${entry.path} has ${actualCount} allowlisted reference(s); configuration expects ${entry.expectedOccurrences}`,
            });
        }
    }

    return {references, allowlisted, errors};
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
        const text = fs.readFileSync(path.join(root, relativePath), 'utf8');
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
    } else {
        const source = fs.readFileSync(helpController, 'utf8');
        if (!/['"]docs['"]\s*,\s*['"]user-guide['"]/u.test(source)) {
            errors.push({
                type: 'help-controller-path-mismatch',
                message: `${config.helpController} does not resolve the canonical docs/user-guide directory`,
            });
        }
    }

    for (const relativePath of markdownFiles) {
        const text = fs.readFileSync(path.join(root, relativePath), 'utf8');
        const match = /docs\/user-docs\b/giu.exec(text);
        if (match) {
            errors.push({
                type: 'ambiguous-user-guide-path',
                path: relativePath,
                line: lineNumber(text, match.index),
                message: `${relativePath} references non-canonical docs/user-docs`,
            });
        }
    }

    return errors;
}

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
    const copiesAllDocs = /cp\s+-R\s+docs\s+release\/docs/u.test(workflow);
    const copiesUserGuide = /cp\s+-R\s+docs\/user-guide\s+release\/docs\/user-guide/u.test(workflow);
    if (!copiesAllDocs && !copiesUserGuide) {
        errors.push({
            type: 'release-missing-user-guides',
            message: `${config.releaseWorkflow} does not copy ${config.canonicalUserGuideDirectory} into the release bundle`,
        });
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

function buildReport(root, config, strict) {
    const markdownFiles = collectMarkdownFiles(root, config);
    const fingerprint = computeSourceFingerprint(root, config);
    const links = collectLinkErrors(root, markdownFiles);
    const npmScripts = collectNpmScriptErrors(root, markdownFiles);
    const repositoryPaths = collectRepositoryPathErrors(root, config, markdownFiles);
    const metadata = validateMetadata(root, config, markdownFiles);
    const staleTerms = collectStaleTerms(root, config, markdownFiles, strict);
    const canonicalErrors = validateCanonicalUserGuide(root, config, markdownFiles);
    const releaseErrors = validateReleaseBundle(root, config);
    const baseline = validateCurrentBaseline(config, fingerprint);

    const errors = [
        ...baseline.errors,
        ...links.errors,
        ...npmScripts.errors,
        ...repositoryPaths.errors,
        ...metadata.errors,
        ...staleTerms.errors,
        ...canonicalErrors,
        ...releaseErrors,
    ];

    return {
        schemaVersion: 1,
        mode: strict ? 'strict' : 'migration',
        repository: root,
        currentBaseline: config.currentBaseline,
        sourceFingerprint: `sha256:${fingerprint.value}`,
        sourceFingerprintFileCount: fingerprint.files.length,
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
            staleTermOccurrences: staleTerms.occurrences.length,
            deferredStaleTermOccurrences: staleTerms.deferred.length,
            totalErrors: errors.length,
        },
        errors,
        deferredMigrationDebt: staleTerms.deferred,
        staleTermOccurrences: staleTerms.occurrences,
        documentedRepositoryPaths: repositoryPaths.references,
        allowlistedMissingDocumentedPaths: repositoryPaths.allowlisted,
        metadata: metadata.records,
        sourceFingerprintFiles: fingerprint.files,
    };
}

function printReport(report) {
    const summary = report.summary;
    console.log(`Surveyor documentation check (${report.mode} mode)`);
    console.log(`Repository: ${report.repository}`);
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
        console.log('\nErrors:');
        for (const error of report.errors) {
            console.log(`  - ${error.message}`);
        }
    }

    if (report.deferredMigrationDebt.length > 0) {
        const byPackage = new Map();
        for (const occurrence of report.deferredMigrationDebt) {
            byPackage.set(occurrence.package, (byPackage.get(occurrence.package) ?? 0) + 1);
        }
        console.log('\nTracked migration debt (non-failing in migration mode):');
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
    if (options.fingerprintOnly) {
        const fingerprint = computeSourceFingerprint(options.root, config);
        console.log(`sha256:${fingerprint.value}`);
        return;
    }

    const report = buildReport(options.root, config, options.strict);
    printReport(report);

    if (options.jsonPath) {
        fs.mkdirSync(path.dirname(options.jsonPath), {recursive: true});
        fs.writeFileSync(options.jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
        console.log(`\nJSON written to ${options.jsonPath}`);
    }

    if (report.summary.totalErrors > 0) {
        process.exitCode = 1;
    }
}

main();
