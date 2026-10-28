/* Copyright 2026 Julian Malovanij. Licensed under the Apache License, Version 2.0. */

import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';

/** Preserve Git diagnostics while masking actual credential values in place. */
function redactCredentials(diagnostic) {
    let result = diagnostic.replace(/(https?:\/\/[^\s/:@]+:)[^\s@]+(@)/gu, '$1[REDACTED]$2')
        .replace(/(authorization:\s*(?:basic|bearer)\s+)[^\s]+/giu, '$1[REDACTED]');
    for (const value of [process.env.GITHUB_TOKEN, process.env.GH_TOKEN]) {
        if (value) result = result.replaceAll(value, '[REDACTED]');
    }
    return result;
}

/** Execute only fixed Git operations and retain their complete error context. */
function git(args) {
    try {
        return execFileSync('git', args, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
    } catch (error) {
        const diagnostic = error.stderr?.toString().trim() || error.message;
        throw new Error(`Release Git operation failed: ${args[0]}\n${redactCredentials(diagnostic)}`);
    }
}

/** Resolve the caller's immutable CI input and the explicit publication branch.
 * A detached checkout is expected; a tag must never become an implicit branch. */
function releaseSource() {
    const revision = process.env.GITHUB_SHA;
    const reference = process.env.GITHUB_REF;
    if (!revision || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(revision)) throw new Error('A tested commit is required');
    if (!reference?.startsWith('refs/heads/')) throw new Error('Release publication requires a selected branch');
    git(['check-ref-format', reference]);

    // Compare the remote branch, not a stale local tracking ref. The atomic push
    // repeats this comparison as a lease so an intervening advance is rejected.
    const remote = git(['ls-remote', '--exit-code', 'origin', reference]).split(/\s+/u);
    if (remote.length !== 2 || remote[1] !== reference || remote[0] !== revision) {
        throw new Error('Release branch advanced after CI; run verification again');
    }
    return {revision, reference};
}

/** Verify checkout before the version bump and every fallible build/package step. */
function verifySource() {
    const {revision} = releaseSource();
    if (git(['rev-parse', 'HEAD']) !== revision) throw new Error('Release checkout differs from the tested commit');
    git(['diff', '--quiet', 'HEAD']);
    console.log(`Verified tested release source ${revision}`);
}

/** Compare semantic package contents, allowing only the requested version field.
 * npm may reformat JSON, but application/dependency changes cannot ride the bump. */
function assertVersionOnly(file, revision, version) {
    const before = JSON.parse(git(['show', `${revision}:${file}`]));
    const after = JSON.parse(git(['show', `HEAD:${file}`]));
    if (after.version !== version) throw new Error(`${file} does not contain the requested release version`);
    delete before.version;
    delete after.version;
    if (file === 'package-lock.json' && before.packages?.[''] && after.packages?.['']) {
        if (after.packages[''].version !== version) throw new Error('Lockfile root version differs from the release');
        delete before.packages[''].version;
        delete after.packages[''].version;
    }
    if (!isDeepStrictEqual(before, after)) throw new Error(`Release bump changed more than ${file} version metadata`);
}

/** Publish a locally prepared version commit/tag only after its archive exists.
 * The exact parent, version-only tree and remote lease connect CI to the artifact;
 * a single atomic push prevents a branch-only or tag-only publication. */
function preparedRelease() {
    const {revision, reference} = releaseSource();
    const version = process.env.RELEASE_VERSION;
    if (!version || !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/u.test(version)) throw new Error('A valid release version is required');
    // Local commit/tag creation before building is harmless; only this operation
    // may expose them. Refuse unexpected commits or uncommitted authored changes.
    if (git(['rev-parse', 'HEAD^']) !== revision) throw new Error('Release commit is not the tested commit plus one version bump');
    git(['diff', '--quiet', 'HEAD']);
    const changed = git(['diff', '--name-only', revision, 'HEAD']).split('\n');
    if (!changed.includes('package.json') || changed.some(file => !['package.json', 'package-lock.json'].includes(file))) {
        throw new Error('Release commit must contain only package version metadata');
    }
    for (const file of changed) assertVersionOnly(file, revision, version);
    const tag = `refs/tags/v${version}`;
    if (git(['rev-parse', `${tag}^{commit}`]) !== git(['rev-parse', 'HEAD'])) throw new Error('Release tag differs from the built commit');
    return {revision, reference, version, tag, buildRevision: git(['rev-parse', 'HEAD'])};
}

/** Include source identity in the archive itself, after build/package preparation.
 * This is operator evidence beside the runtime files, never browser application data. */
function recordBuild() {
    const {revision, version, buildRevision} = preparedRelease();
    fs.writeFileSync(path.join('release', 'release-source.json'), JSON.stringify({testedRevision: revision, buildRevision, version}) + '\n');
}

/** Validate the packaged source receipt and publish both references in one push. */
function publishRelease() {
    const {revision, reference, version, tag, buildRevision} = preparedRelease();
    const archive = path.resolve('artifacts', `surveyor-v${version}.tar.gz`);
    if (!fs.statSync(archive, {throwIfNoEntry: false})?.isFile() || fs.statSync(archive).size === 0) {
        throw new Error('A complete nonempty release archive is required before publication');
    }
    // Inspect the actual archive, not an unarchived staging copy. A stale/wrong
    // package must not consume a public version even when local refs look valid.
    let source;
    try {
        source = JSON.parse(execFileSync('tar', ['-xOf', archive, './release-source.json'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}));
    } catch {
        throw new Error('Release archive has no readable source receipt');
    }
    if (!isDeepStrictEqual(source, {testedRevision: revision, buildRevision, version})) throw new Error('Release archive differs from the tested version commit');
    console.log(`Verified archive SHA-256 ${createHash('sha256').update(fs.readFileSync(archive)).digest('hex')}`);
    git(['push', '--atomic', `--force-with-lease=${reference}:${revision}`, 'origin', `HEAD:${reference}`, `${tag}:${tag}`]);
    console.log(`Published release ${version} from the tested source and its version-only commit`);
}

try {
    if (process.argv[2] === 'verify-source') verifySource();
    else if (process.argv[2] === 'record-build') recordBuild();
    else if (process.argv[2] === 'publish') publishRelease();
    else throw new Error('Expected verify-source, record-build or publish');
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
