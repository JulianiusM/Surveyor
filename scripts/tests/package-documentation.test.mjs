/*
 * Copyright 2026 Julian Malovanij
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy at http://www.apache.org/licenses/LICENSE-2.0
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';

// Exercise the real publisher, including the shared discovery import. None of
// these fixtures participates in application CI or reads the maintained corpus.
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const script = path.join(repository, 'scripts/package-documentation.mjs');
const config = fs.readFileSync(path.join(repository, 'docs/policies/documentation-check.json'));
const metadata = `<!--
documentation-metadata
audience: maintainers
owner: documentation maintainers
status: current
last-verified: 2026-10-14
verification-baseline: docs-baseline-2026-09-06-ci-repair
verification-scope: isolated publication fixture
source-anchors: repository-tree
next-review: none
-->`;

/** Only fresh fixture-owned paths are written. Root cleanup is checked before
 * recursive removal; directory-link fixtures unlink their known link first. */
function write(root, relative, content) {
    const absolute = path.resolve(root, relative);
    assert.ok(absolute.startsWith(root + path.sep));
    fs.mkdirSync(path.dirname(absolute), {recursive: true});
    fs.writeFileSync(absolute, content);
}

function fixture(t) {
    const parent = path.join(repository, '.temp');
    fs.mkdirSync(parent, {recursive: true});
    const root = fs.mkdtempSync(path.join(parent, 'documentation-package-test-'));
    const links = [];
    t.after(function removeOwnedFixture() {
        for (const link of links) fs.unlinkSync(link);
        assert.ok(path.resolve(root).startsWith(path.resolve(parent) + path.sep));
        assert.ok(path.basename(root).startsWith('documentation-package-test-'));
        assert.equal(fs.lstatSync(root).isSymbolicLink(), false);
        fs.rmSync(root, {recursive: true, force: true});
    });
    write(root, 'docs/policies/documentation-check.json', config);
    write(root, 'docs/policies/RULES.md', `# Rules\n${metadata}\n`);
    write(root, 'docs/decisions/DEC-999-SAMPLE.md', `# Decision\n${metadata}\n`);
    write(root, 'docs/README.md', `# Current guides\n${metadata}\n`);
    for (const corpus of ['docs/user-guide', 'docs/user-guide/en', 'docs/user-guide/de']) {
        write(root, `${corpus}/README.md`, `# Help\n${metadata}\n`);
        write(root, `${corpus}/assets/figure.png`, Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
    }
    return {root, links};
}

function addProfile(root, directory, status = 'current') {
    const fields = metadata.replace('status: current', `status: ${status}`)
        .replace('next-review: none', 'next-review: none\nactivation-scope: fixture maintenance');
    write(root, `${directory}/PROFILE.md`, `# Optional profile\n${fields}\n`);
    write(root, `${directory}/staged/OPERATIONS.md`, '# Prospective operator guidance\n');
}

function run(root, destination = 'bundle/docs') {
    const result = spawnSync(process.execPath, [script, '--root', root, '--destination', destination], {
        encoding: 'utf8', timeout: 20000, windowsHide: true,
    });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    assert.equal(result.status, 0, result.stderr);
    return result;
}

/** Preservation assertions compare actual file bytes, not a simulated filter. */
function assertCanonicalBytes(root) {
    for (const relative of ['policies/documentation-check.json', 'policies/RULES.md',
        'decisions/DEC-999-SAMPLE.md', 'README.md', 'user-guide/README.md',
        'user-guide/assets/figure.png', 'user-guide/en/README.md', 'user-guide/en/assets/figure.png',
        'user-guide/de/README.md', 'user-guide/de/assets/figure.png']) {
        assert.deepEqual(fs.readFileSync(path.join(root, 'bundle/docs', relative)),
            fs.readFileSync(path.join(root, 'docs', relative)), relative);
    }
}

test('no optional profiles preserves ordinary guides, active governance and every runtime Help corpus', function absentProfiles(t) {
    const {root} = fixture(t);
    const result = run(root);
    const report = JSON.parse(result.stdout);
    assert.equal(report.status, 'packaged');
    assert.deepEqual(report.excludedProfiles, []);
    assertCanonicalBytes(root);
});

test('current, historical and malformed optional profile working directories are excluded', function temporaryProfiles(t) {
    const {root} = fixture(t);
    addProfile(root, 'docs/first-task');
    addProfile(root, 'docs/retired-task', 'historical');
    write(root, 'docs/incomplete-task/PROFILE.md', '# Incomplete declaration\n');
    write(root, 'docs/incomplete-task/staged/README.md', '# Future guidance\n');
    const report = JSON.parse(run(root).stdout);
    assert.equal(report.status, 'findings');
    assert.deepEqual(report.excludedProfiles.sort(), ['docs/first-task', 'docs/incomplete-task', 'docs/retired-task']);
    for (const directory of ['first-task', 'incomplete-task', 'retired-task']) {
        assert.equal(fs.existsSync(path.join(root, 'bundle/docs', directory)), false);
    }
    assertCanonicalBytes(root);
});

test('a conflicting profile marker cannot suppress a canonical policy or runtime Help owner', function reservedOwners(t) {
    const {root} = fixture(t);
    addProfile(root, 'docs/policies');
    addProfile(root, 'docs/user-guide');
    const report = JSON.parse(run(root).stdout);
    assert.equal(report.status, 'findings');
    assert.deepEqual(report.excludedProfiles, []);
    assert.ok(report.findings.some(function reservedProfileFinding(finding) {
        return finding.type === 'task-profile-role-conflict';
    }));
    assertCanonicalBytes(root);
});

test('Windows category aliases preserve the canonical feature owner', {skip: process.platform !== 'win32'}, function categoryAlias(t) {
    const {root} = fixture(t);
    // The physical casing differs from configuration on this case-insensitive
    // filesystem. Discovery and publication must use the same owner identity.
    addProfile(root, 'docs/Features');
    write(root, 'docs/Features/reference.md', '# Durable feature reference\n');

    const report = JSON.parse(run(root).stdout);
    assert.equal(report.status, 'findings');
    assert.deepEqual(report.excludedProfiles, []);
    assert.ok(report.findings.some(function categoryConflict(finding) {
        return finding.type === 'task-profile-role-conflict';
    }));
    assert.deepEqual(fs.readFileSync(path.join(root, 'bundle/docs/Features/reference.md')),
        fs.readFileSync(path.join(root, 'docs/Features/reference.md')));
    assertCanonicalBytes(root);
});

test('existing output and maintained docs destinations are untouched with visible advisory errors', function preservedDestinations(t) {
    const {root} = fixture(t);
    write(root, 'bundle/docs/owned.txt', 'original output');
    assert.match(run(root).stderr, /already exists/);
    assert.equal(fs.readFileSync(path.join(root, 'bundle/docs/owned.txt'), 'utf8'), 'original output');
    const original = fs.readFileSync(path.join(root, 'docs/README.md'));
    assert.match(run(root, 'docs/copied').stderr, /separate from maintained/);
    assert.deepEqual(fs.readFileSync(path.join(root, 'docs/README.md')), original);
    assert.equal(fs.existsSync(path.join(root, 'docs/copied')), false);
});

test('redirected output ancestors are rejected before any copy', function redirectedDestination(t) {
    const {root, links} = fixture(t);
    const outside = path.join(root, 'other-output');
    fs.mkdirSync(outside);
    const link = path.join(root, 'bundle');
    fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    links.push(link);
    assert.match(run(root).stderr, /Redirected packaging path/);
    assert.deepEqual(fs.readdirSync(outside), []);
});
