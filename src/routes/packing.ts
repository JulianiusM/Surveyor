import express from 'express';
import * as packingService from '../modules/database/services/PackingService';
import {createGuestFlowRouter} from "../middleware/guestFlowFactory";
import controller from "../controller/packingController";
import {ENTITIES, ENTITY_ITEMS} from "../modules/lib/util";

const app = express.Router();

app.use("/", createGuestFlowRouter({
    addToEvent: true,
    entityType: ENTITIES.PACKING,
    entityItemType: ENTITY_ITEMS.PACKING,
    db: {
        getById: packingService.getPackingListById,
        getItems: packingService.getPackingItems,
    },
    templates: {
        create: 'packing/packing-create',
        view: 'packing/packing-view',
    },
    buildRedirect: (id: any) => `/packing/${id}`,
    preprocessCreate: controller.preprocessCreate,
    createEntity: controller.createEntity,
    afterCreateItems: controller.afterCreateItems,
    fetchForView: controller.fetchForView,
    fetchForDuplicate: controller.fetchForDuplicate,
    deleteEntity: controller.deleteEntity,
}));

export default app;
