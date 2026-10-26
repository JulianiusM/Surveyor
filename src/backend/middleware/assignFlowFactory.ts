/*
 * Copyright 2026 Julian Malovanij
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy at http://www.apache.org/licenses/LICENSE-2.0
 */

import type {Request, RequestHandler, Response, Router} from 'express';
import type {PreparedApiJsonResponse} from '../../types/ApiTransportTypes';
import type {AssignmentCommand, AssignmentInput, AssignmentOperation, AssignmentRoleRoute,
    AssignmentRoutePair, AssignmentRouteParameters, AssignmentResult} from '../../types/AssignmentFlowTypes';
import {requireApiContext} from '../modules/api/session';
import {prepareValidatedJson, sendPreparedJson, sendValidatedJson, validateOperationRequest} from '../modules/api/transport';
import {asyncHandler} from '../modules/lib/asyncHandler';

/**
 * Register the existing list self-assignment methods through one transport owner.
 * Feature hooks keep their current locks, capacity policy and principal checks;
 * a route pair supplies only its URL, operation contracts and business calls.
 */
export function attachAssignRoutes<Assign extends 'assignPackingItem' | 'assignDriversItem',
    Unassign extends 'unassignPackingItem' | 'unassignDriversItem'>(router: Router,
    configuration: AssignmentRoutePair<Assign, Unassign>): void {
    // PUT takes a place and DELETE releases it. Both retain the same configured
    // parameter names and admission while selecting distinct generated operations.
    router.put(configuration.path, assignmentHandler(configuration, configuration.assign));
    router.delete(configuration.path, assignmentHandler(configuration, configuration.unassign));
}

/** Register Activity's combined self-membership/role command without adding organizer routes. */
export function attachAssignRoleRoutes(router: Router, configuration: AssignmentRoleRoute): void {
    // The current body chooses join/leave and optional role; do not resurrect
    // the retired separate take-role/leave-role URLs or their legacy envelope.
    router.put(configuration.path, assignmentHandler(configuration, configuration.command));
}

/**
 * Share actor capture, generated decoding and delivery while preserving each
 * feature's exact response-preparation boundary. This adapter performs no item
 * lookup, permission decision, session write, transaction or command replay.
 */
function assignmentHandler<Operation extends AssignmentOperation>(parameters: AssignmentRouteParameters,
    command: AssignmentCommand<Operation>): RequestHandler {
    /** Admit one request and preserve its selected feature's response preparation order. */
    async function performAssignment(req: Request, res: Response): Promise<void> {
        // Context/CSRF admission precedes decoding, matching the original feature
        // adapters. A submitted profile identifier never selects the actor.
        const actor = await requireApiContext(req, res, parameters.requireProfile);
        validateOperationRequest(req, command.operation);
        const input: AssignmentInput<Operation> = {
            entityId: String(req.params[parameters.entityParameter]),
            itemId: String(req.params[parameters.itemParameter]),
            actor,
            body: req.body,
        };

        // Packing's existing operation returns its result before transport
        // preparation. Retain that boundary instead of changing its transaction.
        if (command.delivery === 'result') {
            const result = await command.execute(input);
            sendValidatedJson<AssignmentOperation, 200>(req, res, command.operation, 200, result);
            return;
        }

        let prepared: PreparedApiJsonResponse;
        function prepareAssignment(data: AssignmentResult<Operation>): void {
            prepared = prepareValidatedJson<AssignmentOperation, 200>(req, command.operation, 200, data);
        }

        // Drivers invokes preparation inside its existing transaction. Activity
        // prepares the invariant acknowledgement before its existing operation.
        // After success both branches only deliver their already prepared bytes.
        if (command.delivery === 'transaction') await command.execute(input, prepareAssignment);
        else {
            prepareAssignment(command.result);
            await command.execute(input);
        }
        sendPreparedJson(req, res, prepared!);
    }
    return asyncHandler(performAssignment);
}
