// @vitest-environment happy-dom
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {flushFrontendPromises as flushPromises} from '../keywords/frontendUiKeywords';
import EventRegistration from '../../src/frontend/features/event/EventRegistration.vue';
import {useEventApi} from '../../src/frontend/features/event/api';
import {createFrontendEventSession, createFrontendEventView, frontendEventId} from '../factories/frontendEventFactory';
import {frontendEventButton as button, frontendEventJson as json, mountFrontendEvent} from '../keywords/frontendUiKeywords';

const cleanups: Array<() => Promise<void>> = [];
beforeEach(() => {vi.stubGlobal('confirm', vi.fn(() => true));});
afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    document.body.innerHTML = '';
});

/** Fill the actual participant date controls before a normal submit event. */
async function enterDates(wrapper: Awaited<ReturnType<typeof mountFrontendEvent>>['wrapper'], arrival = '2027-06-01', departure = '2027-06-03') {
    await wrapper.get('[name="arrivalDate"]').setValue(arrival);
    await wrapper.get('[name="departureDate"]').setValue(departure);
}

describe('Event participant registration', () => {
    it('shares sticky localized validation feedback while preserving and correcting the registration draft', async () => {
        const event = createFrontendEventView({requireDietaryInfo: true});
        const mounted = await mountFrontendEvent(EventRegistration, async () => json({changed: true}),
            {event, refresh: async () => {}});
        cleanups.push(mounted.dispose);
        await enterDates(mounted.wrapper);
        const arrival = mounted.wrapper.get<HTMLInputElement>('[name="arrivalDate"]');
        await mounted.wrapper.get('form').trigger('submit');
        expect(mounted.request).not.toHaveBeenCalled();
        const feedback = mounted.wrapper.get('.frontend-notification.alert-danger');
        expect(feedback.text()).toContain(mounted.context.messages.value.t('event.registration.mealRequired'));
        expect(feedback.element.closest('.frontend-notice-region')).not.toBeNull();

        mounted.context.locale.value = 'de';
        await flushPromises();
        expect(mounted.wrapper.get('.frontend-notification.alert-danger').element).toBe(feedback.element);
        expect(feedback.text()).toContain(mounted.context.messages.value.t('event.registration.mealRequired'));
        expect(mounted.wrapper.get('[name="arrivalDate"]').element).toBe(arrival.element);
        expect(arrival.element.value).toBe('2027-06-01');
        await mounted.wrapper.get('#diet-meat').setValue(true);
        expect(mounted.wrapper.find('.frontend-notification.alert-danger').exists()).toBe(false);
        expect(mounted.request).not.toHaveBeenCalled();

        await mounted.wrapper.get('#diet-meat').setValue(false);
        await mounted.wrapper.get('form').trigger('submit');
        await mounted.wrapper.get('.frontend-notification .btn-close').trigger('click');
        expect(mounted.wrapper.find('.frontend-notification').exists()).toBe(false);
        expect(arrival.element.value).toBe('2027-06-01');
        expect(mounted.request).not.toHaveBeenCalled();
    });

    it.each(['save', 'cancel'] as const)('marks only registration %s pending while the shared command blocks both controls', async kind => {
        const event = createFrontendEventView({requireDietaryInfo: false, registration: {id: '17', arrivalDate: '2027-06-01',
            departureDate: '2027-06-03', dietary: [], allergyNotes: '', dietComment: ''}});
        let settle!: (response: Response) => void;
        const mounted = await mountFrontendEvent(EventRegistration, async () => new Promise<Response>(resolve => { settle = resolve; }),
            {event, refresh: async () => {}});
        cleanups.push(mounted.dispose);
        const save = button(mounted.wrapper, 'Update');
        const cancel = button(mounted.wrapper, 'Cancel registration');
        const initiator = kind === 'save' ? save : cancel;
        const sibling = kind === 'save' ? cancel : save;
        if (kind === 'save') await mounted.wrapper.get('form').trigger('submit');
        else await cancel.trigger('click');
        await flushPromises();
        try {
            expect(initiator.attributes('disabled')).toBeDefined();
            expect(sibling.attributes('disabled')).toBeDefined();
            expect(initiator.attributes('aria-busy')).toBe('true');
            expect(sibling.attributes('aria-busy')).toBe('false');
            expect(initiator.find('.spinner-border').exists()).toBe(true);
            expect(sibling.find('.spinner-border').exists()).toBe(false);
        } finally {
            settle(json({changed: true}));
            await flushPromises();
        }
    });

    it('retranslates saved attendance without replacing the independent date draft', async () => {
        vi.stubEnv('TZ', 'America/Los_Angeles');
        const event = createFrontendEventView({registration: {id: '17', arrivalDate: '2027-06-01',
            departureDate: '2027-06-03', dietary: [], allergyNotes: '', dietComment: ''}});
        const mounted = await mountFrontendEvent(EventRegistration, async () => json({changed: true}),
            {event, refresh: async () => {}});
        cleanups.push(mounted.dispose);
        const departure = mounted.wrapper.get<HTMLInputElement>('[name="departureDate"]');
        await departure.setValue('2027-06-02');
        expect(mounted.wrapper.get('#arrival').text()).toBe('Tuesday, June 1, 2027');
        expect(mounted.wrapper.get('#departure').text()).toBe('Thursday, June 3, 2027');

        mounted.context.locale.value = 'de';
        await flushPromises();
        expect(mounted.wrapper.get('#arrival').text()).toBe('Dienstag, 1. Juni 2027');
        expect(mounted.wrapper.get('#departure').text()).toBe('Donnerstag, 3. Juni 2027');
        expect(mounted.wrapper.get('[name="departureDate"]').element).toBe(departure.element);
        expect(departure.element.value).toBe('2027-06-02');
        expect(event.registration?.departureDate).toBe('2027-06-03');
        expect(mounted.request).not.toHaveBeenCalled();
    });

    it.each([false, true])('preserves the native dietary-requirements icon for registered=%s', async registered => {
        const event = createFrontendEventView({registration: registered ? {id: '17', arrivalDate: '2027-06-01',
            departureDate: '2027-06-03', dietary: [], allergyNotes: '', dietComment: ''} : null});
        const mounted = await mountFrontendEvent(EventRegistration, async () => json({changed: true}),
            {event, refresh: async () => {}});
        cleanups.push(mounted.dispose);
        const label = mounted.wrapper.findAll('label').find(control => control.text() === 'Dietary requirements (optional)')!;
        expect(label.get('i').classes()).toContain(registered ? 'bi-exclamation-circle' : 'bi-egg-fried');
    });

    it('creates and updates once per deliberate save and submits the route token only with the command', async () => {
        const event = createFrontendEventView({requireDietaryInfo: false});
        const writes: {method: string; body: unknown}[] = [];
        const refresh = vi.fn(async () => {});
        const mounted = await mountFrontendEvent(EventRegistration, async request => {
            writes.push({method: request.method, body: await request.json()});
            return json({changed: true});
        }, {event, refresh}, `/event/${frontendEventId}?regToken=private%2Btoken`);
        cleanups.push(mounted.dispose);
        expect(mounted.request).not.toHaveBeenCalled();
        refresh.mockImplementation(async () => {
            await mounted.wrapper.setProps({event: {...event, registrationCount: 1,
                registration: {id: '17', arrivalDate: '2027-06-01', departureDate: '2027-06-03',
                    dietary: [], allergyNotes: '', dietComment: ''}}});
        });
        await enterDates(mounted.wrapper);
        await mounted.wrapper.get('form').trigger('submit');
        await flushPromises();
        expect(writes).toEqual([{method: 'PUT', body: {arrivalDate: '2027-06-01', departureDate: '2027-06-03', dietary: [], regToken: 'private+token'}}]);
        expect(refresh).toHaveBeenCalledOnce();
        await mounted.wrapper.get('[name="departureDate"]').setValue('2027-06-02');
        await mounted.wrapper.get('form').trigger('submit');
        await flushPromises();
        expect(writes).toHaveLength(2);
        expect(writes[1]).toEqual({method: 'PUT', body: {arrivalDate: '2027-06-01', departureDate: '2027-06-02', dietary: [], regToken: 'private+token'}});
        expect(mounted.request.mock.calls.every(([request]) => !(request as Request).url.includes('private'))).toBe(true);
    });

    it.each([false, true])('keeps all deadline variants server-controlled and cancellation independent of write grants (%s)', async allowed => {
        const event = createFrontendEventView({requireDietaryInfo: false, bindingDeadline: '2000-01-01T00:00:00Z',
            allowRegDateUpdatesAfterDeadline: allowed, allowRegDietUpdateAfterDeadline: allowed,
            allowRegCancelationAfterDeadline: allowed,
            registration: {id: '17', arrivalDate: '2027-06-01', departureDate: '2027-06-03', dietary: [], allergyNotes: '', dietComment: ''}});
        const mounted = await mountFrontendEvent(EventRegistration, async () => json({changed: true}), {event, refresh: async () => {}});
        cleanups.push(mounted.dispose);
        expect(mounted.wrapper.get('[name="arrivalDate"]').attributes('disabled')).toBeUndefined();
        expect(button(mounted.wrapper, 'Update').attributes('disabled')).toBeUndefined();
        await mounted.wrapper.setProps({event: {...event, capabilities: {...event.capabilities, register: false}}});
        expect(button(mounted.wrapper, 'Update').attributes('disabled')).toBeUndefined();
        expect(button(mounted.wrapper, 'Cancel registration').attributes('disabled')).toBeUndefined();
        expect(mounted.request).not.toHaveBeenCalled();
    });

    it.each(['confirmed', 'rejected', 'unknown'] as const)('dispatches deliberate cancellation once and preserves the %s outcome', async outcome => {
        const event = createFrontendEventView({requireDietaryInfo: false, registrationCount: 1,
            registration: {id: '17', arrivalDate: '2027-06-01', departureDate: '2027-06-03',
                dietary: [], allergyNotes: '', dietComment: ''}});
        let current = event;
        const refresh = vi.fn(async () => {});
        const mounted = await mountFrontendEvent(EventRegistration, async request => {
            if (request.method === 'GET') return json(current);
            expect(request.method).toBe('DELETE');
            expect(new URL(request.url).pathname).toBe(`/api/v1/events/${frontendEventId}/registration`);
            expect(await request.text()).toBe('');
            if (outcome === 'unknown') throw new Error('Cancellation response lost after dispatch');
            if (outcome === 'rejected') return new Response(JSON.stringify({type: 'about:blank', title: 'Forbidden',
                status: 403, detail: 'Cancellation is closed.', code: 'EVENT_CANCELLATION_CLOSED',
                messageKey: 'api:errors.EVENT_CANCELLATION_CLOSED', params: {}, requestId: 'cancellation-rejection'}),
            {status: 403, headers: {'Content-Type': 'application/problem+json',
                'X-Surveyor-Context': createFrontendEventSession().context}});
            current = {...event, registration: null, registrationCount: 0};
            return json({changed: true});
        }, {event, refresh});
        cleanups.push(mounted.dispose);
        refresh.mockImplementation(async () => {
            const admitted = await useEventApi(mounted.context).event(event.id, mounted.context.capture());
            await mounted.wrapper.setProps({event: admitted});
        });
        await mounted.wrapper.get('[name="departureDate"]').setValue('2027-06-02');
        vi.mocked(window.confirm).mockReturnValueOnce(false);
        await button(mounted.wrapper, 'Cancel registration').trigger('click');
        expect(mounted.request).not.toHaveBeenCalled();
        expect(mounted.wrapper.get<HTMLInputElement>('[name="departureDate"]').element.value).toBe('2027-06-02');
        await button(mounted.wrapper, 'Cancel registration').trigger('click');
        await flushPromises();
        expect(mounted.request.mock.calls.filter(([request]) => (request as Request).method === 'DELETE')).toHaveLength(1);
        if (outcome === 'confirmed') {
            expect(refresh).toHaveBeenCalledOnce();
            expect(mounted.wrapper.find('#cancelRegistrationBtn').exists()).toBe(false);
            expect(mounted.wrapper.get<HTMLInputElement>('[name="departureDate"]').element.value).toBe('');
            expect(button(mounted.wrapper, 'Save registration').attributes('disabled')).toBeUndefined();
            return;
        }
        expect(refresh).not.toHaveBeenCalled();
        expect(mounted.wrapper.props('event').registration?.id).toBe('17');
        expect(mounted.wrapper.get<HTMLInputElement>('[name="departureDate"]').element.value).toBe('2027-06-02');
        if (outcome === 'rejected') {
            expect(button(mounted.wrapper, 'Cancel registration').attributes('disabled')).toBeUndefined();
            expect(mounted.wrapper.text()).not.toContain('The result is uncertain.');
            return;
        }
        expect(button(mounted.wrapper, 'Cancel registration').attributes('disabled')).toBeDefined();
        expect(mounted.wrapper.text()).toContain('The result is uncertain.');
        await button(mounted.wrapper, 'Cancel registration').trigger('click');
        await button(mounted.wrapper, 'Refresh').trigger('click');
        await flushPromises();
        expect(mounted.request.mock.calls.map(([request]) => (request as Request).method)).toEqual(['DELETE', 'GET']);
        expect(mounted.wrapper.props('event').registration?.id).toBe('17');
        expect(mounted.wrapper.get<HTMLInputElement>('[name="departureDate"]').element.value).toBe('2027-06-02');
        expect(button(mounted.wrapper, 'Cancel registration').attributes('disabled')).toBeUndefined();
    });

    it('keeps the native usable form when registration permission is absent and retains a rejected attempt', async () => {
        const event = createFrontendEventView();
        event.capabilities.register = false;
        const refresh = vi.fn(async () => {});
        const mounted = await mountFrontendEvent(EventRegistration, async () => {
            const session = createFrontendEventSession();
            return new Response(JSON.stringify({type: 'about:blank', title: 'Forbidden', status: 403, detail: 'Not allowed',
                code: 'FORBIDDEN', messageKey: 'api:errors.FORBIDDEN', params: {}, requestId: 'registration-grant-rejection'}),
            {status: 403, headers: {'Content-Type': 'application/problem+json', 'X-Surveyor-Context': session.context}});
        }, {event, refresh});
        cleanups.push(mounted.dispose);
        await enterDates(mounted.wrapper);
        await mounted.wrapper.get('#diet-vegan').setValue(true);
        expect(button(mounted.wrapper, 'Save registration').attributes('disabled')).toBeUndefined();
        await mounted.wrapper.get('form').trigger('submit');
        await flushPromises();
        expect(mounted.request).toHaveBeenCalledOnce();
        expect(refresh).not.toHaveBeenCalled();
        expect(mounted.wrapper.get<HTMLInputElement>('[name="arrivalDate"]').element.value).toBe('2027-06-01');
        expect(mounted.wrapper.get<HTMLInputElement>('#diet-vegan').element.checked).toBe(true);
    });

    it('retains rejected input and matches native allergy-required checkbox behavior', async () => {
        const event = createFrontendEventView();
        const mounted = await mountFrontendEvent(EventRegistration, async () => {
            const session = createFrontendEventSession();
            return new Response(JSON.stringify({type: 'about:blank', title: 'Invalid', status: 400, detail: 'Review the request.',
                code: 'VALIDATION_FAILED', messageKey: 'api:errors.VALIDATION_FAILED', params: {}, requestId: 'registration-rejection'}),
            {status: 400, headers: {'Content-Type': 'application/problem+json', 'X-Surveyor-Context': session.context}});
        }, {event, refresh: vi.fn(async () => {})});
        cleanups.push(mounted.dispose);
        await enterDates(mounted.wrapper);
        await mounted.wrapper.get('#diet-meat').setValue(true);
        await mounted.wrapper.get('#diet-allergies').setValue(true);
        expect(mounted.wrapper.get('#allergyNotes').attributes('required')).toBeDefined();
        await mounted.wrapper.get('#allergyNotes').setValue('Peanuts');
        await mounted.wrapper.get('form').trigger('submit');
        await flushPromises();
        expect(mounted.request).toHaveBeenCalledOnce();
        expect(mounted.wrapper.get<HTMLInputElement>('#allergyNotes').element.value).toBe('Peanuts');
        expect(mounted.wrapper.get<HTMLInputElement>('#diet-allergies').element.checked).toBe(true);
        await mounted.wrapper.get('#diet-allergies').setValue(false);
        expect(mounted.wrapper.get('#allergyNotes').attributes('required')).toBeUndefined();
        expect(mounted.wrapper.get<HTMLInputElement>('#allergyNotes').element.value).toBe('Peanuts');
    });

    it('submits only rendered dietary choices after comments are disabled without clearing visible date edits', async () => {
        const event = createFrontendEventView({allowDietComment: true,
            registration: {id: '17', arrivalDate: '2027-06-01', departureDate: '2027-06-03',
                dietary: ['MEAT', 'COMMENT'], allergyNotes: '', dietComment: 'Saved comment'}});
        const writes: unknown[] = [];
        const mounted = await mountFrontendEvent(EventRegistration, async request => {
            writes.push(await request.json());
            return json({changed: true});
        }, {event, refresh: async () => {}});
        cleanups.push(mounted.dispose);
        await mounted.wrapper.get('[name="arrivalDate"]').setValue('2027-06-02');
        await mounted.wrapper.get('#dietComment').setValue('Unsubmitted comment');
        await mounted.wrapper.setProps({event: {...event, allowDietComment: false}});
        expect(mounted.wrapper.find('#diet-comment').exists()).toBe(false);
        expect(mounted.wrapper.find('#dietComment').exists()).toBe(false);
        expect(mounted.wrapper.get<HTMLInputElement>('[name="arrivalDate"]').element.value).toBe('2027-06-02');
        await mounted.wrapper.get('form').trigger('submit');
        await flushPromises();
        expect(writes).toEqual([{arrivalDate: '2027-06-02', departureDate: '2027-06-03', dietary: ['MEAT'], allergyNotes: ''}]);
    });

    it('recovers an unknown registration with a fresh read without replaying its write or clearing the draft', async () => {
        const event = createFrontendEventView({requireDietaryInfo: false});
        const refresh = vi.fn(async () => {});
        const mounted = await mountFrontendEvent(EventRegistration, async request => {
            if (request.method === 'PUT') throw new Error('Lost response after dispatch');
            return json(event);
        }, {event, refresh});
        cleanups.push(mounted.dispose);
        refresh.mockImplementation(async () => {
            const result = await useEventApi(mounted.context).event(event.id, mounted.context.capture());
            await mounted.wrapper.setProps({event: result});
        });
        await enterDates(mounted.wrapper);
        await mounted.wrapper.get('form').trigger('submit');
        await flushPromises();
        expect(button(mounted.wrapper, 'Save registration').attributes('disabled')).toBeDefined();
        expect(mounted.request.mock.calls.map(([request]) => (request as Request).method)).toEqual(['PUT']);
        await button(mounted.wrapper, 'Refresh').trigger('click');
        await flushPromises();
        expect(mounted.request.mock.calls.map(([request]) => (request as Request).method)).toEqual(['PUT', 'GET']);
        expect(mounted.wrapper.get<HTMLInputElement>('[name="arrivalDate"]').element.value).toBe('2027-06-01');
        expect(button(mounted.wrapper, 'Save registration').attributes('disabled')).toBeUndefined();
    });

    it('keeps unknown registration input when its deliberate recovery read fails without leaking an event rejection', async () => {
        const event = createFrontendEventView({requireDietaryInfo: false});
        const refresh = vi.fn(async () => { throw new TypeError('Recovery read unavailable'); });
        const mounted = await mountFrontendEvent(EventRegistration, async () => { throw new TypeError('Lost write response'); },
            {event, refresh});
        cleanups.push(mounted.dispose);
        const eventErrors = vi.fn();
        mounted.wrapper.vm.$.appContext.config.errorHandler = eventErrors;
        await enterDates(mounted.wrapper);
        const arrival = mounted.wrapper.get<HTMLInputElement>('[name="arrivalDate"]');
        await mounted.wrapper.get('form').trigger('submit');
        await flushPromises();
        await button(mounted.wrapper, 'Refresh').trigger('click');
        await flushPromises();

        expect(eventErrors).not.toHaveBeenCalled();
        expect(refresh).toHaveBeenCalledOnce();
        expect(mounted.request).toHaveBeenCalledOnce();
        expect(mounted.wrapper.get('[name="arrivalDate"]').element).toBe(arrival.element);
        expect(arrival.element.value).toBe('2027-06-01');
        expect(button(mounted.wrapper, 'Save registration').attributes('disabled')).toBeDefined();
        expect(mounted.wrapper.text()).toContain(mounted.context.messages.value.t('state.unknownOutcome'));
    });

    it('releases participant fields when the resource or admitted actor changes', async () => {
        const event = createFrontendEventView({requireDietaryInfo: false});
        const mounted = await mountFrontendEvent(EventRegistration, async () => json({changed: true}), {event, refresh: async () => {}});
        cleanups.push(mounted.dispose);
        await enterDates(mounted.wrapper);
        await mounted.wrapper.setProps({event: {...event, id: '22222222-2222-4222-8222-222222222222'}});
        expect(mounted.wrapper.get<HTMLInputElement>('[name="arrivalDate"]').element.value).toBe('');
        await enterDates(mounted.wrapper);
        mounted.context.epoch.value++;
        await flushPromises();
        expect(mounted.wrapper.get<HTMLInputElement>('[name="arrivalDate"]').element.value).toBe('');
        expect(mounted.request).not.toHaveBeenCalled();
    });
});
