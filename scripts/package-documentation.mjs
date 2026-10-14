#!/usr/bin/env node

/*
 * Copyright 2026 Julian Malovanij
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy at http://www.apache.org/licenses/LICENSE-2.0
 */

/** Package available release documentation without publishing temporary task
 * material. Profile discovery has one owner; packaging never applies profile
 * instructions, assembles amendments or changes an application delivery result. */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';
import {discoverTaskProfiles, repositoryPathKey} from './check-documentation.mjs';

/** Explicit roots support isolated fixtures. Destination creation is limited to
 * a fresh workspace-owned directory, never the source documentation tree. */
function readOptions(argumentsList) {
    const options = {root: process.cwd(), destination: 'release/docs'};
    for (let index = 0; index < argumentsList.length; index += 1) {
        const argument = argumentsList[index];
        if (argument !== '--root' && argument !== '--destination') throw new Error(`Unknown argument: ${argument}`);
        const value = argumentsList[++index];
        if (!value) throw new Error(`${argument} requires a path`);
        options[argument.slice(2)] = value;
    }
    options.root = path.resolve(options.root);
    options.destination = path.resolve(options.root, options.destination);
    return options;
}

/** Validate ancestors before mkdir/copy. A redirected output parent must not
 * turn an otherwise contained lexical path into an outside filesystem write. */
function assertPlainPath(absolute) {
    const filesystemRoot = path.parse(absolute).root;
    let current = filesystemRoot;
    for (const component of path.relative(filesystemRoot, absolute).split(path.sep)) {
        current = path.join(current, component);
        if (!fs.existsSync(current)) break;
        if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Redirected packaging path: ${current}`);
    }
}

/** Keep every publication inside its declared workspace, excluding both the
 * maintained docs tree and Git metadata. Existing output is never overwritten. */
function validateDestination(options) {
    const relative = path.relative(options.root, options.destination);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error('Documentation destination must stay inside its workspace');
    }
    const owner = relative.split(path.sep)[0].toLowerCase();
    if (owner === 'docs' || owner === '.git') throw new Error('Documentation destination must be separate from maintained files');
    assertPlainPath(options.root);
    assertPlainPath(options.destination);
    if (fs.existsSync(options.destination)) throw new Error('Documentation destination already exists; existing content is preserved');
}

/** All declared temporary profile directories are excluded, including inactive
 * or malformed declarations. A marker cannot exclude a canonical category such
 * as runtime Help or active policies; the shared resolver reports that conflict. */
function publicationExclusions(config, discovery) {
    if (!Array.isArray(discovery.profileDirectories)) throw new Error('Profile declaration inventory is unavailable');
    const permanentDirectories = new Set(Object.values(config.documentClassification?.categories ?? {})
        .map(repositoryPathKey));
    const exclusions = [];
    for (const directory of discovery.profileDirectories) {
        if (!permanentDirectories.has(repositoryPathKey(directory))) exclusions.push(directory);
    }
    return exclusions;
}

/** Build a fresh temporary package before publishing its directory name. Failed
 * copies remain separate from the release destination and never mutate sources.
 * The filter excludes profile-owned material only; canonical Help and assets use
 * the same ordinary byte-copy path as all other retained documentation. */
function copyDocumentation(options, source, exclusions) {
    const destinationParent = path.dirname(options.destination);
    fs.mkdirSync(destinationParent, {recursive: true});
    const temporary = fs.mkdtempSync(path.join(destinationParent, '.documentation-package-'));
    const copied = path.join(temporary, 'docs');

    function includePublishedPath(absolute) {
        const relative = path.relative(options.root, absolute).split(path.sep).join('/');
        for (const directory of exclusions) {
            if (relative === directory || relative.startsWith(`${directory}/`)) return false;
        }
        return true;
    }

    try {
        fs.cpSync(source, copied, {recursive: true, dereference: false, filter: includePublishedPath});
        // Recheck after the copy: concurrent output creation must not be replaced.
        assertPlainPath(options.destination);
        if (fs.existsSync(options.destination)) throw new Error('Documentation destination changed while packaging');
        fs.renameSync(copied, options.destination);
    } finally {
        // This one freshly allocated directory is owned by this invocation.
        const relative = path.relative(destinationParent, temporary);
        if (!relative.startsWith('.documentation-package-') || relative.includes(path.sep)) {
            throw new Error('Temporary documentation directory escaped its owner');
        }
        assertPlainPath(temporary);
        fs.rmSync(temporary, {recursive: true, force: true});
    }
}

/** Advisory output preserves discovery errors without turning documentation
 * publication or an unavailable tool into a build/release prerequisite. */
function main() {
    try {
        const options = readOptions(process.argv.slice(2));
        validateDestination(options);
        const source = path.join(options.root, 'docs');
        if (!fs.existsSync(source)) {
            console.log(JSON.stringify({advisory: true, status: 'unavailable', message: 'Documentation source is absent'}));
            return;
        }
        assertPlainPath(source);
        const config = JSON.parse(fs.readFileSync(path.join(source, 'policies/documentation-check.json'), 'utf8'));
        const discovery = discoverTaskProfiles(options.root, config);
        const exclusions = publicationExclusions(config, discovery);
        copyDocumentation(options, source, exclusions);
        console.log(JSON.stringify({advisory: true, status: discovery.errors.length ? 'findings' : 'packaged',
            destination: options.destination, excludedProfiles: exclusions, findings: discovery.errors}));
    } catch (error) {
        console.error(`Documentation packaging incomplete (advisory): ${error.message}`);
    } finally {
        process.exitCode = 0;
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
