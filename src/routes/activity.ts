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

import {Request, Response} from 'express';
import controller from '../controller/activityController';
import {createGuestFlowRouter} from '../middleware/guestFlowFactory';
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
        ownerId: resource?.ownerId,
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

app.get("/:id/export/schedule", requirePermission(permFct, PERM.DATA_EXPORT), asyncHandler(async (req: Request, res: Response) => {
    const data = await controller.getScheduleExport(resFct(req));
    renderer.renderWithData(res, 'activity/export/schedule', data);
}));

export default app;
