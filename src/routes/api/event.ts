import express, {Request, Response} from 'express';
import {asyncHandler} from '../../modules/lib/asyncHandler';
import * as eventService from '../../modules/database/services/EventService';

import renderer from '../../modules/renderer';
import {ENTITIES, getItemFromEntityPermFct, getPermFct, getResource} from "../../modules/lib/util";
import {apiParamHandler} from "../../middleware/paramHandler";

import eventController from '../../controller/eventController';
import {
    attachPermBundle,
    requireEventParticipantAPI,
    requirePermissionApi
} from "../../middleware/permissionMiddleware";
import {PERM} from "../../modules/lib/permissions";
import {EntityType} from "../../types/UtilTypes";
import {createEntityAdminApiRouter} from "../../middleware/adminApiFactory";
import {ItemGetter} from "../../types/PermissionTypes";

const app = express.Router();
const entityName: EntityType = ENTITIES.EVENT;
const resFct = (req: Request) => getResource(req, entityName);
const permFct = getPermFct(resFct, entityName);
const itemPermFct: ItemGetter = getItemFromEntityPermFct(async () => [], resFct);

apiParamHandler('id', app, eventService.getEventById, entityName);
app.use("/:id", attachPermBundle(permFct, itemPermFct));

createEntityAdminApiRouter(app, entityName, permFct)

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
        await eventController.revokeDeadlineBypassLink(resFct(req), req.params.linkId);
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
        if (await eventController.deleteRegistration(resFct(req), req.params.regId)) {
            return renderer.respondWithSuccessJson(res, "Registration deleted")
        }
        renderer.respondWithErrorJson(res)
    })
);

export default app;
