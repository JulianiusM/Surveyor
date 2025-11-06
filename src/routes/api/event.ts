import express, {Request, Response} from 'express';
import {asyncHandler} from '../../modules/lib/asyncHandler';
import * as eventService from '../../modules/database/services/EventService';

import renderer from '../../modules/renderer';
import {getResource} from "../../modules/lib/util";
import {apiParamHandler} from "../../middleware/paramHandler";

import eventController from '../../controller/eventController';
import {requireOwnerAPI} from "../../middleware/permissionMiddleware";

const app = express.Router();
const entityName = 'event';
const resFct = (req: Request) => getResource(req, entityName);
apiParamHandler('id', app, eventService.getEventById, entityName);

// Register current user to event
app.post('/:id/register', asyncHandler(async (req: Request, res: Response) => {
    const msg = await eventController.registerAttendance(resFct(req), req.body, req.session);
    renderer.respondWithSuccessJson(res, msg);
}));

// Cancel registration
app.post('/:id/register/delete', asyncHandler(async (req: Request, res: Response) => {
    const msg = await eventController.cancelRegistration(resFct(req), req.session);
    renderer.respondWithSuccessJson(res, msg);
}));

// Organizer updates event settings
app.post('/:id/update', requireOwnerAPI(resFct), asyncHandler(async (req: Request, res: Response) => {
    const msg = await eventController.updateEventSettings(resFct(req), req.body);
    renderer.respondWithSuccessJson(res, msg);
}));

export default app;
