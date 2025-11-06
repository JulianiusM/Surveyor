/**
 * Unit tests for src/modules/settings.ts
 * - Mocks `node:fs` with an in-memory store
 * - Mocks `node:crypto.randomBytes` to make sessionSecret deterministic
 * - Verifies read() bootstrap, coercions, unknown keys, comma handling, and write() output
 */
import type {Settings} from '../../src/modules/settings';

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
    const FILE = '/settings.csv';

    beforeEach(() => {
        memfs.__reset();
        jest.restoreAllMocks();
    });

    test('read() bootstraps file when missing and sets initialized', async () => {
        const spyWriteLog = jest.spyOn(console, 'log').mockImplementation(() => {
        });
        const {SettingsStore} = await loadModule();
        const store = new SettingsStore();

        const before = store.value;
        expect(before.initialized).toBe(false);
        // Point the store at our fake path
        (store.value as any).file = FILE;

        await store.read(); // file missing -> write defaults

        const after = store.value;
        expect(after.initialized).toBe(true);
        expect(memfs.existsSync(FILE)).toBe(true);
        // sessionSecret is deterministic due to crypto mock
        expect(after.sessionSecret.startsWith('CHANGE__')).toBe(true);
        expect(after.sessionSecret.length).toBeGreaterThan('CHANGE__'.length);

        // write() logs once
        expect(spyWriteLog).toHaveBeenCalled();
    });

    test('read() parses CSV, coerces types, handles unknown keys & commas', async () => {
        const spyWarn = jest.spyOn(console, 'warn').mockImplementation(() => {
        });
        const {SettingsStore} = await loadModule();
        const store = new SettingsStore();
        (store.value as any).file = FILE;

        // Prepare CSV; commas after first comma are preserved
        const csv = [
            'ROOT_URL,http://x.example.com',
            'DB_PORT,3310',
            'APP_PORT,9001',
            'SMTP_POOL,yes',
            'SMTP_SECURE,0',
            'LOCAL_LOGIN_ENABLED,On',
            'OIDC_ENABLED,TRUE',
            'SMTP_EMAIL,user,with,comma@example.com',
            'FOO_BAR,should_warn', // unknown key
        ].join('\n') + '\n';
        memfs.__set(FILE, csv);

        await store.read();

        const s = store.value as Settings;
        expect(s.initialized).toBe(true);
        expect(s.rootUrl).toBe('http://x.example.com');
        expect(s.dbPort).toBe(3310);
        expect(s.appPort).toBe(9001);
        expect(s.smtpPool).toBe(true);
        expect(s.smtpSecure).toBe(false);
        expect(s.localLoginEnabled).toBe(true);
        expect(s.oidcEnabled).toBe(true);
        expect(s.smtpEmail).toBe('user,with,comma@example.com');

        expect(spyWarn).toHaveBeenCalled(); // unknown key warning
    });

    test('write() emits only CSV-known keys and matches current state', async () => {
        const {SettingsStore} = await loadModule();
        const store = new SettingsStore();
        (store.value as any).file = FILE;

        // mutate some values
        Object.assign(store.value, {
            rootUrl: 'http://changed:1234',
            dbHost: 'db.example',
            dbPort: 3307,
            dbUser: 'alice',
            dbPassword: 'secret',
            dbName: 'testdb',
            smtpPool: false,
            smtpHost: 'smtp.local',
            smtpPort: 2525,
            smtpSecure: false,
            smtpEmail: 'ci@example.com',
            smtpUser: 'mailer',
            smtpPassword: 'pw',
            oidcEnabled: true,
            oidcName: 'ExampleOIDC',
            oidcClientId: 'client',
            oidcClientSecret: 'client-secret',
            oidcIssuerBaseUrl: 'http://issuer',
            oidcRedirectUrl: 'http://app/cb',
            localLoginEnabled: false,
            sessionSecret: 'CHANGE__DETERMINISTIC',
            appPort: 7777,
            // fields not in CSV should be skipped by write (initialized, file)
            initialized: true,
            file: FILE,
        });

        await store.write(FILE);

        const written = memfs.__get(FILE)!;
        const lines = written.trim().split(/\r?\n/);

        // Ensure some sample lines exist and match new values
        expect(lines).toEqual(expect.arrayContaining([
            'ROOT_URL,http://changed:1234',
            'DB_HOST,db.example',
            'DB_PORT,3307',
            'DB_USER,alice',
            'DB_PASSWORD,secret',
            'DB_NAME,testdb',
            'SMTP_POOL,false',
            'SMTP_HOST,smtp.local',
            'SMTP_PORT,2525',
            'SMTP_SECURE,false',
            'SMTP_EMAIL,ci@example.com',
            'SMTP_USER,mailer',
            'SMTP_PASSWORD,pw',
            'OIDC_ENABLED,true',
            'OIDC_NAME,ExampleOIDC',
            'OIDC_CLIENT_ID,client',
            'OIDC_CLIENT_SECRET,client-secret',
            'OIDC_ISSUER_BASE_URL,http://issuer',
            'OIDC_REDIRECT_URL,http://app/cb',
            'LOCAL_LOGIN_ENABLED,false',
            'SESSION_SECRET,CHANGE__DETERMINISTIC',
            'APP_PORT,7777',
        ]));

        // Ensure non-CSV fields were NOT written
        for (const forbidden of ['initialized', 'file']) {
            expect(lines.find(l => l.startsWith(forbidden.toUpperCase()))).toBeUndefined();
        }
    });
});
