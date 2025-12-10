import {Request, Response} from 'express';
import {createGuestFlowRouter} from '../middleware/guestFlowFactory';
import controller from '../controller/activityController';
import * as activityService from '../modules/database/services/ActivityService';
import {ENTITIES, ENTITY_ITEMS, getResource} from "../modules/lib/util";
import {requirePermission} from "../middleware/permissionMiddleware";
import {asyncHandler} from "../modules/lib/asyncHandler";
import renderer from "../modules/renderer";
import {PERM} from "../modules/lib/permissions";
import type {EntityDescriptor} from "../types/PermissionTypes";
import type {EntityType} from "../types/UtilTypes";

const entityName: EntityType = ENTITIES.ACTIVITY;
const resFct = (req: Request) => getResource(req, entityName);
const permFct = (req: Request): EntityDescriptor => {
    const resource = getResource(req, entityName);
    return {
        entityType: entityName,
        entityId: resource?.id,
        ownerUserId: resource?.ownerId,
        eventId: resource?.eventId,
    };
};

const app = createGuestFlowRouter({
    addToEvent: true,
    entityType: ENTITIES.ACTIVITY,
    entityItemType: ENTITY_ITEMS.ACTIVITY,
    db: {
        getById: activityService.getActivityPlanById,
        getItems: activityService.getActivitySlotsFlat,
    },
    templates: {
        create: 'activity/activity-create',
        view: 'activity/activity-view',
    },
    buildRedirect: (id: any) => `/activity/${id}`,
    preprocessCreate: controller.preprocessCreate,
    createEntity: controller.createEntity,
    afterCreateItems: controller.afterCreateItems,
    fetchForView: controller.fetchForView,
    fetchForDuplicate: controller.fetchForDuplicate,
    deleteEntity: controller.deleteEntity,
});

app.get("/:id/export/schedule", requirePermission(permFct, PERM.DATA_EXPORT | PERM.ACCESS_VIEW), asyncHandler(async (req: Request, res: Response) => {
    const data = await controller.getScheduleExport(resFct(req));
    renderer.renderWithData(res, 'activity/export/schedule', data);
}));

export default app;
