// @vitest-environment happy-dom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {createPilotApp} from '../../src/frontend/app/createApp';
import type {components} from '../../src/types/api/v1';

const session: components['schemas']['SessionView'] = {kind: 'anonymous',
    deployment: {buildId: 'route-fixture', apiCompatibility: 'v1-pilot-2026-10-07'},
    context: 'route-fixture-context', csrfToken: 'route-fixture-csrf', locale: 'en',
    activeProfile: null, profiles: [], loginUrl: '/users/login', logoutUrl: null,
    shell: {version: 'fixture', imprintUrl: '/imprint', privacyPolicyUrl: '/privacy',
        localLoginEnabled: true, oidcEnabled: false, oidcName: 'Provider'}};

afterEach(() => { vi.restoreAllMocks(); sessionStorage.clear(); });

describe('retired route module recovery', () => {
    it.each([
        'error loading dynamically imported module: https://example.invalid/app/assets/HelpPage-old.js',
        'Failed to fetch dynamically imported module: https://example.invalid/app/assets/HelpPage-old.js',
        'Importing a module script failed.',
    ])('keeps the current route and its edit guard after %s', async message => {
        window.history.replaceState({}, '', '/frontend-pilot/help');
        const {router, context} = createPilotApp({session}, true);
        const failure = new TypeError(message);
        router.addRoute({path: '/frontend-pilot/unavailable-fixture', component: () => Promise.reject(failure)});
        const editMayBeDiscarded = vi.fn(() => false);
        context.updates.registerGuard(editMayBeDiscarded);
        try {
            await router.push('/frontend-pilot/help');
            await expect(router.push('/frontend-pilot/unavailable-fixture')).rejects.toBe(failure);
            await Promise.resolve();
            expect(router.currentRoute.value.path).toBe('/frontend-pilot/help');
            expect(context.updates.available.value).toBe(true);
            expect(context.updates.requestReload()).toBe(false);
            expect(editMayBeDiscarded).toHaveBeenCalled();
        } finally {
            router.options.history.destroy();
            context.start()();
        }
    });

    it('keeps ordinary route bugs visible without suggesting a release reload', async () => {
        window.history.replaceState({}, '', '/frontend-pilot/help');
        const {router, context} = createPilotApp({session}, true);
        const failure = new TypeError('Cannot read properties of undefined');
        router.addRoute({path: '/frontend-pilot/broken-fixture', component: () => Promise.reject(failure)});
        try {
            await router.push('/frontend-pilot/help');
            await expect(router.push('/frontend-pilot/broken-fixture')).rejects.toBe(failure);
            expect(context.updates.available.value).toBe(false);
        } finally {
            router.options.history.destroy();
            context.start()();
        }
    });
});
