import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {SettingsStore} from '../../src/backend/modules/settings';

const directories: string[] = [];

/** Read only this test's CSV while the existing settings owner applies its normal overlay. */
async function readOidcSettings(csv: string): Promise<SettingsStore> {
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
        const settings = await readOidcSettings('OIDC_LINK_BY_EMAIL,true\nOIDC_ALLOW_EMAIL_REBINDING,on\n');
        expect(settings.value.oidcLinkByEmail).toBe(true);
        expect(settings.value.oidcAllowEmailRebinding).toBe(true);
    });

    it('lets explicit environment values override CSV without conflating the two switches', async () => {
        vi.stubEnv('NODE_ENV', 'test');
        vi.stubEnv('SETTINGS_FILE', '');
        vi.stubEnv('OIDC_LINK_BY_EMAIL', '0');
        vi.stubEnv('OIDC_ALLOW_EMAIL_REBINDING', 'yes');
        const settings = await readOidcSettings('OIDC_LINK_BY_EMAIL,true\nOIDC_ALLOW_EMAIL_REBINDING,false\n');
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
        const settings = await readOidcSettings('OIDC_LINK_BY_EMAIL,false\nOIDC_ALLOW_EMAIL_REBINDING,true\n');
        expect(settings.value.oidcLinkByEmail).toBe(true);
        expect(settings.value.oidcAllowEmailRebinding).toBe(false);
    });
});
