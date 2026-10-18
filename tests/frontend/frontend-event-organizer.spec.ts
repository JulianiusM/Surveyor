// @vitest-environment happy-dom
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {flushPromises} from '@vue/test-utils';
import {defineComponent, ref, type Component} from 'vue';
import {useDraftProtection} from '../../src/frontend/composables/command';
import {createFrontendEventSession, frontendEventId as eventId} from '../factories/frontendEventFactory';
import {frontendEventJson as json, frontendEventButton as button, mountFrontendEvent} from '../keywords/frontendEventKeywords';
import {eventKeys} from '../../src/frontend/app/queryKeys';
import EventParticipants from '../../src/frontend/features/event/EventParticipants.vue';
import EventBypassLinks from '../../src/frontend/features/event/EventBypassLinks.vue';
import EventThingsToDo from '../../src/frontend/features/event/EventThingsToDo.vue';
import {copyEventText} from '../../src/frontend/features/event/clipboard';
import AppDialog from '../../src/frontend/components/AppDialog.vue';
import type {components} from '../../src/types/api/v1';

const childId = '22222222-2222-4222-8222-222222222222';
const linkId = '33333333-3333-4333-8333-333333333333';
const session = createFrontendEventSession();
const participant: components['schemas']['EventParticipant'] = {id: '17', profileId: childId, name: '<A guest>',
    email: 'guest@example.test', arrivalDate: '2027-06-01', departureDate: '2027-06-03',
    dietary: [{choice: 'ALLERGIES', additionalInfo: '<peanuts>; lactose'}, {choice: 'MEAT', additionalInfo: null}]};
const roster: components['schemas']['EventParticipants'] = {participants: [participant],
    totals: [{key: 'ALLERGIES', count: 1}, {key: 'MEAT', count: 1}], dateTotals: [{date: '2027-06-01', count: 1}],
    allergies: ['<peanuts>', 'lactose'], comments: [], generatedAt: '2026-10-16T00:00:00Z'};
const link: components['schemas']['EventRegistrationLink'] = {id: linkId, token: 'real-row-token',
    createdAt: '2026-10-16T00:00:00Z', expiresAt: null, revokedAt: null, used: false, profileId: null, status: 'active'};
const card: components['schemas']['OverviewCard'] = {id: childId, type: 'activity', title: 'Shared shifts',
    description: 'An archived plan', url: `/frontend-pilot/activity/${childId}`, headerUrl: null, headerVersion: null,
    eventContext: null, visibility: 'hidden', overviewHidden: true, archived: true, inheritedArchived: false,
    capabilities: {archive: false, restore: true, duplicate: false, remove: false}, children: null,
    automation: {paused: true, canManage: true}};
const cleanups: Array<() => Promise<void>> = [];
beforeEach(() => { vi.stubGlobal('confirm', vi.fn(() => true)); });

afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
});

function denied(): Response {
    return new Response(JSON.stringify({type: 'about:blank', title: 'Forbidden', status: 403,
        detail: 'Not allowed', code: 'FORBIDDEN', messageKey: 'api:errors.FORBIDDEN', params: {}, requestId: 'organizer-denial'}),
    {status: 403, headers: {'Content-Type': 'application/problem+json', 'X-Surveyor-Context': session.context}});
}

/** Replace only HTTP delivery while mounting real generated adapters, query admission,
 * commands and dialogs; these client tests make no persistence/system-test claim. */
async function mounted(component: Component, handler: (request: Request) => Promise<Response>, props: Record<string, unknown> = {}) {
    const mounted = await mountFrontendEvent(component, handler, {eventId, ...props});
    cleanups.push(mounted.dispose);
    await vi.waitFor(() => expect(mounted.request).toHaveBeenCalled());
    await vi.waitFor(() => expect(mounted.context.queryClient.isFetching()).toBe(0));
    await flushPromises();
    return mounted;
}

describe('Event organizer workflows', () => {
    it('approves sibling drafts before deleting a captured child and retries only confirmed navigation', async () => {
        const host = defineComponent({inheritAttrs: false, components: {EventThingsToDo}, setup() {
            const draft = ref('');
            useDraftProtection({dirty: () => !!draft.value, unknownMessage: 'draft.leaveUnknown'});
            return {draft, eventId};
        }, template: '<input data-test="sibling-draft" v-model="draft" /><EventThingsToDo :event-id="eventId" admin />'});
        const owned = {...card, capabilities: {...card.capabilities, remove: true}};
        let finishDelete: (() => void) | undefined;
        const {wrapper, request, router} = await mounted(host, async req => {
            if (req.method === 'DELETE') {
                expect(new URL(req.url).pathname).toBe(`/api/v1/events/${eventId}/things-to-do/activity/${childId}`);
                expect(new URL(req.url).searchParams.get('view')).toBe('admin');
                return new Promise<Response>(resolve => {finishDelete = () => resolve(json({changed: true}));});
            }
            return json({items: [owned]});
        });
        router.addRoute({path: '/frontend-pilot', component: defineComponent({template: '<p>Overview</p>'})});
        router.onError(() => {});
        await wrapper.findAll('.accordion-button')[1]!.trigger('click');
        await wrapper.get('[data-test="sibling-draft"]').setValue('Retain this draft');
        const confirmation = vi.mocked(window.confirm);
        confirmation.mockReturnValue(false);
        await button(wrapper, 'Delete').trigger('click'); await flushPromises();
        expect(confirmation).toHaveBeenCalledWith('Discard changes?');
        expect(request.mock.calls.filter(([input]) => (input as Request).method === 'DELETE')).toHaveLength(0);

        confirmation.mockReset().mockReturnValueOnce(true).mockReturnValueOnce(false);
        await button(wrapper, 'Delete').trigger('click'); await flushPromises();
        expect(request.mock.calls.filter(([input]) => (input as Request).method === 'DELETE')).toHaveLength(0);
        expect(wrapper.get<HTMLInputElement>('[data-test="sibling-draft"]').element.value).toBe('Retain this draft');

        confirmation.mockReset().mockReturnValue(true);
        const stopFailure = router.beforeResolve(to => {if (to.path === '/frontend-pilot') throw new Error('Destination chunk unavailable');});
        await button(wrapper, 'Delete').trigger('click'); await flushPromises();
        expect(finishDelete).toBeTypeOf('function');
        expect(button(wrapper, 'Delete').attributes('disabled')).toBeDefined();
        finishDelete!(); await flushPromises();
        expect(wrapper.text()).toContain('Changes saved');
        expect(router.currentRoute.value.path).toBe(`/frontend-pilot/event/${eventId}`);
        stopFailure();
        await button(wrapper, 'Try again').trigger('click'); await flushPromises();
        expect(router.currentRoute.value.path).toBe('/frontend-pilot');
        expect(confirmation).toHaveBeenCalledTimes(2);
        expect(request.mock.calls.filter(([input]) => (input as Request).method === 'DELETE')).toHaveLength(1);
    });

    it.each([
        {name: 'participant roster', component: EventParticipants, value: roster,
            props: {startDate: '2027-06-01', endDate: '2027-06-03'}, initiallyOpen: false},
        {name: 'registration links', component: EventBypassLinks, value: {items: [link]}, props: {}, initiallyOpen: false},
        {name: 'participant things', component: EventThingsToDo, value: {items: [card]}, props: {}, initiallyOpen: true},
        {name: 'organizer child groups', component: EventThingsToDo, value: {items: [card]}, props: {admin: true}, initiallyOpen: false},
    ])('reads initial $name counts but polls only while disclosed and visible', async ({component, value, props, initiallyOpen}) => {
        // Preserve real asynchronous delivery and control events while advancing
        // only recurring intervals; no timer may manufacture a network response.
        vi.useFakeTimers({toFake: ['setInterval', 'clearInterval']});
        vi.spyOn(Math, 'random').mockReturnValue(0);
        const {wrapper, request, context} = await mounted(component, async () => json(value), props);
        const disclosure = wrapper.findAll('.accordion-button')[0]!;
        if (initiallyOpen) await disclosure.trigger('click');
        await flushPromises();
        await vi.advanceTimersByTimeAsync(60_000);
        await flushPromises();
        expect(request).toHaveBeenCalledOnce();
        expect(disclosure.get('.badge').text()).toBe(component === EventThingsToDo && props.admin ? '0' : '1');

        await disclosure.trigger('click');
        await flushPromises();
        await vi.advanceTimersByTimeAsync(30_000);
        await flushPromises();
        expect(request).toHaveBeenCalledTimes(2);
        context.visible.value = false;
        await flushPromises();
        await vi.advanceTimersByTimeAsync(60_000);
        expect(request).toHaveBeenCalledTimes(2);
        context.visible.value = true;
        await flushPromises();
        await vi.advanceTimersByTimeAsync(30_000);
        await flushPromises();
        expect(request).toHaveBeenCalledTimes(3);
        await disclosure.trigger('click');
        await flushPromises();
        await vi.advanceTimersByTimeAsync(60_000);
        expect(request).toHaveBeenCalledTimes(3);
    });

    it.each([
        {name: 'roster', component: EventParticipants, value: {participants: [], totals: [], dateTotals: [],
            allergies: [], comments: [], generatedAt: '2026-10-16T00:00:00Z'},
        props: {startDate: '2027-06-01', endDate: '2027-06-03'}},
        {name: 'link list', component: EventBypassLinks, value: {items: []}, props: {}},
    ])('distinguishes an unknown $name count from an admitted empty result and retires it on denial', async ({component, value, props}) => {
        let finishRead: ((response: Response) => void) | undefined;
        let rejectRead = false;
        const result = await mountFrontendEvent(component, async () => rejectRead ? denied()
            : new Promise<Response>(resolve => {finishRead = resolve;}), {eventId, ...props});
        cleanups.push(result.dispose);
        const badge = result.wrapper.get('.accordion-button .badge');
        expect(badge.text()).toBe('Unknown');
        finishRead!(json(value));
        await flushPromises();
        expect(badge.text()).toBe('0');
        rejectRead = true;
        await result.context.queryClient.refetchQueries();
        await flushPromises();
        expect(badge.text()).toBe('Unknown');
    });

    it.each([false, true])('omits the native notes-summary action when no notes exist (populated=%s)', async populated => {
        const emptyNotes = {...roster, participants: populated ? [{...participant, dietary: [{choice: 'MEAT', additionalInfo: null}]}] : [],
            allergies: [], comments: []};
        const {wrapper} = await mounted(EventParticipants, async () => json(emptyNotes),
            {startDate: '2027-06-01', endDate: '2027-06-03'});
        await wrapper.get('.accordion-button').trigger('click');
        expect(wrapper.findAll('button').some(control => control.text().trim() === 'Allergy / Comment Details')).toBe(false);
        expect(document.querySelector('[role="dialog"]')).toBeNull();
    });

    it('localizes dietary badges and search while retaining date totals as civil dates', async () => {
        const {wrapper, context, request} = await mounted(EventParticipants, async () => json(roster),
            {startDate: '2027-06-01', endDate: '2027-06-03'});
        await wrapper.get('.accordion-button').trigger('click');
        context.locale.value = 'de';
        await flushPromises();
        expect(wrapper.get('.js-totals').text()).toContain('ALLERGIEN: 1');
        expect(wrapper.get('.js-date-totals').text()).toContain('2027-06-01: 1');
        await wrapper.get('.js-filter').setValue('Fleisch');
        expect(wrapper.findAll('tbody tr')).toHaveLength(1);
        expect(request).toHaveBeenCalledOnce();
    });

    it('retains the native clipboard fallback and restores its invoking focus without retaining a temporary field', async () => {
        vi.stubGlobal('navigator', {...navigator, clipboard: undefined});
        const copied: string[] = [];
        Object.defineProperty(document, 'execCommand', {configurable: true, value: vi.fn(() => {
            copied.push(document.querySelector('textarea')!.value);
            return true;
        })});
        cleanups.push(async () => {Reflect.deleteProperty(document, 'execCommand');});
        const invoker = document.createElement('button');
        document.body.append(invoker);
        invoker.focus();
        await copyEventText('real-token-link');
        expect(copied).toEqual(['real-token-link']);
        expect(document.querySelector('textarea')).toBeNull();
        expect(document.activeElement).toBe(invoker);
    });

    it('keeps the participant roster read-only and its full totals independent of local search', async () => {
        const {wrapper, request} = await mounted(EventParticipants, async () => json(roster),
            {startDate: '2027-06-01', endDate: '2027-06-03'});
        await wrapper.get('.accordion-button').trigger('click');
        expect(wrapper.text()).toContain('<A guest>');
        expect(wrapper.find('a-guest').exists()).toBe(false);
        expect(wrapper.findAll('button').some(item => item.text().includes('Edit dates'))).toBe(false);
        expect(wrapper.findAll('button').some(item => item.text().trim() === 'Delete')).toBe(false);
        await wrapper.get('.js-filter').setValue('no-match');
        expect(wrapper.findAll('tbody tr')).toHaveLength(0);
        expect(wrapper.get('.js-totals').text()).toContain('MEAT: 1');
        expect(wrapper.get('.js-date-totals').text()).toContain('2027-06-01: 1');
        expect(request).toHaveBeenCalledOnce();
        await button(wrapper, 'Allergy / Comment Details').trigger('click');
        await flushPromises();
        expect(document.querySelector('[role="dialog"]')!.textContent).toContain('<peanuts>');
        expect(document.querySelector('[role="dialog"] peanuts')).toBeNull();
    });

    it('updates an open participant notes selection from fresh admitted rows and closes it after removal', async () => {
        let current = roster;
        const {wrapper, context, request} = await mounted(EventParticipants, async () => json(current),
            {startDate: '2027-06-01', endDate: '2027-06-03'});
        await wrapper.get('.accordion-button').trigger('click');
        await button(wrapper, 'Details').trigger('click');
        await flushPromises();
        expect(document.querySelector('[role="dialog"]')!.textContent).toContain('<peanuts>');

        // Search is presentation only. A fresh full-roster read updates an open
        // participant selection even while its table row is filtered away.
        await wrapper.get('.js-filter').setValue('no-match');
        current = {...roster, participants: [{...participant, dietary: [
            {choice: 'ALLERGIES', additionalInfo: ' sesame ; soy '},
            {choice: 'COMMENT', additionalInfo: 'No tomatoes'},
        ]}], allergies: ['sesame', 'soy'], comments: ['No tomatoes']};
        await context.queryClient.refetchQueries({queryKey: eventKeys.participants(session.context, eventId)});
        await flushPromises();
        const dialog = document.querySelector('[role="dialog"]')!;
        expect(dialog.textContent).toContain('sesame');
        expect(dialog.textContent).toContain('soy');
        expect(dialog.textContent).toContain('No tomatoes');
        expect(dialog.textContent).not.toContain('<peanuts>');
        expect(wrapper.findAll('tbody tr')).toHaveLength(0);

        // A removed registration retires the selected identity. Returning data
        // later must not reopen an old read-only dialog automatically.
        current = {...roster, participants: [], allergies: [], comments: []};
        await context.queryClient.refetchQueries({queryKey: eventKeys.participants(session.context, eventId)});
        await flushPromises();
        expect(document.querySelector('[role="dialog"]')).toBeNull();
        current = roster;
        await context.queryClient.refetchQueries({queryKey: eventKeys.participants(session.context, eventId)});
        await flushPromises();
        expect(document.querySelector('[role="dialog"]')).toBeNull();
        expect(request.mock.calls.every(([input]) => (input as Request).method === 'GET')).toBe(true);
    });

    it('updates an open whole-roster notes summary and closes it when admitted notes become empty', async () => {
        let current = roster;
        const {wrapper, context} = await mounted(EventParticipants, async () => json(current),
            {startDate: '2027-06-01', endDate: '2027-06-03'});
        await wrapper.get('.accordion-button').trigger('click');
        await button(wrapper, 'Allergy / Comment Details').trigger('click');
        await flushPromises();
        expect(document.querySelector('[role="dialog"]')!.textContent).toContain('<peanuts>');

        // Summary membership belongs to the server projection, not the search
        // result or a copied list retained when its dialog first opened.
        await wrapper.get('.js-filter').setValue('no-match');
        current = {...roster, allergies: ['Updated allergy'], comments: ['Updated comment']};
        await context.queryClient.refetchQueries({queryKey: eventKeys.participants(session.context, eventId)});
        await flushPromises();
        expect(document.querySelector('[role="dialog"]')!.textContent).toContain('Updated allergy');
        expect(document.querySelector('[role="dialog"]')!.textContent).toContain('Updated comment');
        expect(document.querySelector('[role="dialog"]')!.textContent).not.toContain('<peanuts>');

        current = {...roster, allergies: [], comments: []};
        await context.queryClient.refetchQueries({queryKey: eventKeys.participants(session.context, eventId)});
        await flushPromises();
        expect(document.querySelector('[role="dialog"]')).toBeNull();
    });

    it('preserves an organizer date draft through a fresh roster read and sends the captured registration once', async () => {
        const writes: {path: string; body: unknown}[] = [];
        const {wrapper, context} = await mounted(EventParticipants, async request => {
            if (request.method === 'PATCH') { writes.push({path: new URL(request.url).pathname, body: await request.json()}); return json({changed: true}); }
            return json(roster);
        }, {startDate: '2027-06-01', endDate: '2027-06-03', manageRegistrations: true});
        await wrapper.get('.accordion-button').trigger('click');
        await button(wrapper, 'Edit dates').trigger('click');
        await flushPromises();
        const dialog = wrapper.findAllComponents(AppDialog).find(value => value.props('open'))!;
        const arrival = document.querySelector<HTMLInputElement>('[role="dialog"] [name="arrivalDate"]')!;
        arrival.value = '2027-06-02';
        arrival.dispatchEvent(new Event('input', {bubbles: true}));
        await context.queryClient.refetchQueries({queryKey: eventKeys.participants(session.context, eventId)});
        await flushPromises();
        expect(arrival.value).toBe('2027-06-02');
        const form = document.querySelector<HTMLFormElement>('[role="dialog"] form')!;
        form.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
        await flushPromises();
        expect(writes).toEqual([{path: `/api/v1/events/${eventId}/registrations/17`, body: {arrivalDate: '2027-06-02', departureDate: '2027-06-03'}}]);
        expect(dialog.props('open')).toBe(false);
        expect(wrapper.text()).toContain('Attendance dates updated');
    });

    it('retains a readable date draft but disables its command when the management grant is revoked', async () => {
        const {wrapper, request} = await mounted(EventParticipants, async () => json(roster),
            {startDate: '2027-06-01', endDate: '2027-06-03', manageRegistrations: true});
        await wrapper.get('.accordion-button').trigger('click');
        await button(wrapper, 'Edit dates').trigger('click');
        await flushPromises();
        const arrival = document.querySelector<HTMLInputElement>('[role="dialog"] [name="arrivalDate"]')!;
        arrival.value = '2027-06-02';
        arrival.dispatchEvent(new Event('input', {bubbles: true}));
        await wrapper.setProps({manageRegistrations: false});
        const save = document.querySelector<HTMLButtonElement>('[role="dialog"] button[type="submit"]')!;
        expect(save.disabled).toBe(true);
        expect(arrival.disabled).toBe(true);
        expect(arrival.value).toBe('2027-06-02');
        expect(wrapper.text()).toContain('<A guest>');
        document.querySelector<HTMLFormElement>('[role="dialog"] form')!
            .dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
        await flushPromises();
        expect(request.mock.calls.filter(([input]) => (input as Request).method === 'PATCH')).toHaveLength(0);
        await wrapper.setProps({manageRegistrations: true});
        expect(save.disabled).toBe(false);
        expect(arrival.value).toBe('2027-06-02');
        await wrapper.setProps({manageRegistrations: false});
        const cancel = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
            .find(control => control.textContent?.trim() === 'Cancel')!;
        expect(cancel.disabled).toBe(false);
        cancel.click();
        await flushPromises();
        expect(document.querySelector('[role="dialog"]')).toBeNull();
    });

    it('removes only the confirmed row and retires private roster/modal content after a real denial', async () => {
        let fail = false;
        const {wrapper, context, request} = await mounted(EventParticipants, async req => {
            if (req.method === 'DELETE') return json({changed: true});
            return fail ? denied() : json(roster);
        }, {startDate: '2027-06-01', endDate: '2027-06-03', manageRegistrations: true});
        const confirm = vi.mocked(window.confirm).mockReturnValue(false);
        await wrapper.get('.accordion-button').trigger('click');
        await button(wrapper, 'Delete').trigger('click');
        expect(request.mock.calls.filter(([input]) => (input as Request).method === 'DELETE')).toHaveLength(0);
        confirm.mockReturnValue(true);
        await button(wrapper, 'Delete').trigger('click');
        await flushPromises();
        expect(request.mock.calls.filter(([input]) => (input as Request).method === 'DELETE')).toHaveLength(1);
        await button(wrapper, 'Details').trigger('click');
        fail = true;
        await context.queryClient.refetchQueries({queryKey: eventKeys.participants(session.context, eventId)});
        await flushPromises();
        expect(wrapper.text()).not.toContain('<A guest>');
        expect(document.querySelector('[role="dialog"]')).toBeNull();
    });

    it('copies the actual listed token explicitly and preserves editable native Uses without promising automatic copy', async () => {
        const copied = vi.fn(async () => {});
        vi.stubGlobal('navigator', {...navigator, clipboard: {writeText: copied}});
        const writes: unknown[] = [];
        const {wrapper} = await mounted(EventBypassLinks, async request => {
            if (request.method === 'POST') {writes.push(await request.json()); return json({id: linkId, token: 'created-token'});}
            return json({items: [link]});
        });
        await wrapper.get('.accordion-button').trigger('click');
        await button(wrapper, 'Copy').trigger('click');
        await flushPromises();
        expect(copied.mock.calls[0]).toEqual([`${location.origin}/frontend-pilot/event/${eventId}?regToken=real-row-token`]);
        await button(wrapper, 'Create link').trigger('click');
        await flushPromises();
        const input = document.querySelector<HTMLInputElement>('[role="dialog"] input[type="number"]')!;
        expect(input.readOnly).toBe(false);
        input.value = '3';
        input.dispatchEvent(new Event('input', {bubbles: true}));
        document.querySelector<HTMLFormElement>('[role="dialog"] form')!.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
        await flushPromises();
        expect(writes).toEqual([{maxUses: 3}]);
        expect(copied).toHaveBeenCalledOnce();
    });

    it('does not replay an unknown link creation during explicit list recovery', async () => {
        const {wrapper, request} = await mounted(EventBypassLinks, async req => {
            if (req.method === 'POST') throw new Error('Connection lost after dispatch');
            return json({items: [link]});
        });
        vi.mocked(window.confirm).mockReturnValue(true);
        await wrapper.get('.accordion-button').trigger('click');
        await button(wrapper, 'Create link').trigger('click');
        await flushPromises();
        document.querySelector<HTMLFormElement>('[role="dialog"] form')!.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
        await flushPromises();
        expect(document.body.textContent).toContain('The result is uncertain.');
        // Recovery belongs inside the actual open portal. The background list
        // intentionally has no duplicate action while the creation dialog is open.
        const recovery = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
            .find(control => control.textContent?.trim() === 'Refresh');
        expect(recovery).toBeDefined();
        recovery!.click();
        await flushPromises();
        expect(request.mock.calls.filter(([input]) => (input as Request).method === 'POST')).toHaveLength(1);
        expect(request.mock.calls.filter(([input]) => (input as Request).method === 'GET')).toHaveLength(2);
        expect(document.querySelector('[role="dialog"]')).toBeNull();
    });

    it('recovers an uncertain child schedule command through a fresh read without replaying it', async () => {
        const {wrapper, request} = await mounted(EventThingsToDo, async req => {
            if (req.method === 'PUT') throw new Error('Connection lost after dispatch');
            return json({items: [card]});
        });
        await button(wrapper, 'Resume automatic archival').trigger('click');
        await flushPromises();
        expect(wrapper.text()).toContain('The result is uncertain.');
        // Closing content pauses recurring reads, but the explicit recovery
        // remains usable in its page-level feedback host without another PUT.
        await wrapper.get('.accordion-button').trigger('click');
        await button(wrapper, 'Refresh').trigger('click');
        await flushPromises();
        expect(request.mock.calls.filter(([input]) => (input as Request).method === 'PUT')).toHaveLength(1);
        expect(request.mock.calls.filter(([input]) => (input as Request).method === 'GET')).toHaveLength(2);
        expect(wrapper.text()).not.toContain('The result is uncertain.');
    });

    it('shares ungrouped child cards while preserving native links, archive automation and local filters', async () => {
        const writes: {path: string; body: unknown}[] = [];
        const {wrapper, request} = await mounted(EventThingsToDo, async req => {
            if (req.method === 'PUT') {writes.push({path: new URL(req.url).pathname, body: await req.json()}); return json({changed: true});}
            return json({items: [card]});
        });
        vi.mocked(window.confirm).mockReturnValue(true);
        expect(wrapper.get('article .card-body').attributes('href')).toBe(`/frontend-pilot/activity/${childId}`);
        expect(wrapper.text()).not.toContain('Only my overview');
        expect(wrapper.text()).not.toContain('Hidden for me');
        expect(wrapper.text()).toContain('Shared shifts');
        await wrapper.get('input[type="search"]').setValue('no-match');
        expect(wrapper.findAll('article')).toHaveLength(0);
        expect(request).toHaveBeenCalledOnce();
        await wrapper.get('input[type="search"]').setValue('');
        await button(wrapper, 'Resume automatic archival').trigger('click');
        await flushPromises();
        expect(writes).toEqual([{path: `/api/v1/events/${eventId}/things-to-do/activity/${childId}/automatic-archive`, body: {paused: false}}]);
    });
});
