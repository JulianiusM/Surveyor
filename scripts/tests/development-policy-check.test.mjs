/*
 * Copyright 2026 Julian Malovanij
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy at http://www.apache.org/licenses/LICENSE-2.0
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const script = path.join(repository, 'scripts/check-development-policy.mjs');
const policy = fs.readFileSync(path.join(repository, 'docs/policies/development-check.json'));

/** Each fixture owns a fresh disposable Git tree; no application source or DB is loaded. */
function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surveyor-development-policy-'));
    execFileSync('git', ['init', '--quiet'], {cwd: root});
    write(root, 'docs/policies/development-check.json', policy);
    t.after(function removeFixture() {
        // Verify the exact OS-created directory before its recursive cleanup.
        const resolved = path.resolve(root);
        assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
        assert.ok(path.basename(resolved).startsWith('surveyor-development-policy-'));
        fs.rmSync(resolved, {recursive: true, force: true});
    });
    return root;
}

/** Write only explicitly named synthetic production sources into the owned fixture. */
function write(root, file, content) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.writeFileSync(target, content);
}

/** Exercise actual CLI status and structured findings, including unavailable prerequisites. */
function run(root, args = ['--all']) {
    const result = spawnSync(process.execPath, [script, '--root', root, '--json', ...args],
        {encoding: 'utf8', timeout: 20_000});
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    return {...result, report: result.stdout.trim() ? JSON.parse(result.stdout) : undefined};
}

test('accepts declaration contracts and documented DBAL/short named selectors', t => {
    const root = fixture(t);
    write(root, 'src/types/Contract.d.ts', 'export interface Contract { id: string }');
    write(root, 'src/modules/database/services/ExampleService.ts',
        '/** Query data only; the caller owns validation. */\nexport function lookup(rows: string[]) { for (const row of rows) { return row; } }');
    write(root, 'src/example.ts', 'export const names = (rows: string[]) => rows.map(row => row.trim());');
    const result = run(root);
    assert.equal(result.status, 0);
    assert.equal(result.report.errors.length, 0);
    assert.ok(result.report.manualReview.length > 0);
});

test('rejects executable files in src/types', t => {
    const root = fixture(t);
    write(root, 'src/types/Contract.ts', 'export interface Contract { id: string }');
    const result = run(root);
    assert.equal(result.status, 1);
    assert.ok(result.report.errors.some(error => error.rule === 'declaration-files'));
});

test('recognizes aliased, namespace, re-export and dynamic request dependencies in DBAL', t => {
    const root = fixture(t);
    write(root, 'src/modules/database/services/ExampleService.ts', [
        "import {APIError as Failure} from '../../lib/errors';",
        "import * as Problems from '../../api/problem';",
        "export {operation} from '../../../controller/packingController';",
        "const errors = require('../../lib/errors.js');",
        "type Controller = import('../../../controller/packingController');",
        "const later = import('../../api/problem');",
        "import Failure = require('../../lib/errors');",
        "const templateImport = import(`../../api/problem`);",
        "const templateRequire = require(`../../lib/errors`);",
    ].join('\n'));
    const result = run(root);
    assert.equal(result.status, 1);
    assert.equal(result.report.errors.filter(error => error.rule === 'pure-dbal').length, 9);
});

test('does not treat error names in comments, strings or shared type contracts as DBAL imports', t => {
    const root = fixture(t);
    write(root, 'src/modules/database/services/ExampleService.ts',
        "import type {Contract} from '../../../types/Contract';\n// APIError is a prohibited request error.\nexport const text = 'controller/APIError';");
    assert.equal(run(root).status, 0);
});

test('reports uncommented control-flow blocks and nested complex anonymous operations', t => {
    const root = fixture(t);
    write(root, 'src/example.ts',
        'export const operation = (rows: number[]) => rows.map(row => { return [row].map(value => { if (value) { return value; } return 0; }); });');
    const result = run(root);
    assert.equal(result.status, 1);
    assert.ok(result.report.errors.some(error => error.rule === 'nontrivial-comments'));
    assert.ok(result.report.errors.some(error => error.rule === 'nested-anonymous-operation'));
});

test('template text cannot impersonate explanatory code comments', t => {
    const root = fixture(t);
    write(root, 'src/example.ts',
        'export function operation(value: string) { if (value) { return `${value} // not a comment`; } return ""; }');
    const result = run(root);
    assert.equal(result.status, 1);
    assert.equal(result.report.errors[0].rule, 'nontrivial-comments');
});

test('recognizes an explanatory comment immediately after the opening brace', t => {
    const root = fixture(t);
    write(root, 'src/example.ts',
        'export function operation(value: boolean) { /* Retain the confirmed value on this path. */ if (value) { return 1; } return 0; }');
    assert.equal(run(root).status, 0);
});

test('a scoped review remains explicit and cannot skip global declaration/DBAL boundaries', t => {
    const root = fixture(t);
    write(root, 'src/owned.ts', '/** Keep the supplied value. */ export function owned(value: boolean) { if (value) { return 1; } }');
    write(root, 'src/untouched.ts', 'export function old(value: boolean) { if (value) { return 1; } }');
    const args = ['--all', '--file', 'src/owned.ts'];
    const selected = run(root, args);
    assert.equal(selected.status, 0);
    assert.deepEqual(selected.report.readabilityScope, ['src/owned.ts']);
    assert.equal(run(root, ['--all', '--file', 'src/missing.ts']).status, 2);
    assert.equal(run(root, ['--all', '--file', 'src/../untouched.ts']).status, 2);
    write(root, 'src/types/Invalid.ts', 'export type Invalid = string');
    write(root, 'src/modules/database/services/OutsideService.ts', "import * as Errors from '../../lib/errors';");
    const blocked = run(root, args);
    assert.equal(blocked.status, 1);
    assert.deepEqual(new Set(blocked.report.errors.map(error => error.rule)), new Set(['declaration-files', 'pure-dbal']));
});

test('default mode detects a removed contract comment but preserves untouched legacy methods', t => {
    const root = fixture(t);
    write(root, 'src/owned.ts', '/** Preserve one path. */\nexport function owned(value: boolean) { if (value) { return 1; } }\n');
    write(root, 'src/legacy.ts', 'export function legacy(value: boolean) { if (value) { return 1; } }\n');
    execFileSync('git', ['add', '.'], {cwd: root});
    execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
        '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Synthetic checker baseline'], {cwd: root});
    assert.equal(run(root, []).status, 0);

    write(root, 'src/owned.ts', 'export function owned(value: boolean) { if (value) { return 1; } }\n');
    const removed = run(root, []);
    assert.equal(removed.status, 1);
    assert.deepEqual(removed.report.errors.map(error => error.file), ['src/owned.ts']);

    // A staged violation remains visible even when the worktree has no unstaged diff.
    execFileSync('git', ['add', 'src/owned.ts'], {cwd: root});
    assert.equal(run(root, []).status, 1);
});

test('default mode includes an assigned operation contract before a multiline arrow', t => {
    const root = fixture(t);
    write(root, 'src/owned.ts', '/** Preserve one path. */\n\nexport const action =\n'
        + '    (value: boolean) => { if (value) { return 1; } return 0; };\n');
    execFileSync('git', ['add', '.'], {cwd: root});
    execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
        '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Synthetic assigned-operation baseline'], {cwd: root});
    write(root, 'src/owned.ts', '\nexport const action =\n'
        + '    (value: boolean) => { if (value) { return 1; } return 0; };\n');
    const result = run(root, []);
    assert.equal(result.status, 1);
    assert.equal(result.report.errors[0].rule, 'nontrivial-comments');
    assert.equal(result.report.reviewedOperations, 1);
});

test('rejects configurations that would silently disable policy boundaries', t => {
    const root = fixture(t);
    const original = JSON.parse(policy);
    const invalid = [
        {...original, declarationDirectory: undefined},
        {...original, sourceExtensions: []},
        {...original, requestOwnerDirectories: ['src/../controller']},
        {...original, manualReview: []},
    ];
    for (const config of invalid) {
        write(root, 'docs/policies/development-check.json', JSON.stringify(config));
        assert.equal(run(root).status, 2);
    }
});

test('real comments in a template substitution remain valid while multiline template text does not', t => {
    const root = fixture(t);
    write(root, 'src/real.ts', 'export function real(value: boolean) { if (value) {\n'
        + 'return `${ /* Preserve the displayed boolean. */ value}`; } return ""; }');
    assert.equal(run(root).status, 0);
    write(root, 'src/text.ts', 'export function text(value: boolean) { if (value) {\n'
        + 'return `${value}\n// this is displayed text\n/* also text */`; } return ""; }');
    const result = run(root);
    assert.equal(result.status, 1);
    assert.deepEqual(result.report.errors.map(error => error.file), ['src/text.ts']);
});

test('checks both real Vue script blocks and preserves source line numbers', t => {
    const root = fixture(t);
    write(root, 'src/Example.vue', '<script lang="ts">\nfunction ordinary(value: boolean) { if (value) { return 1; } }\n</script>\n'
        + '<script setup lang="ts">\nfunction setup(value: boolean) { if (value) { return 2; } }\n</script>\n<template><p>Fixture</p></template>');
    const result = run(root);
    assert.equal(result.status, 1);
    assert.deepEqual(result.report.errors.map(error => error.line), [2, 5]);
});

test('inspects staged comments and dependencies even when the worktree is restored to HEAD', t => {
    const root = fixture(t);
    const file = 'src/owned.ts';
    const service = 'src/modules/database/services/ExampleService.ts';
    const original = '/** Preserve the admitted value. */\nexport function action(value: boolean) { if (value) { return 1; } }\n';
    write(root, file, original);
    write(root, service, 'export const persisted = 1;\n');
    execFileSync('git', ['add', '.'], {cwd: root});
    execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
        '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Synthetic staged-snapshot baseline'], {cwd: root});
    write(root, file, original.split('\n').slice(1).join('\n'));
    write(root, service, "import * as Errors from '../../lib/errors';\nexport const persisted = 1;\n");
    execFileSync('git', ['add', file, service], {cwd: root});
    write(root, file, original);
    write(root, service, 'export const persisted = 1;\n');

    const result = run(root, []);
    assert.equal(result.status, 1);
    assert.equal(result.report.staged.checkedSources, 2);
    assert.deepEqual(new Set(result.report.errors.map(error => error.rule)), new Set(['nontrivial-comments', 'pure-dbal']));
    assert.ok(result.report.errors.every(error => error.snapshot === 'index'));
    assert.equal(fs.readFileSync(path.join(root, file), 'utf8'), original);
});

test('supports changed Unicode filenames without interpreting Git octal escapes as JSON', t => {
    const root = fixture(t);
    const file = 'src/überprüfung.ts';
    write(root, file, '/** Preserve one path. */\nexport function action(value: boolean) { if (value) { return 1; } }\n');
    execFileSync('git', ['add', '.'], {cwd: root});
    execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
        '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Synthetic Unicode baseline'], {cwd: root});
    write(root, file, 'export function action(value: boolean) { if (value) { return 1; } }\n');
    const result = run(root, []);
    assert.equal(result.status, 1);
    assert.equal(result.report.errors[0].file, file);
});

test('includes executable getters and setters but keeps their named contracts', t => {
    const root = fixture(t);
    write(root, 'src/example.ts', 'export class Draft { get value() { if (true) { return 1; } }\n'
        + 'set value(next: number) { if (next) { console.log(next); } } }');
    const result = run(root);
    assert.equal(result.status, 1);
    assert.equal(result.report.reviewedOperations, 2);
    assert.equal(result.report.errors.length, 2);
    assert.ok(result.report.errors.every(error => error.rule === 'nontrivial-comments'));
});

test('fails closed for unsupported options, unavailable configuration and malformed source', t => {
    const root = fixture(t);
    assert.equal(run(root, ['--ignore-findings']).status, 2);
    write(root, 'src/example.ts', 'export function broken( {');
    assert.equal(run(root).status, 2);
    fs.unlinkSync(path.join(root, 'docs/policies/development-check.json'));
    assert.equal(run(root).status, 2);
});
