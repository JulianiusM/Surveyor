import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {SettingsStore} from '../../src/backend/modules/settings';

const directories: string[] = [];

/** Read only this test's CSV while the existing settings owner applies its normal overlay. */
async function readSettings(csv: string): Promise<SettingsStore> {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'surveyor-oidc-settings-'));
    directories.push(directory);
    const filename = path.join(directory, 'settings.csv');
    await writeFile(filename, csv);
    const settings = new SettingsStore();
    await settings.read(filename);
    return settings;
}

afterEach(async function restoreSettingsEnvironment() {
    vi.unstubAllEnvs();
    for (const directory of directories.splice(0)) await rm(directory, {recursive: true, force: true});
});

describe('operator-controlled OIDC email trust', () => {
    it('starts with automatic linking and binding replacement disabled', () => {
        const settings = new SettingsStore();
        expect(settings.value.oidcLinkByEmail).toBe(false);
        expect(settings.value.oidcAllowEmailRebinding).toBe(false);
    });

    it('reads explicit CSV opt-ins through the existing boolean setting convention', async () => {
        vi.stubEnv('NODE_ENV', 'test');
        vi.stubEnv('SETTINGS_FILE', '');
        vi.stubEnv('OIDC_LINK_BY_EMAIL', '');
        vi.stubEnv('OIDC_ALLOW_EMAIL_REBINDING', '');
        const settings = await readSettings('OIDC_LINK_BY_EMAIL,true\nOIDC_ALLOW_EMAIL_REBINDING,on\n');
        expect(settings.value.oidcLinkByEmail).toBe(true);
        expect(settings.value.oidcAllowEmailRebinding).toBe(true);
    });

    it('lets explicit environment values override CSV without conflating the two switches', async () => {
        vi.stubEnv('NODE_ENV', 'test');
        vi.stubEnv('SETTINGS_FILE', '');
        vi.stubEnv('OIDC_LINK_BY_EMAIL', '0');
        vi.stubEnv('OIDC_ALLOW_EMAIL_REBINDING', 'yes');
        const settings = await readSettings('OIDC_LINK_BY_EMAIL,true\nOIDC_ALLOW_EMAIL_REBINDING,false\n');
        expect(settings.value.oidcLinkByEmail).toBe(false);
        expect(settings.value.oidcAllowEmailRebinding).toBe(true);
    });

    it('preserves E2E-prefixed precedence over ordinary environment values', async () => {
        vi.stubEnv('NODE_ENV', 'e2e');
        vi.stubEnv('SETTINGS_FILE', '');
        vi.stubEnv('OIDC_LINK_BY_EMAIL', 'false');
        vi.stubEnv('OIDC_ALLOW_EMAIL_REBINDING', 'true');
        vi.stubEnv('E2E_OIDC_LINK_BY_EMAIL', '1');
        vi.stubEnv('E2E_OIDC_ALLOW_EMAIL_REBINDING', '0');
        vi.stubEnv('E2E_DB_NAME', 'surveyor_e2e');
        const settings = await readSettings('OIDC_LINK_BY_EMAIL,false\nOIDC_ALLOW_EMAIL_REBINDING,true\n');
        expect(settings.value.oidcLinkByEmail).toBe(true);
        expect(settings.value.oidcAllowEmailRebinding).toBe(false);
    });
});

describe('configured production bounds', () => {
    it('uses the existing CSV, environment and E2E precedence for duration and shared login budgets', async () => {
        vi.stubEnv('NODE_ENV', 'e2e');
        vi.stubEnv('SETTINGS_FILE', '');
        vi.stubEnv('E2E_DB_NAME', 'surveyor_e2e');
        vi.stubEnv('ACTIVITY_MAX_DURATION_DAYS', '120');
        vi.stubEnv('E2E_ACTIVITY_MAX_DURATION_DAYS', '42');
        vi.stubEnv('AUTH_LOGIN_FAILURE_CLIENT_LIMIT', '7');
        const settings = await readSettings('ACTIVITY_MAX_DURATION_DAYS,730\nAUTH_LOGIN_FAILURE_CLIENT_LIMIT,9\n');
        expect(settings.value.activityMaxDurationDays).toBe(42);
        expect(settings.value.authLoginFailureClientLimit).toBe(7);
        // A client failure counter is distinct from the account protection, but
        // both read this one settings owner rather than copying defaults in routes.
        expect(settings.value.authLoginAccountLimit).toBe(10);
    });

    it.each([
        ['ACTIVITY_MAX_DURATION_DAYS', '0'],
        ['ACTIVITY_MAX_DURATION_DAYS', '1.5'],
        ['AUTH_LOGIN_CLIENT_LIMIT', '-1'],
        ['AUTH_MAIL_RECIPIENT_LIMIT', 'not-a-number'],
        ['AUTH_GUEST_CREATION_CLIENT_LIMIT', '9007199254740992'],
        ['AUTH_LOGIN_WINDOW_MINUTES', '40000'],
    ])('rejects unusable %s configuration before admission becomes ready', async (key, value) => {
        vi.stubEnv('NODE_ENV', 'test');
        vi.stubEnv('SETTINGS_FILE', '');
        vi.stubEnv(key, value);
        await expect(readSettings('APP_NAME,Bounded settings fixture\n')).rejects.toThrow(key);
    });
});
