/*
 * Copyright 2026 Julian Malovanij
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {discoverTaskProfiles, parseDocumentationDelta, parseMetadataBlock, walkFiles} from '../check-documentation.mjs';

// Dependency-free maintainer diagnostics; never part of required application CI.
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const script = path.join(repository, 'scripts/check-documentation.mjs');
const helpScript = path.join(repository, 'scripts/check-help-documentation.mjs');
const productionConfig = JSON.parse(fs.readFileSync(path.join(repository, 'docs/policies/documentation-check.json'), 'utf8'));
const optionalPaths = [
    'src/modules/database/__index__.ts', 'tests/.env.test.local', 'tests/.env.test', '.env.e2e',
];
const metadata = `<!--
documentation-metadata
audience: test fixture
owner: documentation maintainers
status: current
last-verified: 2026-09-06
verification-baseline: fixture
verification-scope: isolated checker regression fixture
source-anchors: repository-tree
next-review: none
-->`;

function run(file, args = [], cwd = repository) {
    const result = spawnSync(process.execPath, [file, ...args], {cwd, encoding: 'utf8', timeout: 20000});
    assert.ifError(result.error);
    assert.equal(result.signal, null, result.stderr);
    return result;
}

function write(root, name, content) {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, content);
}

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surveyor-doc-check-'));
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    const config = structuredClone(productionConfig);
    config.currentBaseline = 'fixture';
    config.baselines = [{id: 'fixture', sourceFingerprint: `sha256:${'0'.repeat(64)}`}];
    config.deferredStaleTerms = [];
    config.forbiddenTerms = [{id: 'fixture-stale', pattern: 'RETIRED_CONCEPT', flags: ''}];
    config.documentedPathAllowlist = optionalPaths.map(name => ({
        path: name, expectedOccurrences: 1, reason: 'Synthetic optional file', package: 'fixture',
    }));
    write(root, 'docs/policies/documentation-check.json', JSON.stringify(config));
    write(root, 'package.json', JSON.stringify({scripts: {valid: 'node -v'}}));
    write(root, 'README.md', `# Fixture\n${metadata}\n\n${optionalPaths.map(name => `\`${name}\``).join('\n')}\n`);
    write(root, 'docs/user-guide/README.md', `# Guide\n${metadata}\n\nUse [this page](README.md).\n`);
    write(root, 'src/controller/helpController.ts', `const root = ['docs', 'user-guide'];\n`);
    write(root, 'src/feature.ts', 'export const fixture = "Grüße";\n');
    write(root, '.github/workflows/release.yml', 'run: cp -R docs release/docs\n');
    const fingerprint = run(script, ['--root', root, '--fingerprint']);
    assert.equal(fingerprint.status, 0, fingerprint.stderr);
    config.baselines[0].sourceFingerprint = fingerprint.stdout.trim();
    write(root, 'docs/policies/documentation-check.json', JSON.stringify(config));
    return root;
}

function inspect(root, strict = false) {
    const report = path.join(root, 'artifacts/report.json');
    const result = run(script, ['--root', root, ...(strict ? ['--strict'] : []), '--json', report]);
    assert.ok(fs.existsSync(report), result.stderr);
    return {result, report: JSON.parse(fs.readFileSync(report, 'utf8'))};
}

function expectError(root, type) {
    const {result, report} = inspect(root, true);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.ok(report.errors.some(error => error.type === type), JSON.stringify(report.errors));
}

/** Add an explicitly scoped synthetic profile; no real task directory is assumed. */
function writeTaskProfile(root, directory, extraFields = '') {
    const fields = `activation-scope: isolated documentation review${extraFields ? `\n${extraFields}` : ''}`;
    const profileMetadata = metadata.replace('next-review: none', `next-review: none\n${fields}`);
    write(root, `${directory}/PROFILE.md`, `# Task profile\n${profileMetadata}\n`);
}

/** Supply only synthetic governance. Bootstrap must not require a matching global
 * source fingerprint or all unrelated documentation diagnostics to be clean. */
function contextFixture(t) {
    const root = fixture(t);
    write(root, 'AGENTS.md', `# Agent routing\n${metadata}\nRead both current policies.\n`);
    write(root, 'docs/policies/DOCUMENTATION_POLICY.md', `# Documentation policy\n${metadata}\nDiscovery grants no approval.\n`);
    write(root, 'docs/policies/DEVELOPMENT_POLICY.md', `# Development policy\n${metadata}\nControllers own business rules.\n`);
    return root;
}

/** Exercise the public CLI and its actual serialized continuation contract. */
function context(root, args = []) {
    const result = run(script, ['--root', root, '--context', ...args]);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
}

test('context bootstrap accepts no profiles and does not run the global report', t => {
    const root = contextFixture(t);
    write(root, 'docs/UNCLASSIFIED.md', '# RETIRED_CONCEPT\n[Broken](absent.md)\n');
    const report = context(root, ['--purpose', 'Inspect an ordinary feature', '--path', 'src/feature.ts']);
    assert.equal(report.state, 'current-identities');
    assert.equal(report.profiles.selectedCount, 0);
    assert.deepEqual(report.profiles.available, []);
    assert.equal(report.sources.length, 3);
    assert.ok(report.sources.every(source => source.content && /^[a-f0-9]{64}$/u.test(source.sha256)));
    assert.equal(report.sourceFingerprint, undefined);
    assert.equal(report.handoff.authorization, null);
    const listing = run(script, ['--root', root, '--profiles']);
    assert.equal(listing.status, 0, listing.stderr);
    assert.deepEqual(JSON.parse(listing.stdout).profiles, []);
});

test('context discovery delivers candidate bodies without selecting or loading their references', t => {
    const root = contextFixture(t);
    writeTaskProfile(root, 'docs/operations-review');
    fs.appendFileSync(path.join(root, 'docs/operations-review/PROFILE.md'), '\n[Working procedure](WORK.md)\n');
    const report = context(root, ['--purpose', 'An approved general task']);
    assert.equal(report.profiles.available.length, 1);
    assert.match(report.profiles.available[0].content, /Working procedure/u);
    assert.equal(report.profiles.available[0].selected, false);
    assert.equal(report.sources.length, 3);
    assert.equal(report.state, 'current-identities');
    assert.equal(report.handoff.authorization, null);
});

test('selected context loads owned working material and preserves caller-held handoff statements', t => {
    const root = contextFixture(t);
    const profile = 'docs/operations-review/PROFILE.md';
    writeTaskProfile(root, 'docs/operations-review');
    write(root, 'docs/operations-review/WORK.md', `# Working procedure\n${metadata}\nA scoped procedure.\n`);
    fs.appendFileSync(path.join(root, profile), '\n[Working procedure](WORK.md)\n');
    const first = context(root, ['--profile', profile, '--purpose', 'Inspect storage', '--path', 'src/']);
    assert.equal(first.profiles.selectedCount, 1);
    assert.ok(first.sources.some(source => source.path.endsWith('/WORK.md') && source.content.includes('scoped procedure')));
    first.receipt.authorization = {decision: 'caller supplied approval provenance', scope: ['src/']};
    first.receipt.unresolvedDecisions = [{decision: 'caller supplied unresolved consequence'}];
    first.receipt.selectionReasons = {[profile]: 'Caller assessed storage responsibility against the declared scope'};
    write(root, 'artifacts/context.json', JSON.stringify(first));
    const resumed = context(root, ['--expect-context', 'artifacts/context.json']);
    assert.equal(resumed.state, 'current-identities');
    assert.deepEqual(resumed.profiles.selected, [profile]);
    assert.deepEqual(resumed.handoff.authorization, first.receipt.authorization);
    assert.deepEqual(resumed.handoff.unresolvedDecisions, first.receipt.unresolvedDecisions);
    assert.deepEqual(resumed.handoff.selectionReasons, first.receipt.selectionReasons);
    assert.deepEqual(resumed.task, first.task);
});

test('selected profile changes and disappearance invalidate held context distinctly', t => {
    const root = contextFixture(t);
    const profile = 'docs/operations-review/PROFILE.md';
    writeTaskProfile(root, 'docs/operations-review');
    const first = context(root, ['--profile', profile]);
    write(root, 'artifacts/context.json', JSON.stringify(first.receipt));
    fs.appendFileSync(path.join(root, profile), '\nA newly changed scoped rule.\n');
    const changed = context(root, ['--expect-context', 'artifacts/context.json']);
    assert.equal(changed.state, 'review-required');
    assert.ok(changed.reviewRequired.some(item => item.type === 'context-source-changed' && item.path === profile));
    fs.unlinkSync(path.join(root, profile));
    const missing = context(root, ['--expect-context', 'artifacts/context.json']);
    assert.equal(missing.state, 'review-required');
    assert.ok(missing.reviewRequired.some(item => item.type === 'selected-profile-unavailable' && item.path === profile));
    assert.deepEqual(missing.receipt.selectedProfiles, [profile]);
    writeTaskProfile(root, 'docs/operations-review');
    fs.writeFileSync(path.join(root, profile), fs.readFileSync(path.join(root, profile), 'utf8').replace('status: current', 'status: historical'));
    assert.ok(context(root, ['--expect-context', 'artifacts/context.json']).reviewRequired
        .some(item => item.type === 'selected-profile-unavailable'));
});

test('resume checks governance, selected references and manifest bytes without manufacturing approval', t => {
    const root = contextFixture(t);
    const profile = 'docs/operations-review/PROFILE.md';
    writeTaskProfile(root, 'docs/operations-review', 'replacement-manifest: boundary.json');
    write(root, 'docs/operations-review/boundary.json', JSON.stringify({replacements: []}));
    write(root, 'docs/operations-review/WORK.md', `# Work\n${metadata}\n`);
    fs.appendFileSync(path.join(root, profile), '\n[Work](WORK.md)\n');
    const first = context(root, ['--profile', profile, '--purpose', 'An already approved request']);
    write(root, 'artifacts/context.json', JSON.stringify(first));
    for (const changedPath of ['AGENTS.md', 'docs/operations-review/WORK.md', 'docs/operations-review/boundary.json']) {
        fs.appendFileSync(path.join(root, changedPath), '\n');
        const resumed = context(root, ['--expect-context', 'artifacts/context.json']);
        assert.ok(resumed.reviewRequired.some(item => item.type === 'context-source-changed' && item.path === changedPath));
        assert.equal(resumed.handoff.authorization, null);
    }
    const changedScope = context(root, ['--expect-context', 'artifacts/context.json', '--no-profile', '--purpose', 'A different task']);
    assert.deepEqual(changedScope.profiles.selected, []);
    assert.ok(changedScope.reviewRequired.some(item => item.type === 'context-scope-changed'));
});

test('context retains unresolved freshness review and reports malformed caller evidence', t => {
    const root = contextFixture(t);
    const first = context(root);
    first.receipt.reviewRequired.push({type: 'caller-unresolved-review', message: 'Still awaiting actual review'});
    write(root, 'artifacts/context.json', JSON.stringify(first));
    assert.ok(context(root, ['--expect-context', 'artifacts/context.json']).reviewRequired
        .some(item => item.type === 'unresolved-context-review'));
    write(root, 'artifacts/context.json', '{not JSON');
    const malformed = context(root, ['--expect-context', 'artifacts/context.json']);
    assert.ok(malformed.reviewRequired.some(item => item.type === 'invalid-expected-context'));
    assert.equal(malformed.state, 'review-required');
});

test('context rejects unsafe owned paths and does not silently use report mode for selection', t => {
    const root = contextFixture(t);
    assert.ok(context(root, ['--path', '../outside']).reviewRequired.some(item => item.type === 'invalid-context-path'));
    const result = run(script, ['--root', root, '--profile', 'docs/operations-review/PROFILE.md']);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /require --context/u);
});

test('profile declaration inventory includes invalid and inactive markers without claiming canonical owners', t => {
    const root = fixture(t);
    writeTaskProfile(root, 'docs/operations-review');
    writeTaskProfile(root, 'docs/retired-review');
    const retired = path.join(root, 'docs/retired-review/PROFILE.md');
    fs.writeFileSync(retired, fs.readFileSync(retired, 'utf8').replace('status: current', 'status: historical'));
    write(root, 'docs/broken-review/PROFILE.md', '# Unclassified marker\n');
    fs.mkdirSync(path.join(root, 'docs/non-file-review/PROFILE.md'), {recursive: true});
    writeTaskProfile(root, 'docs/features');
    const config = JSON.parse(fs.readFileSync(path.join(root, 'docs/policies/documentation-check.json'), 'utf8'));
    const discovered = discoverTaskProfiles(root, config);
    assert.deepEqual(discovered.profileDirectories, ['docs/broken-review', 'docs/features', 'docs/non-file-review',
        'docs/operations-review', 'docs/retired-review']);
    assert.deepEqual(discovered.profiles.map(profile => profile.directory), ['docs/operations-review']);
    assert.ok(discovered.errors.some(error => error.type === 'invalid-task-profile'));
    assert.ok(discovered.errors.some(error => error.type === 'task-profile-role-conflict' && error.path === 'docs/features/PROFILE.md'));
});

test('Windows case aliases cannot reclassify a canonical category as temporary profile material', {
    skip: process.platform !== 'win32',
}, t => {
    const root = fixture(t);
    writeTaskProfile(root, 'docs/Features');
    const config = JSON.parse(fs.readFileSync(path.join(root, 'docs/policies/documentation-check.json'), 'utf8'));
    const discovered = discoverTaskProfiles(root, config);
    assert.deepEqual(discovered.profileDirectories, ['docs/Features']);
    assert.equal(discovered.profiles.length, 0);
    assert.ok(discovered.errors.some(error => error.type === 'task-profile-role-conflict'));
});

test('unreadable profile metadata remains a finding with its temporary declaration inventory', t => {
    const root = fixture(t);
    const profile = 'docs/operations-review/PROFILE.md';
    writeTaskProfile(root, 'docs/operations-review');
    const config = JSON.parse(fs.readFileSync(path.join(root, 'docs/policies/documentation-check.json'), 'utf8'));
    const readFile = fs.readFileSync;
    // Replace only the external filesystem read failure. Production discovery,
    // metadata ownership and declaration inventory remain the actual code path;
    // this does not claim a platform ACL or release rehearsal was performed.
    t.mock.method(fs, 'readFileSync', function unavailableProfileRead(filename, ...args) {
        if (filename === path.join(root, profile)) throw Object.assign(new Error('Fixture permission denied'), {code: 'EACCES'});
        return readFile.call(fs, filename, ...args);
    });
    const discovered = discoverTaskProfiles(root, config);
    assert.deepEqual(discovered.profileDirectories, ['docs/operations-review']);
    assert.equal(discovered.profiles.length, 0);
    assert.ok(discovered.errors.some(error => error.type === 'unreadable-task-profile' && error.path === profile));
    assert.equal(fs.existsSync(path.join(root, 'docs/user-guide/README.md')), true);
});

test('unavailable delta payloads cannot abort the shared optional profile inventory', t => {
    const root = fixture(t);
    writeTaskProfile(root, 'docs/operations-review', 'staging-directory: staged\nreplacement-manifest: boundary.json');
    const source = 'docs/operations-review/staged/NOTES.md';
    write(root, source, `# Delta\n${metadata}\n<!-- delta:body -->Text<!-- /delta:body -->\n`);
    write(root, 'docs/operations-review/boundary.json', JSON.stringify({stagingMode: 'deltas',
        replacements: [{source, target: 'docs/ARCHITECTURE.md'}]}));
    const config = JSON.parse(fs.readFileSync(path.join(root, 'docs/policies/documentation-check.json'), 'utf8'));
    const readFile = fs.readFileSync;
    t.mock.method(fs, 'readFileSync', function unavailablePayloadRead(filename, ...args) {
        if (filename === path.join(root, source)) throw Object.assign(new Error('Fixture read unavailable'), {code: 'EACCES'});
        return readFile.call(fs, filename, ...args);
    });
    const discovered = discoverTaskProfiles(root, config);
    assert.deepEqual(discovered.profileDirectories, ['docs/operations-review']);
    assert.equal(discovered.profiles.length, 1);
    assert.equal(discovered.deltasBySource.size, 0);
    assert.ok(discovered.errors.some(error => error.type === 'invalid-profile-delta' && error.path === source));
});

test('optional walker visitor sees real redirected entries without changing default traversal', t => {
    const root = fixture(t);
    write(root, 'other-source/HIDDEN.ts', 'export const hidden = true;\n');
    write(root, 'ignored/PRIVATE.ts', 'export const excluded = true;\n');
    const redirect = path.join(root, 'src/redirected');
    fs.symlinkSync(path.join(root, 'other-source'), redirect, process.platform === 'win32' ? 'junction' : 'dir');
    const ordinary = walkFiles(root, ['ignored']);
    const entries = [];
    function recordVisitedEntry(value) {
        entries.push({relative: value.relative, absolute: value.absolute, redirected: value.entry.isSymbolicLink()});
    }
    assert.deepEqual(walkFiles(root, ['ignored'], recordVisitedEntry), ordinary);
    assert.ok(entries.some(entry => entry.relative === 'src/redirected' && entry.absolute === redirect && entry.redirected));
    assert.equal(entries.some(entry => entry.relative.startsWith('ignored')), false);
    assert.equal(ordinary.includes('src/redirected/HIDDEN.ts'), false);

    function rejectSelectedRedirection(value) {
        if (value.relative.startsWith('src/') && value.entry.isSymbolicLink()) throw new Error('Selected input is redirected');
    }
    assert.throws(() => walkFiles(root, ['ignored'], rejectSelectedRedirection), /Selected input is redirected/u);
});

test('shared parser preserves metadata and delta CRLF offsets and rejects ambiguous payloads', () => {
    const text = `# Delta\r\n${metadata.replace(/\n/gu, '\r\n')}\r\n<!-- delta:step_1 -->\r\nText.\r\n<!-- /delta:step_1 -->\r\n`;
    const header = parseMetadataBlock(text);
    assert.equal(text.slice(header.start, header.end), header.content);
    assert.equal(header.metadata.owner, 'documentation maintainers');
    const delta = parseDocumentationDelta(text);
    assert.deepEqual(delta.errors, []);
    assert.equal(delta.blocks[0].id, 'step_1');
    assert.equal(text.slice(delta.blocks[0].contentStart, delta.blocks[0].contentEnd), '\r\nText.\r\n');
    for (const malformed of [
        '<!-- delta:bad.id --><!-- /delta:bad.id -->',
        '<!-- delta:outer --><!-- delta:inner --><!-- /delta:inner --><!-- /delta:outer -->',
        '<!-- delta:same --><!-- /delta:same --><!-- delta:same --><!-- /delta:same -->',
        '<!-- /delta:stray -->', '<!-- delta:unclosed -->',
        '<!-- delta:first --><!-- /delta:different -->',
    ]) {
        const invalid = parseDocumentationDelta(malformed);
        assert.ok(invalid.errors.length, malformed);
        assert.deepEqual(invalid.blocks, []);
    }
});

test('delta payload links use final destinations while outer links stay profile-local', t => {
    const root = fixture(t);
    writeTaskProfile(root, 'docs/operations-review', 'staging-directory: staged\nreplacement-manifest: boundary.json');
    const source = 'docs/operations-review/staged/ARCHITECTURE.md';
    const second = 'docs/operations-review/staged/DEVELOPMENT.md';
    write(root, 'docs/operations-review/CONTROL.md', `# Control\n${metadata}\n`);
    write(root, source, `# Architecture delta\n${metadata.replace('status: current', 'status: migration-pending')}\n` +
        '[Control](../CONTROL.md)\n<!-- delta:links -->\n[Development](DEVELOPMENT.md)\n<!-- /delta:links -->\n');
    write(root, second, `# Development delta\n${metadata}\n<!-- delta:body -->\nDevelopment content.\n<!-- /delta:body -->\n`);
    write(root, 'docs/operations-review/boundary.json', JSON.stringify({stagingMode: 'deltas', replacements: [
        {source, target: 'docs/ARCHITECTURE.md'}, {source: second, target: 'docs/DEVELOPMENT.md'},
    ]}));
    const config = JSON.parse(fs.readFileSync(path.join(root, 'docs/policies/documentation-check.json'), 'utf8'));
    const discovered = discoverTaskProfiles(root, config);
    assert.equal(discovered.replacementsBySource.size, 0);
    assert.equal(discovered.deltasBySource.size, 2);
    assert.equal(discovered.mappedTargetsBySource.size, 2);
    const report = inspect(root).report;
    assert.equal(report.summary.brokenLinks, 0, JSON.stringify(report.errors));
    assert.equal(report.summary.classificationErrors, 0, JSON.stringify(report.errors));
    assert.equal(report.summary.stagedDeltas, 2);
    fs.appendFileSync(path.join(root, source), '\n[Outer missing](DEVELOPMENT.md)\n');
    // This physical sibling exists. Removing it invalidates the map separately;
    // an unrelated outer link cannot borrow a final-location replacement.
    fs.appendFileSync(path.join(root, source), '\n[Outer final guide](../../ARCHITECTURE.md)\n');
    assert.equal(inspect(root).report.summary.brokenLinks, 1);
});

test('delta maps preserve governance/runtime roles and reject malformed payload overlays', t => {
    const root = fixture(t);
    writeTaskProfile(root, 'docs/operations-review', 'staging-directory: staged\nreplacement-manifest: boundary.json');
    const source = 'docs/operations-review/staged/NOTES.md';
    write(root, source, `# Delta\n${metadata}\n<!-- delta:body -->\nText\n<!-- /delta:body -->\n`);
    const manifest = 'docs/operations-review/boundary.json';
    for (const target of ['docs/policies/NOTES.md', 'docs/decisions/DEC-999-NOTES.md', 'docs/user-guide/NOTES.md']) {
        write(root, manifest, JSON.stringify({stagingMode: 'deltas', replacements: [{source, target}]}));
        assert.ok(inspect(root).report.errors.some(item => ['misplaced-governance-document',
            'misplaced-decision-document', 'misplaced-user-help-document'].includes(item.type)));
    }
    write(root, source, `# Delta\n${metadata}\n<!-- delta:body -->\nUnclosed.\n`);
    expectError(root, 'invalid-profile-delta');
});

test('release declarations recognize the optional publisher only when its executable exists', t => {
    const root = fixture(t);
    write(root, '.github/workflows/release.yml', 'run: node scripts/package-documentation.mjs --destination release/docs\n');
    expectError(root, 'release-missing-user-guides');
    // Use the real executable owner. Its separate CLI suite verifies copying;
    // this regression protects only the advisory declaration/path boundary.
    write(root, 'scripts/package-documentation.mjs', fs.readFileSync(path.join(repository, 'scripts/package-documentation.mjs')));
    assert.equal(inspect(root).report.errors.some(error => error.type === 'release-missing-user-guides'), false);
    write(root, '.github/workflows/release.yml', 'run: node scripts/package-documentation.mjs --destination other/docs\n');
    expectError(root, 'release-missing-user-guides');
});

test('both structural modes accept a clean checkout without generated/local files', t => {
    const root = fixture(t);
    for (const strict of [false, true]) {
        const {result, report} = inspect(root, strict);
        assert.equal(result.status, 0, result.stdout + result.stderr);
        assert.equal(report.summary.totalErrors, 0);
        assert.equal(report.summary.taskProfiles, 0);
        assert.equal(report.summary.profileErrors, 0);
        assert.equal(report.allowlistedMissingDocumentedPaths.length, optionalPaths.length);
    }
});

test('creating optional/generated files changes neither reference counts nor fingerprint', t => {
    const root = fixture(t);
    const before = inspect(root).report;
    for (const name of optionalPaths) write(root, name, 'synthetic local value\n');
    const {result, report} = inspect(root, true);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(report.sourceFingerprint, before.sourceFingerprint);
    assert.equal(report.allowlistedMissingDocumentedPaths.length, 0);
});

for (const present of [false, true]) {
    test(`exact reference counts remain enforced (optional file present: ${present})`, t => {
        const root = fixture(t);
        if (present) write(root, optionalPaths[0], '// generated fixture\n');
        fs.appendFileSync(path.join(root, 'README.md'), `\n\`${optionalPaths[0]}\`\n`);
        expectError(root, 'documented-path-allowlist-count-mismatch');
    });
}

test('LF and CRLF UTF-8 source yield the same fingerprint', t => {
    const root = fixture(t);
    const source = path.join(root, 'src/feature.ts');
    const before = inspect(root).report.sourceFingerprint;
    fs.writeFileSync(source, fs.readFileSync(source, 'utf8').replace(/\n/gu, '\r\n'));
    const {result, report} = inspect(root, true);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(report.sourceFingerprint, before);
});

test('binary CRLF bytes are not normalized', t => {
    const root = fixture(t);
    write(root, 'src/binary.fixture', Buffer.from([0xff, 0x00, 0x0d, 0x0a]));
    const first = run(script, ['--root', root, '--fingerprint']).stdout;
    write(root, 'src/binary.fixture', Buffer.from([0xff, 0x00, 0x0a]));
    const second = run(script, ['--root', root, '--fingerprint']).stdout;
    assert.notEqual(first, second);
});

test('local settings and IDE files are not implementation inputs', t => {
    const root = fixture(t);
    const before = inspect(root).report.sourceFingerprint;
    for (const name of ['.env', '.env.local', 'settings.csv', '.idea/workspace.xml', '.vscode/settings.json', 'uploads/sample.bin']) {
        write(root, name, 'synthetic non-source state\r\n');
    }
    const {result, report} = inspect(root, true);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(report.sourceFingerprint, before);
});

test('temporary release copies do not enter maintained-document scans or source fingerprints', t => {
    const root = fixture(t);
    const before = inspect(root).report.sourceFingerprint;
    write(root, '.temp/release/docs/UNVERIFIED.md', '# Temporary copy\n[Missing](missing.md)\n');
    write(root, '.temp/release/src/copied.ts', 'export const temporary = true;\n');
    const {report} = inspect(root, true);
    assert.equal(report.summary.totalErrors, 0);
    assert.equal(report.sourceFingerprint, before);
});

test('advisory source inventory accepts equivalent fixed-path composition', t => {
    const root = fixture(t);
    write(root, 'src/controller/helpController.ts', "const docsRoot = path.join(root, 'docs');\nconst helpRoot = path.join(docsRoot, 'user-guide');\n");
    const {report} = inspect(root, true);
    // A source change still has fingerprint evidence; static expression spelling
    // must not be mistaken for a runtime source-boundary assertion.
    assert.ok(report.errors.every(error => error.type === 'source-baseline-mismatch'));
});

test('real source changes are reported without blocking in both modes', t => {
    const root = fixture(t);
    fs.appendFileSync(path.join(root, 'src/feature.ts'), '// real source change\n');
    for (const strict of [false, true]) {
        const {result, report} = inspect(root, strict);
        assert.equal(result.status, 0);
        assert.ok(report.errors.some(error => error.type === 'source-baseline-mismatch'));
    }
});

test('new source files still change the fingerprint', t => {
    const root = fixture(t);
    write(root, 'src/new-feature.ts', 'export const added = true;\n');
    expectError(root, 'source-baseline-mismatch');
});

test('a removed real source file still changes the fingerprint', t => {
    const root = fixture(t);
    fs.unlinkSync(path.join(root, 'src/feature.ts'));
    expectError(root, 'source-baseline-mismatch');
});

test('undefined source path is not masked by the exact generated-path exception', t => {
    const root = fixture(t);
    fs.appendFileSync(path.join(root, 'README.md'), '\n`src/modules/database/missing.ts`\n');
    expectError(root, 'missing-documented-repository-path');
});

test('missing source anchors are not allowlisted', t => {
    const root = fixture(t);
    const file = path.join(root, 'README.md');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('source-anchors: repository-tree', 'source-anchors: src/missing.ts'));
    expectError(root, 'missing-source-anchor');
});

test('broken links remain visible findings', t => {
    const root = fixture(t);
    fs.appendFileSync(path.join(root, 'README.md'), '\n[Missing](missing.md)\n');
    expectError(root, 'broken-link');
});

test('undefined npm scripts remain visible findings', t => {
    const root = fixture(t);
    fs.appendFileSync(path.join(root, 'README.md'), '\n`npm run missing-script`\n');
    expectError(root, 'missing-npm-script');
});

test('missing metadata remains a finding', t => {
    const root = fixture(t);
    write(root, 'docs/UNVERIFIED.md', '# Unverified\n');
    expectError(root, 'missing-metadata');
});

test('forbidden stale concepts remain visible findings', t => {
    const root = fixture(t);
    fs.appendFileSync(path.join(root, 'README.md'), '\nRETIRED_CONCEPT\n');
    expectError(root, 'forbidden-stale-term');
});

test('classification accepts the policy root allowlist and reports unclassified files without deleting them', t => {
    const root = fixture(t);
    write(root, 'docs/README.md', `# Documentation\n${metadata}\n`);
    assert.equal(inspect(root).report.summary.classificationErrors, 0);
    const document = 'docs/UNAPPROVED_PLAN.md';
    const content = `# Unclassified plan\n${metadata}\n\nAwait human classification.\n`;
    write(root, document, content);
    expectError(root, 'unclassified-document');
    assert.equal(fs.readFileSync(path.join(root, document), 'utf8'), content);
});

test('classification reports misplaced user help, task amendments and formal decisions', t => {
    const root = fixture(t);
    write(root, 'docs/features/help/TASKS.md', `# User task\n${metadata.replace('audience: test fixture', 'audience: end users')}\n`);
    write(root, 'docs/features/packing/MIGRATION.md', `# Migration amendment\n${metadata.replace('status: current', 'status: migration-pending')}\n`);
    writeTaskProfile(root, 'docs/review-task');
    write(root, 'docs/review-task/DEC-999-SAMPLE.md', `# Formal decision\n${metadata}\n`);
    const {result, report} = inspect(root);
    assert.equal(result.status, 0);
    for (const type of ['misplaced-user-help-document', 'misplaced-migration-document', 'misplaced-decision-document']) {
        assert.ok(report.errors.some(error => error.type === type), type);
    }
});

test('optional profiles and declared replacement manifests may be absent without findings', t => {
    const root = fixture(t);
    writeTaskProfile(root, 'docs/operations-review');
    writeTaskProfile(root, 'docs/second-review', 'replacement-manifest: missing.json');
    const {result, report} = inspect(root, true);
    assert.equal(result.status, 0);
    assert.equal(report.summary.totalErrors, 0);
    assert.equal(report.summary.taskProfiles, 2);
    assert.equal(report.summary.stagedReplacements, 0);
    assert.equal(fs.existsSync(path.join(root, 'docs/second-review/missing.json')), false);
});

test('an alternate profile resolves candidate links at final locations using staged counterparts', t => {
    const root = fixture(t);
    const directory = 'docs/operations-review';
    writeTaskProfile(root, directory, 'staging-directory: candidates\nreplacement-manifest: replacements.json');
    write(root, `${directory}/candidates/architecture.md`, `# Architecture\n${metadata}\n\n[Development](DEVELOPMENT.md)\n[Project](../README.md)\n`);
    write(root, `${directory}/candidates/development.md`, `# Development\n${metadata}\n\n[Architecture](ARCHITECTURE.md)\n`);
    write(root, `${directory}/replacements.json`, JSON.stringify({replacements: [
        {source: `${directory}/candidates/architecture.md`, target: 'docs/ARCHITECTURE.md'},
        {source: `${directory}/candidates/development.md`, target: 'docs/DEVELOPMENT.md'},
    ]}));
    write(root, `${directory}/NOTES.md`, `# Review notes\n${metadata}\n`);
    const {report} = inspect(root, true);
    assert.equal(report.summary.totalErrors, 0, JSON.stringify(report.errors));
    assert.equal(report.summary.taskProfiles, 1);
    assert.equal(report.summary.stagedReplacements, 2);
    assert.equal(fs.existsSync(path.join(root, 'docs/DEVELOPMENT.md')), false);

    // A future counterpart cannot make the same missing current guide usable now.
    fs.appendFileSync(path.join(root, 'README.md'), '\n[Live development guide](docs/DEVELOPMENT.md)\n');
    const live = inspect(root).report;
    assert.ok(live.errors.some(error => error.type === 'broken-link' && error.path === 'README.md'));
});

test('a mapped project README preserves its legitimate combined audience', t => {
    const root = fixture(t);
    const directory = 'docs/entry-review';
    writeTaskProfile(root, directory, 'replacement-manifest: replacements.json\nstaging-directory: candidates');
    const entryMetadata = metadata.replace('audience: test fixture', 'audience: developers; operators; end users');
    write(root, `${directory}/candidates/PROJECT.md`, `# Project\n${entryMetadata}\n`);
    write(root, `${directory}/replacements.json`, JSON.stringify({replacements: [
        {source: `${directory}/candidates/PROJECT.md`, target: 'README.md'},
    ]}));
    assert.equal(inspect(root, true).report.summary.totalErrors, 0);
});

test('mapped candidates cannot hide an unapproved root document or stage canonical governance and Help', t => {
    const root = fixture(t);
    const directory = 'docs/entry-review';
    writeTaskProfile(root, directory, 'replacement-manifest: replacements.json\nstaging-directory: candidates');
    const replacements = [
        {source: `${directory}/candidates/PLAN.md`, target: 'docs/UNAPPROVED_PLAN.md'},
        {source: `${directory}/candidates/DECISION.md`, target: 'docs/decisions/DEC-999-SAMPLE.md'},
        {source: `${directory}/candidates/POLICY.md`, target: 'docs/policies/EXTRA_POLICY.md'},
        {source: `${directory}/candidates/HELP.md`, target: 'docs/user-guide/TASK.md'},
        {source: `${directory}/candidates/FIGURE.png`, target: 'docs/user-guide/assets/STAGED.png'},
    ];
    for (const replacement of replacements) write(root, replacement.source, `# Candidate\n${metadata}\n`);
    write(root, `${directory}/replacements.json`, JSON.stringify({replacements}));
    const {result, report} = inspect(root);
    assert.equal(result.status, 0);
    for (const type of ['unclassified-document', 'misplaced-decision-document', 'misplaced-governance-document', 'misplaced-user-help-document']) {
        assert.ok(report.errors.some(error => error.type === type), type);
    }
    assert.ok(report.errors.some(error => error.type === 'misplaced-user-help-document'
        && error.path === `${directory}/candidates/FIGURE.png`));
});

test('malformed profiles and replacement JSON remain advisory and grant no overlay', t => {
    const root = fixture(t);
    write(root, 'docs/incomplete-review/PROFILE.md', `# Incomplete profile\n${metadata}\n`);
    writeTaskProfile(root, 'docs/json-review', 'replacement-manifest: replacements.json');
    write(root, 'docs/json-review/replacements.json', '{not-json');
    const {result, report} = inspect(root);
    assert.equal(result.status, 0);
    assert.ok(report.errors.some(error => error.type === 'invalid-task-profile'));
    assert.ok(report.errors.some(error => error.type === 'invalid-profile-replacement-map'));
    assert.equal(report.summary.stagedReplacements, 0);
});

test('escaping and noncanonical replacement paths cannot select outside files or an overlay', t => {
    const root = fixture(t);
    const directory = 'docs/path-review';
    writeTaskProfile(root, directory, 'replacement-manifest: replacements.json\nstaging-directory: candidates');
    write(root, `${directory}/candidates/GUIDE.md`, `# Candidate\n${metadata}\n`);
    write(root, 'docs/features/OUTSIDE.md', `# Outside\n${metadata}\n`);
    const unsafeEntries = [
        {source: `${directory}/candidates/../candidates/GUIDE.md`, target: 'docs/DEVELOPMENT.md'},
        {source: 'docs/features/OUTSIDE.md', target: 'docs/DEVELOPMENT.md'},
        {source: `${directory}/candidates/GUIDE.md`, target: '../OUTSIDE.md'},
        {source: `${directory}/candidates/GUIDE.md`, target: 'C:OUTSIDE.md'},
        {source: `${directory}/candidates/GUIDE.md`, target: 'docs/DEVELOPMENT.md:stream'},
        {source: `${directory}/candidates/GUIDE.md`, target: 'docs\\DEVELOPMENT.md'},
        null,
    ];
    for (const entry of unsafeEntries) {
        write(root, `${directory}/replacements.json`, JSON.stringify({replacements: [entry]}));
        const {result, report} = inspect(root);
        assert.equal(result.status, 0);
        assert.ok(report.errors.some(error => error.type === 'invalid-profile-replacement-map'), JSON.stringify(entry));
        assert.equal(report.summary.stagedReplacements, 0);
    }

    writeTaskProfile(root, directory, 'replacement-manifest: ../outside.json');
    expectError(root, 'invalid-profile-replacement-map');
});

test('duplicate replacement destinations within and across profiles have no selected winner', t => {
    const root = fixture(t);
    const directories = ['docs/first-review', 'docs/second-review'];
    for (const directory of directories) {
        writeTaskProfile(root, directory, 'replacement-manifest: replacements.json\nstaging-directory: candidates');
        write(root, `${directory}/candidates/GUIDE.md`, `# Candidate\n${metadata}\n`);
        write(root, `${directory}/replacements.json`, JSON.stringify({replacements: [
            {source: `${directory}/candidates/GUIDE.md`, target: 'docs/DEVELOPMENT.md'},
        ]}));
    }
    const conflicting = inspect(root).report;
    assert.ok(conflicting.errors.some(error => error.type === 'duplicate-profile-replacement'));
    assert.equal(conflicting.summary.stagedReplacements, 0);

    const directory = directories[0];
    write(root, `${directory}/candidates/SECOND.md`, `# Second candidate\n${metadata}\n`);
    write(root, `${directory}/replacements.json`, JSON.stringify({replacements: [
        {source: `${directory}/candidates/GUIDE.md`, target: 'docs/ARCHITECTURE.md'},
        {source: `${directory}/candidates/SECOND.md`, target: 'docs/ARCHITECTURE.md'},
    ]}));
    const duplicate = inspect(root).report;
    assert.ok(duplicate.errors.some(error => error.type === 'duplicate-profile-replacement'));
    assert.equal(duplicate.summary.stagedReplacements, 1); // Only the unaffected second profile contributes.
});

test('Windows case aliases share candidate, counterpart and duplicate-source keys', {skip: process.platform !== 'win32'}, t => {
    const root = fixture(t);
    const directory = 'docs/case-review';
    writeTaskProfile(root, directory, 'replacement-manifest: replacements.json\nstaging-directory: candidates');
    write(root, `${directory}/candidates/ARCHITECTURE.md`, `# Architecture\n${metadata}\n\n[Development](development.md)\n`);
    write(root, `${directory}/candidates/DEVELOPMENT.md`, `# Development\n${metadata}\n`);
    const replacements = [
        {source: `${directory}/candidates/architecture.md`, target: 'docs/ARCHITECTURE.md'},
        {source: `${directory}/candidates/DEVELOPMENT.md`, target: 'docs/DEVELOPMENT.md'},
    ];
    write(root, `${directory}/replacements.json`, JSON.stringify({replacements}));
    assert.equal(inspect(root).report.summary.totalErrors, 0);

    // The same Windows file cannot quietly become a second source owner.
    replacements.push({source: `${directory}/candidates/development.md`, target: 'docs/TESTING_GUIDE.md'});
    write(root, `${directory}/replacements.json`, JSON.stringify({replacements}));
    const {result, report} = inspect(root);
    assert.equal(result.status, 0);
    assert.ok(report.errors.some(error => error.type === 'duplicate-profile-replacement'));
    assert.equal(report.summary.stagedReplacements, 0);
});

test('decision/source conflicts are reported without rewriting the policy configuration or record', t => {
    const root = fixture(t);
    const configPath = path.join(root, 'docs/policies/documentation-check.json');
    const before = fs.readFileSync(configPath, 'utf8');
    const record = 'docs/decisions/DEC-999-HELP-SOURCE.md';
    const content = `# Conflicting source decision\n${metadata}\n\nA source proposes docs/user-docs.\n`;
    write(root, record, content);
    expectError(root, 'ambiguous-user-guide-path');
    assert.equal(fs.readFileSync(configPath, 'utf8'), before);
    assert.equal(fs.readFileSync(path.join(root, record), 'utf8'), content);
});

function helpFixture(t, extra = '') {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surveyor-help-check-'));
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    write(root, 'scripts/check-help-documentation.mjs', fs.readFileSync(helpScript));
    write(root, 'scripts/check-documentation.mjs', fs.readFileSync(script));
    write(root, 'docs/user-guide/README.md', `# Help\n${metadata}\n\n![Test diagram](assets/test.png)\n${extra}\n`);
    write(root, 'docs/user-guide/assets/test.png', Buffer.from('89504e470d0a1a0a', 'hex'));
    write(root, 'src/controller/helpController.ts', "'docs', 'user-guide'\nvalidateTrustedHelpMarkdown\nresolveHelpAssetPath\nrenderTrustedHelpMarkdown\n");
    write(root, '.github/workflows/release.yml', 'cp -R docs release/docs\ndiff -qr docs/user-guide release/docs/user-guide\n');
    return root;
}

function inspectHelp(root) {
    const result = run(path.join(root, 'scripts/check-help-documentation.mjs'), [], root);
    assert.equal(result.stderr, '', result.stderr);
    const report = JSON.parse(result.stdout);
    return {result, report};
}

test('help checker is parseable and accepts metadata, safe links and packaged images', t => {
    const root = helpFixture(t, '[Guide](README.md)\n[Safe](https://example.test/guide)\n`<script>literal</script>`');
    const {result, report} = inspectHelp(root);
    assert.equal(result.status, 0, result.stdout);
    assert.equal(report.ok, true);
    assert.equal(report.imagesChecked, 1);
});

test('help report accepts named fixed-root composition without certifying runtime behavior', t => {
    const root = helpFixture(t);
    write(root, 'src/controller/helpController.ts', "const docsRoot = path.join(root, 'docs');\nconst helpRoot = path.join(docsRoot, 'user-guide');\n");
    const {report} = inspectHelp(root);
    assert.equal(report.ok, true);
});

for (const [name, markdown] of [
    ['raw HTML', '<script>alert(1)</script>'],
    ['JavaScript URI', '[Bad](javascript:alert)'],
    ['encoded JavaScript URI', '[Bad](javascript&#58;alert)'],
    ['data URI', '[Bad](data:text/plain,bad)'],
    ['protocol-relative URI', '[Bad](//example.test/bad)'],
    ['control characters', '[Bad](java\tscript:alert)'],
    ['remote image', '![Bad](https://example.test/image.png)'],
    ['empty image alt text', '![](assets/test.png)'],
    ['missing image', '![Bad](assets/missing.png)'],
    ['SVG image', '![Bad](assets/untrusted.svg)'],
    ['guide outside fixed root', '[Bad](../ARCHITECTURE.md)'],
]) {
    test(`help checker rejects ${name}`, t => {
        const {result, report} = inspectHelp(helpFixture(t, markdown));
        assert.equal(result.status, 0);
        assert.equal(report.ok, false);
        assert.ok(report.errors.length > 0);
    });
}

test('missing help root is a structured finding with an advisory exit', t => {
    const root = helpFixture(t);
    fs.rmSync(path.join(root, 'docs/user-guide'), {recursive: true});
    const {result, report} = inspectHelp(root);
    assert.equal(result.status, 0);
    assert.equal(report.ok, false);
});

test('unreferenced help assets remain visible findings', t => {
    const root = helpFixture(t);
    write(root, 'docs/user-guide/assets/unused.png', Buffer.from([1]));
    const {result, report} = inspectHelp(root);
    assert.equal(result.status, 0);
    assert.ok(report.errors.some(error => error.message.includes('not referenced')));
});

test('help report scans each corpus and discloses whole-article English fallback without borrowing figures', t => {
    const root = helpFixture(t);
    write(root, 'docs/user-guide/en/README.md', `# English Help\n${metadata}\n\n![English figure](assets/english.png)\n`);
    write(root, 'docs/user-guide/en/TASK.md', `# English task\n${metadata}\n\nTake an item.\n`);
    write(root, 'docs/user-guide/en/assets/english.png', Buffer.from([1]));
    write(root, 'docs/user-guide/de/README.md', `# Hilfe\n${metadata}\n\n[Aufgabe](TASK.md)\n![Abbildung](assets/english.png)\n`);
    const {result, report} = inspectHelp(root);
    assert.equal(result.status, 0);
    assert.equal(report.ok, true, JSON.stringify(report.errors));
    assert.equal(report.markdownFiles, 4);
    assert.deepEqual(report.corpora.map(corpus => corpus.directory), ['docs/user-guide', 'docs/user-guide/de', 'docs/user-guide/en']);
    assert.ok(report.warnings.some(warning => warning.message.includes('TASK.md')));
    assert.ok(report.warnings.some(warning => warning.message.includes('assets/english.png')));
    assert.ok(report.warnings.some(warning => warning.message.includes('complete article must fall back')));
    assert.equal(report.referencedAssets['docs/user-guide/en/assets/english.png'], 1);
});

test('localized article and figure queries cannot reference another language', t => {
    const root = helpFixture(t);
    write(root, 'docs/user-guide/en/README.md', `# Help\n${metadata}\n`);
    write(root, 'docs/user-guide/de/README.md', `# Hilfe\n${metadata}\n\n[Weiter](README.md?locale=en)\n![Abbildung](assets/test.png?locale=de&locale=en)\n[Vollbild](/help/assets/test.png?locale=en)\n[Index](/help?locale=en)\n[Suche](/help?search=1&q=task&locale=en)\n[Pilot](/frontend-pilot/help?locale=en)\n`);
    write(root, 'docs/user-guide/de/assets/test.png', Buffer.from([1]));
    const {result, report} = inspectHelp(root);
    assert.equal(result.status, 0);
    assert.equal(report.ok, false);
    assert.equal(report.errors.filter(error => error.message.includes('retain their own language')).length, 6);
});

test('same-corpus regional hints remain valid while unsupported or distinct catalog hints reject', t => {
    const root = helpFixture(t);
    write(root, 'docs/user-guide/en/README.md', `# Help\n${metadata}\n\n[Index](/help?locale=en-US)\n![Figure](assets/test.png?locale=en-US)\n`);
    write(root, 'docs/user-guide/en/assets/test.png', Buffer.from([1]));
    write(root, 'docs/user-guide/de/README.md', `# Hilfe\n${metadata}\n\n[Index](/help?locale=de-DE)\n![Abbildung](assets/test.png?locale=de-DE)\n`);
    write(root, 'docs/user-guide/de/assets/test.png', Buffer.from([1]));
    const valid = inspectHelp(root).report;
    assert.equal(valid.ok, true, JSON.stringify(valid.errors));

    // A supported regional catalog is its own source even before its Help exists;
    // an unsupported tag must not pass merely because passive negotiation uses EN.
    write(root, 'src/locales/en-US.json', '{}');
    write(root, 'docs/user-guide/en/README.md', `# Help\n${metadata}\n\n[Regional](/help?locale=en-US)\n[Autre](/help?locale=fr)\n![Figure](assets/test.png)\n`);
    const invalid = inspectHelp(root).report;
    assert.equal(invalid.errors.filter(error => error.message.includes('retain their own language')).length, 2);
});

test('unsafe localized content and cross-corpus traversal remain findings even when English exists', t => {
    const root = helpFixture(t);
    write(root, 'docs/user-guide/en/README.md', `# English Help\n${metadata}\n`);
    write(root, 'docs/user-guide/en/assets/english.png', Buffer.from([1]));
    write(root, 'docs/user-guide/de/README.md', `# Hilfe\n${metadata}\n\n<script>unsafe()</script>\n[Andere](../README.md)\n[Vollbild](../en/assets/english.png)\n`);
    const {result, report} = inspectHelp(root);
    assert.equal(result.status, 0);
    assert.equal(report.ok, false);
    assert.ok(report.errors.some(error => error.file === 'docs/user-guide/de/README.md' && error.message.includes('Raw HTML')));
    assert.ok(report.errors.some(error => error.file === 'docs/user-guide/de/README.md' && error.message.includes('maintained guide')));
    assert.ok(report.errors.some(error => error.file === 'docs/user-guide/de/README.md' && error.message.includes('local packaged asset')));
});

test('malformed localized entries remain findings rather than silently borrowing English', t => {
    const root = helpFixture(t);
    write(root, 'docs/user-guide/en/TASK.md', `# English task\n${metadata}\n`);
    write(root, 'docs/user-guide/de/README.md', `# Hilfe\n${metadata}\n\n[Aufgabe](TASK.md)\n`);
    fs.mkdirSync(path.join(root, 'docs/user-guide/de/TASK.md'));
    write(root, 'docs/user-guide/de/assets', 'Invalid asset directory');
    const {result, report} = inspectHelp(root);
    assert.equal(result.status, 0);
    assert.equal(report.ok, false);
    assert.ok(report.errors.some(error => error.file === 'docs/user-guide/de/TASK.md' && error.message.includes('regular files')));
    assert.ok(report.errors.some(error => error.file === 'docs/user-guide/de/assets' && error.message.includes('regular directory')));
    assert.ok(!report.warnings.some(warning => warning.message.includes('TASK.md')));
});

test('missing canonical release-copy comparison remains an advisory finding', t => {
    const root = helpFixture(t);
    write(root, '.github/workflows/release.yml', 'cp -R docs release/docs\ndiff -qr docs/user-docs release/docs/user-docs\n');
    const {result, report} = inspectHelp(root);
    assert.equal(result.status, 0);
    assert.ok(report.errors.some(error => error.message.includes('diff -qr docs/user-guide')));
});

test('Help publication accepts the real publisher declaration and still requires canonical byte comparison', t => {
    const root = helpFixture(t);
    const publish = 'node scripts/package-documentation.mjs --destination release/docs';
    const compare = 'diff -qr docs/user-guide release/docs/user-guide';
    write(root, '.github/workflows/release.yml', `${publish}\n${compare}\n`);
    assert.ok(inspectHelp(root).report.errors.some(error => error.message.includes('declare maintained documentation copying')));
    write(root, 'scripts/package-documentation.mjs', fs.readFileSync(path.join(repository, 'scripts/package-documentation.mjs')));
    assert.equal(inspectHelp(root).report.ok, true);
    write(root, '.github/workflows/release.yml', `${publish}\n`);
    assert.ok(inspectHelp(root).report.errors.some(error => error.message.includes(compare)));
    write(root, '.github/workflows/release.yml', `cp -R docs/user-guide release/docs/user-guide\n${compare}\n`);
    assert.ok(inspectHelp(root).report.errors.some(error => error.message.includes('declare maintained documentation copying')));
});
