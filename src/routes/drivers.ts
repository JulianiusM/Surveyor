import express from 'express';
import * as driverService from '../modules/database/services/DriverService';
import {createGuestFlowRouter} from "../middleware/guestFlowFactory";
import controller from "../controller/driversController";

const app = express.Router();

app.use("/", createGuestFlowRouter({
    addToEvent: true,
    entityType: 'drivers',
    db: {
        getById: driverService.getDriversListById,
    },
    templates: {
        create: 'drivers/drivers-create',
        view: 'drivers/drivers-view',
    },
    buildRedirect: (id: any) => `/drivers/${id}`,
    preprocessCreate: controller.preprocessCreate,
    createEntity: controller.createEntity,
    afterCreateItems: controller.afterCreateItems,
    fetchForView: controller.fetchForView,
    fetchForDuplicate: controller.fetchForDuplicate,
    deleteEntity: controller.deleteEntity,
}));

export default app;
