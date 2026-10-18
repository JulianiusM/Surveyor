// @vitest-environment happy-dom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {flushPromises, mount} from '@vue/test-utils';
import {createSSRApp, defineComponent, h, ref} from 'vue';
import type {Component} from 'vue';
import {renderToString} from 'vue/server-renderer';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import * as pug from 'pug';
import {createMemoryHistory, createRouter} from 'vue-router';
import {VueQueryPlugin} from '@tanstack/vue-query';
import I18NextVue from 'i18next-vue';
import App from '../../src/frontend/app/App.vue';
import AppHeader from '../../src/frontend/components/AppHeader.vue';
import HelpPage from '../../src/frontend/features/help/HelpPage.vue';
import FormField from '../../src/frontend/components/FormField.vue';
import PageMessage from '../../src/frontend/components/PageMessage.vue';
import StatusNotice from '../../src/frontend/components/StatusNotice.vue';
import {cancelAlertDismissal, initAlertDismissal, showInlineAlert} from '../../src/public/js/shared/alerts';
import {setCurrentNavLocation} from '../../src/public/js/core/navigation';
import {resolveContextualHelpUrl} from '../../src/modules/lib/helpNavigation';
import {useFeedbackError} from '../../src/frontend/composables/feedback';
import {createPilotContext, pilotContextKey} from '../../src/frontend/app/context';
import {render} from '../../src/frontend/app/entry-server';
import type {components} from '../../src/types/api/v1';
import type {FrontendPilotBootstrap} from '../../src/types/FrontendPilotTypes';

const session: components['schemas']['SessionView'] & {context: string; csrfToken: string} = {kind: 'anonymous', deployment: {buildId: 'fixture', apiCompatibility: 'v1-pilot-2026-10-07'}, context: 'shell-context-1234567890',
    csrfToken: 'shell-csrf-1234567890', locale: 'en', activeProfile: null, profiles: [],
    loginUrl: '/users/login', logoutUrl: null, shell: {version: 'fixture-version', imprintUrl: '/fixture-imprint',
        privacyPolicyUrl: '/fixture-privacy', localLoginEnabled: true, oidcEnabled: false, oidcName: 'Provider'}};
const help: components['schemas']['HelpPageData'] = {locale: 'en', title: 'Fixture guide', content: '<h2 id="fixture-task">A synthetic task</h2>',
    currentDoc: 'fixture.md', docsList: [{name: 'fixture', title: 'Fixture guide', path: 'fixture.md', url: '/help/fixture'}],
    docsGroups: [{title: 'Fixture group', docs: [{name: 'fixture', title: 'Fixture guide', path: 'fixture.md', url: '/help/fixture'}]}],
    toc: [{id: 'fixture-task', title: 'A synthetic task', level: 2}]};

// Compile each maintained native template once in this isolated test file. Every
// render still receives fresh locals and creates a fresh DOM, so the native page
// remains the independent presentation oracle without repeated parser work.
const renderNativeGuest = pug.compileFile(resolve('src/views/users/register-guest.pug'));
const renderNativeAlert = pug.compileFile(resolve('src/views/modules/module_alert.pug'));
const renderNativeMessage = pug.compileFile(resolve('src/views/message.pug'));

async function renderHelp(data = help, url = '/frontend-pilot/help?doc=fixture', requestFetch?: typeof fetch,
                          bootstrap: Partial<FrontendPilotBootstrap> = {}) {
    const context = createPilotContext({session, help: data, initialUrl: url, ...bootstrap}, true, requestFetch ?? readLoadedHelp);
    // This helper exercises an initialized shell/Help workflow. Initial delivery
    // and unavailable-JS behavior have their own real SSR/startup fixtures.
    context.hydrated.value = true;
    const router = createRouter({history: createMemoryHistory(), routes: [
        {path: '/frontend-pilot/help', component: HelpPage},
        {path: '/frontend-pilot/help/:doc', component: HelpPage},
    ]});
    await router.push(url);
    await router.isReady();
    const wrapper = mount(App, {attachTo: document.body, global: {
        plugins: [router, [VueQueryPlugin, {queryClient: context.queryClient}], [I18NextVue, {i18next: context.i18next}]], provide: {[pilotContextKey as symbol]: context},
    }});
    await flushPromises();
    return {wrapper, context, router};

    /** Initialized language changes perform their normal Help GET. Keep this
     * external fixture valid instead of scheduling failures/retries accidentally. */
    async function readLoadedHelp(input: RequestInfo | URL): Promise<Response> {
        if (!(input instanceof Request) || new URL(input.url).pathname !== '/api/v1/help')
            throw new Error('Unexpected synthetic Help request.');
        return helpResponse(input, data, bootstrap.session?.context);
    }
}

/** Supply the public Help DTO for the requested presentation language at the
 * HTTP seam. No application lookup, renderer or locale policy is replaced. */
function helpResponse(request: Request, data = help, context: components['schemas']['SessionView']['context'] = session.context): Response {
    return new Response(JSON.stringify({...data, locale: request.headers.get('X-Surveyor-Locale') ?? data.locale}), {
        headers: {'Content-Type': 'application/json', ...(context === null ? {} : {'X-Surveyor-Context': context})},
    });
}

/** The native page supplies actual label/footer markup, not a copied template fixture. */
function nativeGuestPage(helpUrl?: string): HTMLElement {
    const native = document.createElement('div');
    native.innerHTML = renderNativeGuest({
        status: undefined, messages: {}, version: session.shell.version, nxtUrl: '/packing/fixture', profile: undefined, helpUrl,
        permData: undefined, settings: {imprintUrl: session.shell.imprintUrl, privacyPolicyUrl: session.shell.privacyPolicyUrl},
        data: {entityType: 'packing', entityId: 'fixture', title: 'Fixture list', guestRegistrationNags: {}},
    });
    return native;
}
/** Happy DOM has no layout engine; expose visible geometry only for timer contracts. */
function visibleRects(this: HTMLElement): DOMRectList {
    for (let element: HTMLElement | null = this; element; element = element.parentElement) {
        if (element.hidden || element.classList.contains('d-none') || element.style.display === 'none'
            || element.getAttribute('aria-hidden') === 'true') return [] as unknown as DOMRectList;
    }
    return [{}] as unknown as DOMRectList;
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); document.body.innerHTML = ''; });

describe('native shell and help presentation contract', () => {
    it('localizes a confirmed read receipt without replacing its instant or warning', async () => {
        const context = createPilotContext({session}, true, vi.fn());
        const timestamp = Date.UTC(2026, 9, 11, 6, 0, 0);
        const wrapper = mount(StatusNotice, {props: {kind: 'warning', lastUpdatedAt: timestamp},
            slots: {default: 'Retained read warning'}, attachTo: document.body,
            global: {plugins: [[I18NextVue, {i18next: context.i18next}]], provide: {[pilotContextKey as symbol]: context}}});
        try {
            const time = wrapper.get('time');
            expect(time.attributes('datetime')).toBe('2026-10-11T06:00:00.000Z');
            expect(time.text()).toContain('Last successfully refreshed:');
            expect(time.text()).toContain('10/11/2026');
            expect(time.text()).toContain('UTC');
            context.locale.value = 'de';
            await flushPromises();
            expect(wrapper.get('time').element).toBe(time.element);
            expect(time.attributes('datetime')).toBe('2026-10-11T06:00:00.000Z');
            expect(time.text()).toContain('Zuletzt erfolgreich aktualisiert:');
            expect(time.text()).toContain('11.10.2026');
            expect(time.text()).toContain('UTC');
            expect(wrapper.text()).toContain('Retained read warning');
        } finally { wrapper.unmount(); context.queryClient.clear(); }
    });

    it.each([undefined, 0, Number.NaN])('does not claim a successful read without a receipt (%s)', timestamp => {
        const wrapper = mount(StatusNotice, {props: {kind: 'warning', lastUpdatedAt: timestamp},
            slots: {default: 'Initial read failed'}});
        try {
            expect(wrapper.find('[data-last-successful-refresh]').exists()).toBe(false);
            expect(wrapper.text()).toBe('Initial read failed');
        } finally { wrapper.unmount(); }
    });

    it.each(['/packing/fixture', '/packing/create', '/users/login', '/help/packing_lists'])
    ('preserves native contextual Help activation on %s without widening it to other routes', async nativePath => {
        const previousUrl = window.location.href;
        const nativeDocument = nativeGuestPage(resolveContextualHelpUrl(nativePath));
        const native = document.createElement('div');
        // The rendered header is the native navigation oracle. Its document styles
        // and scripts belong to the browser layer and must not issue DOM-test HTTP.
        native.append(nativeDocument.querySelector('header')!);
        document.body.append(native);
        window.history.replaceState(null, '', nativePath);
        // Run the existing native navigation owner against real rendered header
        // markup. Copying an expected class would hide its route-matching behavior.
        setCurrentNavLocation();
        const nativeHelp = native.querySelector<HTMLAnchorElement>('a[aria-label="Help for this page"]')!;
        const context = createPilotContext({session}, true, vi.fn());
        const router = createRouter({history: createMemoryHistory(), routes: [
            {path: '/frontend-pilot/:pathMatch(.*)*', component: defineComponent({template: '<p>Route host</p>'})},
        ]});
        await router.push(`/frontend-pilot${nativePath}`);
        await router.isReady();
        const wrapper = mount(AppHeader, {attachTo: document.body, global: {
            plugins: [router, [I18NextVue, {i18next: context.i18next}]],
            provide: {[pilotContextKey as symbol]: context},
        }});
        try {
            const pilotHelp = wrapper.get('a[aria-label="Help for this page"]');
            expect(pilotHelp.classes().includes('active')).toBe(nativeHelp.classList.contains('active'));
            // Native header disclosures explicitly identify their trigger as a button.
            // Compare actual native markup instead of assuming a summary's implicit role.
            const nativeDropdowns = native.querySelectorAll<HTMLElement>('a.nav-link.dropdown-toggle');
            const pilotDropdowns = wrapper.findAll('summary.nav-link.dropdown-toggle');
            expect(pilotDropdowns).toHaveLength(nativeDropdowns.length);
            for (let index = 0; index < nativeDropdowns.length; index++) {
                expect(pilotDropdowns[index]!.text()).toBe(nativeDropdowns[index]!.textContent?.trim());
                expect(pilotDropdowns[index]!.attributes('role')).toBe(nativeDropdowns[index]!.getAttribute('role'));
            }
            await router.push('/frontend-pilot/help');
            expect(pilotHelp.classes()).not.toContain('active');
        } finally {
            wrapper.unmount();
            context.queryClient.clear();
            native.remove();
            window.history.replaceState(null, '', previousUrl);
        }
    });

    it.each([false, true])('preserves caller alert attributes and listeners through the shared root (inline=%s)', async inline => {
        const click = vi.fn();
        const wrapper = mount(StatusNotice, {props: {inline, transient: inline},
            attrs: {id: 'native-feedback-fixture', class: 'text-center border-warning mb-0', 'aria-live': 'polite', onClick: click},
            slots: {default: 'Caller-owned feedback'}});
        try {
            const alert = wrapper.get('#native-feedback-fixture');
            expect(alert.classes()).toEqual(expect.arrayContaining(['text-center', 'border-warning', 'mb-0']));
            expect(alert.attributes('aria-live')).toBe('polite');
            expect(alert.attributes('role')).toBe(inline ? 'alert' : 'status');
            await alert.trigger('click');
            expect(click).toHaveBeenCalledOnce();
        } finally { wrapper.unmount(); }
    });

    it('renders the guest private-return sentence like the plain native flash', async () => {
        const link = 'https://example.test/guest/login/fixture/one-visit-token';
        const native = document.createElement('div');
        native.innerHTML = renderNativeAlert({
            messages: {success: `Login successful. Use ${link} to edit later.`}, status: undefined,
        });
        const {wrapper, context} = await renderHelp(help, '/frontend-pilot/help?doc=fixture', undefined,
            {personalLink: link});
        try {
            const flash = wrapper.get('.pilot-page-notices > .alert-success');
            const nativeFlash = native.querySelector<HTMLElement>('.alert-success')!;
            expect(flash.text()).toBe(nativeFlash.textContent);
            expect(flash.classes()).toEqual(Array.from(nativeFlash.classList).concat('mb-3'));
            expect(flash.find('a, button').exists()).toBe(false);
            expect(flash.element.nextElementSibling).toBe(wrapper.get('#liveAlerts').element);
        } finally { wrapper.unmount(); context.queryClient.clear(); }
    });

    it('renews repeated native no-change feedback for a complete interval without inventing a write', async () => {
        vi.useFakeTimers();
        vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(visibleRects);
        const focus = vi.spyOn(HTMLElement.prototype, 'focus');
        const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
        const context = createPilotContext({session}, true);
        const host = defineComponent({
            components: {StatusNotice},
            setup: function bindFeedback() { return useFeedbackError(); },
            template: '<button @click="setInformation(\'metadata.noChanges\')">Save</button>'
                + '<div data-command-feedback><StatusNotice v-if="error" inline :kind="feedbackKind"'
                + ' :transient="transientError" :renewal="errorRenewal"'
                + ' @dismiss="setError(null)">{{ error }}</StatusNotice></div>',
        });
        const wrapper = mount(host, {attachTo: document.body, global: {
            plugins: [[I18NextVue, {i18next: context.i18next}]], provide: {[pilotContextKey as symbol]: context},
        }});
        try {
            await wrapper.get('button').trigger('click');
            await flushPromises();
            expect(wrapper.get('.alert-info').text()).toBe('There are no property changes to save.');
            const alert = wrapper.get<HTMLElement>('.alert-info').element;
            const feedback = wrapper.get<HTMLElement>('[data-command-feedback]').element;
            expect(document.activeElement).toBe(alert);
            expect(focus).toHaveBeenCalledExactlyOnceWith({preventScroll: true});
            expect(scroll).toHaveBeenCalledExactlyOnceWith(true);
            expect(scroll.mock.contexts[0]).toBe(feedback);

            // Use the actual native helper as an independent presentation oracle.
            // Its Bootstrap DOM removal belongs to native only; Vue must clear state.
            const nativeHost = document.createElement('div');
            document.body.appendChild(nativeHost);
            showInlineAlert('info', 'There are no property changes to save.', nativeHost);
            const nativeAlert = nativeHost.querySelector<HTMLElement>('.alert')!;
            for (const name of nativeAlert.classList) expect(alert.classList.contains(name)).toBe(true);
            expect(alert.role).toBe(nativeAlert.role);
            expect(alert.tabIndex).toBe(nativeAlert.tabIndex);
            expect(wrapper.get('.btn-close').attributes('aria-label')).toBe('Dismiss notification');
            expect(wrapper.get('.btn-close').attributes('aria-label'))
                .toBe(nativeAlert.querySelector('button')!.getAttribute('aria-label'));
            expect(wrapper.get('.btn-close').attributes('data-bs-dismiss')).toBeUndefined();
            cancelAlertDismissal(nativeAlert);
            nativeHost.remove();
            focus.mockClear();
            scroll.mockClear();

            await vi.advanceTimersByTimeAsync(9000);
            await wrapper.get('button').trigger('click');
            await flushPromises();
            expect(scroll).toHaveBeenCalledExactlyOnceWith(true);
            expect(document.activeElement).toBe(alert);
            expect(focus).toHaveBeenCalledExactlyOnceWith({preventScroll: true});
            await vi.advanceTimersByTimeAsync(9999);
            expect(wrapper.find('.alert-info').exists()).toBe(true);
            await vi.advanceTimersByTimeAsync(1);
            await flushPromises();
            expect(wrapper.find('.alert-info').exists()).toBe(false);
        } finally { wrapper.unmount(); context.start()(); }
        expect(vi.getTimerCount()).toBe(0);
    });

    it('discloses an inline receipt once, locks its Close while pending and leaves ordinary flashes unchanged', async () => {
        vi.useFakeTimers();
        vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(visibleRects);
        const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
        const context = createPilotContext({session}, true);
        context.hydrated.value = true;
        const disclosed = ref(false);
        const pending = ref(true);
        const message = ref('Inline feedback');
        const wrapper = mount(defineComponent({components: {StatusNotice},
            setup: function bindInlineReceipt() { return {disclosed, pending, message}; },
            template: '<section v-show="disclosed" data-entity-section="properties"><div data-command-feedback>'
                + '<StatusNotice v-if="message" inline transient :disabled="pending" :renewal="message"'
                + ' @dismiss="message = \'\'">{{ message }}</StatusNotice></div></section>',
        }), {attachTo: document.body, global: {
            plugins: [[I18NextVue, {i18next: context.i18next}]], provide: {[pilotContextKey as symbol]: context},
        }});
        const ordinary = mount(StatusNotice, {props: {transient: true}, slots: {default: 'Native POST flash'}, attachTo: document.body});
        try {
            await flushPromises();
            expect(scroll).not.toHaveBeenCalled();
            expect(ordinary.find('.btn-close').exists()).toBe(false);
            expect(ordinary.get('.alert').attributes('tabindex')).toBeUndefined();
            disclosed.value = true;
            await flushPromises();
            const alert = wrapper.get<HTMLElement>('.alert').element;
            expect(document.activeElement).toBe(alert);
            expect(scroll).toHaveBeenCalledExactlyOnceWith(true);
            expect(wrapper.get('.btn-close').attributes('disabled')).toBeDefined();
            await wrapper.get('.btn-close').trigger('click');
            expect(message.value).toBe('Inline feedback');

            // Mutations and a second disclosure retain the same receipt's focus.
            wrapper.get('[data-command-feedback]').element.appendChild(document.createTextNode(''));
            disclosed.value = false;
            await flushPromises();
            disclosed.value = true;
            pending.value = false;
            await flushPromises();
            expect(scroll).toHaveBeenCalledTimes(1);
            await wrapper.get('.btn-close').trigger('click');
            await flushPromises();
            expect(message.value).toBe('');
            expect(wrapper.find('.alert').exists()).toBe(false);
        } finally { wrapper.unmount(); ordinary.unmount(); context.start()(); }
        expect(vi.getTimerCount()).toBe(0);
    });

    it('presents page confirmations without moving focus or scrolling, while preserving renewal and dismissal', async function passivePageConfirmation() {
        vi.useFakeTimers();
        vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(visibleRects);
        const page = document.createElement('main');
        page.innerHTML = '<input aria-label="Retained draft" value="Unsaved input"><div id="liveAlerts"></div>';
        document.body.appendChild(page);
        const input = page.querySelector<HTMLInputElement>('input')!;
        const target = page.querySelector<HTMLElement>('#liveAlerts')!;
        input.focus();
        const focus = vi.spyOn(HTMLElement.prototype, 'focus');
        const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
        const shown = ref(true);
        const receipt = ref(0);
        const pending = ref(true);
        const dismiss = vi.fn(function clearPageConfirmation() { shown.value = false; });
        const wrapper = mount(defineComponent({components: {StatusNotice},
            setup: function bindPageConfirmation() { return {shown, receipt, pending, target, dismiss}; },
            template: '<StatusNotice v-if="shown" inline transient :target="target" :renewal="receipt"'
                + ' :disabled="pending" kind="success" @dismiss="dismiss">Page action saved</StatusNotice>',
        }), {attachTo: page});
        try {
            await flushPromises();
            const alert = target.querySelector<HTMLElement>('.alert')!;
            expect(alert.textContent).toBe('Page action saved');
            expect(alert.role).toBe('alert');
            expect(document.activeElement).toBe(input);
            expect(input.value).toBe('Unsaved input');
            expect(focus).not.toHaveBeenCalled();
            expect(scroll).not.toHaveBeenCalled();

            // Repeated outcomes still receive a full independent lifetime. Neither
            // their arrival nor unrelated render changes can steal the draft's focus.
            await vi.advanceTimersByTimeAsync(9000);
            receipt.value++;
            await flushPromises();
            await vi.advanceTimersByTimeAsync(9999);
            expect(dismiss).not.toHaveBeenCalled();
            expect(target.querySelector('.alert')).toBe(alert);
            expect(document.activeElement).toBe(input);
            expect(focus).not.toHaveBeenCalled();
            expect(scroll).not.toHaveBeenCalled();

            // Pending commands retain the existing Close lock. A deliberate
            // dismissal clears the reactive owner and cancels only this timer.
            const close = alert.querySelector<HTMLButtonElement>('.btn-close')!;
            expect(close.disabled).toBe(true);
            close.click();
            expect(dismiss).not.toHaveBeenCalled();
            pending.value = false;
            await flushPromises();
            close.click();
            await flushPromises();
            expect(dismiss).toHaveBeenCalledOnce();
            expect(target.querySelector('.alert')).toBeNull();
            expect(vi.getTimerCount()).toBe(0);

            // A later result remains passive and expires through the same owner,
            // rather than leaving a sticky DOM node after its receipt has retired.
            receipt.value++;
            shown.value = true;
            await flushPromises();
            await vi.advanceTimersByTimeAsync(10_000);
            await flushPromises();
            expect(dismiss).toHaveBeenCalledTimes(2);
            expect(target.querySelector('.alert')).toBeNull();
            expect(document.activeElement).toBe(input);
            expect(focus).not.toHaveBeenCalled();
            expect(scroll).not.toHaveBeenCalled();
        } finally { wrapper.unmount(); page.remove(); }
        expect(vi.getTimerCount()).toBe(0);
    });

    it('keeps uncertain outcomes durable and local when passive page confirmation expires', async function preserveUncertainOutcome() {
        vi.useFakeTimers();
        vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(visibleRects);
        const page = document.createElement('main');
        page.innerHTML = '<input aria-label="Review draft"><div id="liveAlerts"></div>';
        document.body.appendChild(page);
        const input = page.querySelector<HTMLInputElement>('input')!;
        const target = page.querySelector<HTMLElement>('#liveAlerts')!;
        input.focus();
        const focus = vi.spyOn(HTMLElement.prototype, 'focus');
        const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
        const confirmed = ref(true);
        const wrapper = mount(defineComponent({components: {StatusNotice},
            setup: function bindIndependentOutcomes() { return {confirmed, target}; },
            template: '<section><StatusNotice v-if="confirmed" inline transient :target="target"'
                + ' kind="success" @dismiss="confirmed = false">Confirmed action</StatusNotice>'
                + '<StatusNotice inline notice="state.unknownOutcome" :target="target" kind="warning">'
                + 'Review the uncertain action before continuing.</StatusNotice></section>',
        }), {attachTo: page});
        try {
            await flushPromises();
            expect(target.querySelector('.alert')?.textContent).toBe('Confirmed action');
            const unknown = wrapper.get('.status-notice');
            expect(unknown.attributes('role')).toBe('status');
            expect(unknown.find('.btn-close').exists()).toBe(false);
            expect(target.contains(unknown.element)).toBe(false);
            await vi.advanceTimersByTimeAsync(20_000);
            await flushPromises();
            expect(target.querySelector('.alert')).toBeNull();
            expect(wrapper.get('.status-notice').element).toBe(unknown.element);
            expect(document.activeElement).toBe(input);
            expect(focus).not.toHaveBeenCalled();
            expect(scroll).not.toHaveBeenCalled();
        } finally { wrapper.unmount(); page.remove(); }
        expect(vi.getTimerCount()).toBe(0);
    });

    it('keeps an old inline receipt visible without refocusing when its initiating host hides and reopens', async () => {
        vi.useFakeTimers();
        vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(visibleRects);
        const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
        const host = document.createElement('section');
        host.innerHTML = '<button>Reopen Add</button><div data-dialog-feedback></div>'
            + '<section data-entity-section="administrator-add"><div data-command-feedback></div></section>';
        document.body.appendChild(host);
        const section = host.querySelector<HTMLElement>('[data-entity-section]')!;
        const target = section.querySelector<HTMLElement>('[data-command-feedback]')!;
        const opener = host.querySelector('button')!;
        const dismiss = vi.fn();
        const wrapper = mount(StatusNotice, {attachTo: host.querySelector('[data-dialog-feedback]')!,
            props: {inline: true, transient: true, target, renewal: 'confirmed-admin-add', onDismiss: dismiss},
            slots: {default: 'Admin added'}});
        try {
            await flushPromises();
            expect(target.querySelector('.alert')?.textContent).toBe('Admin added');
            expect(document.activeElement).toBe(target.querySelector('.alert'));
            expect(scroll).toHaveBeenCalledTimes(1);
            await vi.advanceTimersByTimeAsync(9000);
            opener.focus();
            section.style.display = 'none';
            await flushPromises();
            expect(host.querySelector('[data-dialog-feedback] .alert')?.textContent).toBe('Admin added');
            expect(document.activeElement).toBe(opener);
            section.style.display = '';
            await flushPromises();
            expect(target.querySelector('.alert')?.textContent).toBe('Admin added');
            expect(document.activeElement).toBe(opener);
            expect(scroll).toHaveBeenCalledTimes(1);
            // Moving the same receipt neither refocuses nor starts another lifetime.
            await vi.advanceTimersByTimeAsync(1000);
            expect(dismiss).toHaveBeenCalledOnce();
        } finally { wrapper.unmount(); host.remove(); }
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each([
        {target: '_self', admitted: true},
        {target: '_blank', admitted: false},
        {target: '', admitted: false, download: true},
        {target: '', admitted: false, ctrlKey: true},
        {target: '_self', admitted: false, href: '/frontend-pilot/help/assets/diagram.png?locale=en'},
    ])('uses the shared ordinary-click policy for delegated Help links ($target, $admitted)', async variant => {
        const content = '<a href="' + (variant.href ?? '/help/fixture#fixture-task') + '" target="' + variant.target + '"'
            + (variant.download ? ' download' : '') + '><span>Follow task</span></a>';
        const {wrapper, context, router} = await renderHelp({...help, content});
        const push = vi.spyOn(router, 'push');
        const navigation = (window as unknown as {happyDOM: {settings: {navigation: Record<string, boolean>}}})
            .happyDOM.settings.navigation;
        const nativeNavigation = {...navigation};
        // The browser layer covers actual tab/document navigation. This DOM test
        // observes admission without dispatching Happy DOM network side effects.
        Object.assign(navigation, {disableMainFrameNavigation: true, disableChildPageNavigation: true, disableFallbackToSetURL: true});
        let admitted = false;
        // Observe the production listener's choice after bubbling, then suppress
        // Happy DOM's simulated document fetch for deliberately native clicks.
        function observeDefault(event: Event): void {
            admitted = event.defaultPrevented;
            event.preventDefault();
        }
        document.addEventListener('click', observeDefault);
        try {
            const event = new MouseEvent('click', {bubbles: true, cancelable: true, button: 0, ctrlKey: variant.ctrlKey});
            wrapper.get('.help-content span').element.dispatchEvent(event);
            await flushPromises();
            expect(admitted).toBe(variant.admitted);
            if (variant.admitted) expect(push).toHaveBeenCalledWith('/frontend-pilot/help?doc=fixture&locale=en#fixture-task');
            else expect(push).not.toHaveBeenCalled();
        } finally {
            Object.assign(navigation, nativeNavigation);
            document.removeEventListener('click', observeDefault);
            wrapper.unmount();
            context.queryClient.clear();
        }
    });

    it.each(['en', 'de'])('renders a confirmed missing Help document as the native Error/Home page in %s and retires it on recovery', async locale => {
        let missing = true;
        const data = {...help, locale};
        const problem: components['schemas']['Problem'] = {type: 'urn:surveyor:problem:not-found', title: 'Synthetic missing document',
            detail: 'Synthetic missing document', status: 404, code: 'NOT_FOUND', messageKey: 'api:errors.NOT_FOUND', params: {}, requestId: 'fixture-request'};
        async function readHelp(): Promise<Response> {
            return new Response(JSON.stringify(missing ? problem : data), {status: missing ? 404 : 200,
                headers: {'Content-Type': missing ? 'application/problem+json' : 'application/json', 'X-Surveyor-Context': session.context}});
        }
        const {wrapper, context} = await renderHelp(data, '/frontend-pilot/help?doc=fixture', readHelp,
            {session: {...session, locale}});
        try {
            expect(wrapper.find('.help-content').exists()).toBe(true);
            context.hydrated.value = true;
            await flushPromises();
            await context.queryClient.invalidateQueries();
            await flushPromises();

            const card = wrapper.get('.pilot-page-message');
            expect(card.get('h1').text()).toBe(context.messages.value.t('common.errorTitle'));
            expect(card.get('.alert-danger').text()).toBe(context.messages.value.t('help.notFound'));
            expect(card.get('a[href="/frontend-pilot"]').text()).toBe(context.messages.value.t('app.home'));
            expect(wrapper.find('.help-content').exists()).toBe(false);
            expect(document.title).toBe(`${context.messages.value.t('common.errorTitle')} | Surveyor`);

            // A later confirmed read resumes the ordinary article/title. No feature-owned
            // error cache or copied PageMessage implementation controls this transition.
            missing = false;
            await card.findAll('button').find(button => button.text() === context.messages.value.t('common.retry'))!.trigger('click');
            await flushPromises();
            expect(wrapper.find('.pilot-page-message').exists()).toBe(false);
            expect(wrapper.get('.help-content').text()).toContain('A synthetic task');
            expect(document.title).toBe('Fixture guide | Surveyor');
        } finally { wrapper.unmount(); context.queryClient.clear(); }
    });

    it('retains the existing Help read warning and confirmed article when a 404 response is unvalidated', async () => {
        async function readHelp(): Promise<Response> {
            return new Response(JSON.stringify({status: 404, detail: 'Synthetic unconfirmed read failure'}), {
                status: 404, headers: {'Content-Type': 'application/problem+json', 'X-Surveyor-Context': session.context},
            });
        }
        const {wrapper, context} = await renderHelp(help, '/frontend-pilot/help?doc=fixture', readHelp);
        try {
            context.hydrated.value = true;
            await flushPromises();
            await context.queryClient.invalidateQueries();
            await flushPromises();
            expect(wrapper.find('.pilot-page-message').exists()).toBe(false);
            expect(wrapper.get('.help-content').text()).toContain('A synthetic task');
            expect(wrapper.get('main .alert-danger').text()).toContain(context.messages.value.t('state.stale'));
            expect(wrapper.get('main [data-last-successful-refresh] time').attributes('datetime')).toBeTruthy();
            expect(document.title).toBe('Fixture guide | Surveyor');
        } finally { wrapper.unmount(); context.queryClient.clear(); }
    });

    it('preserves native outer alert spacing for ordinary pages and actual notices, while empty message pages reserve none', async () => {
        const stylesheet = document.createElement('style');
        stylesheet.textContent = readFileSync(resolve('src/frontend/styles/pilot.css'), 'utf8');
        document.body.append(stylesheet);
        const {wrapper, context, router} = await renderHelp();
        router.addRoute({path: '/frontend-pilot/message-fixture', component: defineComponent({
            render: () => h(PageMessage, {kind: 'success', message: 'Confirmed fixture message'}),
        })});
        try {
            // Native ordinary pages retain an empty mt-1 live-alert region above their card.
            const region = wrapper.get<HTMLElement>('.pilot-page-notices');
            expect(region.element.children).toHaveLength(1);
            expect(region.get('#liveAlerts').classes()).toEqual(['sticky-top', 'mt-1']);
            expect(region.classes()).not.toContain('sticky-top');
            expect(getComputedStyle(region.element).display).not.toBe('none');

            await router.push('/frontend-pilot/message-fixture');
            await flushPromises();
            expect(wrapper.get('.pilot-page-message').text()).toContain('Confirmed fixture message');
            expect(getComputedStyle(region.element).display).toBe('none');

            context.pageNotice.value = {kind: 'info', messageKey: 'auth.accountRequired'};
            await flushPromises();
            expect(region.text()).toContain(context.messages.value.t('auth.accountRequired'));
            expect(getComputedStyle(region.element).display).not.toBe('none');
            expect(region.get('.alert').element.nextElementSibling).toBe(region.get('#liveAlerts').element);
            expect(getComputedStyle(region.element).marginTop).not.toBe('4px');
        } finally { wrapper.unmount(); context.queryClient.clear(); stylesheet.remove(); }
    });

    it('translates an ordinary flash without extending its original receipt deadline', async () => {
        vi.useFakeTimers();
        vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(visibleRects);
        const {wrapper, context} = await renderHelp();
        try {
            context.pageNotice.value = {kind: 'info', messageKey: 'auth.accountRequired'};
            await flushPromises();
            await vi.advanceTimersByTimeAsync(9000);
            context.locale.value = 'de';
            await flushPromises();
            expect(wrapper.get('.pilot-page-notices > .alert-info').text())
                .toBe(context.messages.value.t('auth.accountRequired'));
            await vi.advanceTimersByTimeAsync(1000);
            await flushPromises();
            expect(context.pageNotice.value).toBeNull();
            expect(wrapper.find('.pilot-page-notices > .alert-info').exists()).toBe(false);
        } finally { wrapper.unmount(); context.queryClient.clear(); }
        expect(vi.getTimerCount()).toBe(0);
    });

    it('expires a Header logout rejection at its original deadline after using the locale control', async () => {
        vi.useFakeTimers();
        vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(visibleRects);
        const profile = {id: '22222222-2222-4222-8222-222222222222', name: 'Owner'};
        const account: components['schemas']['SessionView'] = {...session, kind: 'account',
            activeProfile: profile, profiles: [profile], logoutUrl: '/users/logout'};
        const problem: components['schemas']['Problem'] = {type: 'about:blank', title: 'Request failed', status: 403,
            detail: 'Review the request.', requestId: 'header-logout-rejection', code: 'CSRF_INVALID',
            messageKey: 'api:errors.CSRF_INVALID', params: {}};

        // Replace only HTTP responses. The Header submits through the production
        // command/validator and its locale control uses the real context operation.
        const request = vi.fn(async function readHeaderRequest(input: RequestInfo | URL): Promise<Response> {
            const captured = input as Request;
            const path = new URL(captured.url).pathname;
            let value: unknown = problem;
            let status = 403;
            if (path === '/api/v1/locale') {
                const {locale} = await captured.json();
                value = {...account, locale};
                status = 200;
            } else if (path !== '/api/v1/auth/logout') {
                throw new Error(`Unexpected Header request: ${path}`);
            }
            return new Response(JSON.stringify(value), {status,
                headers: {'Content-Type': 'application/json', 'X-Surveyor-Context': account.context}});
        });
        const context = createPilotContext({session: account}, true, request);
        context.hydrated.value = true;
        const destination = defineComponent({template: '<p>Fixture destination</p>'});
        const router = createRouter({history: createMemoryHistory(), routes: [
            {path: '/frontend-pilot', component: destination},
            {path: '/frontend-pilot/help', component: destination},
            {path: '/frontend-pilot/packing/create', component: destination},
        ]});
        await router.push('/frontend-pilot');
        await router.isReady();
        const wrapper = mount(AppHeader, {attachTo: document.body, global: {
            plugins: [router, [I18NextVue, {i18next: context.i18next}]],
            provide: {[pilotContextKey as symbol]: context},
        }});
        try {
            const form = wrapper.get('form');
            (form.element.closest('details') as HTMLDetailsElement).open = true;
            await form.trigger('submit');
            await flushPromises();
            expect(wrapper.get('.alert-danger').text()).toBe(context.messages.value.t(problem.messageKey, problem.params));

            // Header feedback has no bottom gap; the shared composite must pass
            // that explicit presentation input through its fragment roots.
            expect(wrapper.get('.alert-danger').classes()).toContain('mb-0');
            expect(wrapper.get('.alert-danger').classes()).not.toContain('mb-3');

            // Translation changes this receipt's text near expiry. It must neither
            // start another interval nor resurrect the body after it expires.
            await vi.advanceTimersByTimeAsync(9000);
            await wrapper.get('#pilot-locale').setValue('de');
            await flushPromises();
            expect(context.locale.value).toBe('de');
            expect(wrapper.get('.alert-danger').text()).toBe(context.messages.value.t(problem.messageKey, problem.params));
            await vi.advanceTimersByTimeAsync(1000);
            await flushPromises();
            expect(wrapper.find('.alert-danger').exists()).toBe(false);
            await wrapper.get('#pilot-locale').setValue('en');
            await flushPromises();
            expect(wrapper.find('.alert-danger').exists()).toBe(false);
            expect(request.mock.calls.filter(([input]) => new URL((input as Request).url).pathname
                === '/api/v1/auth/logout')).toHaveLength(1);
        } finally {
            wrapper.unmount();
            context.start()();
        }
        expect(vi.getTimerCount()).toBe(0);
    });

    // Message kind changes styling, not this semantic lifetime. The separate
    // native presentation oracle below retains all three kind comparisons.
    it('keeps a full success message expired across translation until its semantic receipt renews', async () => {
        vi.useFakeTimers();
        vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(visibleRects);
        const {wrapper, context, router} = await renderHelp();
        const path = '/frontend-pilot/message-fixture';
        router.addRoute({path, component: defineComponent({
            render: () => h(PageMessage, {kind: 'success', message: context.messages.value.t('auth.recoverySent'),
                renewal: context.pageCompletion.value}),
        })});
        try {
            await router.push(path);
            context.pageCompletion.value = {context: session.context, destination: path,
                messageKey: 'auth.recoverySent', kind: 'success'};
            await flushPromises();
            const receipt = context.pageCompletion.value;
            const card = wrapper.get('.pilot-page-message');
            await vi.advanceTimersByTimeAsync(9000);
            context.locale.value = 'de';
            await flushPromises();
            expect(card.get('.alert').text()).toBe(context.messages.value.t('auth.recoverySent'));
            await vi.advanceTimersByTimeAsync(1000);
            await flushPromises();
            expect(card.find('.alert').exists()).toBe(false);

            // Translation keeps the completed outcome and expired body. Only a new
            // receipt may reveal even identical text at the same document destination.
            context.locale.value = 'en';
            await flushPromises();
            expect(card.find('.alert').exists()).toBe(false);
            expect(context.pageCompletion.value).toBe(receipt);
            context.pageCompletion.value = {...receipt!};
            await flushPromises();
            expect(card.get('.alert').text()).toBe(context.messages.value.t('auth.recoverySent'));
            await vi.advanceTimersByTimeAsync(9999);
            expect(card.find('.alert').exists()).toBe(true);
            await vi.advanceTimersByTimeAsync(1);
            await flushPromises();
            expect(card.find('.alert').exists()).toBe(false);
        } finally { wrapper.unmount(); context.queryClient.clear(); }
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each(['info', 'success', 'error'] as const)('expires a full %s message body like native without retiring its page or receipt', async kind => {
        vi.useFakeTimers();
        vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(visibleRects);
        const message = 'Synthetic native message';
        const native = document.createElement('div');
        const nativeDocument = document.createElement('div');
        nativeDocument.innerHTML = renderNativeMessage({
            status: kind, message, messages: {}, version: session.shell.version,
            nxtUrl: '/', profile: undefined, permData: undefined,
            settings: {imprintUrl: session.shell.imprintUrl, privacyPolicyUrl: session.shell.privacyPolicyUrl}, data: {},
        });
        // Only the actual native content participates in this DOM timer check.
        // Its styles, scripts and remote assets belong to the real browser layer.
        native.append(nativeDocument.querySelector('main')!);
        document.body.append(native);
        const stopNativeAlerts = initAlertDismissal(native);
        const {wrapper, context, router} = await renderHelp();
        const path = '/frontend-pilot/message-fixture';
        router.addRoute({path, component: defineComponent({render: () => h(PageMessage, {kind, message})})});
        try {
            await router.push(path);
            await flushPromises();
            context.pageCompletion.value = {context: session.context, destination: path,
                messageKey: 'auth.recoverySent', kind: 'success'};
            const receipt = context.pageCompletion.value;
            const card = wrapper.get('.pilot-page-message');
            expect(native.querySelector('.alert')?.textContent).toBe(message);
            expect(card.get('.alert').text()).toBe(message);
            await vi.advanceTimersByTimeAsync(9999);
            expect(native.querySelector('.alert')).not.toBeNull();
            expect(card.find('.alert').exists()).toBe(true);

            // Native anchors neither renew an alert nor consume a confirmed POST receipt.
            await router.push(path + '#same-document');
            await vi.advanceTimersByTimeAsync(1);
            await flushPromises();
            expect(native.querySelector('.alert')).toBeNull();
            expect(card.find('.alert').exists()).toBe(false);
            expect(card.get('h1').text()).toBe(context.messages.value.t(kind === 'info' ? 'common.infoTitle'
                : kind === 'success' ? 'common.successTitle' : 'common.errorTitle'));
            expect(card.get('a[href="/frontend-pilot"]').text()).toBe(context.messages.value.t('app.home'));
            expect(context.pageCompletion.value).toBe(receipt);

            // A new document visit can renew identical message text without remounting
            // the component; this is separate from same-document fragment navigation.
            await router.push(path + '?visit=next');
            await flushPromises();
            expect(card.get('.alert').text()).toBe(message);
        } finally {
            stopNativeAlerts(); native.remove(); wrapper.unmount(); context.queryClient.clear();
        }
        expect(vi.getTimerCount()).toBe(0);
    });

    it('keeps an unresolved full-page read warning and its recovery control until recovery', async () => {
        vi.useFakeTimers();
        vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(visibleRects);
        const {wrapper, context, router} = await renderHelp();
        router.addRoute({path: '/frontend-pilot/read-fixture', component: defineComponent({
            render: () => h(PageMessage, {kind: 'error', message: 'Synthetic failed read', transient: false},
                {default: () => h('button', 'Retry read')}),
        })});
        try {
            await router.push('/frontend-pilot/read-fixture');
            await flushPromises();
            await vi.advanceTimersByTimeAsync(20_000);
            const card = wrapper.get('.pilot-page-message');
            expect(card.get('.status-notice').text()).toBe('Synthetic failed read');
            expect(card.get('button').text()).toBe('Retry read');
        } finally { wrapper.unmount(); context.queryClient.clear(); }
        expect(vi.getTimerCount()).toBe(0);
    });

    it('renders the same native label text next to its margin-owned icon in SSR and the mounted client', async () => {
        const native = nativeGuestPage();
        for (const name of ['username', 'email']) {
            const nativeLabel = native.querySelector<HTMLLabelElement>(`label[for="${name}"]`)!;
            const props = {id: name, label: nativeLabel.textContent!, modelValue: '',
                labelIcon: nativeLabel.querySelector('i')!.className};
            const rendered = document.createElement('div');
            rendered.innerHTML = await renderToString(createSSRApp(FormField, props));
            expect(rendered.querySelector('label')?.textContent).toBe(nativeLabel.textContent);

            const wrapper = mount(FormField, {props});
            try {
                expect(wrapper.get('label').element.textContent).toBe(nativeLabel.textContent);
                expect(wrapper.get('label i').classes()).toContain('me-1');
            } finally { wrapper.unmount(); }
        }
    });

    it.each([false, true])('retains native composition, caret and control identity for multiline=%s', async multiline => {
        const value = ref('Entered text');
        const placeholder = ref('Original hint');
        const wrapper = mount(defineComponent({
            setup() {
                return function renderField() {
                    return h(FormField, {id: 'composed-draft', label: 'Draft', modelValue: value.value,
                        multiline, placeholder: placeholder.value, 'onUpdate:modelValue': receiveValue});
                };
            },
        }), {attachTo: document.body});
        function receiveValue(next: string): void { value.value = next; }

        try {
            const input = wrapper.get<HTMLInputElement | HTMLTextAreaElement>(multiline ? 'textarea' : 'input');
            const original = input.element;
            original.focus();
            await input.trigger('compositionstart');
            original.value = 'Entered text あ';
            await input.trigger('input');
            expect(value.value).toBe('Entered text');

            // An unrelated feature rerender cannot erase an active IME draft.
            // Only native composition completion publishes its final text.
            placeholder.value = 'Updated hint';
            await flushPromises();
            expect(original.value).toBe('Entered text あ');
            await input.trigger('compositionend');
            await flushPromises();
            expect(value.value).toBe('Entered text あ');
            original.setSelectionRange(3, 3);
            placeholder.value = 'Another hint';
            await flushPromises();
            expect(wrapper.get(multiline ? 'textarea' : 'input').element).toBe(original);
            expect(document.activeElement).toBe(original);
            expect(original.selectionStart).toBe(3);
            expect(original.selectionEnd).toBe(3);
        } finally { wrapper.unmount(); }
    });

    it('keeps number fields lexical while native input lifecycle retains the focused control', async () => {
        const value = ref('');
        const placeholder = ref('Optional');
        const wrapper = mount(defineComponent({
            setup() {
                return function renderField() {
                    return h(FormField, {id: 'raw-number', label: 'Capacity', type: 'number', modelValue: value.value,
                        placeholder: placeholder.value, 'onUpdate:modelValue': receiveValue});
                };
            },
        }), {attachTo: document.body});
        function receiveValue(next: string): void { value.value = next; }

        try {
            const input = wrapper.get<HTMLInputElement>('input');
            const original = input.element;
            original.focus();
            await input.setValue('001.50');
            placeholder.value = 'Changed hint';
            await flushPromises();
            expect(value.value).toBe('001.50');
            expect(input.element.value).toBe('001.50');
            expect(wrapper.get('input').element).toBe(original);
            expect(document.activeElement).toBe(original);

            // Browsers expose an invalid number spelling as an empty DOM value.
            // The lexical field keeps that empty value instead of inventing zero.
            await input.setValue('invalid number');
            expect(value.value).toBe('');
            await input.setValue('0');
            expect(value.value).toBe('0');
        } finally { wrapper.unmount(); }
    });

    it('preserves the native footer text, icon-owned gap and nonbreaking bullet separators', async () => {
        const native = nativeGuestPage().querySelector('footer small')!;
        const result = await render('/frontend-pilot/help', {session, help});
        const rendered = document.createElement('div');
        rendered.innerHTML = result.html;
        expect(rendered.querySelector('footer small')?.textContent).toBe(native.textContent);

        const {wrapper, context} = await renderHelp();
        try {
            expect(wrapper.get('footer small').element.textContent).toBe(native.textContent);
            expect(wrapper.get('footer i').classes()).toContain('mx-1');
        } finally { wrapper.unmount(); context.queryClient.clear(); }
    });

    it.each([false, true])('keeps a pending lazy navigation when the locale response arrives (navigation first: %s)', async navigationFirst => {
        let finishLocale!: (response: Response) => void;
        const request = vi.fn(() => new Promise<Response>(resolve => { finishLocale = resolve; }));
        const {wrapper, context, router} = await renderHelp(help, '/frontend-pilot/help?locale=en', request);
        let finishRoute!: (component: Component) => void;
        const loadRoute = vi.fn(() => new Promise<Component>(resolve => { finishRoute = resolve; }));
        router.addRoute({path: '/frontend-pilot/users/login', component: loadRoute});
        let navigation: ReturnType<typeof router.push> | undefined;
        try {
            if (navigationFirst) {
                navigation = router.push('/frontend-pilot/users/login');
                await flushPromises();
            }
            await wrapper.get('#pilot-locale').setValue('de');
            if (!navigationFirst) navigation = router.push('/frontend-pilot/users/login');
            await flushPromises();
            expect(loadRoute).toHaveBeenCalledOnce();
            finishLocale(new Response(JSON.stringify({...session, locale: 'de'}), {
                headers: {'Content-Type': 'application/json', 'X-Surveyor-Context': session.context},
            }));
            await flushPromises();
            finishRoute(defineComponent({render: () => h('h1', 'Login destination')}));
            expect(await navigation).toBeUndefined();
            await flushPromises();
            expect(context.locale.value).toBe('de');
            expect(router.currentRoute.value.path).toBe('/frontend-pilot/users/login');
            expect(wrapper.text()).toContain('Login destination');
        } finally { wrapper.unmount(); context.queryClient.clear(); }
    });

    it('synchronizes the new help destination after its lazy navigation settles', async () => {
        let finishLocale!: (response: Response) => void;
        const request = vi.fn(() => new Promise<Response>(resolve => { finishLocale = resolve; }));
        const {wrapper, context, router} = await renderHelp(help, '/frontend-pilot/help?locale=en', request);
        let finishRoute!: (component: Component) => void;
        const loadRoute = vi.fn(() => new Promise<Component>(resolve => { finishRoute = resolve; }));
        router.addRoute({path: '/frontend-pilot/help/next-fixture', component: loadRoute});
        try {
            await wrapper.get('#pilot-locale').setValue('de');
            const navigation = router.push('/frontend-pilot/help/next-fixture?q=next&list=fixture-list&locale=en#fixture-task');
            await flushPromises();
            expect(loadRoute).toHaveBeenCalledOnce();
            finishLocale(new Response(JSON.stringify({...session, locale: 'de'}), {
                headers: {'Content-Type': 'application/json', 'X-Surveyor-Context': session.context},
            }));
            await flushPromises();
            finishRoute(HelpPage);
            expect(await navigation).toBeUndefined();
            await flushPromises();
            expect(router.currentRoute.value.path).toBe('/frontend-pilot/help/next-fixture');
            expect(router.currentRoute.value.query).toEqual({q: 'next', list: 'fixture-list', locale: 'de'});
            expect(router.currentRoute.value.hash).toBe('#fixture-task');
        } finally { wrapper.unmount(); context.queryClient.clear(); }
    });

    it('replaces the pinned help locale after a confirmed language switch while preserving reload context', async () => {
        const request = vi.fn(async (input: RequestInfo | URL) => {
            const captured = input as Request;
            if (new URL(captured.url).pathname === '/api/v1/help') return helpResponse(captured);
            return new Response(JSON.stringify({...session, locale: 'de'}), {
                headers: {'Content-Type': 'application/json', 'X-Surveyor-Context': session.context},
            });
        });
        const {wrapper, context, router} = await renderHelp(help,
            '/frontend-pilot/help?doc=fixture&q=search%20term&list=fixture-list&locale=en#fixture-task', request);
        try {
            await wrapper.get('#pilot-locale').setValue('de');
            await flushPromises();
            expect(request.mock.calls.map(([input]) => [(input as Request).method, new URL((input as Request).url).pathname]))
                .toEqual([['PUT', '/api/v1/locale'], ['GET', '/api/v1/help']]);
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
            for (const path of ['/frontend-pilot', '/frontend-pilot/survey/create', '/activity/create', '/frontend-pilot/event/create', '/frontend-pilot/packing/create', '/frontend-pilot/drivers/create']) {
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
            expect(document.activeElement).toBe(createMenu.get('a[href="/frontend-pilot/survey/create"]').element);
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
        const link = new URL(native.querySelector('.help-content a')!.getAttribute('href')!, 'https://fixture.test');
        expect(link.pathname).toBe('/frontend-pilot/help');
        expect(Object.fromEntries(link.searchParams)).toEqual({doc: 'packing_lists', locale: 'de'});
        expect(native.querySelector('a[href="/frontend-pilot/packing/fixture-list"]')).toBeNull();
        expect(link.hash).toBe('#take-an-item');
        expect(native.querySelector<HTMLInputElement>('form input[name="locale"]')?.value).toBe('de');
        expect(native.querySelector('.help-toc a')?.getAttribute('href')).toBe('#fixture-task');
        expect(native.querySelector('.help-toc a')?.textContent).toBe('Eine Aufgabe');
    });

    it('visibly identifies English fallback search results while preserving the selected interface language', async () => {
        const result = await renderHelp({...help, locale: 'de', contentLocale: 'de', fallbackToEnglish: true,
            content: '', toc: [], searchQuery: 'fixture', searchResults: [
                {title: 'English result', url: '/help/fixture?locale=de#fixture-task', contentLocale: 'en',
                    sectionTitle: 'An English task', excerpt: 'Reviewed English excerpt'},
            ]}, '/frontend-pilot/help?q=fixture&locale=de', undefined, {session: {...session, locale: 'de'}});
        try {
            expect(result.wrapper.get('.help-language-fallback').text()).toContain('werden auf Englisch angezeigt');
            const link = result.wrapper.get('.help-search-results .list-group-item');
            expect(link.attributes('href')).toContain('locale=de');
            expect(link.get('h3').text()).toBe('English result (Englisch)');
            expect(link.get('h3 span[lang="en"]').text()).toBe('English result');
            expect(link.get('p.small').attributes('lang')).toBe('en');
            expect(link.get('p.mb-0').attributes('lang')).toBe('en');
            expect(link.text()).toContain('In “An English task”');
        } finally { result.wrapper.unmount(); result.context.queryClient.clear(); }
    });

    it('clears a recovered locale error without clearing the independent session-read warning', async () => {
        let rejectPreference = true;
        const request = vi.fn(async (input: RequestInfo | URL) => {
            const captured = input as Request;
            if (new URL(captured.url).pathname === '/api/v1/help') return helpResponse(captured);
            if (rejectPreference) throw new TypeError('Fixture preference connection failed');
            return new Response(JSON.stringify({...session, locale: 'de'}), {
                headers: {'Content-Type': 'application/json', 'X-Surveyor-Context': session.context},
            });
        });
        const {wrapper, context} = await renderHelp(help, '/frontend-pilot/help?locale=en', request);
        try {
            context.notice.value = 'state.stale';
            await wrapper.get('#pilot-locale').setValue('de');
            await flushPromises();
            expect(wrapper.find('.pilot-page-notices .status-notice.alert-danger').exists()).toBe(true);

            rejectPreference = false;
            await wrapper.get('#pilot-locale').setValue('de');
            await flushPromises();
            expect(context.locale.value).toBe('de');
            expect(wrapper.find('.pilot-page-notices .status-notice.alert-danger').exists()).toBe(false);
            expect(context.notice.value).toBe('state.stale');

            await context.refreshSession();
            expect(context.notice.value).toBeNull();
        } finally { wrapper.unmount(); context.queryClient.clear(); }
    });

    it('preserves supported native Help query and fragment suffixes in SSR and navigation', async () => {
        const data = {...help, content: '<h2 id="fixture-task">Task</h2>'
            + '<a href="/help/search?q=packing&amp;source=fixture#fixture-task">Search</a>'
            + '<a href="/help/packing_lists#fixture-task">Article</a>'};
        const {wrapper, router, context} = await renderHelp(data);
        try {
            const links = wrapper.findAll('.help-content a');
            const searchHref = links[0].attributes('href');
            if (searchHref === undefined) throw new Error('Expected the rendered Help search href');
            const searchLink = new URL(searchHref, 'https://fixture.test');
            expect(searchLink.pathname).toBe('/frontend-pilot/help/search');
            expect(Object.fromEntries(searchLink.searchParams)).toEqual({q: 'packing', source: 'fixture', locale: 'en'});
            expect(searchLink.hash).toBe('#fixture-task');
            await links[1].trigger('click');
            await flushPromises();
            expect(router.currentRoute.value.query.doc).toBe('packing_lists');
            expect(router.currentRoute.value.hash).toBe('#fixture-task');
        } finally { wrapper.unmount(); context.queryClient.clear(); }
        const result = await render('/frontend-pilot/help?doc=fixture', {session, help: data});
        expect(result.html).toContain('q=packing&amp;source=fixture');
        expect(result.html).toContain('doc=packing_lists');
    });

    it.each([
        ['/frontend-pilot', 'dashboard'],
        ['/frontend-pilot/users/login', 'getting_started'],
        ['/frontend-pilot/guest/recovery', 'getting_started'],
        ['/frontend-pilot/packing/create', 'packing_lists'],
    ])('uses the native contextual guide from %s', async (path, doc) => {
        const {wrapper, context, router} = await renderHelp();
        router.addRoute({path, component: defineComponent({template: '<p>Context fixture</p>'})});
        try {
            await router.push(path);
            await flushPromises();
            const helpHref = wrapper.get('header a[aria-label="Help for this page"]').attributes('href');
            if (helpHref === undefined) throw new Error('Expected the contextual Help href');
            const link = new URL(helpHref, 'https://fixture.test');
            expect(link.searchParams.get('doc')).toBe(doc);
            if (path.includes('/guest/')) expect(link.hash).toBe('#join-an-invitation-as-a-guest');
        } finally { wrapper.unmount(); context.queryClient.clear(); }
    });

    it.each([
        'profile.migrationCompleted', 'profile.migrationCompletedAccountDeleted', 'profile.migrationCompletedGuestDeleted',
        'profile.deactivationCompleted', 'profile.deactivationCompletedAccountDeleted', 'profile.deactivationCompletedGuestDeleted',
        'profile.accountDeleted',
    ] as const)('translates the retained %s completion without renewing its notice or replaying a command', async function translatesWorkflowCompletion(key) {
        vi.useFakeTimers();
        vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(visibleRects);
        const request = vi.fn(function readTranslatedHelp(input: RequestInfo | URL): Promise<Response> {
            if (!(input instanceof Request) || input.method !== 'GET') throw new Error('Completion translation must not dispatch a command.');
            return Promise.resolve(helpResponse(input));
        });
        const notice = {kind: 'success' as const, messageKey: key};
        const {wrapper, context} = await renderHelp(help, '/frontend-pilot/help?doc=fixture', request, {pageNotice: notice});
        try {
            const alert = wrapper.get('main .alert-success');
            const english = context.messages.value.t(key);
            expect(alert.text()).toBe(english.trim());
            const receipt = context.pageNotice.value;
            await vi.advanceTimersByTimeAsync(6000);

            // Locale changes translate the same rendered notice. They cannot
            // replace its receipt, restart its ten-second timer or issue a write.
            context.locale.value = 'de';
            await flushPromises();
            expect(wrapper.get('main .alert-success').element).toBe(alert.element);
            expect(alert.text()).toBe(context.messages.value.t(key));
            expect(alert.text()).not.toBe(english.trim());
            expect(context.pageNotice.value).toBe(receipt);
            expect(request.mock.calls.every(([input]) => (input as Request).method === 'GET')).toBe(true);

            await vi.advanceTimersByTimeAsync(4000);
            await flushPromises();
            expect(context.pageNotice.value).toBeNull();
            context.locale.value = 'en';
            await flushPromises();
            expect(wrapper.find('main .alert-success').exists()).toBe(false);
        } finally { wrapper.unmount(); context.queryClient.clear(); }
    });

    it('expires a native flash, renews the same outcome, and preserves durable warnings', async () => {
        vi.useFakeTimers();
        vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(visibleRects);
        const {wrapper, context} = await renderHelp(help, '/frontend-pilot/help?doc=fixture', undefined,
            {pageNotice: {kind: 'success', messageKey: 'auth.loginDone'}});
        try {
            context.notice.value = 'state.stale';
            await vi.advanceTimersByTimeAsync(9000);
            context.pageNotice.value = {kind: 'success', messageKey: 'auth.loginDone'};
            await flushPromises();
            await vi.advanceTimersByTimeAsync(9999);
            expect(wrapper.find('main .alert-success').exists()).toBe(true);
            await vi.advanceTimersByTimeAsync(1);
            await flushPromises();
            expect(context.pageNotice.value).toBeNull();
            expect(wrapper.find('main .alert-success').exists()).toBe(false);
            expect(wrapper.find('main .alert-warning[role="status"]').exists()).toBe(true);
        } finally { wrapper.unmount(); context.queryClient.clear(); }
        expect(vi.getTimerCount()).toBe(0);
    });

    it('keeps concurrent notice deadlines independent when one receipt renews and another retires', async function independentNotices() {
        vi.useFakeTimers();
        vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(visibleRects);
        const firstDismiss = vi.fn();
        const secondDismiss = vi.fn();
        const first = mount(StatusNotice, {props: {transient: true, renewal: 0, onDismiss: firstDismiss},
            slots: {default: 'First outcome'}, attachTo: document.body});
        let second: ReturnType<typeof mount> | undefined;
        try {
            await vi.advanceTimersByTimeAsync(4000);
            second = mount(StatusNotice, {props: {transient: true, onDismiss: secondDismiss},
                slots: {default: 'Second outcome'}, attachTo: document.body});
            await vi.advanceTimersByTimeAsync(5000);

            // An identical new outcome renews only its own deadline. The other
            // notice retains the interval begun when it was first displayed.
            await first.setProps({renewal: 1});
            await vi.advanceTimersByTimeAsync(4999);
            expect(firstDismiss).not.toHaveBeenCalled();
            expect(secondDismiss).not.toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(1);
            expect(secondDismiss).toHaveBeenCalledOnce();
            expect(firstDismiss).not.toHaveBeenCalled();

            // Removing an expired sibling cannot cancel the still-live receipt.
            second.unmount();
            await vi.advanceTimersByTimeAsync(4999);
            expect(firstDismiss).not.toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(1);
            expect(firstDismiss).toHaveBeenCalledOnce();
        } finally { first.unmount(); second?.unmount(); }
        expect(vi.getTimerCount()).toBe(0);
    });

    it('starts transient feedback only on disclosure and clears Vue state without removing its node', async () => {
        vi.useFakeTimers();
        vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(visibleRects);
        const disclosed = ref(false);
        const message = ref('state.saved' as const);
        const receipt = ref(0);
        const dismiss = vi.fn();
        const wrapper = mount(defineComponent({components: {StatusNotice},
            setup: () => ({disclosed, message, receipt, dismiss}),
            template: '<section v-show="disclosed"><StatusNotice :notice="message" :renewal="receipt" @dismiss="dismiss">Saved</StatusNotice></section>',
        }), {attachTo: document.body});
        try {
            await vi.advanceTimersByTimeAsync(11_000);
            expect(dismiss).not.toHaveBeenCalled();
            disclosed.value = true;
            await flushPromises();
            await vi.advanceTimersByTimeAsync(9999);
            expect(dismiss).not.toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(1);
            expect(dismiss).toHaveBeenCalledOnce();
            expect(wrapper.find('.alert-success').exists()).toBe(true);
            // The actual reactive owner can renew an identical receipt. Disposal
            // before its deadline must cancel this receipt's timer rather than
            // emit a late dismissal into a retired component.
            receipt.value++;
            await flushPromises();
            await vi.advanceTimersByTimeAsync(9000);
            expect(vi.getTimerCount()).toBe(1);
            wrapper.unmount();
            await vi.advanceTimersByTimeAsync(1000);
            expect(dismiss).toHaveBeenCalledOnce();
        } finally { wrapper.unmount(); }
        expect(vi.getTimerCount()).toBe(0);
    });

    it('pauses transient timers on pagehide and renews them after page-cache restoration', async () => {
        vi.useFakeTimers();
        vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(visibleRects);
        const dismiss = vi.fn();
        const wrapper = mount(StatusNotice, {props: {transient: true, onDismiss: dismiss}, slots: {default: 'Flash'}, attachTo: document.body});
        try {
            await vi.advanceTimersByTimeAsync(9000);
            window.dispatchEvent(new Event('pagehide'));
            await vi.advanceTimersByTimeAsync(20_000);
            expect(dismiss).not.toHaveBeenCalled();
            const restored = new Event('pageshow');
            Object.defineProperty(restored, 'persisted', {value: true});
            window.dispatchEvent(restored);
            await vi.advanceTimersByTimeAsync(10_000);
            expect(dismiss).toHaveBeenCalledOnce();
        } finally { wrapper.unmount(); }
        expect(vi.getTimerCount()).toBe(0);
    });

    it('retires a guest personal-link flash on accepted departure and does not revive it on return', async () => {
        const path = '/frontend-pilot/help?doc=fixture';
        const {wrapper, context, router} = await renderHelp(help, path, undefined,
            {personalLink: 'https://fixture.test/guest/confirmed/login/private-token'});
        router.addRoute({path: '/frontend-pilot', component: defineComponent({template: '<p>Overview</p>'})});
        try {
            expect(wrapper.text()).toContain('private-token');
            await router.push(path + '#fixture-task');
            expect(context.personalLink.value).not.toBeNull();
            const cancel = router.beforeEach(() => false);
            await router.push('/frontend-pilot');
            expect(context.personalLink.value).not.toBeNull();
            cancel();
            await router.push('/frontend-pilot');
            await flushPromises();
            expect(context.personalLink.value).toBeNull();
            await router.push(path);
            expect(wrapper.text()).not.toContain('private-token');
        } finally { wrapper.unmount(); context.queryClient.clear(); }
    });
});
