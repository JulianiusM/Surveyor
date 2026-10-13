/** Watch authored inputs, never generated artifacts, and serialize their dependent generators.
 * The completion marker restarts Express only after contracts, catalogs and permission keys agree. */
import {renameSync, watch} from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let timer;
let running = false;
let queued = false;
let stopping = false;
let child;

/** Run one existing generator to completion before its dependent generator can start. */
function generate(script) {
    return new Promise(function startGenerator(resolve, reject) {
        // Use the installed Node and existing script owner; the watcher does not copy
        // generation logic or add a network/package-runner fallback.
        const generation = spawn(process.execPath, [path.join(root, 'scripts', script)], {cwd: root, stdio: 'inherit'});
        child = generation;

        function completeGenerator(code) {
            if (child === generation) child = undefined;
            if (code === 0) resolve();
            else reject(new Error(`${script} exited with ${code}`));
        }
        generation.once('error', reject);
        generation.once('exit', completeGenerator);
    });
}

/** Publish readiness only after an uninterrupted successful dependency batch.
 * Saves during a batch retain another pass; invalid intermediate edits keep watching
 * without advertising partially regenerated input to the Express restart owner. */
async function regenerate() {
    if (running) { queued = true; return; }
    running = true;

    try {
        // Locale generation consumes API problem contracts and the authored permission
        // registry, so its dependent outputs must never race API regeneration.
        await generate('generate-api.mjs');
        if (stopping) return;
        await generate('generate-locales.mjs');
        if (stopping || queued) return;

        // A known newer save owns another complete batch. Generated files themselves
        // are unwatched, and this marker is the only dependent Express restart signal.
        await fs.mkdir(path.join(root, '.generated'), {recursive: true});
        if (stopping || queued) return;
        await publishReadiness();
    } catch (error) {
        // Keep watching after a malformed intermediate edit; the next saved correction recovers.
        if (!stopping) console.error(error.message);
    } finally {
        running = false;
        if (queued && !stopping) { queued = false; schedule(); }
    }
}

/** Stage the marker before deciding whether this batch is still current. The
 * final known-save check and atomic publication share one event-loop step, so a
 * save received during asynchronous writing cannot advertise stale readiness. */
async function publishReadiness() {
    const directory = path.join(root, '.generated');
    const marker = path.join(directory, 'frontend-ready.json');
    const pending = path.join(directory, `frontend-ready-${process.pid}.tmp`);
    try {
        // This process owns one serialized batch and one ignored sibling. Writing
        // it can yield to input callbacks without touching Express's restart marker.
        await fs.writeFile(pending, JSON.stringify({completed: Date.now()}));
        if (stopping || queued) return;

        // Do not await between this check and publication. The brief synchronous
        // rename replaces the marker atomically before another callback can run.
        renameSync(pending, marker);
    } finally {
        // Remove only this process's exact staging file. A successful rename has
        // already consumed it; a queued/stopped/failed batch leaves no false marker.
        await fs.unlink(pending).catch(ignoreConsumedMarker);
    }
}

/** Absence follows successful publication; other cleanup errors remain visible. */
function ignoreConsumedMarker(error) {
    if (error.code !== 'ENOENT') throw error;
}

/** Coalesce idle saves and immediately remember saves that arrive during generation. */
function schedule() {
    // Mark a running batch before the debounce delay: otherwise a late save could
    // publish readiness for that batch before its delayed callback noticed the edit.
    if (running) { queued = true; return; }
    clearTimeout(timer);
    timer = setTimeout(regenerateScheduledInputs, 200);
}

/** Start the asynchronous batch without leaving a rejected timer callback. */
function regenerateScheduledInputs() {
    timer = undefined;
    void regenerate();
}

/** Contract/catalog filenames are authored inputs; generated outputs live elsewhere. */
function observeContractOrCatalog(_event, filename) {
    if (filename && /\.(?:ya?ml|json)$/.test(filename.toString())) schedule();
}

/** Watch the registry's parent so atomic editor replacement retains observation.
 * Other native library saves keep their ordinary server restart behavior. */
function observePermissionRegistry(_event, filename) {
    if (filename && filename.toString() === 'permissions.ts') schedule();
}

const watchers = [];
for (const directory of ['contracts/api/v1', 'src/locales']) {
    watchers.push(watch(path.join(root, directory), {recursive: true}, observeContractOrCatalog));
}
watchers.push(watch(path.join(root, 'src/modules/lib'), observePermissionRegistry));

/** Release timers, directory handles and the active child when the development group stops. */
function stop() {
    stopping = true;
    clearTimeout(timer);
    for (const watcher of watchers) watcher.close();
    child?.kill();
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
console.log('Watching frontend contracts, language catalogs and permission registry.');
