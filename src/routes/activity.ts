import express from 'express';
import {createGuestFlowRouter} from '../middleware/guestFlowFactory';
import controller from '../controller/activityController';
import * as activityService from '../modules/database/services/ActivityService';
import {ENTITIES, ENTITY_ITEMS} from "../modules/lib/util";

const app = express.Router();

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

export default app;
