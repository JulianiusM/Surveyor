import * as controller from '../controller/eventController';
import * as service from '../modules/database/services/EventService';
import type {Event} from '../modules/database/entities/event/Event';
import {createGuestFlow, guestFlowResponse} from '../middleware/guestFlowFactory';

/** Event keeps opaque token navigation separate from attendance and admin authority. */
export const eventFlow = createGuestFlow<'event', Event>({
    entityType: 'event', parameter: 'eventId', apiPath: '/api/v1/events',
    loadRoot: service.getEventById,
    /** Retain Event existence and administration grants in its established read snapshot. */
    withRoot(id, operation) {
        // Pass the original manager through unchanged while adapting the callback argument order.
        return service.withEventReadSnapshot(id, (manager, root) => operation(root, manager));
    },
    async pageAdmission(_root, actor) { return actor.profile ? 'render' : 'guest'; },
    adminAdmission(root, actor, manager) {
        // Event's existing read owner always supplies this same snapshot manager.
        return controller.canAccessEventAdministration(root, actor, manager!);
    },
    detailAddress: 'requested', guestAddress: 'stored',
    profiles: {duplicate: false, header: false},
    formContext: controller.eventFormContext,
    readCreateContext: controller.readEventCreateContext,
    requireCreation: controller.requireEventCreation,
    create: controller.createEvent,
    creation: {imageOwnership: 'controller-entry', receipt: 'after-success', location: true},
    duplicate: controller.readEventDuplicate,
    async detail(id, actor, view) { return {data: await controller.readEvent(id, actor, view)}; },
    header: controller.readEventHeaderPath,
    remove: controller.removeEvent,
    deletion: {profile: true, receipt: 'after-success'},
    operations: {
        createEntry: guestFlowResponse('getEventCreateEntry', 200),
        resourceEntry: guestFlowResponse('getEventResourceEntry', 200),
        createContext: guestFlowResponse('getEventCreateContext', 200),
        create: guestFlowResponse('createEvent', 201),
        duplicate: guestFlowResponse('getEventDuplicate', 200),
        detail: guestFlowResponse('getEvent', 200),
        remove: guestFlowResponse('deleteEvent', 200),
        guest: guestFlowResponse('getEventGuestEntry', 200),
        registerGuest: 'registerEventGuest', header: 'getEventHeader',
    },
    document: {
        preload: false, admin: true, duplicatePageEntry: true,
        seedCreate(state, result) { if (result.context) state.eventCreateContext = result.context; },
        seedDuplicate(state, result) { state.eventDuplicate = result; },
        seedResource(state, result) { state.eventEntry = result; },
    },
});
