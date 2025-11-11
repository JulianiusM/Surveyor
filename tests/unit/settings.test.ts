/**
 * Unit tests for src/modules/settings.ts
 * - Mocks `node:fs` with an in-memory store
 * - Mocks `node:crypto.randomBytes` to make sessionSecret deterministic
 * - Verifies read() bootstrap, coercions, unknown keys, comma handling, and write() output
 */
import type {Settings} from '../../src/modules/settings';
import * as testData from '../data/unit/settingsData';

// Simple in-memory FS mock
const memfs = (() => {
    const files = new Map<string, string>();
    return {
        existsSync: (p: string) => files.has(p),
        readFileSync: (p: string, enc: string) => {
            if (!files.has(p)) throw new Error('ENOENT');
            return files.get(p)!;
        },
        writeFileSync: (p: string, content: string, enc: string) => {
            files.set(p, content);
        },
        __get: (p: string) => files.get(p),
        __set: (p: string, v: string) => files.set(p, v),
        __reset: () => files.clear(),
    };
})();

// deterministic random bytes mock
const rb = (n: number) => ({
    toString: (_enc?: string) => 'RANDOM_BASE64URL_TOKEN_ABCDEFGHIJKLMNOPQRSTUVWXYZ'.slice(0, Math.max(20, n)),
});

// Utility to load the module under fresh mocks
async function loadModule() {
    jest.resetModules();
    jest.doMock('node:fs', () => ({
        __esModule: true,
        default: memfs,
        ...memfs,
    }));
    jest.doMock('node:crypto', () => ({
        __esModule: true,
        default: {randomBytes: rb},
        randomBytes: rb,
    }));
    return await import('../../src/modules/settings');
}

describe('settings', () => {
    beforeEach(() => {
        memfs.__reset();
        jest.restoreAllMocks();
    });

    test(testData.bootstrapTestData.description, async () => {
        const {file, expectInitializedBefore, expectInitializedAfter, expectSessionSecretPrefix, expectFileExists, expectConsoleLogCalled} = testData.bootstrapTestData;
        const spyWriteLog = jest.spyOn(console, 'log').mockImplementation(() => {});
        const {SettingsStore} = await loadModule();
        const store = new SettingsStore();

        const before = store.value;
        expect(before.initialized).toBe(expectInitializedBefore);
        (store.value as any).file = file;

        await store.read(file, true);

        const after = store.value;
        expect(after.initialized).toBe(expectInitializedAfter);
        expect(memfs.existsSync(file)).toBe(expectFileExists);
        expect(after.sessionSecret.startsWith(expectSessionSecretPrefix)).toBe(true);
        expect(after.sessionSecret.length).toBeGreaterThan(expectSessionSecretPrefix.length);

        if (expectConsoleLogCalled) {
            expect(spyWriteLog).toHaveBeenCalled();
        }
    });

    test(testData.parseCSVTestData.description, async () => {
        const {file, csvContent, expected, expectConsoleWarnCalled} = testData.parseCSVTestData;
        const spyWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const {SettingsStore} = await loadModule();
        const store = new SettingsStore();
        (store.value as any).file = file;

        memfs.__set(file, csvContent);

        await store.read(file, true);

        const s = store.value as Settings;
        Object.keys(expected).forEach(key => {
            expect(s[key]).toBe(expected[key]);
        });

        if (expectConsoleWarnCalled) {
            expect(spyWarn).toHaveBeenCalled();
        }
    });

    test(testData.writeCSVTestData.description, async () => {
        const {file, settingsOverrides, expectedLines, forbiddenFields} = testData.writeCSVTestData;
        const {SettingsStore} = await loadModule();
        const store = new SettingsStore();
        (store.value as any).file = file;

        Object.assign(store.value, settingsOverrides);
        (store.value as any).file = file;

        await store.write(file);

        const written = memfs.__get(file)!;
        const lines = written.trim().split(/\r?\n/);

        expect(lines).toEqual(expect.arrayContaining(expectedLines));

        for (const forbidden of forbiddenFields) {
            expect(lines.find(l => l.startsWith(forbidden.toUpperCase()))).toBeUndefined();
        }
    });
});
