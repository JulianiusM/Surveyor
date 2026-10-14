/*
 * Copyright 2026 Julian Malovanij
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy at http://www.apache.org/licenses/LICENSE-2.0
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {documentationDigest, assembleDocumentationDelta, documentationSections}
    from '../check-documentation-boundary.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(testDirectory, '../../..');
const script = path.join(testDirectory, '../check-documentation-boundary.mjs');
const fixtureParent = path.join(repository, '.temp');
const manifestPath = 'docs/frontend-migration/documentation-boundary.json';
const replacementPath = 'docs/frontend-migration/staged/README.md';
const metadata = `<!--
documentation-metadata
audience: disposable CLI fixture
owner: documentation maintainers
status: current
last-verified: 2026-10-13
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: synthetic file-boundary evidence
source-anchors: repository-tree
next-review: none
-->`;
const originalReadme = `# Frozen fixture\n${metadata}\n\nOriginal public guidance.\n`;
const futureReadme = `# Future fixture\n${metadata}\n\nRead the [architecture guide](docs/ARCHITECTURE.md).\n`;
const deltaReadme = `# Staged fixture amendments\n${metadata.replace('status: current', 'status: migration-pending')}

Read the [profile](../PROFILE.md) before preparing these amendments.

<!-- delta:title -->
# Future fixture
<!-- /delta:title -->

<!-- delta:body -->
Read the [architecture guide](docs/ARCHITECTURE.md).

<!-- /delta:body -->
`;

/** Each tiny payload changes a public part of the guide. The expected complete
 * guide above is independently authored, rather than derived from operations. */
function fixtureOperations() {
    return [{kind: 'replace-text', original: '# Frozen fixture',
        originSha256: documentationDigest('# Frozen fixture'), payload: 'title'},
    {kind: 'replace-text', original: 'Original public guidance.\n',
        originSha256: documentationDigest('Original public guidance.\n'), payload: 'body'}];
}

/** Resolve fixture-owned paths before any write, move, Git command or cleanup.
 * Redirected inputs are created deliberately only by the named link helper. */
function contained(root, relative) {
    const result = path.resolve(root, relative);
    const difference = path.relative(root, result);
    assert.ok(difference && !difference.startsWith('..') && !path.isAbsolute(difference), relative);
    return result;
}

/** Create named synthetic files inside this one disposable repository. */
function write(fixture, relative, content) {
    const destination = contained(fixture.root, relative);
    fs.mkdirSync(path.dirname(destination), {recursive: true});
    fs.writeFileSync(destination, content);
}

/** Git runs without a shell and only in the verified fixture repository. */
function git(fixture, argumentsList) {
    assert.ok(path.relative(fixture.outer, fixture.root).startsWith('parent' + path.sep));
    return execFileSync('git', argumentsList, {cwd: fixture.root, encoding: 'utf8',
        windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
}

/** Rewrite only this fixture's control manifest; production files stay unchanged. */
function writeManifest(fixture, manifest = fixture.manifest) {
    write(fixture, manifestPath, JSON.stringify(manifest, null, 2) + '\n');
}

/** Make a real committed Git baseline under an ignored workspace-owned tree.
 * Actual production checker/CLI scripts are used; no app server or DB is loaded. */
function createFixture(t, baselineFiles = {}) {
    // Check the existing parent before mkdir so the fixture helper itself cannot
    // create directories through a redirected workspace or temporary root.
    assert.equal(fs.realpathSync(repository), repository);
    if (fs.existsSync(fixtureParent)) assert.equal(fs.realpathSync(fixtureParent), fixtureParent);
    fs.mkdirSync(fixtureParent, {recursive: true});
    assert.equal(fs.realpathSync(fixtureParent), fixtureParent);
    const outer = fs.mkdtempSync(path.join(fixtureParent, 'surveyor-documentation-boundary-'));
    const fixture = {outer, root: path.join(outer, 'parent/repository'), links: [], manifest: undefined};
    fs.mkdirSync(fixture.root, {recursive: true});
    t.after(function removeOwnedFixture() {
        // Remove each known directory link itself before recursive cleanup.
        // Never traverse a junction while deleting even a disposable tree.
        for (const link of fixture.links.toReversed()) {
            assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
            fs.unlinkSync(link);
        }
        assert.equal(path.dirname(outer), fixtureParent);
        assert.ok(path.basename(outer).startsWith('surveyor-documentation-boundary-'));
        assert.equal(fs.realpathSync(outer), outer);
        assert.equal(fs.lstatSync(outer).isSymbolicLink(), false);
        fs.rmSync(outer, {recursive: true, force: true});
    });

    // Isolate commit identity, line-ending policy and hooks from host defaults.
    git(fixture, ['init', '--quiet']);
    git(fixture, ['config', 'core.autocrlf', 'false']);
    const hooks = contained(outer, 'empty-hooks');
    fs.mkdirSync(hooks);
    git(fixture, ['config', 'core.hooksPath', hooks]);
    write(fixture, '.gitattributes', '*.md text eol=lf\n');
    write(fixture, '.gitignore', '.temp/\n');
    write(fixture, 'README.md', originalReadme);
    write(fixture, 'AGENTS.md', `# Fixture agent guide\n${metadata}\n\nFrozen agent routing.\n`);
    write(fixture, 'docs/ARCHITECTURE.md', `# Architecture\n${metadata}\n\nComplete fixture guide.\n`);
    write(fixture, replacementPath, deltaReadme);
    const profileMetadata = metadata.replace('\n-->', '\nactivation-scope: disposable documentation test\nstaging-directory: staged\nreplacement-manifest: documentation-boundary.json\n-->');
    write(fixture, 'docs/frontend-migration/PROFILE.md', `# Optional fixture profile\n${profileMetadata}\n`);
    write(fixture, 'package.json', '{"name":"documentation-boundary-fixture","scripts":{}}\n');

    // Preview diagnostics use the existing real structural checker. Its known
    // synthetic metadata/fingerprint findings remain advisory and are not hidden.
    write(fixture, 'scripts/check-documentation.mjs',
        fs.readFileSync(path.join(repository, 'scripts/check-documentation.mjs')));
    write(fixture, 'docs/policies/documentation-check.json',
        fs.readFileSync(path.join(repository, 'docs/policies/documentation-check.json')));
    for (const [relative, content] of Object.entries(baselineFiles)) write(fixture, relative, content);
    git(fixture, ['add', '--all']);
    git(fixture, ['-c', 'user.name=Boundary Fixture', '-c', 'user.email=fixture@example.invalid',
        '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Disposable documentation baseline']);

    fixture.manifest = {baselineCommit: git(fixture, ['rev-parse', 'HEAD']).trim(),
        protectedRoots: ['docs/features/', 'docs/user-guide/assets/'], flatGuideRoots: ['docs/', 'docs/user-guide/'],
        protectedFiles: ['README.md'], exemptFiles: ['docs/features/help/HELP_VISUALS.md'],
        controlRoot: 'docs/frontend-migration/', stagingMode: 'deltas', approvedCleanups: [],
        reviewInputs: ['docs/policies/', 'docs/decisions/', 'AGENTS.md', 'src/frontend/', 'src/future-feature/'],
        replacements: [{source: replacementPath, target: 'README.md', operations: fixtureOperations()}]};
    assert.match(fixture.manifest.baselineCommit, /^[a-f0-9]{40}$/);
    writeManifest(fixture);
    return fixture;
}

/** Exercise the actual CLI against only this fixture, including explicit preview mode. */
function runBoundary(fixture, {preview = false, root = fixture.root, ready = null} = {}) {
    const result = spawnSync(process.execPath, [script, '--root', root, '--manifest',
        path.join(fixture.root, manifestPath), ...(preview ? ['--preview'] : []), ...(ready ? ['--check-ready', ready] : [])],
        {cwd: repository, encoding: 'utf8', timeout: 20_000, windowsHide: true});
    assert.ifError(result.error);
    assert.equal(result.signal, null, result.stderr);
    return result;
}

/** Rejection must occur before creating a preview directory or changing production bytes. */
function expectRejectedBeforePreview(fixture, result, message) {
    assert.equal(result.status, 1, result.stdout + result.stderr);
    if (message) assert.match(result.stderr, message);
    assert.equal(fs.existsSync(path.join(fixture.root, '.temp')), false);
}

/** Directory links stay entirely within the owned outer tree and are unlinked first in teardown. */
function linkOwnedDirectory(fixture, source, destination) {
    const target = contained(fixture.outer, source);
    const link = contained(fixture.outer, destination);
    assert.equal(fs.lstatSync(target).isDirectory(), true);
    fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
    fixture.links.push(link);
    return link;
}

test('accepts unchanged production bytes after ordinary CRLF checkout normalization', function normalizedCrLf(t) {
    const fixture = createFixture(t);
    write(fixture, 'README.md', originalReadme.replaceAll('\n', '\r\n'));
    const result = runBoundary(fixture);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /Production freeze: 0 finding\(s\); amendment boundary: 0 finding\(s\)/);
    assert.equal(fs.existsSync(path.join(fixture.root, '.temp')), false);
});

test('classifies active owners separately from frozen production and native Help', function documentRoles(t) {
    const active = ['AGENTS.md', '.github/copilot/fixture.md', 'docs/policies/FIXTURE.md',
        'docs/decisions/FIXTURE.md', 'docs/features/help/HELP_VISUALS.md', 'docs/user-guide/en/README.md',
        'docs/user-guide/de/README.md', 'docs/another-profile/PROFILE.md'];
    const frozen = ['docs/user-guide/README.md', 'docs/features/activity/FIXTURE.md'];
    const files = {};
    for (const relative of [...active, ...frozen]) files[relative] = originalReadme;
    files['docs/another-profile/PROFILE.md'] = originalReadme.replace('\n-->',
        '\nactivation-scope: separate disposable documentation task\n-->');
    files['docs/user-guide/assets/fixture.png'] = Buffer.from([1, 2, 3]);
    const fixture = createFixture(t, files);

    // Actual edits to governance, locale Help and another optional profile
    // cannot silently broaden this profile's production reference freeze.
    for (const relative of active) write(fixture, relative, files[relative] + '\nActive owner update.\n');
    let result = runBoundary(fixture);
    assert.equal(result.status, 0, result.stdout + result.stderr);

    // Native flat Help and durable feature references remain separate from
    // those active owners. Reset only these known fixture bytes between cases.
    for (const relative of frozen) {
        write(fixture, relative, originalReadme + '\nUnapproved production update.\n');
        expectRejectedBeforePreview(fixture, runBoundary(fixture, {preview: true}), /Production worktree changed/);
        write(fixture, relative, originalReadme);
    }
    write(fixture, 'docs/user-guide/assets/fixture.png', Buffer.from([1, 2, 4]));
    expectRejectedBeforePreview(fixture, runBoundary(fixture, {preview: true}), /Production worktree changed/);
    write(fixture, 'docs/user-guide/assets/fixture.png', files['docs/user-guide/assets/fixture.png']);

    // Only ordinary canonical guides can be selected for amendment publication.
    // Production native Help stays protected, and active owners remain active;
    // neither role becomes a guide target through a changed manifest record.
    for (const target of ['docs/policies/FIXTURE.md', 'docs/user-guide/README.md',
        'docs/features/activity/FIXTURE.md', 'docs/features/help/HELP_VISUALS.md']) {
        writeManifest(fixture, {...fixture.manifest, replacements: [{...fixture.manifest.replacements[0], target}]});
        expectRejectedBeforePreview(fixture, runBoundary(fixture, {preview: true}), /Invalid or repeated replacement destination/);
    }
});

test('accepts only the exact reviewed cleanup in worktree and permitted index states', function reviewedCleanup(t) {
    const referencedReadme = originalReadme + '\n[Temporary profile](docs/frontend-migration/PROFILE.md)\n';
    const fixture = createFixture(t, {'README.md': referencedReadme});
    write(fixture, 'README.md', originalReadme);
    const blob = git(fixture, ['hash-object', '--path=README.md', '--', 'README.md']).trim();
    fixture.manifest.approvedCleanups = [{path: 'README.md', blob, approvedOn: '2026-10-14',
        reference: 'Synthetic maintainer-approved removal of this fixture profile link'}];
    writeManifest(fixture);

    // A normal unstaged cleanup retains the immutable index. Staging its exact
    // reviewed result is allowed; neither state permits unrelated future edits.
    let result = runBoundary(fixture);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(git(fixture, ['show', ':README.md']), referencedReadme);
    git(fixture, ['add', 'README.md']);
    result = runBoundary(fixture);
    assert.equal(result.status, 0, result.stdout + result.stderr);

    write(fixture, 'README.md', originalReadme + '\nUnapproved extra text.\n');
    expectRejectedBeforePreview(fixture, runBoundary(fixture, {preview: true}), /Production worktree changed/);
    git(fixture, ['add', 'README.md']);
    write(fixture, 'README.md', originalReadme);
    result = runBoundary(fixture, {preview: true});
    expectRejectedBeforePreview(fixture, result, /Production index changed/);
    assert.doesNotMatch(result.stderr, /Production worktree changed/);
});

test('detects an independent production worktree edit without an index change', function worktreeEdit(t) {
    const fixture = createFixture(t);
    write(fixture, 'README.md', originalReadme + '\nUnapproved worktree text.\n');
    const result = runBoundary(fixture, {preview: true});
    expectRejectedBeforePreview(fixture, result, /Production worktree changed: README\.md/);
    assert.doesNotMatch(result.stderr, /Production index changed/);
});

test('detects a staged production edit concealed by restoring the worktree', function concealedIndexEdit(t) {
    const fixture = createFixture(t);
    write(fixture, 'README.md', originalReadme + '\nUnapproved staged text.\n');
    git(fixture, ['add', 'README.md']);
    write(fixture, 'README.md', originalReadme);
    const result = runBoundary(fixture, {preview: true});
    expectRejectedBeforePreview(fixture, result, /Production index changed: README\.md/);
    assert.doesNotMatch(result.stderr, /Production worktree changed/);
    assert.equal(fs.readFileSync(path.join(fixture.root, 'README.md'), 'utf8'), originalReadme);
});

for (const staged of [false, true]) {
    test(`rejects a ${staged ? 'staged' : 'untracked'} new production document`, function addedDocument(t) {
        const fixture = createFixture(t);
        write(fixture, 'docs/NEW.md', `# New document\n${metadata}\n`);
        if (staged) git(fixture, ['add', 'docs/NEW.md']);
        expectRejectedBeforePreview(fixture, runBoundary(fixture, {preview: true}), /New production file: docs\/NEW\.md/);
    });
}

test('rejects a new production document concealed by local Git ignore rules', function ignoredDocument(t) {
    const fixture = createFixture(t);
    // Use only this disposable repository's local exclude file. Production
    // ignore rules and the fixture's committed public baseline remain unchanged.
    write(fixture, '.git/info/exclude', 'docs/NEW.md\n');
    write(fixture, 'docs/NEW.md', `# Ignored document\n${metadata}\n`);
    assert.equal(git(fixture, ['ls-files', '--others', '--exclude-standard', '--', 'docs/NEW.md']), '');
    expectRejectedBeforePreview(fixture, runBoundary(fixture, {preview: true}), /New production file: docs\/NEW\.md/);
});

test('rejects a deleted production document', function deletedDocument(t) {
    const fixture = createFixture(t);
    fs.unlinkSync(contained(fixture.root, 'docs/ARCHITECTURE.md'));
    expectRejectedBeforePreview(fixture, runBoundary(fixture, {preview: true}), /Production file missing: docs\/ARCHITECTURE\.md/);
});

test('rejects both sides of a staged production-document rename', function renamedDocument(t) {
    const fixture = createFixture(t);
    fs.renameSync(contained(fixture.root, 'docs/ARCHITECTURE.md'), contained(fixture.root, 'docs/RENAMED.md'));
    git(fixture, ['add', '--all']);
    const result = runBoundary(fixture, {preview: true});
    expectRejectedBeforePreview(fixture, result, /Production index changed: docs\/ARCHITECTURE\.md/);
    assert.match(result.stderr, /New production file: docs\/RENAMED\.md/);
});

test('rejects temporary replacement references without changing frozen production', function temporaryReference(t) {
    const fixture = createFixture(t);
    write(fixture, replacementPath, deltaReadme.replace('Read the [architecture guide](docs/ARCHITECTURE.md).',
        'Read the [migration](docs/frontend-migration/PROFILE.md).'));
    expectRejectedBeforePreview(fixture, runBoundary(fixture, {preview: true}), /Prepared guide retains temporary references/);
    assert.equal(fs.readFileSync(path.join(fixture.root, 'README.md'), 'utf8'), originalReadme);
});

test('rejects malformed JSON and empty or invalid manifest boundaries before preview writes', function malformedManifest(t) {
    const fixture = createFixture(t);
    write(fixture, manifestPath, '{invalid-json\n');
    expectRejectedBeforePreview(fixture, runBoundary(fixture, {preview: true}));

    // Each invalid manifest would otherwise hide a missing boundary or admit a
    // mutable baseline/destination. The real CLI must fail closed in every case.
    const invalid = [
        {},
        {...fixture.manifest, baselineCommit: 'HEAD'},
        {...fixture.manifest, protectedRoots: []},
        {...fixture.manifest, protectedFiles: []},
        {...fixture.manifest, protectedFiles: ['AGENTS.md']},
        {...fixture.manifest, flatGuideRoots: []},
        {...fixture.manifest, exemptFiles: []},
        {...fixture.manifest, replacements: []},
        {...fixture.manifest, controlRoot: '../outside/'},
        {...fixture.manifest, protectedRoots: [...fixture.manifest.protectedRoots, 'docs/../']},
        {...fixture.manifest, protectedFiles: ['README.md', '../README.md']},
        {...fixture.manifest, replacements: [fixture.manifest.replacements[0], fixture.manifest.replacements[0]]},
        {...fixture.manifest, replacements: [{source: 'docs/frontend-migration/staged/../../ARCHITECTURE.md',
            target: 'README.md'}]},
        {...fixture.manifest, replacements: [{source: path.join(fixture.root, 'docs/ARCHITECTURE.md'),
            target: 'README.md'}]},
        {...fixture.manifest, previewInputs: ['src/../.env']},
        {...fixture.manifest, previewInputs: ['src/runtime-private.env']},
        {...fixture.manifest, previewInputs: ['src/.secret']},
        {...fixture.manifest, previewInputs: ['tests/integration/']},
        {...fixture.manifest, previewInputs: ['tests/integration/another-runtime.spec.ts']},
        {...fixture.manifest, previewInputs: 'src/types/api/'},
        {...fixture.manifest, approvedCleanups: 'README.md'},
        {...fixture.manifest, approvedCleanups: [{path: 'README.md', blob: 'HEAD',
            approvedOn: '2026-10-14', reference: 'Synthetic invalid receipt'}]},
    ];
    for (const manifest of invalid) {
        writeManifest(fixture, manifest);
        expectRejectedBeforePreview(fixture, runBoundary(fixture, {preview: true}));
    }
});

test('rejects a redirected repository ancestor before creating its absent temporary directory', function redirectedRepositoryAncestor(t) {
    const fixture = createFixture(t);
    const alias = linkOwnedDirectory(fixture, 'parent', 'redirected-parent');
    const result = runBoundary(fixture, {preview: true, root: path.join(alias, 'repository')});
    expectRejectedBeforePreview(fixture, result, /Redirected path/);
});

test('rejects a redirected temporary root without writing into its destination', function redirectedTemporaryRoot(t) {
    const fixture = createFixture(t);
    const target = contained(fixture.outer, 'temporary-target');
    fs.mkdirSync(target);
    linkOwnedDirectory(fixture, 'temporary-target', 'parent/repository/.temp');
    const result = runBoundary(fixture, {preview: true});
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /Redirected path/);
    assert.deepEqual(fs.readdirSync(target), []);
});

test('rejects redirected protected-document ancestors even when their contents match the baseline', function redirectedProtectedDocs(t) {
    const fixture = createFixture(t);
    fs.renameSync(contained(fixture.root, 'docs'), contained(fixture.outer, 'detached-docs'));
    linkOwnedDirectory(fixture, 'detached-docs', 'parent/repository/docs');
    expectRejectedBeforePreview(fixture, runBoundary(fixture, {preview: true}), /Redirected path/);
});

test('rejects a redirected staging-source ancestor before copying replacement bytes', function redirectedStagingSource(t) {
    const fixture = createFixture(t);
    fs.renameSync(contained(fixture.root, 'docs/frontend-migration/staged'), contained(fixture.outer, 'detached-staging'));
    linkOwnedDirectory(fixture, 'detached-staging', 'parent/repository/docs/frontend-migration/staged');
    expectRejectedBeforePreview(fixture, runBoundary(fixture, {preview: true}), /Redirected path/);
});

test('prepares complete delta output at final paths using the real advisory checker', function exactBytePreview(t) {
    const fixture = createFixture(t);
    const result = runBoundary(fixture, {preview: true});
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const temporary = path.join(fixture.root, '.temp');
    const entries = fs.readdirSync(temporary);
    assert.equal(entries.length, 1);
    assert.ok(entries[0].startsWith('frontend-documentation-preview-'));
    const preview = contained(temporary, entries[0]);
    assert.equal(fs.readFileSync(path.join(preview, 'README.md'), 'utf8'), futureReadme);
    assert.equal(fs.readFileSync(path.join(fixture.root, replacementPath), 'utf8'), deltaReadme);
    assert.equal(fs.readFileSync(path.join(fixture.root, 'README.md'), 'utf8'), originalReadme);
    assert.equal(git(fixture, ['show', ':README.md']), originalReadme);
    assert.equal(fs.existsSync(path.join(preview, 'docs/frontend-migration')), false);

    // The staged source's link is authored for README's final root destination.
    // Its target resolves in the preview without rewriting any replacement bytes.
    const diagnostics = JSON.parse(fs.readFileSync(path.join(preview, 'documentation-preview.json'), 'utf8'));
    assert.equal(diagnostics.advisory, true);
    const brokenReadmeLinks = diagnostics.errors.filter(function readmeLinkFailure(finding) {
        return finding.type === 'broken-link' && finding.path === 'README.md';
    });
    assert.deepEqual(brokenReadmeLinks, []);
    const receipt = JSON.parse(fs.readFileSync(path.join(preview, 'documentation-preparation.json'), 'utf8'));
    assert.equal(receipt.semanticReview, null);
    assert.equal(receipt.outputs[0].target, 'README.md');
    assert.equal(receipt.advisory.status, 'advisory');
});

test('pins the exact untracked public runtime fixture in a real Git preparation', function publicRuntimeFixture(t) {
    const fixture = createFixture(t);
    const relative = 'tests/integration/frontend-development-runtime.spec.ts';
    const content = '// Synthetic public Express/Vite runtime fixture.\nexport const boundary = "server-components";\n';
    write(fixture, relative, content);
    assert.equal(git(fixture, ['ls-files', '--', relative]), '');
    fixture.manifest.previewInputs = [relative];
    writeManifest(fixture);

    // Preparation copies this reviewed source's current bytes while leaving its
    // worktree and Git ownership untouched. The receipt must pin the input too.
    const result = runBoundary(fixture, {preview: true});
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const prepared = fixtureReceipt(fixture);
    assert.equal(fs.readFileSync(contained(prepared.preview, relative), 'utf8'), content);
    assert.equal(fs.readFileSync(contained(fixture.root, relative), 'utf8'), content);
    assert.equal(git(fixture, ['ls-files', '--', relative]), '');
    const source = prepared.receipt.inputs.files.find(function reviewedPublicSource(input) {
        return input.path === relative;
    });
    assert.equal(source?.sha256, documentationDigest(content));

    // A later uncommitted source edit invalidates the actual reviewed receipt;
    // allowing this one path cannot turn its moving bytes into permanent approval.
    attestFixturePreparation(prepared);
    write(fixture, relative, content + '// Changed after review.\n');
    const stale = runBoundary(fixture, {ready: prepared.filename});
    assert.equal(stale.status, 1, stale.stdout + stale.stderr);
    assert.match(stale.stderr, /Preparation inputs changed/);
    assert.equal(fs.readFileSync(contained(fixture.root, 'README.md'), 'utf8'), originalReadme);
});

test('rejects an admitted public file replaced by a directory before preview writes', function publicFileKind(t) {
    const fixture = createFixture(t);
    const relative = 'tests/integration/frontend-development-runtime.spec.ts';
    // A misleading file suffix must not admit a directory or its private-looking
    // synthetic child. The failure precedes even the ignored preparation directory.
    write(fixture, relative + '/.env', 'SYNTHETIC_PRIVATE_VALUE=fixture-only\n');
    fixture.manifest.previewInputs = [relative];
    writeManifest(fixture);
    expectRejectedBeforePreview(fixture, runBoundary(fixture, {preview: true}), /Public preview input must be a regular file/);
});

test('preserves unrelated live text and requires reviewed overlapping fragments', function reconcileFragments() {
    const current = originalReadme + '\nApproved unrelated production guidance.\n';
    const record = {operations: fixtureOperations()};
    assert.equal(assembleDocumentationDelta(originalReadme, current, deltaReadme, record),
        futureReadme + '\nApproved unrelated production guidance.\n');

    // An existing paragraph can change for independent work. Its new exact bytes
    // need reviewed provenance; the immutable fragment/hash are never replaced.
    const changed = originalReadme.replace('Original public guidance.', 'Reviewed current public guidance.');
    assert.throws(function unreviewedOverlap() {
        assembleDocumentationDelta(originalReadme, changed, deltaReadme, record);
    }, /Missing or ambiguous documentation fragment/);
    const reviewed = structuredClone(record);
    reviewed.operations[1].reviewedCurrentText = 'Reviewed current public guidance.\n';
    reviewed.operations[1].reviewedCurrentSha256 = documentationDigest(reviewed.operations[1].reviewedCurrentText);
    assert.throws(function missingProvenance() {
        assembleDocumentationDelta(originalReadme, changed, deltaReadme, reviewed);
    }, /reconciliation needed/);
    reviewed.operations[1].reconciliation = 'Synthetic independent review accepted this exact changed paragraph for this CLI fixture.';
    assert.equal(assembleDocumentationDelta(originalReadme, changed, deltaReadme, reviewed), futureReadme);
});

test('ignores fenced pseudo-headings and preserves payload whitespace exactly', function headingAndFraming() {
    const origin = `# Fixture\n${metadata}\n\n## Procedure\n\n~~~sh\n## shell comment\n~~~\n\n### Next step\n\nParagraph.\n`;
    const headings = documentationSections(origin).map(function headingPath(section) { return section.headingPath; });
    assert.deepEqual(headings, [['## Procedure'], ['## Procedure', '### Next step']]);
    const delta = `<!-- delta:paragraph -->\n\n  Preserved spaces.\n\n<!-- /delta:paragraph -->`;
    const actual = assembleDocumentationDelta(origin, origin, delta, {operations: [{kind: 'replace-text',
        original: 'Paragraph.\n', originSha256: documentationDigest('Paragraph.\n'), payload: 'paragraph',
        headingPath: ['## Procedure', '### Next step']}]});
    assert.equal(actual, origin.replace('Paragraph.\n', '\n  Preserved spaces.\n'));
    assert.equal(assembleDocumentationDelta(origin, origin, delta.replaceAll('\n', '\r\n'),
        {operations: [{kind: 'replace-text', original: 'Paragraph.\n',
            originSha256: documentationDigest('Paragraph.\n'), payload: 'paragraph'}]}), actual);
});

test('rejects unmapped staged files, unused payloads and overlapping ranges before preparation', function deltaInventory(t) {
    const fixture = createFixture(t);
    write(fixture, 'docs/frontend-migration/staged/UNMAPPED.md', deltaReadme);
    expectRejectedBeforePreview(fixture, runBoundary(fixture, {preview: true}), /Unmapped staged amendment/);
    fs.unlinkSync(contained(fixture.root, 'docs/frontend-migration/staged/UNMAPPED.md'));
    write(fixture, replacementPath, deltaReadme + '\n<!-- delta:unused -->\nUnmapped content.\n<!-- /delta:unused -->\n');
    expectRejectedBeforePreview(fixture, runBoundary(fixture, {preview: true}), /unmapped payload/);
    write(fixture, replacementPath, deltaReadme.replace('<!-- /delta:body -->', '<!-- /delta:wrong -->'));
    expectRejectedBeforePreview(fixture, runBoundary(fixture, {preview: true}), /Unexpected closing documentation delta/);
    write(fixture, replacementPath, deltaReadme + '\n<!-- delta:overlap -->\nOther title.\n<!-- /delta:overlap -->\n');
    const repeated = {...fixture.manifest, replacements: [{...fixture.manifest.replacements[0],
        operations: [...fixtureOperations(), {kind: 'replace-text', original: '# Frozen fixture',
            originSha256: documentationDigest('# Frozen fixture'), payload: 'overlap'}]}]};
    writeManifest(fixture, repeated);
    expectRejectedBeforePreview(fixture, runBoundary(fixture, {preview: true}), /Overlapping documentation operations/);
});

/** Read only this fixture's newly prepared receipt. There is one preparation;
 * no live repository output or real maintainer approval is represented here. */
function fixtureReceipt(fixture) {
    const temporary = contained(fixture.root, '.temp');
    const entries = fs.readdirSync(temporary);
    assert.equal(entries.length, 1);
    const preview = contained(temporary, entries[0]);
    const filename = contained(preview, 'documentation-preparation.json');
    return {preview, filename, receipt: JSON.parse(fs.readFileSync(filename, 'utf8'))};
}

/** Supply explicit synthetic reviewer evidence after checking fixture output.
 * This tests the receipt contract and cannot authorize real documentation work. */
function attestFixturePreparation(prepared) {
    assert.equal(fs.readFileSync(contained(prepared.preview, 'README.md'), 'utf8'), futureReadme);
    const receipt = prepared.receipt;
    const limitations = ['Synthetic documentation CLI fixture only; no production, application or cutover approval.'];
    receipt.semanticReview = {reviewedAt: new Date().toISOString(), inputDigest: receipt.inputs.digest,
        outputDigest: receipt.outputDigest, reportSha256: receipt.advisory.reportSha256,
        independent: {reviewer: 'fixture independent reviewer', evidence: 'Expected final guide bytes were asserted before this synthetic review record.',
            scope: 'Changed guide wording and preserved inherited fixture metadata.', limitations},
        root: {reviewer: 'fixture root reviewer', evidence: 'Fixture origin, frozen production bytes and advisory report were inspected by assertions.',
            scope: 'Document-only receipt behavior and no production writes.', limitations},
        disposition: 'documentation-reviewed; cutover not authorized'};
    fs.writeFileSync(prepared.filename, JSON.stringify(receipt, null, 2) + '\n');
}

test('pins actual review, prepared bytes and source/governance additions and deletions', function preparationReadiness(t) {
    const implementation = 'export const fixture = true;\n';
    const governance = `# Fixture policy\n${metadata}\n\nPublic policy.\n`;
    const fixture = createFixture(t, {'src/frontend/fixture.ts': implementation, 'docs/policies/FIXTURE.md': governance});
    let result = runBoundary(fixture, {preview: true});
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const prepared = fixtureReceipt(fixture);
    assert.equal(prepared.receipt.inputs.files.some(function capturedSource(file) { return file.path === 'src/frontend/fixture.ts'; }), true);
    result = runBoundary(fixture, {ready: prepared.filename});
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /semantic review is missing/);
    attestFixturePreparation(prepared);
    result = runBoundary(fixture, {ready: prepared.filename});
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /cutover is not authorized/);

    // Private local state is outside the selected public review inventory.
    write(fixture, '.env', 'FIXTURE_PRIVATE_VALUE=never-publish\n');
    result = runBoundary(fixture, {ready: prepared.filename});
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(prepared.receipt.inputs.files.some(function capturedPrivate(file) { return file.path === '.env'; }), false);
    assert.equal(fs.existsSync(contained(prepared.preview, '.env')), false);

    // Moving an output or report invalidates the same receipt even when no
    // authored source changed. Restore only the known owned fixture bytes.
    const output = contained(prepared.preview, 'README.md');
    fs.writeFileSync(output, futureReadme + '\nChanged after review.\n');
    result = runBoundary(fixture, {ready: prepared.filename});
    assert.equal(result.status, 1); assert.match(result.stderr, /output bytes changed/);
    fs.writeFileSync(output, futureReadme);
    const report = contained(prepared.preview, 'documentation-preview.json');
    const reportBytes = fs.readFileSync(report);
    fs.writeFileSync(report, '{}\n');
    result = runBoundary(fixture, {ready: prepared.filename});
    assert.equal(result.status, 1); assert.match(result.stderr, /advisory report changed/);
    fs.writeFileSync(report, reportBytes);

    // Membership is part of the digest. Additions and deletions beneath both
    // source and governance anchors require a fresh review of actual changes.
    for (const relative of ['src/frontend/added.ts', 'docs/policies/ADDED.md']) {
        write(fixture, relative, 'Added public review input.\n');
        result = runBoundary(fixture, {ready: prepared.filename});
        assert.equal(result.status, 1); assert.match(result.stderr, /Preparation inputs changed/);
        fs.unlinkSync(contained(fixture.root, relative));
    }
    for (const [relative, content] of [['src/frontend/fixture.ts', implementation], ['docs/policies/FIXTURE.md', governance]]) {
        fs.unlinkSync(contained(fixture.root, relative));
        result = runBoundary(fixture, {ready: prepared.filename});
        assert.equal(result.status, 1); assert.match(result.stderr, /Preparation inputs changed/);
        write(fixture, relative, content);
    }
    // A previously absent root is recorded explicitly. Even creating an empty
    // selected directory invalidates its prior owner state before files arrive.
    const absent = contained(fixture.root, 'src/future-feature');
    fs.mkdirSync(absent);
    result = runBoundary(fixture, {ready: prepared.filename});
    assert.equal(result.status, 1); assert.match(result.stderr, /Preparation inputs changed/);
    fs.rmdirSync(absent);
    result = runBoundary(fixture, {ready: prepared.filename});
    assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('rejects a newly redirected public review input before preview creation', function redirectedReviewInput(t) {
    const fixture = createFixture(t, {'src/frontend/fixture.ts': 'export const fixture = true;\n'});
    const target = contained(fixture.outer, 'public-target');
    fs.mkdirSync(target);
    linkOwnedDirectory(fixture, 'public-target', 'parent/repository/src/frontend/redirected');
    expectRejectedBeforePreview(fixture, runBoundary(fixture, {preview: true}), /Redirected review input/);
    assert.deepEqual(fs.readdirSync(target), []);
});
