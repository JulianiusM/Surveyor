// @vitest-environment happy-dom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {flushPromises, mount} from '@vue/test-utils';
import {defineComponent} from 'vue';
import {createMemoryHistory, createRouter} from 'vue-router';
import {VueQueryPlugin} from '@tanstack/vue-query';
import I18NextVue from 'i18next-vue';
import {createPilotContext, pilotContextKey} from '../../src/frontend/app/context';
import {render} from '../../src/frontend/app/entry-server';
import HelpPage from '../../src/frontend/features/help/HelpPage.vue';
import OverviewPage from '../../src/frontend/features/overview/OverviewPage.vue';
import type {components} from '../../src/types/api/v1';
import type {FrontendPilotBootstrap} from '../../src/types/FrontendPilotTypes';

type Help = components['schemas']['HelpPageData'];
type Region = components['schemas']['OverviewRegion'];
const profileId = '11111111-1111-4111-8111-111111111111';
const cardId = '33333333-3333-4333-8333-333333333333';
const session: components['schemas']['SessionView'] = {
    kind: 'account', context: 'content-loading-context-1234567890', csrfToken: 'content-loading-csrf-1234567890',
    deployment: {buildId: 'fixture', apiCompatibility: 'v1-pilot-2026-10-07'}, locale: 'en',
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
    code: 'VALIDATION_FAILED', detail: 'Review the request.', messageKey: 'api:errors.VALIDATION_FAILED', params: {}};
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
    bootstrap: Partial<FrontendPilotBootstrap> = {}) {
    const request = vi.fn((input: RequestInfo | URL) => handler(input as Request));
    const context = createPilotContext({session, ...bootstrap}, true, request);
    context.hydrated.value = true;
    context.visible.value = true;
    const router = createRouter({history: createMemoryHistory(), routes: [
        {path: '/frontend-pilot/help', component: HelpPage},
        {path: '/frontend-pilot', component: OverviewPage},
    ]});
    await router.push(path);
    await router.isReady();
    const wrapper = mount(defineComponent({template: '<RouterView />'}), {attachTo: document.body, global: {
        plugins: [router, [VueQueryPlugin, {queryClient: context.queryClient}],
            [I18NextVue, {i18next: context.i18next}]],
        provide: {[pilotContextKey as symbol]: context},
    }});
    cleanups.push(async () => {
        wrapper.unmount();
        await context.queryClient.cancelQueries();
        context.start()();
    });
    await flushPromises();
    return {wrapper, context, request};
}

describe('help and overview progressive content', () => {
    it.each([429, 503])('shows Help read timing and recovers the retained article without navigation or draft loss (%s)', async status => {
        vi.useFakeTimers();
        vi.setSystemTime(Date.UTC(2026, 9, 11, 6, 0, 0));
        let unavailable = true;
        const issue = {type: 'urn:future:read', title: 'Temporary read failure', status,
            detail: 'Please wait before reading this guide again.', requestId: 'help-read-retry'};
        const {wrapper, context, request} = await mounted('/frontend-pilot/help', async () => unavailable
            ? new Response(JSON.stringify(issue), {status, headers: {'Content-Type': 'application/problem+json',
                'X-Surveyor-Context': session.context, 'Retry-After': '5'}})
            : json(article()), {initialUrl: '/frontend-pilot/help', help: article()});
        const content = wrapper.get('.help-content').element;
        const input = wrapper.get<HTMLInputElement>('#pilot-help-search');
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
        const {wrapper, context, request} = await mounted('/frontend-pilot/help', async () => json(rejected ? issue : article(), rejected ? 400 : 200));
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

    it('keeps complete help readable in SSR and renders only missing overview regions as placeholders', async () => {
        const request = vi.fn(() => { throw new Error('SSR must not call its own HTTP server'); });
        vi.stubGlobal('fetch', request);
        const help = await render('/frontend-pilot/help', {session, help: article()});
        expect(help.html).toContain('English article authority');
        expect(help.html).not.toContain('data-loading-skeleton');
        expect(help.javascriptRequired).toBe(false);

        const overview = await render('/frontend-pilot', {session});
        expect(overview.html.match(/data-loading-skeleton="cards"/gu)).toHaveLength(2);
        expect(overview.html).not.toContain('badge bg-secondary ms-2">0');
        expect(overview.javascriptRequired).toBe(true);
        expect(request).not.toHaveBeenCalled();
    });

    it('replaces a cold help placeholder without replacing the focused search draft', async () => {
        const pending = deferred<Response>();
        const {wrapper, context, request} = await mounted('/frontend-pilot/help', () => pending.promise);
        expect(request).toHaveBeenCalledOnce();
        expect(wrapper.find('[data-loading-skeleton="article"]').exists()).toBe(true);
        expect(wrapper.get('.col-lg-9').attributes('aria-busy')).toBe('false');
        expect(wrapper.find('.help-content').exists()).toBe(false);
        expect(wrapper.text()).not.toContain(context.messages.value.t('help.noMatches', {query: 'draft'}));
        const input = wrapper.get<HTMLInputElement>('#pilot-help-search');
        await input.setValue('Unsubmitted search draft');
        input.element.focus();

        pending.resolve(json(article()));
        await flushPromises();
        expect(wrapper.find('[data-loading-skeleton]').exists()).toBe(false);
        expect(wrapper.get('.help-content').text()).toContain('English article authority');
        expect(wrapper.get<HTMLInputElement>('#pilot-help-search').element).toBe(input.element);
        expect(input.element.value).toBe('Unsubmitted search draft');
        expect(document.activeElement).toBe(input.element);
    });

    it('keeps confirmed help and its draft visible during a failed background read', async () => {
        const confirmedAt = Date.UTC(2026, 9, 11, 6, 0, 0);
        const clock = vi.spyOn(Date, 'now').mockReturnValue(confirmedAt);
        const pending = deferred<Response>();
        const {wrapper, context} = await mounted('/frontend-pilot/help', () => pending.promise,
            {initialUrl: '/frontend-pilot/help', help: article()});
        const content = wrapper.get('.help-content').element;
        const input = wrapper.get<HTMLInputElement>('#pilot-help-search');
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
        const {wrapper, context, request} = await mounted('/frontend-pilot/help', () => pending.promise,
            {initialUrl: '/frontend-pilot/help', help: article()});
        const input = wrapper.get<HTMLInputElement>('#pilot-help-search');
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
        function readRegion(request: Request): Promise<Response> {
            return new URL(request.url).searchParams.get('collection') === 'owner' ? owner.promise : participant.promise;
        }
        const {wrapper, context, request} = await mounted('/frontend-pilot', readRegion);
        const ownerView = wrapper.get('[data-collection="owner"][data-region="main"]');
        const participantView = wrapper.get('[data-collection="participant"][data-region="main"]');
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
        // Initial authority now confirms the native empty region. This untouched
        // field is no local draft; its toolbar disappears only after its own read.
        expect(participantView.find('form').exists()).toBe(false);
        expect(input.element.isConnected).toBe(false);
        expect(ownerView.find('form').exists()).toBe(true);
    });

    it('loads an explicitly opened hidden overview region before main-region counts arrive', async () => {
        const main = deferred<Response>();
        const hidden = deferred<Response>();
        function readRegion(request: Request): Promise<Response> {
            return new URL(request.url).searchParams.get('region') === 'hidden' ? hidden.promise : main.promise;
        }
        const {wrapper, context, request} = await mounted('/frontend-pilot?owner_hidden_open=1', readRegion);
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

    it.each(['/frontend-pilot/help', '/frontend-pilot'])('ends initial placeholders after a confirmed read error on %s', async path => {
        const {wrapper, context} = await mounted(path, async () => json(problem, 400));
        expect(wrapper.text()).toContain(context.messages.value.t('state.loadFailed'));
        expect(wrapper.find('[data-loading-skeleton]').exists()).toBe(false);
        expect(wrapper.find('.help-content').exists()).toBe(false);
        expect(wrapper.text()).not.toContain(context.messages.value.t('overview.emptyParticipant'));
        expect(wrapper.text()).not.toContain(context.messages.value.t('overview.emptyOwner'));
    });
});
