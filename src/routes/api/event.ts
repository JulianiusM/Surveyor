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

import eventController from '../../controller/eventController';
import {createEntityAdminApiRouter} from "../../middleware/adminApiFactory";
import {createEntityHeaderUpdateRouter} from "../../middleware/entityHeaderUpdateHandler";
import {apiParamHandler} from "../../middleware/paramHandler";
import {
    attachPermBundle,
    requireEventParticipantAPI,
    requirePermissionApi
} from "../../middleware/permissionMiddleware";
import * as eventService from '../../modules/database/services/EventService';
import {asyncHandler} from '../../modules/lib/asyncHandler';
import {PERM} from "../../modules/lib/permissions";
import {ENTITIES, getItemFromEntityPermFct, getPermFct, getResource} from "../../modules/lib/util";

import renderer from '../../modules/renderer';
import type {ItemGetter} from "../../types/PermissionTypes";
import type {EntityType} from "../../types/UtilTypes";
import buildInvoiceRouter from "./eventInvoices";

const app = express.Router();
const entityName: EntityType = ENTITIES.EVENT;
const resFct = (req: Request) => getResource(req, entityName);
const permFct = getPermFct(resFct, entityName);
const itemPermFct: ItemGetter = getItemFromEntityPermFct(async () => [], resFct);

apiParamHandler('id', app, eventService.getEventById, entityName);
app.use("/:id", attachPermBundle(permFct, itemPermFct));

createEntityAdminApiRouter(app, entityName, permFct)
createEntityHeaderUpdateRouter(app, permFct, resFct, eventController.updateHeaderImg, eventController.deleteHeaderImg);

// Register current user to event
app.post('/:id/register', requirePermissionApi(permFct, PERM.ACCESS_REGISTRATION), asyncHandler(async (req: Request, res: Response) => {
    const msg = await eventController.registerAttendance(resFct(req), req.body, req);
    renderer.respondWithSuccessJson(res, msg);
}));

// Cancel registration
app.post('/:id/register/delete', requireEventParticipantAPI(resFct), asyncHandler(async (req: Request, res: Response) => {
    const msg = await eventController.cancelRegistration(resFct(req), req.session);
    renderer.respondWithSuccessJson(res, msg);
}));

// Organizer updates event settings
app.post('/:id/update', asyncHandler(async (req: Request, res: Response) => {
    const msg = await eventController.updateEventSettings(resFct(req), req.body, res.locals.permData);
    renderer.respondWithSuccessJson(res, msg);
}));

app.post('/:id/settings', requirePermissionApi(permFct, PERM.MANAGE_PERMISSIONS), asyncHandler(async (req: Request, res: Response) => {
    const msg = await eventController.updateSettings(resFct(req).id, req.body);
    renderer.respondWithSuccessJson(res, msg);
}));

/** List links */
app.get('/:id/links', requirePermissionApi(permFct, PERM.MANAGE_REGISTRATIONS), asyncHandler(async (req: Request, res: Response) => {
        const rows = await eventController.listDeadlineBypassLinks(resFct(req));
        renderer.respondWithSuccessDataJson(res, "found", rows);
    })
);

/** Create single-use link (optionally with expiry) */
app.post('/:id/links', requirePermissionApi(permFct, PERM.MANAGE_REGISTRATIONS), asyncHandler(async (req: Request, res: Response) => {
        const {id, token} = await eventController.createDeadlineBypassLink(resFct(req), req.body, req.session)
        // Return token; UI can build full URL as `${location.origin}/event/${id}?t=${token}`
        renderer.respondWithSuccessDataJson(res, "created", {id, token});
    })
);

/** Revoke link */
app.delete('/:id/links/:linkId', requirePermissionApi(permFct, PERM.MANAGE_REGISTRATIONS), asyncHandler(async (req: Request, res: Response) => {
        await eventController.revokeDeadlineBypassLink(resFct(req), req.params.linkId as string);
        renderer.respondWithSuccessJson(res, "revoked");
    })
);

// GET /api/event/:id/participants
app.get(
    '/:id/participants',
    requirePermissionApi(permFct, PERM.ACCESS_PARTICIPANTS),
    asyncHandler(async (req, res) => {
        const rows = await eventController.getParticipantsExtended(resFct(req));
        renderer.respondWithSuccessDataJson(res, "found", rows);
    })
);

// Delete a registration by id (admin only)
app.delete(
    '/:id/registrations/:regId',
    requirePermissionApi(permFct, PERM.MANAGE_REGISTRATIONS),
    asyncHandler(async (req, res) => {
        if (await eventController.deleteRegistration(resFct(req), req.params.regId as string)) {
            return renderer.respondWithSuccessJson(res, "Registration deleted")
        }
        renderer.respondWithErrorJson(res)
    })
);

app.patch(
    '/:id/registrations/:regId',
    requirePermissionApi(permFct, PERM.MANAGE_REGISTRATIONS),
    asyncHandler(async (req, res) => {
        const msg = await eventController.updateRegistrationDates(resFct(req), req.params.regId as string, req.body, res.locals.permData);
        renderer.respondWithSuccessJson(res, msg);
    })
);

// Invoice pools
app.use('/:id/invoice-pools', buildInvoiceRouter(permFct, resFct));

export default app;
