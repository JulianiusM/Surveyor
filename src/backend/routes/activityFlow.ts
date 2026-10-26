
import {readEventLinkSelection} from '../modules/event/linkage';
import * as controller from '../controller/activityController';
import {getEntityViewAdmission} from '../controller/entityAdminController';

import * as service from '../modules/database/services/ActivityService';
import type {ActivityPlan} from '../modules/database/entities/activity/ActivityPlan';
import {createGuestFlow, guestFlowResponse} from '../middleware/guestFlowFactory';

/** Activity preserves its opaque address and inherited root/default commit order. */
export const activityFlow = createGuestFlow<'activity', ActivityPlan>({
    entityType: 'activity', parameter: 'planId', apiPath: '/api/v1/activity-plans',
    loadRoot: service.getActivityPlanById,
    async withRoot(id, operation) { return operation(await service.getActivityPlanById(id)); },
    pageAdmission(root, actor, manager) { return getEntityViewAdmission('activity', root, actor, manager); },
    detailAddress: 'requested', guestAddress: 'requested',
    profiles: {duplicate: false, header: true},
    formContext: controller.activityFormContext,
    readCreateContext: controller.readActivityCreateContext,
    requireCreation(actor) { controller.readActivityCreateContext(actor); },
    selectEvent: readEventLinkSelection,
    searchEvents: controller.searchActivityEvents,
    create(input, file, actor, lifecycle) {
        // The root/slot commit releases the upload even when later default saving
        // fails. Receipt preparation remains inside the original creation owner.
        return controller.createActivityPlan(input, file, actor, lifecycle.prepare, lifecycle.retainImage);
    },
    creation: {imageOwnership: 'controller-notification', receipt: 'controller', location: false},
    duplicate: controller.readActivityDuplicate,
    detail: controller.readActivityPlan,
    header: controller.readActivityHeaderPath,
    async remove(id, actor) {
        await controller.deleteActivityPlan(id, actor);
        return {changed: true};
    },
    deletion: {profile: false, receipt: 'before-command'},
    operations: {
        createEntry: guestFlowResponse('getActivityCreateEntry', 200),
        resourceEntry: guestFlowResponse('getActivityResourceEntry', 200),
        createContext: guestFlowResponse('getActivityCreateContext', 200),
        events: guestFlowResponse('searchActivityEvents', 200),
        create: guestFlowResponse('createActivityPlan', 201),
        duplicate: guestFlowResponse('getActivityDuplicate', 200),
        detail: guestFlowResponse('getActivityPlan', 200),
        remove: guestFlowResponse('deleteActivityPlan', 200),
        guest: guestFlowResponse('getActivityGuestEntry', 200),
        registerGuest: 'registerActivityGuest', header: 'getActivityHeader',
    },
    document: {
        preload: false, admin: false, duplicatePageEntry: true,
        seedCreate(state, result) {
            state.activityCreateContext = result.context ?? undefined;
            state.activitySelectedEvent = result.selectedEvent ?? null;
        },
        seedDuplicate(state, result) { state.activityDuplicate = result; },
    },
});
