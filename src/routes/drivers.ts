/*
 * Copyright 2026 Julian Malovanij
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import express from 'express';
import * as driverService from '../modules/database/services/DriverService';
import {createGuestFlowRouter} from "../middleware/guestFlowFactory";
import controller from "../controller/driversController";
import {ENTITIES, ENTITY_ITEMS} from "../modules/lib/util";

const app = express.Router();

app.use("/", createGuestFlowRouter({
    addToEvent: true,
    entityType: ENTITIES.DRIVERS,
    entityItemType: ENTITY_ITEMS.DRIVERS,
    db: {
        getById: driverService.getDriversListById,
        getItems: driverService.getDriversItems,
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
