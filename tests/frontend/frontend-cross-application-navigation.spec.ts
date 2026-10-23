// @vitest-environment happy-dom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {flushPromises, mount} from '@vue/test-utils';
import type {Component} from 'vue';
import {createMemoryHistory, createRouter} from 'vue-router';
import {VueQueryPlugin} from '@tanstack/vue-query';
import I18NextVue from 'i18next-vue';
import type {components} from '../../src/types/api/v1';
import {pilotRoutes} from '../../src/frontend/app/createApp';
import {createPilotContext, pilotContextKey} from '../../src/frontend/app/context';
import AppHeader from '../../src/frontend/components/AppHeader.vue';
import EntityHeader from '../../src/frontend/components/EntityHeader.vue';
import OverviewRegion from '../../src/frontend/features/overview/OverviewRegion.vue';
import EventSummary from '../../src/frontend/features/event/EventSummary.vue';
import {createFrontendEventSession, createFrontendEventView, frontendEventId} from '../factories/frontendEventFactory';

const session = createFrontendEventSession();
const resourceId = '22222222-2222-4222-8222-222222222222';
const familyCases = [
    {type: 'packing', header: 'packing-lists'},
    {type: 'event', header: 'events'},
    {type: 'drivers', header: 'drivers-lists'},
    {type: 'survey', header: 'surveys'},
    {type: 'activity', header: 'activity-plans'},
] as const;
const cards: components['schemas']['OverviewCard'][] = familyCases.map(({type}) => ({
    id: resourceId, type, title: `Admitted ${type}`, description: null,
    url: `/frontend-pilot/${type}/${resourceId}`, headerUrl: null, headerVersion: 'header-version',
    eventContext: type === 'packing' || type === 'drivers' || type === 'activity'
        ? {title: 'Admitted parent', url: `/frontend-pilot/event/${frontendEventId}`} : null,
    children: null, archived: false, inheritedArchived: false, visibility: 'default', overviewHidden: false,
    capabilities: {archive: false, restore: false, duplicate: true, remove: false},
}));
const region: components['schemas']['OverviewRegion'] = {collection: 'owner', region: 'main', q: '',
    type: 'all', availableTypes: familyCases.map(value => value.type), page: 1, childPage: 1, eventId: null,
    pageSize: 12, totalEntities: 5, hiddenEntities: 0, regionEntities: 5, matchingEntities: 5,
    totalCards: 5, totalChildren: 0, hasPrevious: false, hasNext: false, parent: null, items: cards};
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
});

/** Mount a real link consumer against the production route declarations. This
 * client-layer fixture supplies only HTTP; it neither substitutes destination
 * modules nor claims their integrated server admission/persistence behavior. */
async function visit(component: Component, props: Record<string, unknown> = {}, path = '/frontend-pilot/users/dashboard') {
    const requests: Request[] = [];
    const send = vi.fn(async function serveAdmittedProjection(input: RequestInfo | URL): Promise<Response> {
        const request = input as Request;
        requests.push(request);
        const target = new URL(request.url);
        // Mixed cards select their real feature image adapters. The test replaces
        // binary delivery only, keeping each adapter's actor/version lifecycle.
        if (target.pathname.endsWith('/header')) return new Response(new Blob(['image'], {type: 'image/png'}), {
            headers: {'Content-Type': 'image/png', 'X-Surveyor-Context': session.context},
        });
        if (target.pathname === '/api/v1/overview') return new Response(JSON.stringify(region), {
            headers: {'Content-Type': 'application/json', 'X-Surveyor-Context': session.context},
        });
        throw new Error(`Unexpected navigation-fixture request: ${request.method} ${target.pathname}`);
    });
    const context = createPilotContext({session, initialUrl: path}, true, send);
    context.hydrated.value = true;
    context.visible.value = true;
    const router = createRouter({history: createMemoryHistory(), routes: [...pilotRoutes]});
    await router.push(path);
    const wrapper = mount(component, {props, attachTo: document.body, global: {
        plugins: [router, [VueQueryPlugin, {queryClient: context.queryClient}], [I18NextVue, {i18next: context.i18next}]],
        provide: {[pilotContextKey as symbol]: context},
    }});
    await flushPromises();

    // The host remains mounted to exercise its outgoing links independently of
    // target rendering. Application E2E owns that full destination workflow.
    cleanups.push(async function retireNavigationFixture(): Promise<void> {
        wrapper.unmount();
        await context.queryClient.cancelQueries();
        context.queryClient.clear();
        router.options.history.destroy();
    });
    return {wrapper, router, context, requests};
}

describe('cross-application production navigation', {timeout: 30_000}, () => {
    it('connects every shell creation and account administration link to its real route module', async () => {
        const {wrapper, router, requests} = await visit(AppHeader);
        const origin = document.documentElement;
        const destinations = [
            ...familyCases.map(({type}) => `/frontend-pilot/${type}/create`),
            '/frontend-pilot/users/profile', '/frontend-pilot/users/profile/manage', '/frontend-pilot/users/account/delete',
        ];
        for (const destination of destinations) {
            const link = wrapper.get(`a[href="${destination}"]`);
            await link.trigger('click');
            await vi.waitFor(() => expect(router.currentRoute.value.path).toBe(destination), {timeout: 10_000});
            // A catch-all also accepts a URL, but supplies no working journey.
            // Confirm the ordinary click resolved a feature module, not that fallback.
            expect(router.currentRoute.value.matched.at(-1)?.path).toBe(destination);
            expect(document.documentElement).toBe(origin);
            await router.push('/frontend-pilot/users/dashboard');
        }
        expect(requests).toEqual([]);
    });

    it('uses the real mixed-family card caller for every detail, duplicate and authorized header', async () => {
        vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:authorized-card');
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
        const {wrapper, router, requests} = await visit(OverviewRegion, {collection: 'owner', region: 'main'});
        await vi.waitFor(() => expect(wrapper.findAll('article.card')).toHaveLength(5));

        for (const {type, header} of familyCases) {
            const card = wrapper.get(`article[data-type="${type}"]`);
            const detail = `/frontend-pilot/${type}/${resourceId}`;
            await vi.waitFor(() => expect(requests.some(request => new URL(request.url).pathname
                === `/api/v1/${header}/${resourceId}/header`)).toBe(true));
            expect(card.get('img').attributes('src')).toBe('blob:authorized-card');

            await card.get(`a.card-body[href="${detail}"]`).trigger('click');
            await vi.waitFor(() => expect(router.currentRoute.value.path).toBe(detail), {timeout: 10_000});
            expect(router.currentRoute.value.matched.at(-1)?.path).toBe(
                `/frontend-pilot/${type}/:${type === 'event' ? 'eventId' : type === 'survey' ? 'surveyId' : type === 'activity' ? 'planId' : 'listId'}`);

            await router.push('/frontend-pilot/users/dashboard');
            await card.get(`a[href="${detail}/duplicate"]`).trigger('click');
            await vi.waitFor(() => expect(router.currentRoute.value.path).toBe(detail + '/duplicate'), {timeout: 10_000});
            expect(router.currentRoute.value.matched.at(-1)?.path).toContain('/duplicate');
            await router.push('/frontend-pilot/users/dashboard');
        }
        // Link clicks perform no document form submission or feature command.
        expect(requests.every(request => request.method === 'GET')).toBe(true);
    });

    it('keeps admitted parent links navigable from every child card and the responsive header', async () => {
        vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:authorized-card');
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
        const parent = `/frontend-pilot/event/${frontendEventId}`;
        const overview = await visit(OverviewRegion, {collection: 'owner', region: 'main'});
        await vi.waitFor(() => expect(overview.wrapper.findAll('article.card')).toHaveLength(5));
        for (const type of ['packing', 'drivers', 'activity']) {
            const link = overview.wrapper.get(`article[data-type="${type}"] a[href="${parent}"]`);
            const modified = new MouseEvent('click', {bubbles: true, cancelable: true, ctrlKey: true});
            link.element.dispatchEvent(modified);
            await flushPromises();
            expect(modified.defaultPrevented).toBe(false);
            expect(overview.router.currentRoute.value.path).toBe('/frontend-pilot/users/dashboard');
            await link.trigger('click');
            await vi.waitFor(() => expect(overview.router.currentRoute.value.path).toBe(parent), {timeout: 10_000});
            await overview.router.push('/frontend-pilot/users/dashboard');
        }

        const readImage = vi.fn();
        const header = await visit(EntityHeader, {resourceId, title: 'Child title', icon: 'bi-bag',
            imageVersion: null, imageQueryKey: ['child-header'], readImage, parentUrl: parent});
        const links = header.wrapper.findAll(`a[href="${parent}"]`);
        expect(links).toHaveLength(1);
        for (const link of links) {
            await link.trigger('click');
            await vi.waitFor(() => expect(header.router.currentRoute.value.path).toBe(parent), {timeout: 10_000});
            expect(header.router.currentRoute.value.matched.at(-1)?.path).toBe('/frontend-pilot/event/:eventId');
            await header.router.push('/frontend-pilot/users/dashboard');
        }
        expect(readImage).not.toHaveBeenCalled();
    });

    it('uses the shared Event summary to enter and leave the admitted organizer page', async () => {
        const view = createFrontendEventView();
        view.capabilities.admin = true;
        const {wrapper, router, requests} = await visit(EventSummary, {event: view});
        await wrapper.get('a').trigger('click');
        await vi.waitFor(() => expect(router.currentRoute.value.path).toBe(`/frontend-pilot/event/${view.id}/admin`), {timeout: 10_000});
        expect(router.currentRoute.value.matched.at(-1)?.path).toBe('/frontend-pilot/event/:eventId/admin');
        await wrapper.setProps({admin: true});
        await wrapper.get('a').trigger('click');
        await vi.waitFor(() => expect(router.currentRoute.value.path).toBe(`/frontend-pilot/event/${view.id}`), {timeout: 10_000});
        expect(router.currentRoute.value.matched.at(-1)?.path).toBe('/frontend-pilot/event/:eventId');
        expect(requests).toEqual([]);
    });
});
