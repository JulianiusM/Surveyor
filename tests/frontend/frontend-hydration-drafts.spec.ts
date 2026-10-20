// @vitest-environment happy-dom
import {apiCompatibility} from '../../.generated/api/v1/policy.mjs';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {flushPromises} from '@vue/test-utils';
import {createSSRApp, defineComponent, h, nextTick, onMounted, ref} from 'vue';
import {renderToString} from 'vue/server-renderer';
import {render} from '../../src/frontend/app/entry-server';
import {createPilotApp} from '../../src/frontend/app/createApp';
import {hasHydrationDrafts, mountPreservingDrafts} from '../../src/frontend/app/mountPreservingDrafts';
import FormField from '../../src/frontend/components/FormField.vue';
import type {FrontendPilotBootstrap} from '../../src/types/FrontendPilotTypes';
import type {components} from '../../src/types/api/v1';

const profileId = '11111111-1111-4111-8111-111111111111';
const session: components['schemas']['SessionView'] & {context: string; csrfToken: string} = {kind: 'anonymous', context: 'hydration-context',
    csrfToken: 'hydration-csrf', locale: 'en', activeProfile: null, profiles: [], loginUrl: '/users/login',
    logoutUrl: null, deployment: {buildId: 'fixture', apiCompatibility},
    shell: {version: 'fixture', imprintUrl: '/imprint', privacyPolicyUrl: '/privacy',
        localLoginEnabled: true, oidcEnabled: false, oidcName: 'Provider'}};
const help: components['schemas']['HelpPageData'] = {locale: 'en', title: 'Synthetic help',
    content: '<h2 id="task">A synthetic task</h2>', currentDoc: 'fixture.md', docsList: [], docsGroups: [], toc: []};
const cleanups: (() => void)[] = [];
const account: components['schemas']['SessionView'] & {context: string; csrfToken: string} = {...session, kind: 'account',
    activeProfile: {id: profileId, name: 'Fixture'}, profiles: [{id: profileId, name: 'Fixture'}], logoutUrl: '/users/logout'};
const creation: components['schemas']['PackingCreateContext'] = {
    defaults: {participant: 0, guest: 0, authenticated: 0, public: 0},
    permissions: [{key: 'ACCESS_VIEW', bit: 1}, {key: 'ITEM_ADD', bit: 2}], presets: [],
};

afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
});

/** Keep production transport/validators intact while replacing only the external HTTP boundary. */
function creationResponse(value: unknown, status = 200): Response {
    return new Response(JSON.stringify(value), {status, headers: {'Content-Type': 'application/json',
        'X-Surveyor-Context': account.context}});
}

/** Use a real FileList, matching a browser file choice instead of a test-only array property. */
function selectEarlyImage(input: HTMLInputElement): void {
    const selection = new DataTransfer();
    selection.items.add(new File(['synthetic image'], 'early.png', {type: 'image/png'}));
    input.files = selection.files;
}

/** Use the actual SSR/client tree. Only static Help has an editing window before
 * mount; interactive feature controls appear after the shared initialization gate. */
async function nativeApplication(url: string, bootstrap: FrontendPilotBootstrap) {
    const result = await render(url, bootstrap);
    document.body.innerHTML = `<div id="surveyor-pilot">${result.html}</div>`;
    window.history.replaceState({}, '', url);
    const browser = createPilotApp(JSON.parse(result.state) as FrontendPilotBootstrap, true);
    await browser.router.isReady();
    cleanups.push(() => { browser.app.unmount(); browser.context.start()(); });
    const container = document.getElementById('surveyor-pilot')!;
    async function hydrate() {
        await mountPreservingDrafts(browser.app, container);
        await nextTick();
    }
    async function initialize() {
        await hydrate();
        browser.context.hydrated.value = true;
        await nextTick();
    }
    return {...browser, container, hydrate, initialize};
}

describe('drafts entered before hydration', () => {
    it('uses the same admitted DOM draft rules for initial reload protection', () => {
        document.body.innerHTML = `<div id="surveyor-pilot">
            <input name="username" value="server value"><textarea>server text</textarea>
            <input type="number" data-hydration-draft value="1">
            <input type="checkbox" data-hydration-draft>
            <input type="file" data-hydration-draft>
            <select data-hydration-draft><option selected>first</option><option>second</option></select>
            <input type="hidden" data-hydration-draft value="context">
            <input readonly value="read-only"><input disabled value="disabled">
        </div>`;
        const container = document.getElementById('surveyor-pilot')!;
        const fields = container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select');
        expect(hasHydrationDrafts(container)).toBe(false);

        for (const field of Array.from(fields).slice(0, 6)) {
            if (field instanceof HTMLSelectElement) field.selectedIndex = 1;
            else if (field instanceof HTMLInputElement && field.type === 'file') selectEarlyImage(field);
            else if (field instanceof HTMLInputElement && field.type === 'checkbox') field.checked = true;
            else field.value += '2';
            expect(hasHydrationDrafts(container)).toBe(true);
            if (field instanceof HTMLSelectElement) field.selectedIndex = 0;
            else if (field instanceof HTMLInputElement && field.type === 'file') field.value = '';
            else if (field instanceof HTMLInputElement && field.type === 'checkbox') field.checked = false;
            else field.value = field.defaultValue;
            expect(hasHydrationDrafts(container)).toBe(false);
        }

        for (const field of Array.from(fields).slice(6)) field.value = 'unadmitted change';
        expect(hasHydrationDrafts(container)).toBe(false);
    });

    it('keeps visible English Help fallback, actual content language and chosen interface across SSR and hydration', async () => {
        const request = vi.fn(() => { throw new Error('Hydration must not submit or read'); });
        vi.stubGlobal('fetch', request);
        const englishTopic = {name: 'PACKING_LISTS.md', title: 'Packing lists', path: 'packing_lists',
            url: '/help/packing_lists?locale=de', contentLocale: 'en'};
        const fallback: components['schemas']['HelpPageData'] = {...help, locale: 'de', contentLocale: 'en', fallbackToEnglish: true,
            content: '<h2 id="task">A synthetic task</h2><p>Reviewed English instructions.</p>'
                + '<a href="/help/packing_lists?locale=de#task">Packing</a><img src="/frontend-pilot/help/assets/figure.png?locale=en" alt="English figure">',
            docsList: [englishTopic], docsGroups: [{title: 'Organisieren und teilen', docs: [englishTopic]}],
            toc: [{id: 'task', title: 'A synthetic task', level: 2}]};
        const {container, context, hydrate} = await nativeApplication('/frontend-pilot/help?locale=de', {
            session: {...session, locale: 'de'}, help: fallback,
        });
        const notice = container.querySelector<HTMLElement>('.help-language-fallback')!;
        const article = container.querySelector<HTMLElement>('article')!;
        expect(notice.textContent).toContain('werden auf Englisch angezeigt');
        expect(article.lang).toBe('en');
        expect(container.querySelector('.help-toc a')?.getAttribute('lang')).toBe('en');
        expect(container.querySelector('nav[aria-label="Hilfethemen"] a')?.textContent).toContain('(Englisch)');
        expect(container.querySelector('nav[aria-label="Hilfethemen"] a span')?.getAttribute('lang')).toBe('en');
        expect(container.querySelector<HTMLInputElement>('form input[name="locale"]')?.value).toBe('de');
        expect(container.querySelector('.help-content a')?.getAttribute('href')).toContain('locale=de');
        expect(container.querySelector('.help-content img')?.getAttribute('src')).toContain('locale=en');
        await hydrate();
        expect(container.querySelector('.help-language-fallback')).toBe(notice);
        expect(container.querySelector('article')).toBe(article);
        expect(context.locale.value).toBe('de');
        expect(request).not.toHaveBeenCalled();
    }, 30_000);

    it('keeps an early help search and submits its edited value through client navigation', async () => {
        const request = vi.fn(() => { throw new Error('Hydration must not submit or read'); });
        vi.stubGlobal('fetch', request);
        const {container, router, initialize} = await nativeApplication('/frontend-pilot/help?q=initial', {session, help});
        const input = container.querySelector<HTMLInputElement>('#pilot-help-search')!;
        input.value = 'My early help search';
        input.focus();
        input.setSelectionRange(3, 8);
        await initialize();
        expect(container.querySelector('#pilot-help-search')).toBe(input);
        expect(input.value).toBe('My early help search');
        expect(document.activeElement).toBe(input);
        expect([input.selectionStart, input.selectionEnd]).toEqual([3, 8]);
        expect(request).not.toHaveBeenCalled();
        input.form!.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
        await flushPromises();
        expect(router.currentRoute.value.query.q).toBe('My early help search');
    }, 30_000); // The first real lazy route may compile its view/validator graph under Vitest.

    it('mounts independent Overview search controls after initialization and preserves the other region when submitted', async () => {
        // Initial SSR contains no inert feature controls. Once initialized, explicit
        // enhanced search validates its own region before committing history.
        const request = vi.fn(async (input: RequestInfo | URL) => {
            const url = new URL((input as Request).url);
            if (url.pathname !== '/api/v1/overview') throw new Error('Unexpected hydration request');
            const view: components['schemas']['OverviewRegion'] = {
                collection: url.searchParams.get('collection') as 'owner' | 'participant', region: 'main',
                q: url.searchParams.get('q') ?? '', type: 'all', availableTypes: [], page: 1, childPage: 1,
                eventId: null, pageSize: 24, totalEntities: 1, hiddenEntities: 0, regionEntities: 1,
                matchingEntities: 0, totalCards: 0, totalChildren: 0, hasPrevious: false, hasNext: false,
                parent: null, items: [],
            };
            return new Response(JSON.stringify(view), {headers: {'Content-Type': 'application/json',
                'X-Surveyor-Context': session.context}});
        });
        vi.stubGlobal('fetch', request);
        const account: components['schemas']['SessionView'] = {...session, kind: 'account',
            activeProfile: {id: profileId, name: 'Fixture'}, profiles: [{id: profileId, name: 'Fixture'}], logoutUrl: '/users/logout'};
        const {container, router, initialize} = await nativeApplication('/frontend-pilot?owner_main_q=initial', {
            session: account, overview: [],
        });
        expect(container.querySelector('main input')).toBeNull();
        expect(container.querySelector('[data-pilot-initial-loading]')).not.toBeNull();
        await initialize();
        await flushPromises();
        // Both newly mounted regions perform their independent initial reads.
        // The explicit search below is a separate admitted interaction.
        expect(request).toHaveBeenCalledTimes(2);
        request.mockClear();
        const owner = container.querySelector<HTMLInputElement>('input[type="search"][name="owner_main_q"]')!;
        const participant = container.querySelector<HTMLInputElement>('input[type="search"][name="participant_main_q"]')!;
        owner.value = 'Owner early search';
        participant.value = 'Participant early search';
        expect(request).not.toHaveBeenCalled();
        owner.dispatchEvent(new Event('input', {bubbles: true}));
        participant.dispatchEvent(new Event('input', {bubbles: true}));
        participant.form!.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
        await flushPromises();
        expect(router.currentRoute.value.query).toEqual({owner_main_q: 'initial', participant_main_q: 'Participant early search'});
        expect(request).toHaveBeenCalledOnce();
        expect(owner.value).toBe('Owner early search');
    }, 30_000); // Each initially visited lazy feature can compile during its first SSR render.

    it('withholds identity fields until initialization and submits only the user-entered initialized values', async () => {
        const request = vi.fn(async (_input: RequestInfo | URL) => new Response(JSON.stringify({type: 'about:blank', title: 'Rejected',
            status: 400, code: 'VALIDATION_FAILED', detail: 'Review the request.', messageKey: 'api:errors.VALIDATION_FAILED', params: {}}),
        {status: 400, headers: {'Content-Type': 'application/json', 'X-Surveyor-Context': session.context}}));
        vi.stubGlobal('fetch', request);
        const {container, context, initialize} = await nativeApplication('/frontend-pilot/users/login', {session});
        expect(container.querySelector('main form')).toBeNull();
        expect(container.querySelector('[data-pilot-initial-loading]')).not.toBeNull();
        expect(container.querySelector<HTMLSelectElement>('#pilot-locale')!.disabled).toBe(true);
        await initialize();
        const username = container.querySelector<HTMLInputElement>('#username')!;
        const password = container.querySelector<HTMLInputElement>('#password')!;
        const locale = container.querySelector<HTMLSelectElement>('#pilot-locale')!;
        username.value = 'early-account';
        password.value = 'synthetic-early-password';
        username.dispatchEvent(new Event('input', {bubbles: true}));
        password.dispatchEvent(new Event('input', {bubbles: true}));
        const selectionChange = vi.fn();
        locale.addEventListener('change', selectionChange);
        expect(username.value).toBe('early-account');
        expect(password.value).toBe('synthetic-early-password');
        expect(container.querySelector('main input[name="_csrf"]')).toBeNull();
        expect(context.locale.value).toBe('en');
        expect(selectionChange).not.toHaveBeenCalled();
        expect(request).not.toHaveBeenCalled();
        username.form!.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
        await flushPromises();
        expect(request).toHaveBeenCalledOnce();
        const submitted = request.mock.calls[0]![0] as Request;
        expect(new URL(submitted.url).pathname).toBe('/api/v1/auth/login');
        expect(await submitted.json()).toEqual({username: 'early-account', password: 'synthetic-early-password', next: '/frontend-pilot'});
        expect(context.bootstrap).not.toHaveProperty('password');
    }, 30_000);

    it.each(['create', 'duplicate'] as const)(
        'exposes %s controls only after initialization and keeps their drafts in the actual multipart command',
        async mode => {
            let submitted: components['schemas']['PackingCreateInput'] | undefined;
            // The HTTP callback records its actual multipart value. Keep that
            // asynchronous observation in a holder rather than casting an initial
            // null variable into the expected uploaded File after submission.
            const capturedUpload: {value: FormDataEntryValue | null} = {value: null};
            let posts = 0;
            const request = vi.fn(async (input: RequestInfo | URL) => {
                const captured = input as Request;
                const path = new URL(captured.url).pathname;
                if (path === '/api/v1/packing-lists/create-entry') {
                    return creationResponse({entry: {kind: 'render'}, context: creation, selectedEvent: null});
                }
                if (path !== '/api/v1/packing-lists' || captured.method !== 'POST') {
                    throw new Error('Unexpected creation request: ' + captured.method + ' ' + path);
                }
                posts++;
                const body = await captured.formData();
                submitted = JSON.parse(String(body.get('data'))) as components['schemas']['PackingCreateInput'];
                capturedUpload.value = body.get('image');
                // A known validated rejection keeps this production form mounted for observation.
                // Its command has crossed the real generated serializer; no destination stub is needed.
                return creationResponse({type: 'about:blank', title: 'Rejected', status: 400,
                    code: 'VALIDATION_FAILED', requestId: 'hydration-creation', detail: 'Review the request.',
                    messageKey: 'api:errors.VALIDATION_FAILED', params: {}}, 400);
            });
            vi.stubGlobal('fetch', request);
            const duplicate: components['schemas']['PackingDuplicate'] = {
                title: 'Copied list', description: 'Copied description', eventId: null,
                items: [{title: 'Copied tent', description: '', maxAssignees: 2, requiredByAll: true}],
                defaultPermissions: {...creation.defaults, participant: 3}, formContext: creation, selectedEvent: null,
            };
            const url = mode === 'create' ? '/frontend-pilot/packing/create'
                : `/frontend-pilot/packing/${profileId}/duplicate`;
            const bootstrap: FrontendPilotBootstrap = mode === 'create'
                ? {session: account, packingCreateContext: creation}
                : {session: account, packingDuplicate: duplicate};
            const {container, initialize, context} = await nativeApplication(url, bootstrap);
            expect(container.querySelector('main form')).toBeNull();
            expect(container.querySelector('[data-pilot-initial-loading]')).not.toBeNull();
            expect(request).not.toHaveBeenCalled();
            await initialize();
            const form = container.querySelector<HTMLFormElement>('main form')!;
            const capacity = form.querySelector<HTMLInputElement>('input[type="number"]')!;
            const everyone = form.querySelector<HTMLInputElement>('tbody input[type="checkbox"]')!;
            const permissions = form.querySelectorAll<HTMLInputElement>('input[id^="create-defaults-participant-"]');
            const image = form.querySelector<HTMLInputElement>('#create-header')!;
            const title = form.querySelector<HTMLInputElement>('#create-title')!;
            title.value = 'Early list';
            title.dispatchEvent(new Event('input', {bubbles: true}));
            await nextTick();
            const itemTitle = form.querySelector<HTMLInputElement>('input[aria-label="Item 1"]')!;
            itemTitle.value = 'Early tent';
            itemTitle.dispatchEvent(new Event('input', {bubbles: true}));
            await nextTick();
            capacity.value = '9';
            capacity.dispatchEvent(new Event('input', {bubbles: true}));
            await nextTick();
            everyone.checked = mode === 'create';
            everyone.dispatchEvent(new Event('change', {bubbles: true}));
            await nextTick();
            for (const permission of permissions) {
                permission.checked = mode === 'create';
                permission.dispatchEvent(new Event('change', {bubbles: true}));
                await nextTick();
            }
            selectEarlyImage(image);
            image.dispatchEvent(new Event('change', {bubbles: true}));
            // Browser events update only mounted draft owners. Initialization
            // itself never creates a list or submits the selected file.
            expect(posts).toBe(0);
            expect(context.hydrated.value).toBe(true);
            expect(form.querySelector('input[type="number"]')).toBe(capacity);
            expect(capacity.value).toBe('9');
            expect(everyone.checked).toBe(mode === 'create');
            expect(Array.from(permissions, permission => permission.checked)).toEqual([mode === 'create', mode === 'create']);
            expect(image.files?.[0]?.name).toBe('early.png');

            form.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
            await flushPromises();
            await flushPromises();
            expect(posts).toBe(1);
            expect(submitted).toMatchObject({title: 'Early list',
                defaultPermissions: {...creation.defaults, participant: mode === 'create' ? 3 : 0},
                items: [{title: 'Early tent', maxAssignees: 9, requiredByAll: mode === 'create'}]});
            const upload = capturedUpload.value;
            expect(upload).not.toBeNull();
            expect(typeof upload).not.toBe('string');
            if (!(upload instanceof File)) throw new Error('Expected the hydrated multipart image File');
            expect(upload.name).toBe('early.png');
            expect(await upload.text()).toBe('synthetic image');
            expect(request).toHaveBeenCalledTimes(2); // One explicit admission read and one explicit POST.
        }, 30_000,
    );

    it('restores opted-in select drafts while excluding selectors and action controls', async () => {
        const action = vi.fn();
        let draftValue = 'first';
        let draftValues = ['first'];
        const Fixture = defineComponent({
            setup() {
                const choice = ref('first');
                const choices = ref(['first']);
                function updateChoice(event: Event): void {
                    choice.value = (event.target as HTMLSelectElement).value;
                    draftValue = choice.value;
                }
                function updateChoices(event: Event): void {
                    choices.value = Array.from((event.target as HTMLSelectElement).selectedOptions, option => option.value);
                    draftValues = choices.value;
                }
                function options(selected: string[]) {
                    return ['first', 'second', 'third'].map(value => h('option', {value, selected: selected.includes(value)}, value));
                }
                return () => h('form', {onSubmit: action}, [
                    h('select', {id: 'draft-select', 'data-hydration-draft': '', onChange: updateChoice}, options([choice.value])),
                    h('select', {id: 'draft-multiple', multiple: true, 'data-hydration-draft': '', onChange: updateChoices}, options(choices.value)),
                    h('select', {id: 'identity-select', onChange: action}, options(['first'])),
                    h('input', {id: 'action-checkbox', type: 'checkbox', checked: false, onChange: action}),
                    h('input', {id: 'hidden-admission', type: 'hidden', 'data-hydration-draft': '', value: 'Server admission', onInput: action}),
                    h('input', {id: 'action-file', type: 'file', onChange: action}),
                    h('button', {type: 'submit', onClick: action}, 'Submit'),
                ]);
            },
        });
        document.body.innerHTML = `<div id="select-fixture">${await renderToString(createSSRApp(Fixture))}</div>`;
        const container = document.getElementById('select-fixture')!;
        container.querySelector<HTMLSelectElement>('#draft-select')!.value = 'second';
        const multiple = container.querySelector<HTMLSelectElement>('#draft-multiple')!;
        for (const option of multiple.options) option.selected = option.value !== 'first';
        container.querySelector<HTMLSelectElement>('#identity-select')!.value = 'third';
        container.querySelector<HTMLInputElement>('#action-checkbox')!.checked = true;
        container.querySelector<HTMLInputElement>('#hidden-admission')!.value = 'Edited admission';
        selectEarlyImage(container.querySelector<HTMLInputElement>('#action-file')!);
        const application = createSSRApp(Fixture);
        await mountPreservingDrafts(application, container);
        cleanups.push(() => application.unmount());
        expect(draftValue).toBe('second');
        expect(draftValues).toEqual(['second', 'third']);
        expect(container.querySelector<HTMLInputElement>('#hidden-admission')!.value).toBe('Server admission');
        expect(action).not.toHaveBeenCalled();
    });

    it('leaves untouched, disabled and read-only fields at their authored values', async () => {
        const Fixture = defineComponent({
            setup() {
                const untouched = ref('Server value');
                return () => h('form', [
                    h(FormField, {id: 'untouched', label: 'Untouched', modelValue: untouched.value,
                        'onUpdate:modelValue': (value: string) => { untouched.value = value; }}),
                    h('input', {id: 'disabled', disabled: true, value: 'Disabled value'}),
                    h('input', {id: 'readonly', readonly: true, value: 'Read-only value'}),
                    h('input', {id: 'hidden', type: 'hidden', value: 'Admission value'}),
                ]);
            },
        });
        document.body.innerHTML = `<div id="draft-fixture">${await renderToString(createSSRApp(Fixture))}</div>`;
        const container = document.getElementById('draft-fixture')!;
        for (const id of ['disabled', 'readonly', 'hidden']) {
            container.querySelector<HTMLInputElement>('#' + id)!.value = 'Not editable';
        }
        const inputs = Array.from(container.querySelectorAll('input'));
        const events = vi.fn();
        for (const input of inputs) input.addEventListener('input', events);
        const application = createSSRApp(Fixture);
        await mountPreservingDrafts(application, container);
        cleanups.push(() => application.unmount());
        await nextTick();
        expect(inputs.map(input => input.value)).toEqual(['Server value', 'Disabled value', 'Read-only value', 'Admission value']);
        expect(events).not.toHaveBeenCalled();
    });

    it('does not transfer captured edits to replaced, newly disabled, read-only or no-longer-opted-in controls', async () => {
        const events = vi.fn();
        const Fixture = defineComponent({
            setup() {
                const admitted = ref(true);
                function retireAdmission(): void { admitted.value = false; }
                onMounted(retireAdmission);
                return () => h('form', [
                    h('fieldset', {disabled: !admitted.value}, [
                        h('input', {id: 'retired-number', type: 'number', disabled: !admitted.value,
                            'data-hydration-draft': '', value: '1', onInput: events}),
                        h('input', {id: 'retired-checkbox', type: 'checkbox', disabled: !admitted.value,
                            'data-hydration-draft': '', checked: false, onChange: events}),
                        h('input', {id: 'retired-file', type: 'file', disabled: !admitted.value,
                            'data-hydration-draft': '', onChange: events}),
                        h('select', {id: 'retired-select', disabled: !admitted.value,
                            'data-hydration-draft': '', onChange: events}, [
                            h('option', {value: 'first', selected: true}, 'First'),
                            h('option', {value: 'second'}, 'Second'),
                        ]),
                    ]),
                    h('input', {id: 'new-readonly', readonly: !admitted.value, value: 'Server value', onInput: events}),
                    h('input', {id: 'new-optout', type: 'number', value: '1',
                        'data-hydration-draft': admitted.value ? '' : undefined, onInput: events}),
                    h('input', {id: 'new-kind', type: admitted.value ? 'number' : 'text', value: '1',
                        'data-hydration-draft': '', onInput: events}),
                    h('input', {id: 'new-choice', type: 'checkbox', checked: false,
                        value: admitted.value ? 'first-choice' : 'different-choice',
                        'data-hydration-draft': '', onChange: events}),
                    h('select', {id: 'new-options', 'data-hydration-draft': '', onChange: events}, [
                        h('option', {value: 'first', selected: true}, 'First'),
                        h('option', {value: admitted.value ? 'second' : 'different'}, 'Changed authority'),
                    ]),
                    admitted.value
                        ? h('input', {id: 'replacement', value: 'Original field', onInput: events})
                        : h('textarea', {id: 'replacement', value: 'Different owner', onInput: events}),
                ]);
            },
        });
        document.body.innerHTML = `<div id="admission-fixture">${await renderToString(createSSRApp(Fixture))}</div>`;
        const container = document.getElementById('admission-fixture')!;
        const original = container.querySelector<HTMLInputElement>('#replacement')!;
        for (const id of ['retired-number', 'new-optout', 'new-kind']) container.querySelector<HTMLInputElement>('#' + id)!.value = '9';
        for (const id of ['new-readonly', 'replacement']) container.querySelector<HTMLInputElement>('#' + id)!.value = 'Private draft';
        container.querySelector<HTMLInputElement>('#retired-checkbox')!.checked = true;
        container.querySelector<HTMLInputElement>('#new-choice')!.checked = true;
        container.querySelector<HTMLSelectElement>('#retired-select')!.value = 'second';
        container.querySelector<HTMLSelectElement>('#new-options')!.value = 'second';
        selectEarlyImage(container.querySelector<HTMLInputElement>('#retired-file')!);
        // The actual mounted owner retires admission before restoration completes.
        // The updated original controls and replacement must not receive captured edits.
        const application = createSSRApp(Fixture);
        await mountPreservingDrafts(application, container);
        cleanups.push(() => application.unmount());
        expect(original.isConnected).toBe(false);
        expect(container.querySelector<HTMLTextAreaElement>('#replacement')!.value).toBe('Different owner');
        expect(container.querySelector<HTMLInputElement>('#new-readonly')!.readOnly).toBe(true);
        expect(container.querySelector<HTMLInputElement>('#new-optout')!.hasAttribute('data-hydration-draft')).toBe(false);
        expect(container.querySelector<HTMLInputElement>('#new-kind')!.type).toBe('text');
        expect(events).not.toHaveBeenCalled();
    });
});
