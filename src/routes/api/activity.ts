import express, {Request, Response} from 'express';
import * as activityService from '../../modules/database/services/ActivityService';
import {asyncHandler} from '../../modules/lib/asyncHandler';
import renderer from '../../modules/renderer';
import {
    ENTITIES,
    ENTITY_ITEMS,
    getAdditional,
    getItemFromEntityPermFct,
    getPermFct,
    getPermFctAssign,
    getPermFctItems,
    getResource
} from "../../modules/lib/util";

import {apiParamHandler} from "../../middleware/paramHandler";
import {attachPermBundle, requireItemPermissionApi, requirePermissionApi} from '../../middleware/permissionMiddleware';
import {attachAssignRoleRoutes, attachAssignRoutes} from '../../middleware/assignFlowFactory';

import controller from '../../controller/activityController';
import {PERM} from "../../modules/lib/permissions";
import type {EntityItemType, EntityType} from "../../types/UtilTypes";
import {createEntityAdminApiRouter} from "../../middleware/adminApiFactory";
import type {ItemGetter} from "../../types/PermissionTypes";

const app = express.Router();
const entityName: EntityType = ENTITIES.ACTIVITY;
const entityItemName: EntityItemType = ENTITY_ITEMS.ACTIVITY;
const assignName = "assignment"
const resFct = (req: Request) => getResource(req, entityName);
const resFctItems = (req: Request) => getAdditional(req, entityItemName);
const resFctAssign = (req: Request) => getAdditional(req, assignName);
const permFct = getPermFct(resFct, entityName);
const permFctItems = getPermFctItems(resFct, resFctItems, entityName, entityItemName);
const permFctAssign = getPermFctAssign(resFct, resFctAssign, entityName, entityItemName);
const itemPermFct: ItemGetter = getItemFromEntityPermFct(activityService.getActivitySlotsFlat, resFct, entityItemName);

apiParamHandler('id', app, activityService.getActivityPlanById, entityName);
apiParamHandler('slotId', app, activityService.getActivitySlotById, entityItemName);
apiParamHandler('assignId', app, activityService.getActivitySlotAssignmentById, assignName);
app.use("/:id", attachPermBundle(permFct, itemPermFct));

createEntityAdminApiRouter(app, entityName, permFct)

app.post('/:id/description', requirePermissionApi(permFct, PERM.EDIT_DESC), async (req: Request, res: Response) => {
    const msg = await controller.updateDescription(resFct(req).id, req.body);
    renderer.respondWithSuccessJson(res, msg);
})

app.get(
    '/:id/requirements',
    requirePermissionApi(permFct, PERM.MANAGE_REQUIREMENTS),
    asyncHandler(async (req: Request, res: Response) => {
        const requirements = await controller.getRequirements(resFct(req).id);
        renderer.respondWithSuccessJson(res, requirements);
    })
);

app.post(
    '/:id/requirements',
    requirePermissionApi(permFct, PERM.MANAGE_REQUIREMENTS),
    asyncHandler(async (req: Request, res: Response) => {
        const msg = await controller.updateRequirements(resFct(req).id, req.body);
        renderer.respondWithSuccessJson(res, msg);
    })
);

app.get(
    '/:id/recommendations',
    requirePermissionApi(permFct, PERM.MANAGE_ASSIGNMENTS),
    asyncHandler(async (req: Request, res: Response) => {
        const data = await controller.getRecommendations(resFct(req).id);
        renderer.respondWithSuccessJson(res, data);
    })
);

app.post(
    '/:id/recommendations',
    requirePermissionApi(permFct, PERM.MANAGE_ASSIGNMENTS),
    asyncHandler(async (req: Request, res: Response) => {
        const data = await controller.updateRecommendations(resFct(req).id, req.body);
        renderer.respondWithSuccessJson(res, data);
    })
);

/* Assign / Unassign identical to packing routes … */
/* ───────────────── ASSIGN / UNASSIGN (JSON) ───────────────── */

attachAssignRoutes(app, controller.getAssignmentAccessMapping());
attachAssignRoleRoutes(app, controller.getRoleAccessMapping());

/* ───────────────── REORDER (Owner) ────────────────────────── */

/* ----------- REORDER (nur Owner, JSON-Antwort) ---------------- */
app.post('/:id/slot/reorder', requirePermissionApi(permFct, PERM.ITEM_EDIT), asyncHandler(async (req: Request, res: Response) => {
    const msg = await controller.reorderSlots(resFct(req).id, req.body.order);
    renderer.respondWithSuccessJson(res, msg);
}));

/* ───────────────── QUICK-ADD ──────────────────────────────── */

app.post('/:id/slot/add', requirePermissionApi(permFct, PERM.ITEM_ADD), asyncHandler(async (req: Request, res: Response) => {
    const msg = await controller.quickAddSlot(resFct(req), req.body);
    renderer.respondWithSuccessJson(res, msg);
}));

app.post('/:id/slot/:slotId/description', requireItemPermissionApi(permFctItems, PERM.EDIT_DESC, PERM.ITEM_EDIT), asyncHandler(async (req: Request, res: Response) => {
    const msg = await controller.updateSlotDescription(req.params.slotId, req.body);
    renderer.respondWithSuccessJson(res, msg);
}));

/* ---------- PATCH einzelnes Attribut -------------------------------- */
app.post('/:id/slot/:slotId/attr', requireItemPermissionApi(permFctItems, PERM.EDIT_META, PERM.ITEM_EDIT), asyncHandler(async (req: Request, res: Response) => {
    const msg = await controller.updateSlotAttr(req.params.slotId, req.body);
    renderer.respondWithSuccessJson(res, msg);
}));

app.post('/:id/assignment/:assignId/delete', requireItemPermissionApi(permFctAssign, PERM.MANAGE_ASSIGNMENTS), asyncHandler(async (req: Request, res: Response) => {
    const msg = await controller.deleteAssignment(Number(req.params.assignId));
    renderer.respondWithSuccessJson(res, msg);
}));

/* Owner-Settings ändern (AJAX) -------------------------------------- */
app.post('/:id/settings', requirePermissionApi(permFct, PERM.MANAGE_PERMISSIONS), asyncHandler(async (req: Request, res: Response) => {
    const msg = await controller.updateSettings(resFct(req).id, req.body);
    renderer.respondWithSuccessJson(res, msg);
}));

app.post('/:id/slot/:slotId/delete', requireItemPermissionApi(permFctItems, PERM.ITEM_DELETE, PERM.ITEM_DELETE), asyncHandler(async (req: Request, res: Response) => {
    const msg = await controller.deleteSlot(req.params.slotId);
    renderer.respondWithSuccessJson(res, msg);
}));

app.post('/:id/slot/:slotId/addRole', requireItemPermissionApi(permFctItems, PERM.EDIT_META, PERM.ITEM_EDIT), asyncHandler(async (req: Request, res: Response) => {
    const msg = await controller.addSlotRole(req.params.slotId, req.body);
    renderer.respondWithSuccessJson(res, msg);
}));

export default app;