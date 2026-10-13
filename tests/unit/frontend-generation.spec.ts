import {describe, expect, it} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync, spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const root = process.cwd();
const artifacts = ['.generated/api/v1/openapi.json', '.generated/api/v1/operations.json',
    '.generated/api/v1/server.cjs', '.generated/api/v1/browser.mjs',
    '.generated/api/v1/server.d.cts', '.generated/api/v1/browser.d.mts',
    'src/types/api/v1.d.ts', 'src/types/api/validation-v1.d.ts', 'src/types/LocalizationTypes.d.ts',
    'src/modules/localization/generated/resources.json', 'src/modules/localization/generated/manifest.json',
    'src/modules/localization/generated/permissions.ts', '.generated/api/v1/policy.mjs',
    '.generated/api/v1/browser/validatePackingListView.mjs', '.generated/api/v1/browser/validateRegistrationInput.mjs'];

/** Run the real generators in an empty output tree; never substitute hand-authored validators. */
function generate(script: string, arguments_: string[]): void {
    execFileSync(process.execPath, [path.join(root, 'scripts', script), ...arguments_], {cwd: root, stdio: 'pipe'});
}

/** Temporary directories originate from mkdtemp and cleanup cannot escape that named test directory. */
async function removeTemporary(directory: string): Promise<void> {
    const resolved = path.resolve(directory);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('surveyor-generation-')) {
        throw new Error('Refusing unexpected generation test cleanup path');
    }
    await fs.rm(resolved, {recursive: true, force: true});
}

/** Read a watcher result while its asynchronous generator may not have published it yet. */
async function readOptionalFile(filename: string): Promise<string | null> {
    try {
        return await fs.readFile(filename, 'utf8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
    }
}

/** Hold the actual readiness write in a detached watcher process. Real directory
 * callbacks run first and report their completion, making a newer known save
 * deterministic without replacing either generator or accessing watcher state. */
function readinessPublicationGate(): string {
    return String.raw`
import filesystem from 'node:fs';
import promises from 'node:fs/promises';
import path from 'node:path';
import {syncBuiltinESMExports} from 'node:module';

const writeFile = promises.writeFile.bind(promises);
const watch = filesystem.watch.bind(filesystem);
let firstReadinessWrite = true;
let release;

// Delay only the first readiness artifact, whether published directly or staged
// beside it. Generator subprocesses do not inherit this process-only preload.
promises.writeFile = async function holdReadiness(filename, ...arguments_) {
    const target = path.resolve(String(filename));
    if (firstReadinessWrite && path.dirname(target) === path.join(process.cwd(), '.generated')
        && path.basename(target).startsWith('frontend-ready')) {
        firstReadinessWrite = false;
        const released = new Promise(function awaitRelease(resolve) { release = resolve; });
        process.send({kind: 'readiness-held'});
        await released;
    }
    return writeFile(filename, ...arguments_);
};

// Observe real input delivery after the production callback has already queued
// its next batch. IPC cannot release publication before that callback finishes.
filesystem.watch = function observeInput(directory, options, listener) {
    const callback = typeof options === 'function' ? options : listener;
    const watchOptions = typeof options === 'function' ? undefined : options;
    return watch(directory, watchOptions, inputObserved);

    function inputObserved(event, filename) {
        callback.call(this, event, filename);
        if (path.resolve(String(directory)) === path.join(process.cwd(), 'src/modules/lib')
            && filename?.toString() === 'permissions.ts') process.send({kind: 'permission-observed'});
    }
};
syncBuiltinESMExports();

function receiveRelease(message) {
    if (message.kind === 'release-readiness') release?.();
}
function stopGate() {
    release?.();
    process.off('message', receiveRelease);
    if (process.connected) process.disconnect();
}
process.on('message', receiveRelease);
process.once('SIGTERM', stopGate);
process.once('SIGINT', stopGate);
`;
}

describe('contract and catalog generation', () => {
    it('watches atomically replaced permission declarations and publishes readiness only after successful dependent generation', async function watchesPermissionDependency() {
        const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'surveyor-generation-'));
        let watcher: ReturnType<typeof spawn> | undefined;
        let output = '';
        let publicationHeld = false;
        let observedSaves = 0;
        try {
            // Run copies of the actual watcher/generators against a detached authored
            // tree. Installed dependencies are read through one junction; no maintained
            // source, application server, environment or database is changed.
            await fs.mkdir(path.join(temporary, 'scripts'), {recursive: true});
            for (const script of ['watch-frontend-inputs.mjs', 'generate-api.mjs', 'generate-locales.mjs']) {
                await fs.copyFile(path.join(root, 'scripts', script), path.join(temporary, 'scripts', script));
            }
            await fs.cp(path.join(root, 'contracts/api/v1'), path.join(temporary, 'contracts/api/v1'), {recursive: true});
            await fs.cp(path.join(root, 'src/locales'), path.join(temporary, 'src/locales'), {recursive: true});
            await fs.mkdir(path.join(temporary, 'src/modules/lib'), {recursive: true});
            const permissionsPath = path.join(temporary, 'src/modules/lib/permissions.ts');
            const originalPermissions = await fs.readFile(path.join(root, 'src/modules/lib/permissions.ts'), 'utf8');
            await fs.writeFile(permissionsPath, originalPermissions);
            await fs.symlink(path.join(root, 'node_modules'), path.join(temporary, 'node_modules'),
                process.platform === 'win32' ? 'junction' : 'dir');

            // Add the synthetic permission's text before watching. Subsequent changes
            // affect only the registry, proving its exact dependency is observed.
            for (const filename of ['en.json', 'de.json']) {
                const catalogPath = path.join(temporary, 'src/locales', filename);
                const catalog = JSON.parse(await fs.readFile(catalogPath, 'utf8'));
                catalog.resources.ui.permissions.WATCHER_PERMISSION = 'Watcher fixture permission';
                await fs.writeFile(catalogPath, JSON.stringify(catalog));
            }
            const gate = path.join(temporary, 'scripts/readiness-gate.mjs');
            await fs.writeFile(gate, readinessPublicationGate());
            watcher = spawn(process.execPath, ['--import', pathToFileURL(gate).href,
                path.join(temporary, 'scripts/watch-frontend-inputs.mjs')],
                {cwd: temporary, stdio: ['pipe', 'pipe', 'pipe', 'ipc']});
            function captureWatcherOutput(chunk: Buffer): void { output += chunk.toString(); }
            function receiveWatcherGate(message: {kind?: string}): void {
                if (message.kind === 'readiness-held') publicationHeld = true;
                else if (message.kind === 'permission-observed') observedSaves++;
            }
            watcher.stdout!.on('data', captureWatcherOutput);
            watcher.stderr!.on('data', captureWatcherOutput);
            watcher.on('message', receiveWatcherGate);
            await expect.poll(function watcherRegistered() { return output; }, {timeout: 10_000})
                .toContain('Watching frontend contracts, language catalogs and permission registry.');

            // An atomic replacement must remain watched. The ready file is absent
            // until real API and locale generation have both completed successfully.
            const validPermissions = originalPermissions.replace('    EDIT_TITLE: 1,', '    WATCHER_PERMISSION: 1,');
            expect(validPermissions).not.toBe(originalPermissions);
            const replacement = path.join(temporary, 'src/modules/lib/permissions.next');
            const markerPath = path.join(temporary, '.generated/frontend-ready.json');
            const generatedDirectory = path.join(temporary, 'src/modules/localization/generated');
            expect(await readOptionalFile(markerPath)).toBeNull();
            await fs.writeFile(replacement, validPermissions);
            await fs.rename(replacement, permissionsPath);

            // A newer save arrives inside the actual asynchronous readiness write.
            // Its callback is known before that write resumes, so the first valid
            // batch must not advertise readiness for the now-invalid input tree.
            await expect.poll(function readinessWriteStarted() { return publicationHeld; }, {timeout: 30_000}).toBe(true);
            const savesBeforeReplacement = observedSaves;
            await fs.writeFile(replacement, validPermissions.replace('WATCHER_PERMISSION:', 'WATCHER_MISSING:'));
            await fs.rename(replacement, permissionsPath);
            await expect.poll(function newerSaveDelivered() { return observedSaves; }, {timeout: 10_000})
                .toBeGreaterThan(savesBeforeReplacement);
            watcher.send({kind: 'release-readiness'});
            await expect.poll(function queuedInvalidRegistryReported() { return output; }, {timeout: 30_000})
                .toContain('Missing permission message: WATCHER_MISSING');
            expect(await readOptionalFile(markerPath)).toBeNull();
            const abandonedMarkers = (await fs.readdir(path.dirname(markerPath)))
                .filter(filename => filename.startsWith('frontend-ready') && filename.endsWith('.tmp'));
            expect(abandonedMarkers).toEqual([]);

            // Recovery must still use the same parent-directory observation and
            // publish only after a full successful dependency pass for this save.
            await fs.writeFile(replacement, validPermissions);
            await fs.rename(replacement, permissionsPath);
            await expect.poll(async function initialReadyMarker() { return readOptionalFile(markerPath); }, {timeout: 30_000})
                .not.toBeNull();

            const firstMarker = await fs.readFile(markerPath, 'utf8');
            const emittedPermissions = await fs.readFile(path.join(generatedDirectory, 'permissions.ts'), 'utf8');
            expect(emittedPermissions).toContain('"WATCHER_PERMISSION": "permissions.WATCHER_PERMISSION"');
            expect(emittedPermissions).not.toContain('"EDIT_TITLE":');
            const firstManifest = JSON.parse(await fs.readFile(path.join(generatedDirectory, 'manifest.json'), 'utf8'));
            expect(firstManifest.messages['permissions.WATCHER_PERMISSION']).toBeDefined();
            const markerModified = (await fs.stat(markerPath)).mtimeMs;
            for (const relative of ['.generated/api/v1/operations.json',
                'src/modules/localization/generated/permissions.ts', 'src/modules/localization/generated/manifest.json']) {
                expect((await fs.stat(path.join(temporary, relative))).mtimeMs).toBeLessThanOrEqual(markerModified);
            }

            // An invalid intermediate registry save must not advertise a restart.
            // A later valid save must still recover through the same watcher handles.
            const outputBeforeInvalidSave = output.length;
            await fs.writeFile(replacement, validPermissions.replace('WATCHER_PERMISSION:', 'WATCHER_MISSING:'));
            await fs.rename(replacement, permissionsPath);
            await expect.poll(function invalidRegistryReported() { return output.slice(outputBeforeInvalidSave); }, {timeout: 30_000})
                .toContain('Missing permission message: WATCHER_MISSING');
            expect(await fs.readFile(markerPath, 'utf8')).toBe(firstMarker);
            await fs.writeFile(replacement, originalPermissions);
            await fs.rename(replacement, permissionsPath);
            await expect.poll(async function recoveredReadyMarker() { return readOptionalFile(markerPath); }, {timeout: 30_000})
                .not.toBe(firstMarker);
            const recoveredPermissions = await fs.readFile(path.join(generatedDirectory, 'permissions.ts'), 'utf8');
            expect(recoveredPermissions).toContain('"EDIT_TITLE": "permissions.EDIT_TITLE"');
            expect(recoveredPermissions).not.toContain('"WATCHER_PERMISSION":');
            const recoveredManifest = JSON.parse(await fs.readFile(path.join(generatedDirectory, 'manifest.json'), 'utf8'));
            expect(recoveredManifest.version).not.toBe(firstManifest.version);
        } finally {
            // Stop the real child and release the dependency link before the established
            // mkdtemp containment guard removes only this fixture's own authored tree.
            if (watcher && watcher.exitCode === null) {
                const stopped = new Promise<void>(function waitForWatcherExit(resolve) {
                    watcher!.once('exit', function watcherExited() { resolve(); });
                });
                watcher.kill('SIGTERM');
                await stopped;
            }
            await fs.unlink(path.join(temporary, 'node_modules')).catch(function ignoreAbsentJunction(error: NodeJS.ErrnoException) {
                if (error.code !== 'ENOENT') throw error;
            });
            await removeTemporary(temporary);
        }
    }, 90_000);

    it('keeps emitted JavaScript from shadowing maintained TypeScript modules and root configurations', async () => {
        // Extensionless imports can resolve an adjacent emitted .js before
        // the maintained .ts source. Such a copy can make both tests and production
        // bundles consume stale behavior despite a successful TypeScript check.
        // Build output belongs outside this authored tree; report every collision
        // together so another external emitter cannot silently invalidate review.
        const collisions: string[] = [];
        // Include every authored consumer: runtime helpers, test fixtures and
        // scripts can also resolve stale siblings. Root runner/build configurations
        // use all three TypeScript module formats. Discover pairs rather than
        // maintaining a second list of configs or generated-file exceptions.
        for (const directory of ['src', 'tests', 'scripts', '.']) {
            const files = new Set(await fs.readdir(path.join(root, directory), {recursive: directory !== '.'}));
            for (const file of files) {
                if (/\.d\.(?:ts|mts|cts)$/u.test(file)) continue;
                const extension = path.extname(file);
                const emittedExtension = extension === '.ts' ? '.js'
                    : extension === '.mts' ? '.mjs' : extension === '.cts' ? '.cjs' : null;
                if (emittedExtension === null) continue;
                const emitted = file.slice(0, -extension.length) + emittedExtension;
                if (files.has(emitted)) collisions.push(path.join(directory, emitted));
            }
        }
        expect(collisions.sort()).toEqual([]);
    });

    it('reports compiled permission siblings without mutation and retires only those known outputs during generation', async function retiresCompiledPermissionSiblings() {
        const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'surveyor-generation-'));
        try {
            const destination = path.join(temporary, 'output');
            generate('generate-locales.mjs', ['--output-root', destination]);
            const generated = path.join(destination, 'src/modules/localization/generated');
            const sourcePath = path.join(generated, 'permissions.ts');
            const sourceBefore = await fs.readFile(sourcePath, 'utf8');
            const sourceModifiedBefore = (await fs.stat(sourcePath)).mtimeMs;
            const compiled = path.join(generated, 'permissions.js');
            const sourceMap = path.join(generated, 'permissions.js.map');
            const unrelated = path.join(generated, 'unrelated.js');

            // Reproduce the real extension-resolution collision in the generator's
            // own temporary output tree, with an unrelated file beside it.
            await fs.writeFile(compiled, '// Stale compiled permission source\n');
            await fs.writeFile(sourceMap, '{"version":3}\n');
            await fs.writeFile(unrelated, '// Preserve this unrelated generated neighbor\n');
            expect(() => generate('generate-locales.mjs', ['--output-root', destination, '--check']))
                .toThrow(/compiled permission siblings/);
            expect(await fs.readFile(compiled, 'utf8')).toBe('// Stale compiled permission source\n');
            expect(await fs.readFile(sourceMap, 'utf8')).toBe('{"version":3}\n');
            expect(await fs.readFile(sourcePath, 'utf8')).toBe(sourceBefore);
            expect((await fs.stat(sourcePath)).mtimeMs).toBe(sourceModifiedBefore);

            // Normal generation uses its exact-file retirement before publishing
            // current TypeScript. It must not replace a broad directory cleanup.
            generate('generate-locales.mjs', ['--output-root', destination]);
            await expect(fs.access(compiled)).rejects.toMatchObject({code: 'ENOENT'});
            await expect(fs.access(sourceMap)).rejects.toMatchObject({code: 'ENOENT'});
            expect(await fs.readFile(unrelated, 'utf8')).toBe('// Preserve this unrelated generated neighbor\n');
            expect(await fs.readFile(sourcePath, 'utf8')).toBe(sourceBefore);
            generate('generate-locales.mjs', ['--output-root', destination, '--check']);
        } finally {
            // The established guard verifies the mkdtemp root before recursive fixture cleanup.
            await removeTemporary(temporary);
        }
    }, 20_000);

    it('generates identical artifacts from two clean trees and verifies them without rewriting', async () => {
        const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'surveyor-generation-'));
        try {
            const first = path.join(temporary, 'first');
            const second = path.join(temporary, 'second');
            for (const destination of [first, second]) {
                generate('generate-api.mjs', ['--output-root', destination]);
                generate('generate-locales.mjs', ['--output-root', destination]);
            }
            for (const artifact of artifacts) {
                expect(await fs.readFile(path.join(first, artifact), 'utf8'))
                    .toBe(await fs.readFile(path.join(second, artifact), 'utf8'));
            }
            // Load copied build output outside the repository, with runtime compilation disabled.
            // Unicode length exercises a helper that standalone Ajv output otherwise imports.
            const browserUrl = pathToFileURL(path.join(first, '.generated/api/v1/browser.mjs')).href;
            const serverUrl = pathToFileURL(path.join(first, '.generated/api/v1/server.cjs')).href;
            const registrationUrl = pathToFileURL(path.join(first, '.generated/api/v1/browser/validateRegistrationInput.mjs')).href;
            const verifyStandalone = `globalThis.Function = function () { throw new Error('Runtime compilation is forbidden'); };
                const browser = await import(${JSON.stringify(browserUrl)});
                const server = (await import(${JSON.stringify(serverUrl)})).default;
                const registration = await import(${JSON.stringify(registrationUrl)});
                for (const validators of [browser, server]) {
                    if (!validators.validatePackingMetadataPatch({title: '💡'.repeat(255)})) throw new Error('Unicode boundary rejected');
                    if (validators.validatePackingMetadataPatch({title: '💡'.repeat(256)})) throw new Error('Unicode bound ignored');
                    const password = 'A1' + '💡'.repeat(3);
                    if (!validators.validateResetInput({token: 'Current-token', password, confirmPassword: password})) throw new Error('Native UTF-16 minimum rejected');
                    if (validators.validateResetInput({token: 'Current-token', password: 'A1💡💡x', confirmPassword: password})) throw new Error('Native UTF-16 minimum ignored');
                }
                for (const validators of [browser, server, registration]) {
                    const input = {username: 'Account', displayname: 'Account', email: 'account@example.invalid', password: 'A1💡💡💡', password_repeat: 'A1💡💡💡'};
                    if (!validators.validateRegistrationInput(input)) throw new Error('Standalone native UTF-16 registration rejected');
                    if (validators.validateRegistrationInput({...input, password_repeat: 'A1💡💡x'})) throw new Error('Standalone native UTF-16 repetition accepted');
                }`;
            execFileSync(process.execPath, ['--input-type=module', '--eval', verifyStandalone], {cwd: temporary, stdio: 'pipe'});
            generate('generate-api.mjs', ['--output-root', first, '--check']);
            generate('generate-locales.mjs', ['--output-root', first, '--check']);
        } finally {
            await removeTemporary(temporary);
        }
    }, 60_000);

    it('discovers one added locale file and rejects missing text, placeholder drift and active markup', async () => {
        const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'surveyor-generation-'));
        try {
            const source = path.join(temporary, 'locales');
            const destination = path.join(temporary, 'output');
            await fs.cp(path.join(root, 'src/locales'), source, {recursive: true});
            const english = JSON.parse(await fs.readFile(path.join(source, 'en.json'), 'utf8'));
            // Synthetic fixture: tests discovery and applicable plural categories, not translation quality.
            const added = {...english, locale: 'nl', nativeName: 'Nederlands', help: {directory: 'nl'}};
            delete added.uiContracts;
            await fs.writeFile(path.join(source, 'nl.json'), JSON.stringify(added));
            generate('generate-locales.mjs', ['--source', source, '--output-root', destination]);
            const manifest = JSON.parse(await fs.readFile(path.join(destination, 'src/modules/localization/generated/manifest.json'), 'utf8'));
            expect(manifest.locales.map((locale: {locale: string}) => locale.locale)).toContain('nl');
            expect(manifest.helpSources.nl).toBe('nl');
            const germanPath = path.join(source, 'de.json');
            const german = JSON.parse(await fs.readFile(germanPath, 'utf8'));
            const invalidCatalogs = [
                {...german, help: {directory: '../uploads'}},
                {...german, help: {directory: '.'}},
                {...german, resources: {...german.resources, ui: {...german.resources.ui, common: {...german.resources.ui.common, save: undefined}}}},
                {...german, resources: {...german.resources, ui: {...german.resources.ui, app: {...german.resources.ui.app, activeProfile: 'Hallo {{unexpected}}'}}}},
                {...german, resources: {...german.resources, ui: {...german.resources.ui, common: {...german.resources.ui.common, save: '<script>alert(1)</script>'}}}},
            ];
            for (const invalid of invalidCatalogs) {
                await fs.writeFile(germanPath, JSON.stringify(invalid));
                expect(() => generate('generate-locales.mjs', ['--source', source, '--output-root', destination])).toThrow();
            }
        } finally {
            await removeTemporary(temporary);
        }
    }, 20_000);

    it('compiles real consumers and required negative assertions with the installed TypeScript', () => {
        execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--ignoreConfig',
            '--noEmit', '--strict', '--skipLibCheck', '--target', 'ES2024', '--module', 'NodeNext',
            '--moduleResolution', 'NodeNext', '--resolveJsonModule', '--esModuleInterop',
            path.join(root, 'tests/fixtures/frontend-contracts.mts')], {cwd: root, stdio: 'pipe'});
    }, 20_000);
});
