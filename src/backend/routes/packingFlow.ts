import {
    searchEntityEvents, readEventLinkSelection, getEntityViewAdmission,
} from '../modules/event/linkage';

import * as controller from '../controller/packingController';

import * as service from '../modules/database/services/PackingService';
import type {PackingList} from '../modules/database/entities/packing/PackingList';
import {ApiProblem} from '../modules/api/problem';
import {ExpectedError} from '../modules/lib/errors';
import {createGuestFlow, guestFlowResponse} from '../middleware/guestFlowFactory';

/** One configuration binds Packing's existing controller/DBAL hooks to both HTTP surfaces. */
export const packingFlow = createGuestFlow<'packing', PackingList>({
    entityType: 'packing', parameter: 'listId', apiPath: '/api/v1/packing-lists',
    loadRoot: service.getPackingListById,
    /** Keep root, Event membership and grants in Packing's existing read snapshot. */
    withRoot(id, operation) {
        // Adapt DBAL argument order without opening another transaction or losing its manager.
        return service.withPackingReadSnapshot(id, (manager, root) => operation(root, manager));
    },
    pageAdmission(root, actor, manager) { return getEntityViewAdmission('packing', root, actor, manager); },
    detailAddress: 'stored', guestAddress: 'stored',
    profiles: {duplicate: false, header: true},
    formContext: controller.packingFormContext,
    readCreateContext: controller.readPackingCreateContext,
    requireCreation: controller.requirePackingCreation,
    selectEvent: readEventLinkSelection,
    searchEvents: searchEntityEvents,
    create: controller.createPackingList,
    creation: {imageOwnership: 'success', receipt: 'after-success', location: true},
    duplicate: controller.readPackingDuplicate,
    detail: controller.readPackingList,
    header: controller.readPackingHeaderPath,
    remove(id, actor) { return controller.deletePackingList(id, actor); },
    deletion: {profile: true, receipt: 'after-success'},
    operations: {
        createEntry: guestFlowResponse('getPackingCreateEntry', 200),
        resourceEntry: guestFlowResponse('getPackingResourceEntry', 200),
        createContext: guestFlowResponse('getPackingCreateContext', 200),
        events: guestFlowResponse('searchPackingEvents', 200),
        create: guestFlowResponse('createPackingList', 201),
        duplicate: guestFlowResponse('getPackingDuplicate', 200),
        detail: guestFlowResponse('getPackingList', 200),
        remove: guestFlowResponse('deletePackingList', 200),
        guest: guestFlowResponse('getPackingGuestEntry', 200),
        registerGuest: 'registerPackingGuest', header: 'getPackingHeader',
    },
    document: {
        preload: true, admin: false, duplicatePageEntry: false,
        seedCreate(state, result) {
            state.packingCreateContext = result.context ?? undefined;
            state.packingSelectedEvent = result.selectedEvent ?? null;
        },
        seedDuplicate(state, result) { state.packingDuplicate = result; },
        duplicateError(error) {
            // Packing historically translates these duplicate denials into its
            // known localized HTML boundary rather than the generic API boundary.
            if (error instanceof ApiProblem && ['NOT_FOUND', 'FORBIDDEN'].includes(error.code)) {
                return new ExpectedError(error.code === 'FORBIDDEN' ? 'Not allowed' : error.code, 'error', error.status);
            }
            return error;
        },
    },
});
