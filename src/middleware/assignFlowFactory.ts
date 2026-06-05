/*
 * lib/assignRoutes.js
 */
import {Request, Response, Router} from "express";
import * as activityService from "../modules/database/services/ActivityService";
import {asyncHandler} from '../modules/lib/asyncHandler';
import {APIError} from "../modules/lib/errors";
import {performAPIAction} from '../modules/lib/util';
import renderer from '../modules/renderer';
import type {PermBundle} from "../types/PermissionTypes";

export function attachAssignRoutes(router: Router, opts: {
    assignToUser: (body: any, userId: number) => Promise<void>,
    assignToGuest: (body: any, guestId: string) => Promise<void>,
    unassignFromUser: (body: any, userId: number) => Promise<void>,
    unassignFromGuest: (body: any, guestId: string) => Promise<void>
}) {
    attachGenericAssignRoutes(router, '/:id/assign', '/:id/unassign', opts);
}

export function attachAssignRoleRoutes(router: Router, opts: {
    assignToUser: (body: any, userId: number) => Promise<void>;
    assignToGuest: (body: any, guestId: string) => Promise<void>;
    unassignFromUser: (body: any, userId: number) => Promise<void>;
    unassignFromGuest: (body: any, guestId: string) => Promise<void>;
}) {
    attachGenericAssignRoutes(router, '/:id/take-role', '/:id/leave-role', opts);
}

export function attachGenericAssignRoutes(router: Router, assignRoute: string, unassignRoute: string, opts: {
    assignToUser: (body: any, userId: number) => Promise<void>,
    assignToGuest: (body: any, guestId: string) => Promise<void>,
    unassignFromUser: (body: any, userId: number) => Promise<void>,
    unassignFromGuest: (body: any, guestId: string) => Promise<void>
}) {
    router.post(assignRoute, asyncHandler(async (req: Request, res: Response) => {
        await enforcePlanBindingDeadline(req, res.locals.permData as PermBundle | undefined);
        await performAPIAction(req, {actionUser: opts.assignToUser, actionGuest: opts.assignToGuest});
        renderer.respondWithSuccessJson(res, 'Assigned');
    }));

    router.post(unassignRoute, asyncHandler(async (req: Request, res: Response) => {
        await enforcePlanBindingDeadline(req, res.locals.permData as PermBundle | undefined);
        await performAPIAction(req, {actionUser: opts.unassignFromUser, actionGuest: opts.unassignFromGuest});
        renderer.respondWithSuccessJson(res, 'Unassigned');
    }));
}

export async function enforcePlanBindingDeadline(req: Request, permData?: PermBundle) {
    const planId = req.params?.id;
    if (!planId) return;

    const plan = await activityService.getActivityPlanById(planId);
    if (!plan?.bindingDeadline) return;

    const deadline = new Date(plan.bindingDeadline);
    if (Number.isNaN(deadline.getTime())) return;

    const now = new Date();
    if (deadline > now) return;

    const isAdmin = Boolean(permData?.entity?.has('MANAGE_ASSIGNMENTS'));
    if (!isAdmin) {
        throw new APIError('Assignments are locked after the binding deadline', req.body, 403);
    }
}
