/* Copyright 2026 Julian Malovanij. Licensed under the Apache License, Version 2.0. */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import YAML from 'yaml';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const command = path.join(project, 'scripts/release-publication.mjs');
const temporaryRoot = fs.realpathSync(os.tmpdir());

function git(cwd, ...args) {
    return execFileSync('git', args, {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
}

/** Every publication uses its own actual local bare origin, never the project remote. */
function fixture(run) {
    const directory = fs.mkdtempSync(path.join(temporaryRoot, 'surveyor-release-publication-'));
    const working = path.join(directory, 'working');
    const origin = path.join(directory, 'origin.git');
    fs.mkdirSync(working);
    git(directory, 'init', '--bare', origin);
    git(working, 'init', '-b', 'main');
    git(working, 'config', 'user.name', 'Release fixture');
    git(working, 'config', 'user.email', 'release@example.test');
    git(working, 'config', 'commit.gpgsign', 'false');
    git(working, 'remote', 'add', 'origin', origin);
    fs.writeFileSync(path.join(working, '.gitignore'), 'release/\nartifacts/\n');
    fs.writeFileSync(path.join(working, 'package.json'), JSON.stringify({name: 'fixture', version: '1.0.0', dependencies: {example: '1.0.0'}}));
    fs.writeFileSync(path.join(working, 'package-lock.json'), JSON.stringify({name: 'fixture', version: '1.0.0', packages: {'': {name: 'fixture', version: '1.0.0'}}}));
    git(working, 'add', '.');
    git(working, 'commit', '-m', 'Tested application');
    git(working, 'push', 'origin', 'main');
    const revision = git(working, 'rev-parse', 'HEAD');

    const environment = {...process.env, GITHUB_SHA: revision, GITHUB_REF: 'refs/heads/main', RELEASE_VERSION: '1.0.1'};
    const invoke = operation => spawnSync(process.execPath, [command, operation], {cwd: working, env: environment, encoding: 'utf8'});
    function bump(extra) {
        for (const file of ['package.json', 'package-lock.json']) {
            const filename = path.join(working, file);
            const value = JSON.parse(fs.readFileSync(filename, 'utf8'));
            value.version = '1.0.1';
            if (value.packages) value.packages[''].version = '1.0.1';
            if (extra) extra(file, value);
            fs.writeFileSync(filename, JSON.stringify(value));
        }
        git(working, 'add', 'package.json', 'package-lock.json');
        git(working, 'commit', '-m', 'Version bump');
        git(working, 'tag', '-a', 'v1.0.1', '-m', 'Release fixture');
    }
    function archive(receipt) {
        fs.mkdirSync(path.join(working, 'release'), {recursive: true});
        fs.mkdirSync(path.join(working, 'artifacts'), {recursive: true});
        if (receipt) fs.writeFileSync(path.join(working, 'release/release-source.json'), JSON.stringify(receipt));
        else assert.equal(invoke('record-build').status, 0);
        execFileSync('tar', ['-czf', path.join(working, 'artifacts/surveyor-v1.0.1.tar.gz'), '-C', path.join(working, 'release'), '.']);
    }
    function remoteUnchanged() {
        assert.equal(git(origin, 'rev-parse', 'refs/heads/main'), revision);
        assert.equal(git(origin, 'tag', '--list', 'v1.0.1'), '');
    }
    try {
        run({directory, working, origin, revision, environment, invoke, bump, archive, remoteUnchanged});
    } finally {
        // Verify the resolved task directory remains a single child of the
        // explicit temporary root before removing any recursive fixture tree.
        const relative = path.relative(temporaryRoot, fs.realpathSync(directory));
        assert.ok(relative.startsWith('surveyor-release-publication-') && !relative.includes(path.sep));
        fs.rmSync(directory, {recursive: true, force: true});
    }
}

test('pins detached checkout to tested input and rejects branch advancement', () => fixture(({working, origin, revision, invoke, remoteUnchanged}) => {
    git(working, 'checkout', '--detach', revision);
    assert.equal(invoke('verify-source').status, 0);
    git(origin, 'update-ref', 'refs/heads/other', revision);
    fs.writeFileSync(path.join(working, 'application.txt'), 'New source');
    git(working, 'add', 'application.txt');
    git(working, 'commit', '-m', 'Application advanced');
    git(working, 'push', 'origin', 'HEAD:refs/heads/main');
    assert.equal(invoke('verify-source').status, 1);
    assert.match(invoke('verify-source').stderr, /branch advanced/u);
    assert.equal(git(origin, 'tag', '--list'), '');
}));

test('build failure or missing archive leaves both remote references unpublished', () => fixture(({invoke, bump, remoteUnchanged}) => {
    bump();
    const result = invoke('publish');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /archive is required/u);
    remoteUnchanged();
}));

test('publishes only a version-only commit with its exact archived source receipt', () => fixture(({working, origin, invoke, bump, archive}) => {
    bump();
    archive();
    const result = invoke('publish');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /archive SHA-256 [a-f0-9]{64}/u);
    assert.equal(git(origin, 'rev-parse', 'refs/heads/main'), git(working, 'rev-parse', 'HEAD'));
    assert.equal(git(origin, 'rev-parse', 'refs/tags/v1.0.1^{commit}'), git(working, 'rev-parse', 'HEAD'));
}));

test('rejects stale archives without publishing branch or tag', () => fixture(({invoke, bump, archive, remoteUnchanged}) => {
    bump();
    archive({version: '1.0.1', testedRevision: 'wrong', buildRevision: 'wrong'});
    assert.equal(invoke('publish').status, 1);
    remoteUnchanged();
}));

test('rejects dependency mutations hidden inside a version bump', () => fixture(({invoke, bump, remoteUnchanged}) => {
    bump((file, value) => {if (file === 'package.json') value.dependencies.example = '2.0.0';});
    const result = invoke('record-build');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /changed more than/u);
    remoteUnchanged();
}));

test('a conflicting remote tag rejects the entire atomic branch/tag publication', () => fixture(({origin, revision, invoke, bump, archive}) => {
    bump();
    archive();
    git(origin, 'update-ref', 'refs/tags/v1.0.1', revision);
    const result = invoke('publish');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /atomic|already exists/u);
    assert.match(result.stderr, /v1\.0\.1/u);
    assert.equal(git(origin, 'rev-parse', 'refs/heads/main'), revision);
    assert.equal(git(origin, 'rev-parse', 'refs/tags/v1.0.1'), revision);
}));

test('retains remote failure details and redacts only URL credentials', () => fixture(({working, invoke}) => {
    git(working, 'remote', 'set-url', 'origin', 'http://release-user:synthetic-secret@127.0.0.1:1/repository.git');
    const result = invoke('verify-source');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /127\.0\.0\.1/u);
    assert.match(result.stderr, /repository\.git/u);
    assert.match(result.stderr, /Failed to connect|Couldn't connect|Could not connect/iu);
    assert.doesNotMatch(result.stderr, /synthetic-secret/u);
    // Git versions may themselves omit userinfo; if present the username remains.
    if (result.stderr.includes('release-user')) assert.match(result.stderr, /release-user:\[REDACTED\]@/u);
}));

test('the real workflow builds the archive before invoking its shared publisher', () => {
    const workflow = YAML.parse(fs.readFileSync(path.join(project, '.github/workflows/release.yml'), 'utf8'));
    const steps = workflow.jobs.release.steps;
    assert.equal(steps.find(step => step.uses?.startsWith('actions/checkout')).with.ref, '${{ github.sha }}');
    const verify = steps.findIndex(step => step.run === 'node scripts/release-publication.mjs verify-source');
    const build = steps.findIndex(step => step.run === 'npm run build');
    const archive = steps.findIndex(step => step.name === 'Create build archive');
    const publish = steps.findIndex(step => step.run === 'node scripts/release-publication.mjs publish');
    assert.ok(verify >= 0 && verify < build && build < archive && archive < publish);
    assert.match(steps[archive].run, /release-publication\.mjs record-build/u);
    assert.ok(steps.filter(step => step.run?.includes('git push')).length === 0);
    assert.equal(steps.find(step => step.name === 'Include available documentation (advisory)')['continue-on-error'], true);
});
