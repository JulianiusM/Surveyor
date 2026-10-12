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

/*
 * lib/assignRoutes.js
 */
import {Request, RequestHandler, Response, Router} from "express";
import * as activityService from "../modules/database/services/ActivityService";
import {asyncHandler} from '../modules/lib/asyncHandler';
import {APIError} from "../modules/lib/errors";
import {performAPIAction} from '../modules/lib/util';
import renderer from '../modules/renderer';
import type {PermBundle} from "../types/PermissionTypes";

interface AssignmentAccessMapping {
    assign: (body: any, profileId: string) => Promise<void>,
    unassign: (body: any, profileId: string) => Promise<void>
}

export type AssignmentOperation = 'assign' | 'unassign';

interface AssignmentRouteSecurity {
    middleware: RequestHandler[];
    resolveItemEntityId: (itemId: string) => Promise<string | undefined>;
    authorize?: (req: Request, profileId: string, operation: AssignmentOperation) => Promise<void>;
    enforceActivityBindingDeadline?: boolean;
}

export function attachAssignRoutes(
    router: Router,
    opts: AssignmentAccessMapping,
    security: AssignmentRouteSecurity,
) {
    attachGenericAssignRoutes(router, '/:id/assign', '/:id/unassign', opts, security);
}

export function attachAssignRoleRoutes(
    router: Router,
    opts: AssignmentAccessMapping,
    security: AssignmentRouteSecurity,
) {
    attachGenericAssignRoutes(router, '/:id/take-role', '/:id/leave-role', opts, security);
}

export function attachGenericAssignRoutes(
    router: Router,
    assignRoute: string,
    unassignRoute: string,
    opts: AssignmentAccessMapping,
    security: AssignmentRouteSecurity,
) {
    router.post(assignRoute, ...security.middleware, asyncHandler(async (req: Request, res: Response) => {
        if (security.enforceActivityBindingDeadline) {
            await enforcePlanBindingDeadline(req, res.locals.permData as PermBundle | undefined);
        }
        await performSecuredAssignmentAction(req, opts.assign, security, 'assign');
        renderer.respondWithSuccessJson(res, 'Assigned');
    }));

    router.post(unassignRoute, ...security.middleware, asyncHandler(async (req: Request, res: Response) => {
        if (security.enforceActivityBindingDeadline) {
            await enforcePlanBindingDeadline(req, res.locals.permData as PermBundle | undefined);
        }
        await performSecuredAssignmentAction(req, opts.unassign, security, 'unassign');
        renderer.respondWithSuccessJson(res, 'Unassigned');
    }));
}

/** Resolve the native session profile through the common API-action wrapper,
 * then scope the submitted item before optional feature authority and mutation.
 * This wrapper opens no transaction: the selected feature action owns its DBAL
 * locks/business checks and retains the native success/error presentation.
 */
async function performSecuredAssignmentAction(
    req: Request,
    action: AssignmentAccessMapping['assign'],
    security: AssignmentRouteSecurity,
    operation: AssignmentOperation,
) {
    // The wrapper supplies the admitted native profile; body fields never select
    // the acting identity. Scope and feature checks must precede the chosen action.
    await performAPIAction(req, async (body, profileId) => {
        const itemId = typeof body?.itemId === 'string' ? body.itemId : '';
        if (!itemId) {
            throw new APIError('Assignment item is required', body, 400);
        }

        await enforceAssignmentItemScope(req.params.id as string, itemId, security.resolveItemEntityId);

        await security.authorize?.(req, profileId, operation);

        // The feature owner retains any locked capacity/deadline decision.
        await action(body, profileId);
    });
}

export async function enforceAssignmentItemScope(
    routeEntityId: string,
    itemId: string,
    resolveItemEntityId: (itemId: string) => Promise<string | undefined>,
) {
    let itemEntityId: string | undefined;
    try {
        itemEntityId = await resolveItemEntityId(itemId);
    } catch {
        throw new APIError('Assignment item not found in this resource', {itemId}, 404);
    }

    if (!itemEntityId || itemEntityId !== routeEntityId) {
        throw new APIError('Assignment item not found in this resource', {itemId}, 404);
    }
}

export async function enforcePlanBindingDeadline(req: Request, permData?: PermBundle) {
    const planId = req.params?.id as string;
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
