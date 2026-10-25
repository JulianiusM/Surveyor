// @vitest-environment happy-dom
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {flushPromises} from '@vue/test-utils';
import {defineComponent} from 'vue';
import type {components} from '../../src/types/api/v1';
import EntityHeader from '../../src/frontend/components/EntityHeader.vue';
import EventPage from '../../src/frontend/features/event/EventPage.vue';
import EventSettings from '../../src/frontend/features/event/EventSettings.vue';
import EventThingsToDo from '../../src/frontend/features/event/EventThingsToDo.vue';
import ActivitySettings from '../../src/frontend/features/activity/ActivitySettings.vue';
import PackingPage from '../../src/frontend/features/packing/PackingPage.vue';
import {eventKeys, packingKeys} from '../../src/frontend/app/queryKeys';
import {createFrontendEventSession, createFrontendEventView, frontendEventId} from '../factories/frontendEventFactory';
import {frontendEventJson, mountFrontendEvent} from '../keywords/frontendEventKeywords';

const session = createFrontendEventSession();
const childId = '22222222-2222-4222-8222-222222222222';
const cleanups: Array<() => Promise<void>> = [];
beforeEach(() => vi.stubGlobal('confirm', vi.fn(() => true)));
afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
});

/** Packing's validated detail also carries its existing comparison header.
 * Only HTTP delivery is supplied; generated APIs, commands and query owners run. */
function json(value: unknown): Response {
    const response = frontendEventJson(value);
    response.headers.set('ETag', '"entity-presentation"');
    return response;
}

function createPackingView(): components['schemas']['PackingListView'] {
    return {
        entityType: 'packing', id: frontendEventId, title: 'Packing header', description: null,
        headerUrl: `/api/v1/packing-lists/${frontendEventId}/header`, headerVersion: 'header-one',
        orderToken: '"order"', currentEventId: childId, currentEventUrl: `/event/${childId}`,
        archived: false, inheritedArchived: false,
        capabilities: {editTitle: false, editDescription: false, selfAssign: false,
            addItem: false, reorder: false, manageSettings: true},
        counters: {participants: 0, open: 0, empty: 0}, items: [],
    };
}

/** Real dialog controls live in the shared portal, while card controls stay in
 * their section. Resolve both by the exact public label, without private state. */
function action(label: string): HTMLButtonElement {
    const button = [...document.querySelectorAll<HTMLButtonElement>('button')]
        .find(candidate => candidate.textContent?.trim() === label);
    expect(button, label).toBeDefined();
    return button!;
}

describe('shared displayed entity header consumers', () => {
    it('keeps settings dispatch disabled until its feature permits the action', async () => {
        const mounted = await mountFrontendEvent(EntityHeader, async () => json({}), {
            resourceId: frontendEventId, title: 'Admitted header', icon: 'bi-calendar2-event',
            imageVersion: null, imageQueryKey: eventKeys.detail(session.context, frontendEventId),
            readImage: vi.fn(async () => new Blob(['unused'])),
            settingsAvailable: true, settingsDisabled: true,
        });
        cleanups.push(mounted.dispose);
        const button = mounted.wrapper.get<HTMLButtonElement>('button');
        expect(button.element.disabled).toBe(true);
        button.element.click();
        expect(mounted.wrapper.emitted('settings')).toBeUndefined();

        await mounted.wrapper.setProps({settingsDisabled: false});
        button.element.click();
        expect(mounted.wrapper.emitted('settings')).toHaveLength(1);
        await mounted.wrapper.setProps({settingsAvailable: false});
        expect(mounted.wrapper.find('button').exists()).toBe(false);
    });

    it.each(['event', 'packing'] as const)(
        'keeps %s image lifetime, title and settings admission in one adopted header',
        async kind => {
            vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:shared-entity-header');
            const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
            const event = createFrontendEventView({
                headerUrl: `/api/v1/events/${frontendEventId}/header`, headerVersion: 'header-one',
                capabilities: {...createFrontendEventView().capabilities, settings: true},
            });
            const view = kind === 'event' ? event : createPackingView();
            let imageReads = 0;
            const mounted = await mountFrontendEvent(kind === 'event' ? EventPage : PackingPage, async request => {
                if (new URL(request.url).pathname.endsWith('/header')) {
                    imageReads++;
                    return new Response(new Blob(['image']), {headers: {
                        'Content-Type': 'image/png', 'X-Surveyor-Context': session.context,
                    }});
                }
                return json(view);
            }, {}, `/${kind}/${frontendEventId}`);
            cleanups.push(mounted.dispose);
            await vi.waitFor(() => expect(imageReads).toBe(1));
            await flushPromises();

            // This is actual production adoption, including the existing cover
            // geometry and one responsive copy of the admitted parent URL.
            const header = mounted.wrapper.findComponent(EntityHeader);
            expect(header.exists()).toBe(true);
            expect(header.get('h1').text()).toBe(view.title);
            expect(mounted.context.pageTitle.value).toBe(`${view.title} | ${kind === 'event' ? 'Event' : 'Surveyor'}`);
            const image = header.get<HTMLImageElement>('img');
            expect(image.attributes('src')).toBe('blob:shared-entity-header');
            expect(image.attributes('alt')).toBe(view.title);
            expect(image.element.style.objectFit).toBe('cover');
            expect(image.element.style.height).toBe('250px');
            expect(header.findAll('a').map(link => link.attributes('href')))
                .toEqual(kind === 'packing' ? [`/event/${childId}`] : []);
            expect(header.get('.frontend-page-heading-actions button').text()).toBe(mounted.context.messages.value.t('packing.edit'));
            expect(header.get('button[aria-label="Refresh"]').element.closest('.card-header')).not.toBeNull();

            // Equal image versions retain their URL through a real feature GET.
            // Current feature capabilities and title still replace their old display.
            view.title = 'Updated shared title';
            Object.assign(view.capabilities, kind === 'event' ? {settings: false} : {manageSettings: false});
            const key = kind === 'event' ? eventKeys.detail(session.context, frontendEventId)
                : packingKeys.detail(session.context, frontendEventId);
            await mounted.context.queryClient.refetchQueries({queryKey: key, exact: true});
            await flushPromises();
            expect(header.get('h1').text()).toBe(view.title);
            expect(mounted.context.pageTitle.value).toBe(`${view.title} | ${kind === 'event' ? 'Event' : 'Surveyor'}`);
            expect(header.get('img').attributes('alt')).toBe(view.title);
            expect(header.findAll('button')).toHaveLength(1);
            expect(header.get('button').attributes('aria-label')).toBe('Refresh');
            expect(imageReads).toBe(1);
            expect(revoke).not.toHaveBeenCalled();

            // A newly admitted absence releases bytes and their browser URL.
            view.headerUrl = null;
            view.headerVersion = null;
            await mounted.context.queryClient.refetchQueries({queryKey: key, exact: true});
            await flushPromises();
            expect(header.find('img').exists()).toBe(false);
            expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:shared-entity-header');
        },
    );

    it('keeps the Event dashboard title while sharing settings and Refresh placement', async () => {
        const view = createFrontendEventView({capabilities: {...createFrontendEventView().capabilities, settings: true}});
        const mounted = await mountFrontendEvent(EventPage, async () => json(view), {});
        cleanups.push(mounted.dispose);
        mounted.router.addRoute({path: '/event/:eventId/admin',
            component: defineComponent({template: '<p>Dashboard route</p>'})});
        await mounted.router.push(`/event/${frontendEventId}/admin`);
        await flushPromises();
        const header = mounted.wrapper.getComponent(EntityHeader);
        expect(header.get('h1').text()).toBe(`Event Dashboard — ${view.title}`);
        expect(header.find('img').exists()).toBe(false);
        expect(header.get('.frontend-page-heading-actions button').text()).toBe(mounted.context.messages.value.t('packing.edit'));
        expect(header.get('button[aria-label="Refresh"]').element.closest('.card-header')).not.toBeNull();
        expect(mounted.context.pageTitle.value).toBe(`Dashboard — ${view.title}`);
    });

    it('adopts a successful image removal before recovering an earlier missing image', async () => {
        const view = createFrontendEventView({
            headerUrl: `/api/v1/events/${frontendEventId}/header`, headerVersion: 'removed-header',
        });
        let imageReads = 0;
        const mounted = await mountFrontendEvent(EventPage, async request => {
            if (new URL(request.url).pathname.endsWith('/header')) {
                imageReads++;
                return new Response(JSON.stringify({
                    type: 'about:blank', title: 'Not Found', status: 404, detail: 'Image unavailable',
                    requestId: 'removed-header', code: 'NOT_FOUND', messageKey: 'api:errors.NOT_FOUND', params: {},
                }), {status: 404, headers: {
                    'Content-Type': 'application/problem+json', 'X-Surveyor-Context': session.context,
                }});
            }
            return json(view);
        }, {});
        cleanups.push(mounted.dispose);
        expect(imageReads).toBe(1);

        // The actual successful JSON read removes its version. Recovery observes
        // those new props rather than starting another request for the old image.
        view.headerUrl = null;
        view.headerVersion = null;
        await mounted.context.queryClient.refetchQueries({
            queryKey: eventKeys.detail(session.context, frontendEventId), exact: true,
        });
        await flushPromises();
        expect(imageReads).toBe(1);
        expect(mounted.wrapper.find('.card-header img').exists()).toBe(false);
    });
});

describe('shared automatic archival consumers', () => {
    it.each(['Activity settings', 'Event settings'] as const)(
        'shares scheduled restore consent through %s while retaining Event wording', async function preservesScheduledRestore(consumer) {
            const eventSettings: components['schemas']['EventSettings'] = {
                id: frontendEventId, title: 'Archived scheduled root', settingsToken: '"settings"',
                headerUrl: null, headerVersion: null, editableFields: [], access: null,
                capabilities: {editHeader: false, managePermissions: false, duplicate: false, remove: false,
                    manageArchive: true, archive: false, restore: true, manageAutomation: true},
                archive: {direct: true, inherited: false, archivedAt: '2026-10-01T00:00:00Z', autoArchivePaused: false, eventUrl: null},
            };
            // Activity emits a field-comparison token and its own metadata-field
            // vocabulary. Preserve both contracts rather than admitting Event's
            // broader token and field types through a common fixture.
            const activitySettings: components['schemas']['ActivitySettings'] = {...eventSettings,
                settingsToken: '"edit-settings"', editableFields: [], currentEvent: null,
                capabilities: {...eventSettings.capabilities, linkEvent: false, export: false},
                archive: {...eventSettings.archive, hasAutomaticSchedule: true}};
            const settings = consumer === 'Activity settings' ? activitySettings : eventSettings;
            const writes: string[] = [];

            /** Retain actual dated-root settings callers and generated transport.
             * A confirmed write changes their subsequent admitted HTTP read. */
            async function restoreScheduledResource(request: Request): Promise<Response> {
                if (request.method === 'POST') {
                    writes.push(new URL(request.url).pathname);
                    settings.archive.direct = false;
                    settings.archive.archivedAt = null;
                    settings.archive.autoArchivePaused = true;
                    settings.capabilities.restore = false;
                    settings.capabilities.archive = true;
                    return json({changed: true});
                }
                return json(settings);
            }

            const component = consumer === 'Activity settings' ? ActivitySettings : EventSettings;
            const mounted = await mountFrontendEvent(component, restoreScheduledResource,
                consumer === 'Activity settings' ? {planId: frontendEventId, metadataAvailable: false}
                    : {eventId: frontendEventId, metadataAvailable: false});
            cleanups.push(mounted.dispose);
            await vi.waitFor(function admitsRestoreControl() {
                expect([...document.querySelectorAll('button')].some(button => button.textContent?.trim() === 'Restore for everyone')).toBe(true);
            });
            const confirm = vi.mocked(window.confirm);

            // Cancel keeps the current archive/schedule unchanged. The shared
            // selector preserves the explicitly fuller Event parent warning.
            confirm.mockReturnValue(false);
            action('Restore for everyone').click();
            await flushPromises();
            const key = consumer === 'Event settings' ? 'event.confirmRestore' : 'event.organizer.confirmRestoreScheduled';
            expect(confirm).toHaveBeenLastCalledWith(mounted.context.messages.value.t(key));
            expect(writes).toEqual([]);
            expect(settings.archive).toMatchObject({direct: true, autoArchivePaused: false});

            confirm.mockReturnValue(true);
            action('Restore for everyone').click();
            await flushPromises();
            const path = consumer === 'Activity settings' ? `/api/v1/activity-plans/${frontendEventId}/restore`
                : `/api/v1/events/${frontendEventId}/restore`;
            expect(writes).toEqual([path]);
            expect(document.body.textContent).toContain(mounted.context.messages.value.t('overview.restored'));
            expect(document.body.textContent).not.toContain('Restore for everyone');
        },
    );

    it.each(['settings', 'child cards'] as const)(
        'preserves resume confirmation and immediate pause through %s',
        async consumer => {
            let paused = true;
            const writes: {path: string; paused: boolean}[] = [];
            const settings: components['schemas']['EventSettings'] = {
                id: frontendEventId, title: 'Scheduled Event', settingsToken: '"settings"',
                headerUrl: null, headerVersion: null, editableFields: [], access: null,
                capabilities: {editHeader: false, managePermissions: false, duplicate: false, remove: false,
                    manageArchive: true, archive: false, restore: false, manageAutomation: true},
                archive: {direct: false, inherited: false, archivedAt: null, autoArchivePaused: true, eventUrl: null},
            };
            const card: components['schemas']['OverviewCard'] = {
                id: childId, type: 'activity', title: 'Scheduled child', description: null,
                url: `/activity/${childId}`, headerUrl: null, headerVersion: null, eventContext: null,
                visibility: 'default', overviewHidden: false, archived: false, inheritedArchived: false,
                capabilities: {archive: false, restore: false, duplicate: false, remove: false},
                children: null, automation: {paused: true, canManage: true},
            };
            const mounted = await mountFrontendEvent(consumer === 'settings' ? EventSettings : EventThingsToDo,
                async request => {
                    if (request.method === 'PUT') {
                        const input = await request.json() as {paused: boolean};
                        paused = input.paused;
                        writes.push({path: new URL(request.url).pathname, paused});
                        return json({changed: true});
                    }
                    settings.archive.autoArchivePaused = paused;
                    card.automation!.paused = paused;
                    return json(consumer === 'settings' ? settings : {items: [card]});
                }, {eventId: frontendEventId});
            cleanups.push(mounted.dispose);
            const confirm = vi.mocked(window.confirm);

            // The shared owner preserves each consumer's native warning and
            // cancellation. Neither a rejected confirmation nor a read sends PUT.
            confirm.mockReturnValue(false);
            action('Resume automatic archival').click();
            await flushPromises();
            expect(writes).toEqual([]);
            expect(confirm).toHaveBeenLastCalledWith(mounted.context.messages.value.t('event.organizer.confirmResumeAutomation'));

            confirm.mockReturnValue(true);
            action('Resume automatic archival').click();
            await flushPromises();
            const path = consumer === 'settings' ? `/api/v1/events/${frontendEventId}/automatic-archive`
                : `/api/v1/events/${frontendEventId}/things-to-do/activity/${childId}/automatic-archive`;
            expect(writes).toEqual([{path, paused: false}]);
            expect(document.body.textContent).toContain(mounted.context.messages.value.t('event.organizer.automationResumed'));

            // Pausing retains its separate no-confirmation behavior. Fresh GET
            // results, not a manually mirrored schedule flag, update the action.
            confirm.mockClear();
            action('Pause automatic archival').click();
            await flushPromises();
            expect(confirm).not.toHaveBeenCalled();
            expect(writes).toEqual([{path, paused: false}, {path, paused: true}]);
            expect(document.body.textContent).toContain(mounted.context.messages.value.t('event.organizer.automationPaused'));
        },
    );
});
