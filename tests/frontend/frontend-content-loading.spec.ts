// @vitest-environment happy-dom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {mount} from '@vue/test-utils';
import {flushFrontendPromises as flushPromises} from '../keywords/frontendUiKeywords';
import {defineComponent} from 'vue';
import {createMemoryHistory, createRouter} from 'vue-router';
import {VueQueryPlugin} from '@tanstack/vue-query';
import I18NextVue from 'i18next-vue';
import {createFrontendContext, frontendContextKey} from '../../src/frontend/app/context';
import {render} from '../../src/frontend/app/entry-server';
import LoadingSkeleton from '../../src/frontend/components/LoadingSkeleton.vue';
import HelpPage from '../../src/frontend/features/help/HelpPage.vue';
import OverviewPage from '../../src/frontend/features/overview/OverviewPage.vue';
import type {components} from '../../src/types/api/v1';
import type {FrontendBootstrap} from '../../src/types/FrontendTypes';
import type {FrontendLoadingSkeleton} from '../../src/types/FrontendUiTypes';
import {apiCompatibility} from '../../.generated/api/v1/policy.mjs';

// These real lazy-route modules are dependencies of the SSR assertions below.
// Compile them during ordinary test collection, rather than charging unrelated
// route compilation to one suite hook. Each assertion still resolves its actual
// production route and renders a fresh application without private HTTP reads.
import '../../src/frontend/features/packing/PackingEntry.vue';
import '../../src/frontend/features/packing/PackingCreatePage.vue';
import '../../src/frontend/features/drivers/DriversEntry.vue';
import '../../src/frontend/features/drivers/DriversCreatePage.vue';
import '../../src/frontend/features/event/EventEntry.vue';
import '../../src/frontend/features/event/EventCreatePage.vue';
import '../../src/frontend/features/identity/IdentityPage.vue';
import '../../src/frontend/features/identity/ProfileAdministrationPage.vue';
import '../../src/frontend/features/identity/ProfileWorkflowPage.vue';

type Help = components['schemas']['HelpPageData'];
type Region = components['schemas']['OverviewRegion'];
const profileId = '11111111-1111-4111-8111-111111111111';
const cardId = '33333333-3333-4333-8333-333333333333';
const session: components['schemas']['SessionView'] & {context: string; csrfToken: string} = {
    kind: 'account', context: 'content-loading-context-1234567890', csrfToken: 'content-loading-csrf-1234567890',
    deployment: {buildId: 'fixture', apiCompatibility}, locale: 'en',
    activeProfile: {id: profileId, name: 'Organizer'}, profiles: [{id: profileId, name: 'Organizer'}],
    loginUrl: '/users/login', logoutUrl: '/users/logout', shell: {version: 'fixture', imprintUrl: '/imprint',
        privacyPolicyUrl: '/privacy', localLoginEnabled: true, oidcEnabled: false, oidcName: 'Provider'},
};
const card: components['schemas']['OverviewCard'] = {
    id: cardId, type: 'survey', title: 'Owner authority ready', description: null, url: '/survey/' + cardId,
    headerUrl: null, headerVersion: null, eventContext: null, children: null,
    archived: false, inheritedArchived: false, visibility: 'default', overviewHidden: false,
    capabilities: {archive: false, restore: false, duplicate: false, remove: false},
};
const problem: components['schemas']['Problem'] = {type: 'about:blank', title: 'Rejected', status: 400,
    code: 'VALIDATION_FAILED', detail: 'Review the request.', requestId: 'content-loading-rejection',
    messageKey: 'api:errors.VALIDATION_FAILED', params: {}};
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    document.body.innerHTML = '';
});

function json(value: unknown, status = 200): Response {
    return new Response(JSON.stringify(value), {status, headers: {'Content-Type': 'application/json',
            'X-Surveyor-Context': session.context}});
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(finish => { resolve = finish; });
    return {promise, resolve};
}

/** Synthetic task content protects the application's loading contract without testing maintained prose. */
function article(locale = 'en', text = 'English article authority'): Help {
    return {locale, title: 'Synthetic help', content: `<h2 id="task">${text}</h2>`, currentDoc: 'fixture.md',
        docsList: [], docsGroups: [], toc: []};
}

function region(collection: Region['collection'], items: Region['items'] = [], hidden = 0): Region {
    return {collection, region: 'main', q: '', type: 'all', availableTypes: items.length ? ['survey'] : [],
        page: 1, childPage: 1, eventId: null, pageSize: 24, totalEntities: items.length + hidden, hiddenEntities: hidden,
        regionEntities: items.length, matchingEntities: items.length, totalCards: items.length, totalChildren: 0,
        hasPrevious: false, hasNext: false, parent: null, items};
}

/** Keep real pages, query scheduling, scoped transport, validators and router reuse. Only HTTP is replaced. */
async function mounted(path: string, handler: (request: Request) => Promise<Response>,
    bootstrap: Partial<FrontendBootstrap> = {}) {
    const request = vi.fn((input: RequestInfo | URL) => handler(input as Request));
    const context = createFrontendContext({session, ...bootstrap}, true, request);
    context.hydrated.value = true;
    context.visible.value = true;
    const router = createRouter({history: createMemoryHistory(), routes: [
            {path: '/help', component: HelpPage},
            {path: '/users/dashboard', component: OverviewPage},
        ]});
    await router.push(path);
    await router.isReady();
    const wrapper = mount(defineComponent({template: '<RouterView />'}), {attachTo: document.body, global: {
            plugins: [router, [VueQueryPlugin, {queryClient: context.queryClient}],
                [I18NextVue, {i18next: context.i18next}]],
            provide: {[frontendContextKey as symbol]: context},
        }});
    cleanups.push(async () => {
        wrapper.unmount();
        await context.queryClient.cancelQueries();
        context.start()();
    });
    await flushPromises();
    return {wrapper, context, request, router};
}

/** Geometry stays decorative without mounting feature reads or synthetic controls. */
function mountedSkeleton(props: FrontendLoadingSkeleton & {page?: boolean}) {
    const context = createFrontendContext({session}, false);
    const wrapper = mount(LoadingSkeleton, {props, global: {
            plugins: [[I18NextVue, {i18next: context.i18next}]],
            provide: {[frontendContextKey as symbol]: context},
        }});
    cleanups.push(async () => { wrapper.unmount(); context.start()(); });
    return wrapper;
}

describe('help and overview progressive content', () => {
    it('refreshes and translates healthy Help without owning scroll or releasing the search draft', async () => {
        const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
        let current = {...article(), content: '<h2 id="task">Original task</h2><h2 id="next">Next task</h2>'};
        const {wrapper, router, request, context} = await mounted('/help#task', async () => json(current));
        expect(scroll).not.toHaveBeenCalled();
        const search = wrapper.get<HTMLInputElement>('input[name="q"]');
        await search.setValue('Unsubmitted search');
        current = {...current, title: 'Updated guide', content: '<h2 id="task">Updated task</h2><h2 id="next">Next task</h2>'};
        const before = request.mock.calls.length;
        await wrapper.get('button[aria-label="Refresh"]').trigger('click');
        await flushPromises();

        expect(request.mock.calls).toHaveLength(before + 1);
        expect(wrapper.get('h1').text()).toContain('Updated guide');
        expect(wrapper.get('#task').text()).toBe('Updated task');
        expect(wrapper.get('input[name="q"]').element).toBe(search.element);
        expect(search.element.value).toBe('Unsubmitted search');
        expect(scroll).not.toHaveBeenCalled();
        expect(request.mock.calls.every(([input]) => (input as Request).method === 'GET')).toBe(true);

        // The shared header retains the same anchor when changing the locale
        // query. New translated article authority must not repeat its reveal.
        current = {...current, locale: 'de', title: 'Aktualisierte Anleitung',
            content: '<h2 id="task">Übersetzte Aufgabe</h2><h2 id="next">Nächste Aufgabe</h2>'};
        context.locale.value = 'de';
        await router.replace('/help?locale=de#task');
        await flushPromises();
        expect(wrapper.get('#task').text()).toBe('Übersetzte Aufgabe');
        expect(wrapper.get('h1').text()).toContain('Aktualisierte Anleitung');
        expect(scroll).not.toHaveBeenCalled();

        // This page signals readiness; the application's Router owns the actual
        // anchor/history decision, covered by the integrated browser journey.
        await router.push('/help?locale=de#next');
        await flushPromises();
        expect(wrapper.get('#next').text()).toBe('Nächste Aufgabe');
        expect(scroll).not.toHaveBeenCalled();
    });

    it.each([429, 503])('shows Help read timing and recovers the retained article without navigation or draft loss (%s)', async status => {
        vi.useFakeTimers();
        vi.setSystemTime(Date.UTC(2026, 9, 11, 6, 0, 0));
        let unavailable = true;
        const issue = {type: 'urn:future:read', title: 'Temporary read failure', status,
            detail: 'Please wait before reading this guide again.', requestId: 'help-read-retry'};
        const {wrapper, context, request} = await mounted('/help', async () => unavailable
            ? new Response(JSON.stringify(issue), {status, headers: {'Content-Type': 'application/problem+json',
                    'X-Surveyor-Context': session.context, 'Retry-After': '5'}})
            : json(article()), {initialUrl: '/help', help: article()});
        const content = wrapper.get('.help-content').element;
        const input = wrapper.get<HTMLInputElement>('#frontend-help-search');
        await input.setValue('Help recovery draft');
        input.element.focus();
        await context.queryClient.refetchQueries({type: 'active'});
        await flushPromises();
        const retry = wrapper.findAll('button').find(button => button.text() === context.messages.value.t('common.retry'))!;
        expect(retry.attributes('disabled')).toBeDefined();
        expect(wrapper.get('[data-read-retry-at] time').attributes('datetime')).toBe('2026-10-11T06:00:05.000Z');
        expect(wrapper.get('[data-read-issue]').text()).toBe(issue.detail);
        expect(wrapper.get('[data-last-successful-refresh] time').attributes('datetime')).toBe('2026-10-11T06:00:00.000Z');
        await retry.trigger('click');
        expect(request).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(5001);
        await flushPromises();
        expect(retry.attributes('disabled')).toBeUndefined();
        expect(wrapper.find('[data-read-retry-at]').exists()).toBe(false);
        unavailable = false;
        await retry.trigger('click');
        await flushPromises();
        expect(request).toHaveBeenCalledTimes(2);
        expect(request.mock.calls.every(([read]) => (read as Request).method === 'GET')).toBe(true);
        expect(wrapper.find('[data-read-issue]').exists()).toBe(false);
        expect(wrapper.get('.help-content').element).toBe(content);
        expect(input.element.value).toBe('Help recovery draft');
        expect(document.activeElement).toBe(input.element);
    });

    it('explains a validated Help query rejection and offers deliberate recovery without an automatic loop', async () => {
        const issue = {type: 'urn:future:read', title: 'Query rejected', status: 400,
            detail: '<em>Use a supported query.</em>', requestId: 'help-validation'};
        let rejected = true;
        const {wrapper, context, request} = await mounted('/help', async () => json(rejected ? issue : article(), rejected ? 400 : 200));
        expect(wrapper.get('[data-read-issue]').text()).toBe(issue.detail);
        expect(wrapper.find('[data-read-issue] em').exists()).toBe(false);
        expect(wrapper.find('[data-last-successful-refresh]').exists()).toBe(false);
        expect(request).toHaveBeenCalledOnce();
        rejected = false;
        await wrapper.findAll('button').find(button => button.text() === context.messages.value.t('common.retry'))!.trigger('click');
        await flushPromises();
        expect(request).toHaveBeenCalledTimes(2);
        expect(wrapper.get('.help-content').text()).toContain('English article authority');
    });

    it('keeps complete Help readable in SSR and withholds interactive Overview controls until initialization', async () => {
        const request = vi.fn(() => { throw new Error('SSR must not call its own HTTP server'); });
        vi.stubGlobal('fetch', request);
        const help = await render('/help', {session, help: article()});
        expect(help.html).toContain('English article authority');
        expect(help.html).not.toContain('data-loading-skeleton');
        expect(help.javascriptRequired).toBe(false);

        const overview = await render('/users/dashboard', {session});
        expect(overview.html.match(/data-frontend-initial-loading/gu)).toHaveLength(1);
        expect(overview.html).toContain('data-loading-skeleton="overview"');
        expect(overview.html).not.toContain('data-collection=');
        expect(overview.html).not.toContain('Owner authority ready');
        expect(overview.html).not.toContain('badge bg-secondary ms-2">0');
        expect(overview.javascriptRequired).toBe(true);
        expect(request).not.toHaveBeenCalled();
    });

    it.each([
        ['/packing/' + cardId, 'list-detail', 6],
        ['/drivers/' + cardId, 'list-detail', 5],
        ['/packing/create', 'packing-create', 4],
        ['/drivers/' + cardId + '/duplicate', 'list-create', 0],
        ['/event/' + cardId, 'event', 4],
        ['/event/' + cardId + '/admin', 'event-admin', 4],
        ['/event/create', 'event-create', 0],
        ['/packing/' + cardId + '/guest', 'guest', 0],
        ['/users/login', 'login', 0],
        ['/users/register', 'identity', 0],
        ['/users/forgot-password', 'identity', 0],
        ['/users/reset-password/loading-token', 'identity', 0],
        ['/users/profile', 'profile', 0],
        ['/users/profile/manage', 'roster', 0],
        ['/users/profile/create', 'profile', 0],
        ['/users/profile/migrate/show', 'workflow', 0],
        ['/users/profile/delete', 'workflow', 0],
    ])('renders the declared %s module shape before client admission', async (path, variant, columns) => {
        const request = vi.fn(() => { throw new Error('An SSR shape must not read private feature data'); });
        vi.stubGlobal('fetch', request);
        const result = await render(String(path), {session});
        const host = document.createElement('div');
        host.innerHTML = result.html;
        const skeleton = host.querySelector('[data-frontend-initial-loading]')!;
        expect(skeleton.getAttribute('data-loading-skeleton')).toBe(variant);
        expect(skeleton.getAttribute('data-skeleton-page')).toBe('true');
        expect(skeleton.querySelectorAll('[role="status"]')).toHaveLength(1);
        expect(skeleton.querySelectorAll('.frontend-skeleton-page-header')).toHaveLength(1);
        expect(skeleton.querySelector('input,button,a,form,table,[role="button"],.badge')).toBeNull();
        expect(skeleton.querySelectorAll('.frontend-skeleton-animated')).toHaveLength(1);
        if (columns) expect(skeleton.querySelector('.frontend-skeleton-table-heading')!.children).toHaveLength(Number(columns));
        expect(skeleton.textContent).not.toContain(card.title);
        expect(request).not.toHaveBeenCalled();
    });

    it.each([5, 6])('retains every declared list column with one status and no duplicate scoped header (%s)', columns => {
        const shape: FrontendLoadingSkeleton = {variant: 'list-detail', rows: 4, columns};
        const wrapper = mountedSkeleton(shape);
        expect(wrapper.findAll('[role="status"]')).toHaveLength(1);
        expect(wrapper.findAll('.frontend-skeleton-page-header')).toHaveLength(0);
        expect(wrapper.get('.frontend-skeleton-table-heading').element.children).toHaveLength(columns);
        expect(wrapper.findAll('.frontend-skeleton-table-row')).toHaveLength(4);
        for (const row of wrapper.findAll('.frontend-skeleton-table-row')) expect(row.element.children).toHaveLength(columns);
        expect(wrapper.get('.frontend-skeleton-table-grid').attributes('style')).toContain('--frontend-skeleton-columns: ' + columns);
        expect(wrapper.findAll('.frontend-skeleton-animated')).toHaveLength(1);
        expect(wrapper.find('input,button,a,form,table').exists()).toBe(false);
    });

    it('keeps the Event participant email breakpoint opt-in while other tables retain their columns', () => {
        const roster = mountedSkeleton({variant: 'table', rows: 3, columns: 5, hideColumnOnMobile: 2});
        expect(roster.get('.frontend-skeleton-table-grid').attributes('style')).toContain('--frontend-skeleton-mobile-columns: 4');
        for (const row of roster.findAll('.frontend-skeleton-table-heading,.frontend-skeleton-table-row')) {
            expect(row.element.children).toHaveLength(5);
            expect(row.findAll('.d-none.d-md-block')).toHaveLength(1);
            expect(row.element.children[1].classList.contains('d-none')).toBe(true);
        }
        const ordinary = mountedSkeleton({variant: 'table', columns: 5});
        expect(ordinary.find('.d-none').exists()).toBe(false);
        expect(ordinary.get('.frontend-skeleton-table-grid').attributes('style')).toContain('--frontend-skeleton-mobile-columns: 5');
    });

    it('shares creation fields while reserving the initial-items table for Packing', () => {
        const packing = mountedSkeleton({variant: 'packing-create'});
        const drivers = mountedSkeleton({variant: 'list-create'});
        expect(packing.findAll('.frontend-skeleton-field')).toHaveLength(4);
        expect(drivers.findAll('.frontend-skeleton-field')).toHaveLength(4);
        expect(packing.get('.frontend-skeleton-table-heading').element.children).toHaveLength(4);
        expect(drivers.find('.frontend-skeleton-table-grid').exists()).toBe(false);
        expect(packing.findAll('[role="status"]')).toHaveLength(1);
    });

    it('includes the independent recovery row only in the login composition', () => {
        const login = mountedSkeleton({variant: 'login', rows: 2});
        const register = mountedSkeleton({variant: 'identity', rows: 5});
        expect(login.get('.frontend-skeleton-recovery').findAll('.col-md-6')).toHaveLength(2);
        expect(register.find('.frontend-skeleton-recovery').exists()).toBe(false);
        expect(register.findAll('.frontend-skeleton-field')).toHaveLength(5);
        expect(login.findAll('[role="status"]')).toHaveLength(1);
    });

    it('matches the guest form width and profile submit width without implying controls', () => {
        const guest = mountedSkeleton({variant: 'guest', rows: 2});
        const profile = mountedSkeleton({variant: 'profile', rows: 1});
        expect(guest.findAll('.frontend-skeleton-field.col-md-8')).toHaveLength(2);
        expect(guest.find('.frontend-skeleton-form-footer-two-thirds').exists()).toBe(true);
        expect(profile.find('.frontend-skeleton-form-footer-full').exists()).toBe(true);
        expect(guest.find('input,button,a,form').exists()).toBe(false);
    });

    it('replaces a cold help placeholder without replacing the focused search draft', async () => {
        const pending = deferred<Response>();
        const {wrapper, context, request} = await mounted('/help', () => pending.promise);
        expect(request).toHaveBeenCalledOnce();
        expect(wrapper.find('[data-loading-skeleton="article"]').exists()).toBe(true);
        expect(wrapper.get('.col-lg-9').attributes('aria-busy')).toBe('false');
        expect(wrapper.find('.help-content').exists()).toBe(false);
        expect(wrapper.text()).not.toContain(context.messages.value.t('help.noMatches', {query: 'draft'}));
        const input = wrapper.get<HTMLInputElement>('#frontend-help-search');
        await input.setValue('Unsubmitted search draft');
        input.element.focus();

        pending.resolve(json(article()));
        await flushPromises();
        expect(wrapper.find('[data-loading-skeleton]').exists()).toBe(false);
        expect(wrapper.get('.help-content').text()).toContain('English article authority');
        expect(wrapper.get<HTMLInputElement>('#frontend-help-search').element).toBe(input.element);
        expect(input.element.value).toBe('Unsubmitted search draft');
        expect(document.activeElement).toBe(input.element);
    });

    it('keeps confirmed help and its draft visible during a failed background read', async () => {
        const confirmedAt = Date.UTC(2026, 9, 11, 6, 0, 0);
        const clock = vi.spyOn(Date, 'now').mockReturnValue(confirmedAt);
        const pending = deferred<Response>();
        const {wrapper, context} = await mounted('/help', () => pending.promise,
            {initialUrl: '/help', help: article()});
        const content = wrapper.get('.help-content').element;
        const input = wrapper.get<HTMLInputElement>('#frontend-help-search');
        await input.setValue('Retained draft');
        input.element.focus();
        const refresh = context.queryClient.refetchQueries({type: 'active'});
        await flushPromises();
        expect(wrapper.get('.help-content').element).toBe(content);
        expect(wrapper.find('[data-loading-skeleton]').exists()).toBe(false);
        expect(wrapper.get('.col-lg-9').attributes('aria-busy')).toBe('true');

        // The failed retry's clock cannot make retained article data look newer.
        clock.mockReturnValue(confirmedAt + 10_000);
        pending.resolve(json(problem, 400));
        await refresh;
        await flushPromises();
        expect(wrapper.get('.help-content').element).toBe(content);
        expect(wrapper.text()).toContain(context.messages.value.t('state.stale'));
        expect(wrapper.get('[data-last-successful-refresh] time').attributes('datetime'))
            .toBe('2026-10-11T06:00:00.000Z');
        expect(wrapper.find('[data-loading-skeleton]').exists()).toBe(false);
        expect(input.element.value).toBe('Retained draft');
        expect(document.activeElement).toBe(input.element);
    });

    it('isolates the article body while a different language is loading', async () => {
        const pending = deferred<Response>();
        const {wrapper, context, request} = await mounted('/help', () => pending.promise,
            {initialUrl: '/help', help: article()});
        const input = wrapper.get<HTMLInputElement>('#frontend-help-search');
        await input.setValue('Unsubmitted language-switch draft');
        context.locale.value = 'de';
        await flushPromises();
        expect(wrapper.text()).not.toContain('English article authority');
        expect(wrapper.find('[data-loading-skeleton="article"]').exists()).toBe(true);
        expect(wrapper.get('[data-loading-skeleton="article"] [role="status"]').text())
            .toBe(context.messages.value.t('common.loading'));
        expect((request.mock.calls[0][0] as Request).headers.get('X-Surveyor-Locale')).toBe('de');

        pending.resolve(json(article('de', 'Deutsche Artikelautorität')));
        await flushPromises();
        expect(wrapper.get('.help-content').text()).toContain('Deutsche Artikelautorität');
        expect(wrapper.text()).not.toContain('English article authority');
        expect(wrapper.find('[data-loading-skeleton]').exists()).toBe(false);
        expect(input.element.value).toBe('Unsubmitted language-switch draft');
    });

    it('renders ready overview regions independently and confirms empty membership only after its own read', async () => {
        const participant = deferred<Response>();
        const owner = deferred<Response>();
        let participantRead = participant.promise;
        function readRegion(request: Request): Promise<Response> {
            return new URL(request.url).searchParams.get('collection') === 'owner' ? owner.promise : participantRead;
        }
        const {wrapper, context, request} = await mounted('/users/dashboard', readRegion);
        const ownerView = wrapper.get('[data-collection="owner"][data-region="main"]');
        const participantView = wrapper.get('[data-collection="participant"][data-region="main"]');
        const participantForm = participantView.get('form');
        const participantHeading = wrapper.findAll('.entity-overview > .accordion-header')[0]!;
        const participantRefresh = participantHeading.get<HTMLButtonElement>('button[aria-label="Refresh"]');
        const input = participantView.get<HTMLInputElement>('input[type="search"]');
        input.element.focus();
        expect(request).toHaveBeenCalledTimes(2);
        expect(wrapper.findAll('[data-loading-skeleton="cards"]')).toHaveLength(2);
        expect(ownerView.attributes('aria-busy')).toBe('false');
        expect(participantView.attributes('aria-busy')).toBe('false');
        expect(wrapper.findAll('.accordion-button .badge').map(badge => badge.text())).toEqual(['…', '…']);
        expect(participantView.text()).not.toContain(context.messages.value.t('overview.emptyParticipant'));

        owner.resolve(json(region('owner', [card])));
        await flushPromises();
        expect(ownerView.text()).toContain(card.title);
        expect(ownerView.find('[data-loading-skeleton]').exists()).toBe(false);
        expect(participantView.find('[data-loading-skeleton="cards"]').exists()).toBe(true);
        expect(wrapper.findAll('.accordion-button .badge').map(badge => badge.text())).toEqual(['…', '1']);
        expect(participantView.get<HTMLInputElement>('input[type="search"]').element).toBe(input.element);
        expect(document.activeElement).toBe(input.element);

        participant.resolve(json(region('participant')));
        await flushPromises();
        expect(participantView.find('[data-loading-skeleton]').exists()).toBe(false);
        expect(participantView.text()).toContain(context.messages.value.t('overview.emptyParticipant'));
        expect(wrapper.findAll('.accordion-button .badge').map(badge => badge.text())).toEqual(['0', '1']);
        // Empty authority releases only untouched search/filter/count controls.
        // The same Refresh stays in the existing collection heading. Empty
        // membership adds neither a repeated visible title nor a control row.
        expect(participantView.get('form').element).toBe(participantForm.element);
        expect(participantHeading.get('button[aria-label="Refresh"]').element).toBe(participantRefresh.element);
        expect(participantForm.findAll('button')).toHaveLength(0);
        expect(participantForm.classes()).not.toContain('mb-3');
        expect(participantForm.get('h3').classes()).toContain('visually-hidden');
        expect(participantRefresh.attributes('aria-label')).toBe(context.messages.value.t('common.refresh'));
        expect(participantRefresh.attributes('disabled')).toBeUndefined();
        expect(participantForm.find('input[type="search"],[aria-live="polite"]').exists()).toBe(false);
        expect(participantForm.text()).not.toContain(context.messages.value.t('overview.filter'));
        expect(input.element.isConnected).toBe(false);
        expect(ownerView.find('form').exists()).toBe(true);

        // The collection's actual existing read still discovers remote content,
        // and keeps the same focused control after the empty/populated change.
        participantRead = Promise.resolve(json(region('participant', [card])));
        participantRefresh.element.focus();
        await participantRefresh.trigger('click');
        await flushPromises();
        expect(participantView.text()).toContain(card.title);
        expect(participantView.find('input[type="search"]').exists()).toBe(true);
        expect(participantHeading.get('button[aria-label="Refresh"]').element).toBe(participantRefresh.element);
        expect(document.activeElement).toBe(participantRefresh.element);
    });

    it('loads an explicitly opened hidden overview region before main-region counts arrive', async () => {
        const main = deferred<Response>();
        const hidden = deferred<Response>();
        function readRegion(request: Request): Promise<Response> {
            return new URL(request.url).searchParams.get('region') === 'hidden' ? hidden.promise : main.promise;
        }
        const {wrapper, context, request} = await mounted('/users/dashboard?owner_hidden_open=1', readRegion);
        const hiddenView = wrapper.get('[data-collection="owner"][data-region="hidden"]');
        expect(request).toHaveBeenCalledTimes(3);
        expect(hiddenView.find('[data-loading-skeleton="cards"]').exists()).toBe(true);
        expect(wrapper.find('[data-collection="participant"][data-region="hidden"]').exists()).toBe(false);
        const emptyHidden = {...region('owner', [card]), region: 'hidden' as const, regionEntities: 0,
            matchingEntities: 0, totalCards: 0, items: []};

        hidden.resolve(json(emptyHidden));
        await flushPromises();
        expect(hiddenView.find('[data-loading-skeleton]').exists()).toBe(false);
        expect(hiddenView.text()).toContain(context.messages.value.t('overview.emptyHidden'));
        expect(wrapper.get('[data-collection="owner"][data-region="main"]')
            .find('[data-loading-skeleton="cards"]').exists()).toBe(true);
    });

    it.each(['/help', '/users/dashboard'])('ends initial placeholders after a confirmed read error on %s', async path => {
        const {wrapper, context} = await mounted(path, async () => json(problem, 400));
        expect(wrapper.text()).toContain(context.messages.value.t('state.loadFailed'));
        expect(wrapper.find('[data-loading-skeleton]').exists()).toBe(false);
        expect(wrapper.find('.help-content').exists()).toBe(false);
        expect(wrapper.text()).not.toContain(context.messages.value.t('overview.emptyParticipant'));
        expect(wrapper.text()).not.toContain(context.messages.value.t('overview.emptyOwner'));
    });
});
