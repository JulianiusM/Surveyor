import express, {Request, Response} from 'express';
import {createGuestFlowRouter} from '../middleware/guestFlowFactory';
import controller from '../controller/eventController';
import * as eventService from '../modules/database/services/EventService';
import {getResource} from "../modules/lib/util";
import {requireOwner} from "../middleware/permissionMiddleware";
import {asyncHandler} from "../modules/lib/asyncHandler";
import renderer from "../modules/renderer";

const app = express.Router();
const entityName = 'event';
const resFct = (req: Request) => getResource(req, entityName);

app.use("/", createGuestFlowRouter({
    addToEvent: false,
    entityType: entityName,
    db: {getById: eventService.getEventById},
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

app.get('/:id/admin', requireOwner(resFct), asyncHandler(async (req: Request, res: Response) => {
    const data = await controller.fetchForView(resFct(req), req.session);
    renderer.renderWithData(res, 'event/event-dashboard', data);
}))

export default app;
