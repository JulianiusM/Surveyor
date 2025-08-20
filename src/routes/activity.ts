import express from 'express';
import {createGuestFlowRouter} from '../middleware/guestFlowFactory';
import controller from '../controller/activityController';
import * as activityService from '../modules/database/services/ActivityService';

const app = express.Router();

app.use("/", createGuestFlowRouter({
    entityType: 'activity',
    db: {
        getById: activityService.getActivityPlanById,
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
