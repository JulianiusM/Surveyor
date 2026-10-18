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

import express, {Request, Response} from 'express';
import {getEntityPropertyPresentation} from '../controller/entityAdminController';
import controller from '../controller/eventController';
import invoiceController from '../controller/eventPoolController';
import {createGuestFlowRouter} from '../middleware/guestFlowFactory';
import {queryHandler} from "../middleware/paramHandler";
import {isLoggedIn, requirePermission} from "../middleware/permissionMiddleware";
import * as eventService from '../modules/database/services/EventService';
import {asyncHandler} from "../modules/lib/asyncHandler";
import { createParticipantsPdf} from "../modules/lib/pdf";
import {createInvoiceSharesPdf} from '../modules/invoice/exports';
import {PERM} from "../modules/lib/permissions";
import {ENTITIES, getResource} from "../modules/lib/util";
import renderer from "../modules/renderer";
import type {EntityDescriptor} from "../types/PermissionTypes";
import type {EntityType} from "../types/UtilTypes";

const app = express.Router();
const entityName: EntityType = ENTITIES.EVENT;
const resFct = (req: Request) => getResource(req, entityName);
const permFct = (req: Request): EntityDescriptor => {
    const resource = getResource(req, entityName);
    return {entityType: entityName, entityId: resource.id, ownerId: resource.ownerId, eventId: resource.id};
}

queryHandler("regToken", app, (id) => id, 'regToken');

app.use("/", createGuestFlowRouter({
    addToEvent: false,
    entityType: entityName,
    db: {getById: eventService.getEventById, getItems: async (id): Promise<any[]> => []},
    templates: {create: 'event/event-create', view: 'event/event-view'},
    buildRedirect: (id: any) => `/event/${id}`,
    preprocessCreate: controller.preprocessCreate,
    createEntity: controller.createEntity,
    afterCreateItems: controller.afterCreateItems,
    fetchForView: controller.fetchForView,
    fetchForDuplicate: controller.fetchForDuplicate,
    deleteEntity: controller.deleteEntity,
}));

// convenience alias
app.get('/:id/register', (req: Request, res: Response) => res.redirect(`/event/${req.params.id}`));

app.get('/:id/admin', requirePermission(permFct, PERM.ACCESS_ADMIN), asyncHandler(async (req: Request, res: Response) => {
    // Reuse the event view projection, including its shared archive snapshot and decorated
    // child cards. The dashboard passes that page data explicitly to its archival mixins;
    // entering administration does not require a separate feature-state middleware or locals.
    const data = await controller.fetchForView(resFct(req), req);
    const entityProperties = await getEntityPropertyPresentation('event', resFct(req), req.session);
    renderer.renderWithData(res, 'event/event-dashboard', {...data, entityProperties});
}));

app.get("/:id/export/participants", requirePermission(permFct, PERM.DATA_EXPORT | PERM.ACCESS_PARTICIPANTS), asyncHandler(async (req: Request, res: Response) => {
    const data = await controller.getParticipantsExtended(resFct(req));
    //renderer.renderWithData(res, 'event/export/participants', data);
    res.contentType('application/pdf');
    res.send(await createParticipantsPdf(data).getBuffer());
}));

app.get('/:id/export/invoice-pools/:poolId/shares', isLoggedIn, requirePermission(permFct, PERM.MANAGE_ASSIGNMENTS), asyncHandler(async (req: Request, res: Response) => {
    // The invoice controller orchestrates saved data and export policy; the route handles HTTP transport only.
    const data = await invoiceController.getInvoiceSharesPdfData(resFct(req), String(req.params.poolId), req.query);
    // Both downloads use the same authorized snapshot; only the optional example's visibility differs.
    const pdf = createInvoiceSharesPdf(data, data.pdfOptions);
    res.set('Cache-Control', 'no-store');
    res.attachment(`invoice-pool-${data.pool.id}-shares.pdf`);
    res.send(await pdf.getBuffer());
}));

export default app;
