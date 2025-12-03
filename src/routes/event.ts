import express, {Request, Response} from 'express';
import {createGuestFlowRouter} from '../middleware/guestFlowFactory';
import controller from '../controller/eventController';
import * as eventService from '../modules/database/services/EventService';
import {ENTITIES, getResource} from "../modules/lib/util";
import {requirePermission} from "../middleware/permissionMiddleware";
import {asyncHandler} from "../modules/lib/asyncHandler";
import renderer from "../modules/renderer";
import {PERM} from "../modules/lib/permissions";
import {EntityType} from "../types/UtilTypes";
import {EntityDescriptor} from "../types/PermissionTypes";
import {queryHandler} from "../middleware/paramHandler";

const app = express.Router();
const entityName: EntityType = ENTITIES.EVENT;
const resFct = (req: Request) => getResource(req, entityName);
const permFct = (req: Request): EntityDescriptor => {
    const resource = getResource(req, entityName);
    return {entityType: entityName, entityId: resource.id, ownerUserId: resource.ownerId, eventId: resource.id};
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
    const data = await controller.fetchForView(resFct(req), req);
    renderer.renderWithData(res, 'event/event-dashboard', data);
}))

app.get("/:id/export/participants", requirePermission(permFct, PERM.DATA_EXPORT | PERM.ACCESS_PARTICIPANTS), asyncHandler(async (req: Request, res: Response) => {
    const data = await controller.getParticipantsExtended(resFct(req));
    renderer.renderWithData(res, 'event/export/participants', data);
}))

export default app;
