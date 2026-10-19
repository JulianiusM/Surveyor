// @vitest-environment happy-dom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {flushPromises} from '@vue/test-utils';
import {QueryClient, QueryObserver} from '@tanstack/vue-query';
import EventPage from '../../src/frontend/features/event/EventPage.vue';
import EventSummary from '../../src/frontend/features/event/EventSummary.vue';
import {eventKeys, overviewKeys} from '../../src/frontend/app/queryKeys';
import {refetchFreshQueries} from '../../src/frontend/app/queryCache';
import {ApiFailure, UnconfirmedResponseError} from '../../src/frontend/app/transport';
import {createFrontendEventSession, createFrontendEventView, frontendEventId} from '../factories/frontendEventFactory';
import {frontendEventJson as json, mountFrontendEvent} from '../keywords/frontendEventKeywords';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
});

/** Mount the complete Event page, retaining real query, command and response owners.
 * HTTP alone supplies the existing registration acknowledgement and fresh detail. */
async function registrationVisit() {
    const view = createFrontendEventView({requireDietaryInfo: false});
    const writes: string[] = [];
    const mounted = await mountFrontendEvent(EventPage, async request => {
        if (request.method === 'PUT') {
            // The acknowledged write changes the next real feature GET rather
            // than installing a manual query-cache alias as read authority.
            writes.push(request.method);
            view.registrationCount = 1;
            view.registration = {id: '17', arrivalDate: '2027-06-01', departureDate: '2027-06-03',
                dietary: [], allergyNotes: '', dietComment: ''};
            return json({changed: true});
        }
        return json(view);
    }, {});
    cleanups.push(mounted.dispose);
    return {...mounted, writes};
}

/** Deliberate submission exercises EventRegistration's actual EventPage follow-up. */
async function submitRegistration(mounted: Awaited<ReturnType<typeof registrationVisit>>) {
    await mounted.wrapper.get('#arrivalDate').setValue('2027-06-01');
    await mounted.wrapper.get('#departureDate').setValue('2027-06-03');
    await mounted.wrapper.get('#registrationForm').trigger('submit');
    await flushPromises();
}

describe('Event page read dependencies', () => {
    it.each([403, 404])('retires only affected Event projections after detail denial %s and keeps explicit recovery attached', async status => {
        const view = createFrontendEventView({requireDietaryInfo: false});
        let denied = false;
        const mounted = await mountFrontendEvent(EventPage, async request => new URL(request.url).pathname.endsWith('/things-to-do')
            ? json({items: []}) : denied
            ? new Response(JSON.stringify({type: 'about:blank', title: 'Unavailable', status,
                detail: 'Event projection unavailable', requestId: 'event-detail-denial',
                code: status === 404 ? 'NOT_FOUND' : 'FORBIDDEN',
                messageKey: status === 404 ? 'api:errors.NOT_FOUND' : 'api:errors.FORBIDDEN', params: {}}),
            {status, headers: {'Content-Type': 'application/problem+json', 'X-Surveyor-Context': createFrontendEventSession().context}})
            : json(view), {});
        cleanups.push(mounted.dispose);
        mounted.router.addRoute({path: '/frontend-pilot/event/:eventId/admin', component: EventPage});
        await mounted.router.push(`/frontend-pilot/event/${frontendEventId}/admin`);
        await flushPromises();
        const actor = mounted.context.session.value?.context;
        const detail = eventKeys.detail(actor, frontendEventId, true);
        const siblings = [eventKeys.things(actor, frontendEventId, true), eventKeys.things(actor, frontendEventId),
            eventKeys.participants(actor, frontendEventId), eventKeys.links(actor, frontendEventId), eventKeys.editors(actor, frontendEventId)];
        for (const key of siblings) mounted.context.queryClient.setQueryData(key, {private: key});
        const errors = vi.fn();
        mounted.wrapper.vm.$.appContext.config.errorHandler = errors;
        denied = true;
        await mounted.context.queryClient.refetchQueries({queryKey: detail, exact: true});
        await flushPromises();

        for (const [index, key] of siblings.entries()) {
            if (status === 404 || index === 0) expect(mounted.context.queryClient.getQueryData(key)).toBeUndefined();
            else expect(mounted.context.queryClient.getQueryData(key)).toEqual({private: key});
        }
        expect(mounted.context.queryClient.getQueryState(detail)?.error).toBeInstanceOf(ApiFailure);
        expect(mounted.context.queryClient.getQueryData(detail)).toBeUndefined();
        const readsBeforeRetry = mounted.request.mock.calls.length;
        await mounted.wrapper.findAll('button').find(control => control.text().trim() === 'Refresh')!.trigger('click');
        await flushPromises();
        expect(mounted.request.mock.calls.length).toBe(readsBeforeRetry + 1);
        expect(errors).not.toHaveBeenCalled();
        expect(mounted.context.queryClient.getQueryState(detail)?.error).toBeInstanceOf(ApiFailure);
    });

    it.each([null, '', 'First line\nBring <strong>your own</strong> lunch.'])('retains the native description column for %j', async description => {
        const view = createFrontendEventView({description});
        const mounted = await mountFrontendEvent(EventSummary, async () => json(view), {event: view});
        cleanups.push(mounted.dispose);
        const label = mounted.context.messages.value.t('event.descriptionLabel');
        const descriptionLabels = mounted.wrapper.findAll('label').filter(item => item.text() === label);

        // Native omits both label and paragraph for null/empty descriptions.
        // Nonempty Event text keeps its own column, ordinary p margins and no
        // list-specific ID, while sharing the escaped newline implementation.
        expect(descriptionLabels).toHaveLength(description ? 1 : 0);
        expect(mounted.wrapper.find('#planDesc').exists()).toBe(false);
        if (description) {
            const paragraph = mounted.wrapper.get('p');
            expect(paragraph.element.previousElementSibling).toBe(descriptionLabels[0]!.element);
            expect(paragraph.element.parentElement?.classList.contains('col-md-6')).toBe(true);
            expect(paragraph.attributes('id')).toBeUndefined();
            expect(paragraph.classes()).not.toContain('mb-0');
            expect(paragraph.classes()).not.toContain('mt-2');
            expect(paragraph.element.textContent).toBe(description.replace('\n', ''));
            expect(paragraph.findAll('br')).toHaveLength(1);
            expect(paragraph.find('strong').exists()).toBe(false);
        }
    });

    it('confirms attendance after its own fresh detail when no sibling observer exists', async () => {
        const mounted = await registrationVisit();
        await submitRegistration(mounted);
        expect(mounted.writes).toEqual(['PUT']);
        const current = mounted.context.queryClient.getQueryData(eventKeys.detail(mounted.context.session.value?.context,
            frontendEventId)) as ReturnType<typeof createFrontendEventView>;
        expect(current.registration?.id).toBe('17');
        expect(mounted.wrapper.text()).not.toContain(mounted.context.messages.value.t('state.savedRefreshFailed'));
        expect(mounted.wrapper.text()).toContain(mounted.context.messages.value.t('event.registration.saved'));
    });

    it('keeps cached inactive Overview queries outside attendance refresh dependencies', async () => {
        const mounted = await registrationVisit();
        const queryFn = vi.fn(async () => ({fixture: true}));
        const key = overviewKeys.region(mounted.context.session.value?.context, 'en', {collection: 'owned', region: 'active'});
        // A previously visited region retains its real query function and result,
        // but has no mounted observer after navigation to the Event.
        await mounted.context.queryClient.fetchQuery({queryKey: key, queryFn});
        expect(mounted.context.queryClient.getQueryCache().find({queryKey: key, exact: true})?.getObserversCount()).toBe(0);
        await submitRegistration(mounted);
        expect(mounted.writes).toEqual(['PUT']);
        expect(queryFn).toHaveBeenCalledOnce();
        expect(mounted.wrapper.text()).not.toContain(mounted.context.messages.value.t('state.savedRefreshFailed'));
    });

    it('recovers a terminal missing header on an equal successful background detail read and retains its healthy URL', async () => {
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:event-recovered');
        const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
        const view = createFrontendEventView({headerUrl: `/api/v1/events/${frontendEventId}/header`, headerVersion: 'same-version'});
        let headerReads = 0;
        const mounted = await mountFrontendEvent(EventPage, async request => {
            if (new URL(request.url).pathname.endsWith('/header')) {
                headerReads++;
                if (headerReads === 1) return new Response(JSON.stringify({type: 'about:blank', title: 'Not Found', status: 404,
                    detail: 'Image unavailable', requestId: 'event-image-recovery', code: 'NOT_FOUND', messageKey: 'api:errors.NOT_FOUND', params: {}}),
                {status: 404, headers: {'Content-Type': 'application/problem+json', 'X-Surveyor-Context': createFrontendEventSession().context}});
                return new Response(new Blob(['image']), {headers: {'Content-Type': 'image/png', 'X-Surveyor-Context': createFrontendEventSession().context}});
            }
            return json(view);
        }, {});
        cleanups.push(mounted.dispose);
        expect(headerReads).toBe(1);
        const key = eventKeys.detail(mounted.context.session.value?.context, frontendEventId);
        // Structural sharing keeps this Event/version equal. The actual success
        // receipt still reaches the image owner, unlike a manual data alias.
        await mounted.context.queryClient.refetchQueries({queryKey: key, exact: true});
        await flushPromises();
        expect(headerReads).toBe(2);
        expect(mounted.wrapper.get('.card-header img').attributes('src')).toBe('blob:event-recovered');
        await mounted.context.queryClient.refetchQueries({queryKey: key, exact: true});
        await flushPromises();
        expect(headerReads).toBe(2);
        expect(revoke).not.toHaveBeenCalled();
    });
});

describe('required and optional query refresh families', () => {
    it('keeps empty required authority strict and permits an explicitly optional absent family', async () => {
        const client = new QueryClient();
        try {
            await expect(refetchFreshQueries(client, {queryKey: ['absent'], type: 'active'}, () => true))
                .rejects.toBeInstanceOf(UnconfirmedResponseError);
            await expect(refetchFreshQueries(client, {queryKey: ['absent'], type: 'active'}, () => true,
                {allowEmpty: true})).resolves.toBeUndefined();
        } finally { client.clear(); }
    });

    it('propagates a selected active dependent read failure even when absence is optional', async () => {
        const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
        const failure = new Error('Selected dependency failed');
        const queryFn = vi.fn(async () => { throw failure; });
        const observer = new QueryObserver(client, {queryKey: ['dependent'], initialData: {admitted: true},
            staleTime: Infinity, queryFn});
        const unsubscribe = observer.subscribe(() => {});
        try {
            // The family is present and active. Optional absence must never turn
            // its real failed read into successful recovery or fresh authority.
            await expect(refetchFreshQueries(client, {queryKey: ['dependent'], type: 'active'}, () => true,
                {allowEmpty: true})).rejects.toBe(failure);
            expect(queryFn).toHaveBeenCalledOnce();
        } finally { unsubscribe(); client.clear(); }
    });
});
