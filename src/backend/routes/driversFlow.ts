import {
    searchEntityEvents, readEventLinkSelection, getEntityViewAdmission,
} from '../modules/event/linkage';

import * as controller from '../controller/driversController';

import * as service from '../modules/database/services/DriverService';
import type {DriversList} from '../modules/database/entities/drivers/DriversList';
import {createGuestFlow, guestFlowResponse} from '../middleware/guestFlowFactory';

/** Drivers retains its read snapshot and receipt preparation while sharing actual routes. */
export const driversFlow = createGuestFlow<'drivers', DriversList>({
    entityType: 'drivers', parameter: 'listId', apiPath: '/api/v1/drivers-lists',
    loadRoot: service.getDriversListById,
    /** Keep Drivers page admission on its existing root/membership/grant snapshot. */
    withRoot(id, operation) {
        // The same manager crosses the argument-order adapter; no extra read boundary is introduced.
        return service.withDriversReadSnapshot(id, (manager, root) => operation(root, manager));
    },
    pageAdmission(root, actor, manager) { return getEntityViewAdmission('drivers', root, actor, manager); },
    detailAddress: 'stored', guestAddress: 'stored',
    profiles: {duplicate: false, header: true},
    formContext: controller.driversFormContext,
    readCreateContext: controller.readDriversCreateContext,
    requireCreation: controller.requireDriversCreation,
    selectEvent: readEventLinkSelection,
    searchEvents: searchEntityEvents,
    create(input, file, actor, lifecycle) {
        return controller.createDriversList(input, file, actor, lifecycle.prepare);
    },
    creation: {imageOwnership: 'success', receipt: 'controller', location: true},
    duplicate: controller.readDriversDuplicate,
    detail: controller.readDriversList,
    header: controller.readDriversHeaderPath,
    remove(id, actor, prepare) { return controller.deleteDriversList(id, actor, undefined, prepare); },
    deletion: {profile: true, receipt: 'controller'},
    operations: {
        createEntry: guestFlowResponse('getDriversCreateEntry', 200),
        resourceEntry: guestFlowResponse('getDriversResourceEntry', 200),
        createContext: guestFlowResponse('getDriversCreateContext', 200),
        events: guestFlowResponse('searchDriversEvents', 200),
        create: guestFlowResponse('createDriversList', 201),
        duplicate: guestFlowResponse('getDriversDuplicate', 200),
        detail: guestFlowResponse('getDriversList', 200),
        remove: guestFlowResponse('deleteDriversList', 200),
        guest: guestFlowResponse('getDriversGuestEntry', 200),
        registerGuest: 'registerDriversGuest', header: 'getDriversHeader',
    },
    document: {
        preload: false, admin: false, duplicatePageEntry: true,
        seedCreate(state, result) {
            state.driversCreateContext = result.context ?? undefined;
            state.driversSelectedEvent = result.selectedEvent ?? null;
        },
        seedDuplicate(state, result) { state.driversDuplicate = result; },
    },
});
