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

// Dependency-free maintainer diagnostics; never part of required application CI.
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const script = path.join(repository, 'scripts/check-documentation.mjs');
const helpScript = path.join(repository, 'scripts/check-help-documentation.mjs');
const productionConfig = JSON.parse(fs.readFileSync(path.join(repository, 'docs/documentation-check.json'), 'utf8'));
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
    write(root, 'docs/documentation-check.json', JSON.stringify(config));
    write(root, 'package.json', JSON.stringify({scripts: {valid: 'node -v'}}));
    write(root, 'README.md', `# Fixture\n${metadata}\n\n${optionalPaths.map(name => `\`${name}\``).join('\n')}\n`);
    write(root, 'docs/user-guide/README.md', `# Guide\n${metadata}\n\nUse [this page](README.md).\n`);
    write(root, 'src/controller/helpController.ts', `const root = ['docs', 'user-guide'];\n`);
    write(root, 'src/feature.ts', 'export const fixture = "Grüße";\n');
    write(root, '.github/workflows/release.yml', 'run: cp -R docs release/docs\n');
    const fingerprint = run(script, ['--root', root, '--fingerprint']);
    assert.equal(fingerprint.status, 0, fingerprint.stderr);
    config.baselines[0].sourceFingerprint = fingerprint.stdout.trim();
    write(root, 'docs/documentation-check.json', JSON.stringify(config));
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

test('both structural modes accept a clean checkout without generated/local files', t => {
    const root = fixture(t);
    for (const strict of [false, true]) {
        const {result, report} = inspect(root, strict);
        assert.equal(result.status, 0, result.stdout + result.stderr);
        assert.equal(report.summary.totalErrors, 0);
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

function helpFixture(t, extra = '') {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surveyor-help-check-'));
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    write(root, 'scripts/check-help-documentation.mjs', fs.readFileSync(helpScript));
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

