// @vitest-environment happy-dom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {flushPromises, mount} from '@vue/test-utils';
import {createMemoryHistory, createRouter} from 'vue-router';
import {VueQueryPlugin} from '@tanstack/vue-query';
import App from '../../src/frontend/app/App.vue';
import HelpPage from '../../src/frontend/features/help/HelpPage.vue';
import {createPilotContext, pilotContextKey} from '../../src/frontend/app/context';
import {render} from '../../src/frontend/app/entry-server';
import type {components} from '../../src/types/api/v1';

const session: components['schemas']['SessionView'] = {kind: 'anonymous', context: 'shell-context-1234567890',
    csrfToken: 'shell-csrf-1234567890', locale: 'en', activeProfile: null, profiles: [],
    loginUrl: '/users/login', logoutUrl: null, shell: {version: 'fixture-version', imprintUrl: '/fixture-imprint',
        privacyPolicyUrl: '/fixture-privacy', localLoginEnabled: true, oidcEnabled: false, oidcName: 'Provider'}};
const help: components['schemas']['HelpPageData'] = {locale: 'en', title: 'Fixture guide', content: '<h2 id="fixture-task">A synthetic task</h2>',
    currentDoc: 'fixture.md', docsList: [{name: 'fixture', title: 'Fixture guide', path: 'fixture.md', url: '/help/fixture'}],
    docsGroups: [{title: 'Fixture group', docs: [{name: 'fixture', title: 'Fixture guide', path: 'fixture.md', url: '/help/fixture'}]}],
    toc: [{id: 'fixture-task', title: 'A synthetic task', level: 2}]};

async function renderHelp(data = help, url = '/frontend-pilot/help?doc=fixture', requestFetch?: typeof fetch) {
    const context = createPilotContext({session, help: data, initialUrl: url}, true, requestFetch ?? vi.fn());
    const router = createRouter({history: createMemoryHistory(), routes: [{path: '/frontend-pilot/help', component: HelpPage}]});
    await router.push(url);
    await router.isReady();
    const wrapper = mount(App, {attachTo: document.body, global: {
        plugins: [router, [VueQueryPlugin, {queryClient: context.queryClient}]], provide: {[pilotContextKey as symbol]: context},
    }});
    await flushPromises();
    return {wrapper, context, router};
}
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });

describe('native shell and help presentation contract', () => {
    it('replaces the pinned help locale after a confirmed language switch while preserving reload context', async () => {
        const request = vi.fn(async () => new Response(JSON.stringify({...session, locale: 'de'}), {
            headers: {'Content-Type': 'application/json', 'X-Surveyor-Context': session.context},
        }));
        const {wrapper, context, router} = await renderHelp(help,
            '/frontend-pilot/help?doc=fixture&q=search%20term&list=fixture-list&locale=en#fixture-task', request);
        try {
            await wrapper.get('#pilot-locale').setValue('de');
            await flushPromises();
            expect(request).toHaveBeenCalledOnce();
            expect(context.locale.value).toBe('de');
            expect(router.currentRoute.value.path).toBe('/frontend-pilot/help');
            expect(router.currentRoute.value.query).toEqual({doc: 'fixture', q: 'search term', list: 'fixture-list', locale: 'de'});
            expect(router.currentRoute.value.hash).toBe('#fixture-task');
            const reloadUrl = new URL(router.currentRoute.value.fullPath, 'https://surveyor.invalid');
            expect(reloadUrl.searchParams.get('locale')).toBe('de');
            expect(wrapper.get<HTMLInputElement>('form input[name="locale"]').element.value).toBe('de');
            expect(wrapper.get<HTMLSelectElement>('#pilot-locale').element.value).toBe('de');
        } finally { wrapper.unmount(); context.queryClient.clear(); }
    });

    it('server-renders the negotiated language as the selected option before any JavaScript runs', async () => {
        for (const locale of ['en', 'de']) {
            const result = await render(`/frontend-pilot/help?locale=${locale}`, {session: {...session, locale}, help: {...help, locale}});
            const native = document.createElement('div');
            native.innerHTML = result.html;
            expect(native.querySelector<HTMLSelectElement>('#pilot-locale')?.value).toBe(locale);
        }
    });

    it('renders the current navigation destinations, responsive toggle, public footer and help structure', async () => {
        const {wrapper, context} = await renderHelp();
        try {
            for (const path of ['/frontend-pilot', '/survey/create', '/activity/create', '/event/create', '/frontend-pilot/packing/create', '/drivers/create']) {
                expect(wrapper.find(`header a[href="${path}"]`).exists()).toBe(true);
            }
            expect(wrapper.get('main#pilot-main').classes()).toContain('container-fluid');
            expect(wrapper.get('a[href="/fixture-imprint"]').text()).toBe('Imprint');
            expect(wrapper.get('a[href="/fixture-privacy"]').text()).toBe('Privacy Policy');
            expect(wrapper.get('footer').text()).toContain('Surveyor vfixture-version');
            expect(wrapper.find('header a[href^="/frontend-pilot/users/login?next="]').exists()).toBe(true);
            expect(wrapper.find('header a[href^="/frontend-pilot/users/register?next="]').exists()).toBe(true);
            const toggle = wrapper.get('button[aria-controls="pilot-navbar-main"]');
            await toggle.trigger('click');
            expect(toggle.attributes('aria-expanded')).toBe('true');
            expect(wrapper.get('#pilot-navbar-main').classes()).toContain('show');
            const createMenu = wrapper.findAll('details').find(menu => menu.get('summary').text() === 'New')!;
            const dropdown = createMenu.get<HTMLElement>('.dropdown-menu');
            dropdown.element.style.position = 'absolute';
            vi.spyOn(createMenu.get('summary').element, 'getBoundingClientRect')
                .mockReturnValue(new DOMRect(60, window.innerHeight - 50, 80, 32));
            vi.spyOn(dropdown.element, 'getBoundingClientRect').mockReturnValue(new DOMRect(60, 0, 288, 200));
            await createMenu.get('summary').trigger('keydown', {key: 'ArrowDown'});
            expect((createMenu.element as HTMLDetailsElement).open).toBe(true);
            expect(dropdown.element.style.bottom).toBe('100%');
            expect(document.activeElement).toBe(createMenu.get('a[href="/survey/create"]').element);
            await createMenu.trigger('keydown', {key: 'Escape'});
            expect((createMenu.element as HTMLDetailsElement).open).toBe(false);
            expect(document.activeElement).toBe(createMenu.get('summary').element);
            const form = wrapper.get('form[role="search"]');
            expect(form.attributes('method')).toBe('get');
            expect(form.attributes('action')).toBe('/frontend-pilot/help');
            expect(form.find('.input-group input[name="q"]').exists()).toBe(true);
            expect(wrapper.get('nav[aria-label="Help topics"] a[aria-current="page"]').classes()).toContain('bg-primary');
            expect(wrapper.get('.help-content h2').attributes('id')).toBe('fixture-task');
            expect(wrapper.get('nav[aria-label="On this page"] a').attributes('href')).toBe('#fixture-task');
        } finally { wrapper.unmount(); context.queryClient.clear(); }
    });

    it('keeps the entire search result clickable with its section context and result count', async () => {
        const result = await renderHelp({...help, content: '', toc: [], searchQuery: 'fixture', searchResults: [
            {title: 'Result fixture', url: '/help/fixture#fixture-task', sectionTitle: 'A synthetic task', excerpt: 'Synthetic excerpt'},
        ]}, '/frontend-pilot/help?q=fixture');
        try {
            const link = result.wrapper.get('.help-search-results .list-group-item');
            expect(link.element.tagName).toBe('A');
            expect(link.attributes('href')).toContain('doc=fixture');
            expect(link.attributes('href')).toContain('#fixture-task');
            expect(link.text()).toContain('In “A synthetic task”');
            expect(link.text()).toContain('Synthetic excerpt');
            expect(result.wrapper.get('.help-search-results [role="status"]').text()).toBe('1 topic found for “fixture”.');
        } finally { result.wrapper.unmount(); result.context.queryClient.clear(); }
    });

    it('server-renders translated article links as native locale-preserving pilot destinations', async () => {
        const localized = {...help, locale: 'de', title: 'Anleitung',
            content: '<h2 id="fixture-task">Eine Aufgabe</h2><p>Eine vollständige Erklärung.</p><a href="/help/packing_lists?locale=de#take-an-item">Packen</a>',
            toc: [{id: 'fixture-task', title: 'Eine Aufgabe', level: 2}]};
        const rendered = await render('/frontend-pilot/help?doc=fixture&locale=de&list=fixture-list',
            {session: {...session, locale: 'de'}, help: localized});
        const native = document.createElement('div');
        native.innerHTML = rendered.html;
        expect(native.querySelector('.help-content')?.textContent).toContain('Eine vollständige Erklärung.');
        expect(native.querySelector('.help-content a')?.getAttribute('href'))
            .toBe('/frontend-pilot/help?doc=packing_lists&list=fixture-list&locale=de#take-an-item');
        expect(native.querySelector<HTMLInputElement>('form input[name="locale"]')?.value).toBe('de');
        expect(native.querySelector('.help-toc a')?.getAttribute('href')).toBe('#fixture-task');
        expect(native.querySelector('.help-toc a')?.textContent).toBe('Eine Aufgabe');
    });
});
