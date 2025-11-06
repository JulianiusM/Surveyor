/*
 * lib/assignRoutes.js
 */
import {asyncHandler} from '../modules/lib/asyncHandler';
import renderer from '../modules/renderer';
import {performAPIAction} from '../modules/lib/util';
import {Request, Response, Router} from "express";

export function attachAssignRoutes(router: Router, opts: {
    assignToUser: (body: any, userId: number) => Promise<void>,
    assignToGuest: (body: any, guestId: number) => Promise<void>,
    unassignFromUser: (body: any, userId: number) => Promise<void>,
    unassignFromGuest: (body: any, guestId: number) => Promise<void>
}) {
    attachGenericAssignRoutes(router, '/:id/assign', '/:id/unassign', opts);
}

export function attachAssignRoleRoutes(router: Router, opts: {
    assignToUser: (body: any, userId: number) => Promise<void>;
    assignToGuest: (body: any, guestId: number) => Promise<void>;
    unassignFromUser: (body: any, userId: number) => Promise<void>;
    unassignFromGuest: (body: any, guestId: number) => Promise<void>;
}) {
    attachGenericAssignRoutes(router, '/:id/take-role', '/:id/leave-role', opts);
}

export function attachGenericAssignRoutes(router: Router, assignRoute: string, unassignRoute: string, opts: {
    assignToUser: (body: any, userId: number) => Promise<void>,
    assignToGuest: (body: any, guestId: number) => Promise<void>,
    unassignFromUser: (body: any, userId: number) => Promise<void>,
    unassignFromGuest: (body: any, guestId: number) => Promise<void>
}) {
    router.post(assignRoute, asyncHandler(async (req: Request, res: Response) => {
        await performAPIAction(req, {actionUser: opts.assignToUser, actionGuest: opts.assignToGuest});
        renderer.respondWithSuccessJson(res, 'Assigned');
    }));

    router.post(unassignRoute, asyncHandler(async (req: Request, res: Response) => {
        await performAPIAction(req, {actionUser: opts.unassignFromUser, actionGuest: opts.unassignFromGuest});
        renderer.respondWithSuccessJson(res, 'Unassigned');
    }));
}
