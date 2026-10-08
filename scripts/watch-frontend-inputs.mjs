/** Watch authored inputs, never generated artifacts, and serialize their dependent generators.
 * The completion marker restarts Express only after both contracts and catalogs are consistent. */
import {watch} from 'node:fs';
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

function generate(script) {
    return new Promise((resolve, reject) => {
        child = spawn(process.execPath, [path.join(root, 'scripts', script)], {cwd: root, stdio: 'inherit'});
        child.once('error', reject);
        child.once('exit', code => {
            child = undefined;
            if (code === 0) resolve();
            else reject(new Error(`${script} exited with ${code}`));
        });
    });
}

async function regenerate() {
    if (running) { queued = true; return; }
    running = true;
    try {
        await generate('generate-api.mjs');
        if (stopping) return;
        await generate('generate-locales.mjs');
        if (stopping) return;
        await fs.mkdir(path.join(root, '.generated'), {recursive: true});
        await fs.writeFile(path.join(root, '.generated/frontend-ready.json'), JSON.stringify({completed: Date.now()}));
    } catch (error) {
        // Keep watching after a malformed intermediate edit; the next saved correction recovers.
        if (!stopping) console.error(error.message);
    } finally {
        running = false;
        if (queued && !stopping) { queued = false; schedule(); }
    }
}

function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => { void regenerate(); }, 200);
}

const watchers = [path.join(root, 'contracts/api/v1'), path.join(root, 'src/locales')]
    .map(directory => watch(directory, {recursive: true}, (_event, filename) => {
        if (filename && /\.(?:ya?ml|json)$/.test(filename)) schedule();
    }));

function stop() {
    stopping = true;
    clearTimeout(timer);
    for (const watcher of watchers) watcher.close();
    child?.kill();
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
console.log('Watching frontend contracts and language catalogs.');
