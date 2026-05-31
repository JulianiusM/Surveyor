import express, {Request, Response} from 'express';
import controller from '../controller/activityController';
import {createGuestFlowRouter} from '../middleware/guestFlowFactory';
import {createGuestRecoveryRouter} from '../middleware/guestRecoveryRouter';
import {requirePermission} from "../middleware/permissionMiddleware";
import * as activityService from '../modules/database/services/ActivityService';
import {asyncHandler} from "../modules/lib/asyncHandler";
import {PERM} from "../modules/lib/permissions";
import {ENTITIES, ENTITY_ITEMS, getResource} from "../modules/lib/util";
import renderer from "../modules/renderer";
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

const app = express.Router();

app.use("/", createGuestRecoveryRouter({
    entityType: ENTITIES.ACTIVITY,
    buildRedirect: (id: any) => `/activity/${id}`,
    db: {
        getById: activityService.getActivityPlanById,
    },
}));

app.use("/", createGuestFlowRouter({
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
}));

app.get("/:id/export/schedule", requirePermission(permFct, PERM.DATA_EXPORT), asyncHandler(async (req: Request, res: Response) => {
    const data = await controller.getScheduleExport(resFct(req));
    renderer.renderWithData(res, 'activity/export/schedule', data);
}));

export default app;
