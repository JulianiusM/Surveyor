/*
 * lib/assignRoutes.js
 */
import {asyncHandler} from '../modules/lib/asyncHandler';
import renderer from '../modules/renderer';
import {performAPIAction} from "../modules/lib/util";

export function attachAssignRoleRoutes(router: any, {
    assignToUser,
    assignToGuest,
    unassignFromUser,
    unassignFromGuest
}: any) {
    router.post('/:id/take-role', asyncHandler(async (req: any, res: any) => {
        await performAPIAction(req, {actionUser: assignToUser, actionGuest: assignToGuest});
        renderer.respondWithSuccessJson(res, 'Assigned');
    }));

    router.post('/:id/leave-role', asyncHandler(async (req: any, res: any) => {
        await performAPIAction(req, {actionUser: unassignFromUser, actionGuest: unassignFromGuest});
        renderer.respondWithSuccessJson(res, 'Unassigned');
    }));
}
