// @vitest-environment happy-dom
import {apiCompatibility} from '../../.generated/api/v1/policy.mjs';
import {afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
import {flushPromises} from '@vue/test-utils';
import {createPilotApp, initializePilotApp} from '../../src/frontend/app/createApp';
import {render} from '../../src/frontend/app/entry-server';
import type {components} from '../../src/types/api/v1';

const session: components['schemas']['SessionView'] & {context: string; csrfToken: string} = {kind: 'anonymous',
    deployment: {buildId: 'route-fixture', apiCompatibility},
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

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    sessionStorage.clear();
    document.body.innerHTML = '';
});

const firstList = '22222222-2222-4222-8222-222222222222';
const secondList = '33333333-3333-4333-8333-333333333333';
const firstPacking = `/frontend-pilot/packing/${firstList}`;

/** Keep the real SSR tree, initialization, router, admission, validation and
 * update coordinator. Only HTTP and the final document reload are substituted;
 * mounting is essential because denial retires bootstrap during component setup. */
async function mountedDenial(initial: boolean) {
    const state = {denied: true, session};
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {});
    const request = vi.fn(readProjection);

    async function readProjection(input: RequestInfo | URL): Promise<Response> {
        const path = new URL((input as Request).url).pathname;
        let value: unknown;
        if (path === '/api/v1/session') value = state.session;
        else if (path.endsWith('/entry')) {
            value = {entry: state.denied && path.includes(firstList)
                ? {kind: 'denied', status: 404, messageKey: 'packing.notFound'} : {kind: 'render'}, guest: null};
        } else if (path.startsWith('/api/v1/packing-lists/')) {
            const id = path.includes(secondList) ? secondList : firstList;
            value = {entityType: 'packing', id, title: `Admitted ${id}`, description: null,
                headerUrl: null, headerVersion: null, orderToken: '"order"', currentEventId: null, currentEventUrl: null,
                archived: false, inheritedArchived: false,
                capabilities: {editTitle: false, editDescription: false, selfAssign: false, addItem: false,
                    reorder: false, manageSettings: false}, counters: {participants: 0, open: 0, empty: 0}, items: []};
        } else throw new Error(`Unexpected mounted-denial read: ${path}`);
        return new Response(JSON.stringify(value), {headers: {'Content-Type': 'application/json',
            'X-Surveyor-Context': state.session.context}});
    }

    const path = initial ? firstPacking : '/frontend-pilot/home';
    const rendered = await render(path, {session, ...(initial ? {packingError: 'packing.notFound' as const} : {})});
    const host = document.createElement('div');
    host.innerHTML = rendered.html;
    document.body.append(host);
    window.history.replaceState({}, '', path);
    vi.stubGlobal('fetch', request);
    const application = createPilotApp(JSON.parse(rendered.state), true);
    await application.router.isReady();
    const stop = await initializePilotApp(application, host);
    cleanups.push(async function disposeMountedDenial(): Promise<void> {
        application.app.unmount();
        stop();
        application.router.options.history.destroy();
        await application.context.queryClient.cancelQueries();
    });
    if (!initial) await application.router.push(firstPacking);
    await flushPromises();
    return {host, application, state, reload, request};
}

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

describe('mounted static admission and automatic document replacement', () => {
    it.each([true, false])('preserves a readable denial after bootstrap retirement (initial=%s)', async initial => {
        const {host, application, reload} = await mountedDenial(initial);
        const {context, router} = application;
        expect(host.textContent).toContain(context.messages.value.t('packing.notFound'));
        expect(host.querySelector('[data-pilot-initial-loading]')).toBeNull();
        expect(context.initialDocumentFor(firstPacking)).toBeUndefined();
        expect(context.requiresClientInitialization(router.currentRoute.value)).toBe(false);

        context.updates.observe({...session.deployment, buildId: 'mounted-replacement'});
        await flushPromises();
        context.updates.chunkFailed();
        await flushPromises();
        expect(reload).not.toHaveBeenCalled();
        expect(context.updates.requestReload()).toBe(false);

        // Static classification limits automatic recovery only. Existing draft or
        // unresolved-command guards still protect a deliberate recovery attempt.
        const releaseGuard = context.updates.registerGuard(() => false);
        expect(context.updates.requestRecoveryReload()).toBe(false);
        releaseGuard();
        expect(context.updates.requestRecoveryReload()).toBe(true);
        expect(reload).toHaveBeenCalledOnce();
    });

    it('restores dynamic eligibility only after fresh mounted render admission', async () => {
        const {host, application, state, reload} = await mountedDenial(true);
        const {context, router} = application;
        context.updates.observe({...session.deployment, buildId: 'restored-replacement'});
        await flushPromises();
        expect(reload).not.toHaveBeenCalled();
        state.denied = false;
        await context.queryClient.refetchQueries({type: 'active'});
        await flushPromises();
        await vi.waitFor(() => expect(host.textContent).toContain(`Admitted ${firstList}`));
        expect(context.hasStaticPageOutcome(router.currentRoute.value)).toBe(false);
        expect(context.updates.requestReload()).toBe(true);
        expect(reload).toHaveBeenCalledOnce();
    });

    it('does not let one resource denial classify a later admitted resource', async () => {
        const {host, application, reload} = await mountedDenial(true);
        const {context, router} = application;
        await router.push(`/frontend-pilot/packing/${secondList}`);
        await flushPromises();
        await vi.waitFor(() => expect(host.textContent).toContain(`Admitted ${secondList}`));
        expect(host.textContent).not.toContain(context.messages.value.t('packing.notFound'));
        context.updates.observe({...session.deployment, buildId: 'next-resource-replacement'});
        await flushPromises();
        expect(reload).toHaveBeenCalledOnce();
    });

    it('retires the denied actor before admitting a replacement session at the same URL', async () => {
        const {host, application, state, reload} = await mountedDenial(true);
        const {context, router} = application;
        state.denied = false;
        state.session = {...session, context: 'replacement-actor-context'};
        context.invalidateIdentity();
        await context.refreshSession();
        await flushPromises();
        await vi.waitFor(() => expect(host.textContent).toContain(`Admitted ${firstList}`));
        expect(context.hasStaticPageOutcome(router.currentRoute.value)).toBe(false);
        context.updates.observe({...session.deployment, buildId: 'next-actor-replacement'});
        await flushPromises();
        expect(reload).toHaveBeenCalledOnce();
    });
});
