// @vitest-environment happy-dom
import {afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
import {createPilotApp} from '../../src/frontend/app/createApp';
import type {components} from '../../src/types/api/v1';

const session: components['schemas']['SessionView'] = {kind: 'anonymous',
    deployment: {buildId: 'route-fixture', apiCompatibility: 'v1-pilot-2026-10-07'},
    context: 'route-fixture-context', csrfToken: 'route-fixture-csrf', locale: 'en',
    activeProfile: null, profiles: [], loginUrl: '/users/login', logoutUrl: null,
    shell: {version: 'fixture', imprintUrl: '/imprint', privacyPolicyUrl: '/privacy',
        localLoginEnabled: true, oidcEnabled: false, oidcName: 'Provider'}};

// These checks measure the real route policy and recovery lifecycle, not cold
// test-runner SFC transformation. Prepare the actual graphs under the existing
// bounded setup convention; browser chunk-failure tests retain lazy HTTP delivery.
beforeAll(async function prepareRouteComponents(): Promise<void> {
    await Promise.all([
        import('../../src/frontend/features/help/HelpPage.vue'),
        import('../../src/frontend/features/packing/PackingEntry.vue'),
        import('../../src/frontend/features/packing/PackingCreatePage.vue'),
        import('../../src/frontend/features/identity/IdentityPage.vue'),
        import('../../src/frontend/features/identity/ProfileAdministrationPage.vue'),
        import('../../src/frontend/features/identity/ProfileWorkflowPage.vue'),
        import('../../src/frontend/features/overview/OverviewPage.vue'),
        import('../../src/frontend/features/common/LandingPage.vue'),
    ]);
}, 30_000);

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
            // Help requires deliberate recovery even when clean. That explicit
            // action must still consult the retained editor's discard guard.
            expect(context.updates.requestRecoveryReload()).toBe(false);
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

describe('dynamic-content automatic document replacement', () => {
    const packing = '/frontend-pilot/packing/22222222-2222-4222-8222-222222222222';

    it.each([
        '/frontend-pilot/packing/create', `${packing}/duplicate`, `${packing}/guest`,
        '/frontend-pilot/users/profile', '/frontend-pilot/users/profile/manage',
        '/frontend-pilot/users/profile/create', '/frontend-pilot/users/profile/migrate/request',
        '/frontend-pilot/users/login', '/frontend-pilot/help', '/frontend-pilot/home',
        '/frontend-pilot/message', '/frontend-pilot/missing-page',
    ])('keeps static %s during startup and release changes while allowing deliberate recovery', async path => {
        window.history.replaceState({}, '', path);
        const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {});
        const application = createPilotApp({session, initialUrl: path}, true);
        const {router, context} = application;
        try {
            // Dispatch before the first route commits: policy must already know
            // this URL without waiting for a feature to mount or register a guard.
            context.updates.chunkFailed();
            await Promise.resolve();
            expect(reload).not.toHaveBeenCalled();
            await router.isReady();
            context.updates.observe({...session.deployment, buildId: 'replacement'});
            await Promise.resolve();
            expect(context.updates.available.value).toBe(true);
            expect(reload).not.toHaveBeenCalled();
            expect(context.updates.requestRecoveryReload()).toBe(true);
            expect(reload).toHaveBeenCalledOnce();
        } finally {
            router.options.history.destroy();
            context.start()();
        }
    });

    it.each(['/frontend-pilot', packing])('retains one guarded automatic startup recovery for dynamic %s', async path => {
        window.history.replaceState({}, '', path);
        const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {});
        const {router, context} = createPilotApp({session, initialUrl: path}, true);
        try {
            context.updates.chunkFailed();
            await Promise.resolve();
            expect(reload).toHaveBeenCalledOnce();
            expect(context.updates.requestReload()).toBe(false);
            await router.isReady();
        } finally {
            router.options.history.destroy();
            context.start()();
        }
    });

    it('keeps an admitted static error document at an otherwise dynamic URL', async () => {
        window.history.replaceState({}, '', packing);
        const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {});
        const {router, context} = createPilotApp({session, initialUrl: packing, packingError: 'packing.notFound'}, true);
        try {
            context.updates.chunkFailed();
            await Promise.resolve();
            await router.isReady();
            context.updates.observe({...session.deployment, buildId: 'replacement'});
            await Promise.resolve();
            expect(reload).not.toHaveBeenCalled();
            expect(context.updates.requestRecoveryReload()).toBe(true);
        } finally {
            router.options.history.destroy();
            context.start()();
        }
    });

    it('uses the committed visit instead of retaining the initial dynamic classification', async () => {
        window.history.replaceState({}, '', packing);
        const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {});
        const {router, context} = createPilotApp({session, initialUrl: packing}, true);
        try {
            await router.isReady();
            await router.push('/frontend-pilot/users/profile/migrate/request');
            context.updates.observe({...session.deployment, buildId: 'replacement'});
            await Promise.resolve();
            expect(reload).not.toHaveBeenCalled();
            await router.push('/frontend-pilot/help');
            expect(context.updates.requestReload()).toBe(false);

            // Returning to live collaborative content can recover the already
            // detected release. Static visits did not consume its loop marker.
            await router.push('/frontend-pilot');
            expect(context.updates.requestReload()).toBe(true);
            expect(reload).toHaveBeenCalledOnce();
        } finally {
            router.options.history.destroy();
            context.start()();
        }
    });

    it('blocks automatic replacement while history points at a static target before route commitment', async () => {
        window.history.replaceState({}, '', packing);
        const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {});
        const {router, context} = createPilotApp({session, initialUrl: packing}, true);
        try {
            await router.isReady();
            // Exercise the real history boundary independently of route commitment.
            // Back/Forward exposes this same address mismatch while asynchronous
            // admission or a lazy component is still pending. Reload would use
            // the static target's GET, rather than the visible source list's URL.
            const target = '/frontend-pilot/users/profile/migrate/request';
            router.options.history.replace(target);
            expect(router.currentRoute.value.path).toBe(packing);
            expect(router.options.history.location).toBe(target);
            context.updates.observe({...session.deployment, buildId: 'replacement'});
            await Promise.resolve();
            expect(reload).not.toHaveBeenCalled();
            expect(context.updates.requestReload()).toBe(false);

            await router.push(target);
            expect(context.updates.requestReload()).toBe(false);
            expect(context.updates.requestRecoveryReload()).toBe(true);
            expect(reload).toHaveBeenCalledOnce();
        } finally {
            router.options.history.destroy();
            context.start()();
        }
    });
});
