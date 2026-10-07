import {describe, expect, it} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const root = process.cwd();
const artifacts = ['.generated/api/v1/openapi.json', '.generated/api/v1/operations.json',
    '.generated/api/v1/server.cjs', '.generated/api/v1/browser.mjs',
    '.generated/api/v1/server.d.cts', '.generated/api/v1/browser.d.mts',
    'src/types/api/v1.d.ts', 'src/types/api/validation-v1.d.ts', 'src/types/LocalizationTypes.d.ts',
    'src/modules/localization/generated/resources.json', 'src/modules/localization/generated/manifest.json'];

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

describe('contract and catalog generation', () => {
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
            const verifyStandalone = `globalThis.Function = function () { throw new Error('Runtime compilation is forbidden'); };
                const browser = await import(${JSON.stringify(browserUrl)});
                const server = (await import(${JSON.stringify(serverUrl)})).default;
                for (const validators of [browser, server]) {
                    if (!validators.validatePackingMetadataPatch({title: '💡'.repeat(255)})) throw new Error('Unicode boundary rejected');
                    if (validators.validatePackingMetadataPatch({title: '💡'.repeat(256)})) throw new Error('Unicode bound ignored');
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
