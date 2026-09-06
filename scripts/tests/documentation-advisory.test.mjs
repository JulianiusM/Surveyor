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

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const reporter = fs.readFileSync(path.join(repository, 'scripts/report-documentation.mjs'));

function fixture(t, structure, help) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surveyor-advisory-'));
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    fs.mkdirSync(path.join(root, 'scripts'));
    fs.writeFileSync(path.join(root, 'scripts/report-documentation.mjs'), reporter);
    if (structure !== null) fs.writeFileSync(path.join(root, 'scripts/check-documentation.mjs'), structure);
    if (help !== null) fs.writeFileSync(path.join(root, 'scripts/check-help-documentation.mjs'), help);
    return root;
}
const findings = `import fs from 'node:fs';
const p = process.argv[process.argv.indexOf('--json') + 1];
fs.writeFileSync(p, JSON.stringify({summary:{totalErrors:1},errors:[{type:'source-baseline-mismatch'}]}));`;
const helpFindings = `console.log(JSON.stringify({ok:false,errors:[{message:'missing guide'}]}));`;
const cleanHelp = `console.log(JSON.stringify({ok:true,errors:[]}));`;
function run(root, flags = []) {
    const result = spawnSync(process.execPath, ['scripts/report-documentation.mjs', ...flags], {
        cwd: root, encoding: 'utf8', timeout: 20_000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    return result;
}
function report(root, mode = 'default') {
    return JSON.parse(fs.readFileSync(path.join(root, `artifacts/documentation/summary-${mode}.json`), 'utf8'));
}
for (const mode of ['default', 'strict']) {
    test(`${mode}: findings stay visible and both reports run without failing`, t => {
        const root = fixture(t, findings, helpFindings);
        run(root, mode === 'strict' ? ['--strict'] : []);
        const result = report(root, mode);
        assert.equal(result.advisory, true);
        assert.equal(result.reviewNeeded, true);
        assert.deepEqual(result.checks.map(check => check.status), ['findings', 'findings']);
        assert.equal(result.checks[0].errors[0].type, 'source-baseline-mismatch');
    });
}
test('checker syntax failure is reported and does not skip the next check', t => {
    const root = fixture(t, 'export const = ;', cleanHelp);
    run(root);
    assert.deepEqual(report(root).checks.map(check => check.status), ['tool-error', 'clean']);
    assert.notEqual(report(root).checks[0].childExitCode, 0);
});
test('missing checker scripts do not fail documentation commands', t => {
    const root = fixture(t, null, null);
    run(root);
    assert.ok(report(root).checks.every(check => check.status === 'tool-error'));
});
test('failed report does not reuse a stale passing JSON file', t => {
    const root = fixture(t, findings, cleanHelp);
    run(root);
    fs.writeFileSync(path.join(root, 'scripts/check-documentation.mjs'), 'throw new Error("broken checker");');
    run(root);
    assert.equal(report(root).checks[0].status, 'tool-error');
});
test('unwritable report destination is visible without a failing exit', t => {
    const root = fixture(t, findings, cleanHelp);
    fs.writeFileSync(path.join(root, 'not-a-directory'), 'fixture');
    const result = run(root, ['--output-dir', 'not-a-directory']);
    assert.match(result.stderr, /could not complete.*advisory/);
});
test('content runner failures remain reported, not prerequisite failures', t => {
    const root = fixture(t, findings, cleanHelp);
    fs.mkdirSync(path.join(root, 'node_modules/vitest'), {recursive: true});
    fs.writeFileSync(path.join(root, 'node_modules/vitest/vitest.mjs'), 'console.error("content assertion failed"); process.exit(1);');
    run(root, ['--content']);
    assert.equal(report(root, 'content').checks[0].status, 'failed');
    assert.equal(report(root, 'content').checks[0].childExitCode, 1);
});
test('browser runner failures remain reported, not prerequisite failures', t => {
    const root = fixture(t, findings, cleanHelp);
    fs.mkdirSync(path.join(root, 'node_modules/@playwright/test'), {recursive: true});
    fs.writeFileSync(path.join(root, 'node_modules/@playwright/test/cli.js'), 'process.exit(1);');
    run(root, ['--browser']);
    assert.equal(report(root, 'browser').checks[0].status, 'failed');
});
test('application CI and npm lifecycle scripts do not invoke documentation reports', () => {
    const ci = fs.readFileSync(path.join(repository, '.github/workflows/ci.yml'), 'utf8');
    assert.doesNotMatch(ci, /npm run docs:|node --test scripts\/tests\/documentation|report-documentation\.mjs/);
    const pkg = JSON.parse(fs.readFileSync(path.join(repository, 'package.json'), 'utf8'));
    for (const [name, command] of Object.entries(pkg.scripts)) {
        if (!name.startsWith('docs:')) assert.doesNotMatch(command, /docs:|check-documentation|report-documentation/);
    }
});

test('an unavailable optional content runner is not reported as an executed test failure', t => {
    const root = fixture(t, findings, cleanHelp);
    run(root, ['--content']);
    const result = report(root, 'content');
    assert.equal(result.checks[0].status, 'tool-error');
    assert.match(result.checks[0].toolingError, /unavailable/);
});

test('malformed diagnostic JSON is incomplete execution, never a clean report', t => {
    const root = fixture(t, findings, 'console.log("{}");');
    run(root);
    assert.equal(report(root).checks[1].status, 'tool-error');
});
