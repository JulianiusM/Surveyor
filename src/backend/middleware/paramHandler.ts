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

import {NextFunction, Request, Response, Router} from 'express';
import {asyncParamHandler} from '../modules/lib/asyncHandler';
import {ExpectedError} from '../modules/lib/errors';
import type {ResourceLoader} from '../../types/UtilTypes';

export function paramHandler(param: string, router: Router, getById: ResourceLoader, entityType: string) {
    handleParam(param, router, getById, entityType, new ExpectedError(`${entityType} not found`, 'error', 404));
}

/** Register the lookup for an Express-matched path parameter. The async wrapper
 * forwards lookup and missing-resource errors before the route consumes the result. */
function handleParam(param: string, router: Router, getById: ResourceLoader, entityName: string, error?: Error) {
    router.param(param, asyncParamHandler(async (req: Request, res: Response, next: NextFunction, id: any) =>
        await handle(id, getById, entityName, req, res, next, error)
    ));
}

/** Attach the loaded root and its linked Event for later page/output admission.
 * Loading does not grant access; downstream handlers retain their own permission
 * checks. A missing root uses the caller's error, or passes on when optional. */
async function handle(
    id: any,
    getById: ResourceLoader,
    entityName: string,
    req: Request,
    res: Response,
    next: NextFunction,
    error?: Error,
) {
    let entity = undefined;
    if (id !== undefined) {
        entity = await getById(id);
    }
    if (!entity) {
        if (error) throw error;
        // No error --> Optional resource
        return next();
    }
    req.resource = req.resource || {};
    req.resource[entityName] = entity;
    if (entity.event) {
        req.resource['event'] = entity.event;
    }
    return next();
}
