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

import rateLimit from 'express-rate-limit';
import type {Request, RequestHandler, Response, Router} from 'express';
import type {AdminApiCommand, AdminApiInput, AdminApiOperation, AdminApiRead, AdminApiResult,
    EntityAdminApiConfiguration, EntityArchiveApiConfiguration, EntityPropertyApiConfiguration,
    UserSearchApiConfiguration} from '../../types/AdminApiTypes';
import type {SessionLike} from '../../types/PermissionTypes';
import type {EntityType} from '../../types/UtilTypes';
import {requireApiContext} from '../modules/api/session';
import {executePreparedJson, prepareValidatedJson, sendPreparedJson, sendValidatedJson, validateOperationRequest} from '../modules/api/transport';
import {asyncHandler} from '../modules/lib/asyncHandler';
import {APIError} from '../modules/lib/errors';

/** Administrator discovery shares one per-IP search budget across feature routes.
 * This is a transport limit, not a permission decision. Routes admit their
 * authoritative context first, then controllers evaluate resource grants. */
export const searchLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, // 10 minutes
    limit: 120, // 120 searches / 10 minutes per IP
    standardHeaders: true,
    legacyHeaders: false,
    handler: function handleSearchRateLimit(req, res, next, options) {
        // All retained callers use the existing Problem classifier/localization owner.
        next(new APIError('Search rate limit exceeded', {}, options.statusCode));
    },
});

/** Pass declared, validated values to the existing controller without exposing HTTP objects. */
function operationInput<Operation extends AdminApiOperation>(request: Request, parameter: string,
    actor: SessionLike): AdminApiInput<Operation> {
    return {id: String(request.params[parameter]), profileId: String(request.params.profileId), actor,
        body: request.body, query: request.query, ifMatch: request.get('If-Match')};
}

/** Read only the selected controller projection before validating conditional delivery. */
function readHandler<Operation extends AdminApiOperation>(parameter: string, configuration: AdminApiRead<Operation>): RequestHandler {
    /** Preserve context and generated-address admission before controller authority/projection. */
    async function readProjection(request: Request, response: Response): Promise<void> {
        // A transport profile prerequisite is separate from the controller's method grant.
        const actor = await requireApiContext(request, response, configuration.requireProfile);
        validateOperationRequest(request, configuration.operation);
        const result = await configuration.read(operationInput<Operation>(request, parameter, actor));
        sendValidatedJson<AdminApiOperation, 200>(request, response, configuration.operation, 200, result.data, result.etag);
    }
    return asyncHandler(readProjection);
}

/**
 * Share command transport while retaining the selected operation's actual commit boundary.
 * This middleware never evaluates permissions, opens transactions, writes Session state
 * or changes domain error handling; existing named controller operations remain owners.
 */
function commandHandler<Operation extends AdminApiOperation>(parameter: string,
    configuration: AdminApiCommand<Operation>): RequestHandler {
    /** Admit, decode and deliver one existing command without replay or postcommit reads. */
    async function executeCommand(request: Request, response: Response): Promise<void> {
        const actor = await requireApiContext(request, response, configuration.requireProfile);
        // Feature normalization retains its original position before generated body validation.
        validateOperationRequest(request, configuration.operation, configuration.normalize);
        const input = operationInput<Operation>(request, parameter, actor);

        // Packing/Event and Survey metadata keep their established result-first delivery.
        if (configuration.delivery === 'result') {
            const result = await configuration.execute(input);
            sendValidatedJson<AdminApiOperation, 200>(request, response, configuration.operation, 200, result.data, result.etag);
            return;
        }

        // Activity prepares invariant receipts before its inherited operation order.
        if (configuration.delivery === 'invariant') {
            const prepared = prepareValidatedJson<AdminApiOperation, 200>(request, configuration.operation, 200, configuration.result);
            await configuration.execute(input);
            sendPreparedJson(request, response, prepared);
            return;
        }

        // Drivers and selected Activity/Survey operations retain their own locks and
        // prepare callbacks. Metadata's returned ETag is set only after that command.
        const {operationResult: completion, prepared} = await executePreparedJson(
            (result: AdminApiResult<Operation>) => prepareValidatedJson<AdminApiOperation, 200>(request, configuration.operation, 200, result),
            prepare => configuration.execute(input, prepare));
        if (completion?.etag) response.set('ETag', completion.etag);
        sendPreparedJson(request, response, prepared!);
    }
    return asyncHandler(executeCommand);
}

/** Restore common administrator route creation without merging controller business operations. */
export function createEntityAdminApiRouter<Type extends Exclude<EntityType, 'survey'>>(router: Router,
    configuration: EntityAdminApiConfiguration<Type>): void {
    const root = `/:${configuration.parameter}/admins`;
    // Baselines are the current transport companion to the historical three commands.
    router.get(`${root}/:profileId/edit-baseline`, readHandler(configuration.parameter, configuration.baseline));
    router.post(root, commandHandler(configuration.parameter, configuration.add));
    router.patch(`${root}/:profileId`, commandHandler(configuration.parameter, configuration.update));
    router.delete(`${root}/:profileId`, commandHandler(configuration.parameter, configuration.remove));
}

/** Restore finite lifecycle command registration while preserving per-feature scheduling support. */
export function createEntityArchiveApiRouter<Type extends EntityType>(router: Router,
    configuration: EntityArchiveApiConfiguration<Type>): void {
    const root = `/:${configuration.parameter}`;
    // Permanent deletion belongs to the guest-flow composer, never this lifecycle family.
    router.post(`${root}/archive`, commandHandler(configuration.parameter, configuration.archive));
    router.post(`${root}/restore`, commandHandler(configuration.parameter, configuration.restore));
    if (configuration.automatic) router.put(`${root}/automatic-archive`, commandHandler(configuration.parameter, configuration.automatic));
}

/** Restore shared property transport; normalization and locked authorization stay feature-owned. */
export function createEntityPropertyApiRouter<Type extends Exclude<EntityType, 'event'>>(router: Router,
    configuration: EntityPropertyApiConfiguration<Type>): void {
    const root = `/:${configuration.parameter}`;
    // Survey has no Event association, and Event retains its distinct metadata adapter.
    router.get(`${root}/metadata`, readHandler(configuration.parameter, configuration.read));
    router.patch(`${root}/metadata`, commandHandler(configuration.parameter, configuration.update));
    if (configuration.event) router.put(`${root}/event`, commandHandler(configuration.parameter, configuration.event));
}

/** Restore scoped profile-search composition using the original shared limiter instance. */
export function createUserSearchApiRouter<Type extends Exclude<EntityType, 'survey'>>(router: Router,
    configuration: UserSearchApiConfiguration<Type>): void {
    const search = configuration.search;
    /** Context and generated query validation must precede any limiter response. */
    const admitSearch = asyncHandler(async function admitSearch(request, response, next) {
        // Capture once; the search below uses this same admitted actor after rate limiting.
        await requireApiContext(request, response, search.requireProfile);
        validateOperationRequest(request, search.operation);
        next();
    });
    /** Let the existing controller enforce resource scope before returning only its profile options. */
    const searchProfiles = asyncHandler(async function searchProfiles(request, response) {
        // No second identity capture or unscoped user enumeration is introduced.
        const result = await search.read(operationInput(request, configuration.parameter, request.apiActor!));
        sendValidatedJson<AdminApiOperation, 200>(request, response, search.operation, 200, result.data, result.etag);
    });
    router.get(`/:${configuration.parameter}/profiles`, admitSearch, searchLimiter, searchProfiles);
}
