// @vitest-environment happy-dom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {flushPromises, mount} from '@vue/test-utils';
import {defineComponent} from 'vue';
import {createMemoryHistory, createRouter} from 'vue-router';
import {VueQueryPlugin} from '@tanstack/vue-query';
import I18NextVue from 'i18next-vue';
import {pilotRoutes} from '../../src/frontend/app/createApp';
import {createPilotContext, pilotContextKey} from '../../src/frontend/app/context';
import GuestEntryPage from '../../src/frontend/features/identity/GuestEntryPage.vue';
import EventPage from '../../src/frontend/features/event/EventPage.vue';
import {createFrontendEventSession, createFrontendEventView, frontendEventId} from '../factories/frontendEventFactory';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
});

/** Exercise actual route declarations, entry wrappers and generated HTTP decoding.
 * Only delivery is substituted; a URL spelling cannot select a different intent. */
async function visit(path: string, handler: (request: Request) => unknown, locale: 'en' | 'de' = 'en') {
    const session = {...createFrontendEventSession(), locale};
    const request = vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify(handler(input as Request)), {
        headers: {'Content-Type': 'application/json', 'X-Surveyor-Context': session.context},
    }));
    const context = createPilotContext({session}, true, request);
    context.hydrated.value = true;
    context.visible.value = true;
    const router = createRouter({history: createMemoryHistory(), routes: pilotRoutes});
    await router.push(path);
    await router.isReady();
    const root = mount(defineComponent({template: '<RouterView />'}), {attachTo: document.body, global: {
        plugins: [router, [VueQueryPlugin, {queryClient: context.queryClient}], [I18NextVue, {i18next: context.i18next}]],
        provide: {[pilotContextKey as symbol]: context},
    }});
    cleanups.push(async () => {
        root.unmount();
        await context.queryClient.cancelQueries();
        context.queryClient.clear();
    });
    await flushPromises();
    return {root, request, router, context, session};
}

describe('matched resource route intent', () => {
    it.each(['trailing slash', 'case'] as const)('presents only the current exact-destination completion on a %s message visit', async spelling => {
        const canonical = '/frontend-pilot/message';
        const path = spelling === 'case' ? canonical.toUpperCase() : canonical + '/';
        const {root, request, context, session} = await visit(path, () => { throw new Error('Message visits do not read data'); });
        context.pageCompletion.value = {context: session.context, destination: path,
            kind: 'success', messageKey: 'auth.resetDone'};
        await flushPromises();
        expect(root.get('h1').text()).toBe('Success');
        expect(root.get('.alert').text()).toBe(context.messages.value.t('auth.resetDone'));

        // Equivalent route admission never broadens the receipt's exact actor
        // and destination binding, or permits reconstruction from URL values.
        context.pageCompletion.value = {...context.pageCompletion.value!, destination: canonical + '?other=receipt'};
        await flushPromises();
        expect(root.get('h1').text()).toBe(context.messages.value.t('common.errorHeading'));
        expect(root.text()).not.toContain(context.messages.value.t('auth.resetDone'));
        expect(request).not.toHaveBeenCalled();
    });

    for (const family of ['packing', 'drivers', 'activity', 'survey', 'event']) {
        it.each(['trailing slash', 'case'] as const)(`retains ${family} guest admission and controls with %s`, async spelling => {
            const canonical = `/frontend-pilot/${family}/${frontendEventId}/guest`;
            const path = spelling === 'case' ? canonical.toUpperCase() : canonical + '/';
            const admitted: URL[] = [];
            const {root, request, router, context} = await visit(path, function admitGuest(request) {
                admitted.push(new URL(request.url));
                return {entry: {kind: 'render'}, guest: {id: frontendEventId, title: 'Public join fixture'}};
            });
            await vi.waitFor(() => expect(root.findComponent(GuestEntryPage).exists()).toBe(true));
            expect(root.get('h1').text()).toBe('Join «Public join fixture»');
            expect(root.findAll('form')).toHaveLength(1);
            // The real Event wrapper supplies its linked-access guidance explicitly;
            // matching guest consumers keep the original generic notice and email hint.
            expect(root.find('.alert-info').exists()).toBe(family === 'event');
            expect(root.get('.alert-warning').text()).toContain(context.messages.value.t(
                family === 'event' ? 'auth.eventGuestWarning' : 'auth.guestWarning'));
            expect(root.text()).toContain(context.messages.value.t(
                family === 'event' ? 'auth.eventEmailHint' : 'auth.emailHint'));
            expect(admitted).toHaveLength(1);
            expect(admitted[0]!.pathname).toMatch(/\/entry$/u);
            expect(admitted[0]!.searchParams.get('view')).toBe('guest');
            expect(router.currentRoute.value.fullPath).toBe(path);
            expect(request.mock.calls.every(([input]) => (input as Request).method === 'GET')).toBe(true);
        });
    }

    it.each([
        {locale: 'en', title: 'Best for events', warning: 'event registration and linked packing lists or activity plans',
            email: 'Without an email, you will not be able to recover your guest link and your event registration.'},
        {locale: 'de', title: 'Für Veranstaltungen empfohlen', warning: 'Veranstaltungsanmeldung und verknüpfte Packlisten oder Aktivitätspläne',
            email: 'Ohne E-Mail-Adresse kannst du deinen Gastlink und deine Veranstaltungsanmeldung nicht wiederherstellen.'},
    ] as const)('explains Event guest access and recovery in $locale through the actual feature route', async wording => {
        const {root, request} = await visit(`/frontend-pilot/event/${frontendEventId}/guest`, function admitEventGuest() {
            return {entry: {kind: 'render'}, guest: {id: frontendEventId, title: 'Public Event'}};
        }, wording.locale);
        await vi.waitFor(() => expect(root.findComponent(GuestEntryPage).exists()).toBe(true));

        // Check the rendered contextual meaning, including the linked data at risk,
        // rather than accepting a prop or an untranslated message identifier alone.
        expect(root.get('.alert-info strong').text()).toBe(wording.title + ':');
        expect(root.get('.alert-warning').text()).toContain(wording.warning);
        expect(root.text()).toContain(wording.email);
        expect(request.mock.calls.every(([input]) => (input as Request).method === 'GET')).toBe(true);
    });

    it.each(['direct', 'existing-email'] as const)('confirms Event guest creation after %s choice without submitting a canceled draft', async journey => {
        const {root, request, context} = await visit(`/frontend-pilot/event/${frontendEventId}/guest`, function readGuestChoice(input) {
            const path = new URL(input.url).pathname;
            if (path.endsWith('/guest-email-exists')) return {exists: true};
            if (input.method === 'POST') throw new TypeError('Guest identity delivery unavailable');
            return {entry: {kind: 'render'}, guest: {id: frontendEventId, title: 'Public Event'}};
        });
        await vi.waitFor(() => expect(root.findComponent(GuestEntryPage).exists()).toBe(true));
        await root.get('#guest-name').setValue('Retained Event guest');
        if (journey === 'existing-email') await root.get('#guest-email').setValue('guest@example.test');
        const confirmation = vi.fn(() => false);
        vi.stubGlobal('confirm', confirmation);
        const reads = request.mock.calls.length;

        // Existing-email discovery is advisory and precedes the native choice.
        // Only choosing a new identity reaches the Event confirmation, never recovery.
        await root.get('form').trigger('submit');
        await flushPromises();
        if (journey === 'existing-email') {
            expect(confirmation).not.toHaveBeenCalled();
            const dialog = document.querySelector('[role="dialog"]')!;
            const continueButton = [...dialog.querySelectorAll<HTMLButtonElement>('button')]
                .find(button => button.textContent === context.messages.value.t('auth.newGuest'))!;
            continueButton.click();
            await flushPromises();
        }
        expect(confirmation).toHaveBeenCalledExactlyOnceWith(context.messages.value.t('auth.eventGuestConfirmation'));
        expect(root.get<HTMLInputElement>('#guest-name').element.value).toBe('Retained Event guest');
        expect(request.mock.calls).toHaveLength(reads + (journey === 'existing-email' ? 1 : 0));
        expect(request.mock.calls.some(([input]) => new URL((input as Request).url).pathname.endsWith(`/events/${frontendEventId}/guest`))).toBe(false);

        // Accepting deliberately sends the original draft once. Unknown delivery
        // stays in the existing command owner and cannot replay guest creation.
        confirmation.mockReturnValue(true);
        await root.get('form').trigger('submit');
        await flushPromises();
        if (journey === 'existing-email') {
            const dialog = document.querySelector('[role="dialog"]')!;
            [...dialog.querySelectorAll<HTMLButtonElement>('button')]
                .find(button => button.textContent === context.messages.value.t('auth.newGuest'))!.click();
            await flushPromises();
        }
        const registrations = request.mock.calls.map(([input]) => input as Request)
            .filter(input => input.method === 'POST' && new URL(input.url).pathname.endsWith(`/events/${frontendEventId}/guest`));
        expect(registrations).toHaveLength(1);
        expect(await registrations[0]!.json()).toEqual({username: 'Retained Event guest', email: journey === 'existing-email' ? 'guest@example.test' : null});
        expect(confirmation).toHaveBeenCalledTimes(2);
    });

    it.each(['trailing slash', 'case'] as const)('retains Event administration admission, heading and reads with %s', async spelling => {
        const canonical = `/frontend-pilot/event/${frontendEventId}/admin`;
        const path = spelling === 'case' ? canonical.toUpperCase() : canonical + '/';
        const reads: URL[] = [];
        const view = createFrontendEventView();
        const {root, request, router} = await visit(path, function readAdministration(request) {
            const url = new URL(request.url);
            reads.push(url);
            if (url.pathname.endsWith('/entry')) return {entry: {kind: 'render'}, guest: null};
            if (url.pathname.endsWith('/things-to-do')) return {items: []};
            return view;
        });
        await vi.waitFor(() => expect(root.findComponent(EventPage).exists()).toBe(true));
        await vi.waitFor(() => expect(root.get('h1').text()).toBe('Event Dashboard — Event fixture'));
        const entry = reads.find(url => url.pathname.endsWith('/entry'));
        const detail = reads.find(url => url.pathname.endsWith('/' + frontendEventId));
        expect(entry?.searchParams.get('view')).toBe('admin');
        expect(detail?.searchParams.get('view')).toBe('admin');
        expect(root.find('#registrationForm').exists()).toBe(false);
        expect(router.currentRoute.value.fullPath).toBe(path);
        expect(request.mock.calls.every(([input]) => (input as Request).method === 'GET')).toBe(true);
    });
});
