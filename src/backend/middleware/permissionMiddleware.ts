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

import {NextFunction, Request, Response} from "express";
import {ExpectedError} from "../modules/lib/errors";
import {normalizeToArray} from "../modules/lib/util";
import {can} from "../modules/permissionEngine";
import type {EntityGetter, Subject} from "../../types/PermissionTypes";

type ErrorAdapter = {
    forbidden: () => never;
};

const expectedErrors: ErrorAdapter = {
    forbidden: () => {
        throw new ExpectedError("Not allowed", "error", 403);
    },
};

/** Retained print/download routes use the existing account-or-guest redirect. */
export function isLoggedIn(req: Request, res: Response, next: NextFunction) {
    if (req.session.auth && req.session.profile) return next();
    req.flash("info", "You must be logged in to access this site.");
    let nxt = "";
    if (typeof req.query.next === "string") {
        nxt = `?next=${req.query.next}`;
    } else {
        nxt = `?next=${req.baseUrl}${req.path}`;
    }
    res.redirect(`/users/login${nxt}`);
}

/** Resolve each retained output's subject through the shared permission engine.
 * Any permitted subject admits the document; a denial preserves its existing 403. */
function requirePermInternal(
    getSubjects: ((req: Request) => Promise<Subject> | Subject)[],
    requiredPerm: number,
    err: ErrorAdapter,
    requiredParentPerm?: number | number[],
) {
    return /** Admit one independent subject; partial grants never combine. */ async (req: Request, _res: Response, next: NextFunction) => {
        let ok = false;
        // Keep alternative roots independent: combining their masks here could
        // admit a document even when no individual subject grants its operation.
        for (const getSubject of getSubjects) {
            const subject = await getSubject(req);
            ok = await can(subject, req.session ?? {}, requiredPerm, requiredParentPerm)
            if (ok) break; // break early
        }
        if (!ok) {
            return err.forbidden();
        }
        next();
    };
}

/** Keep each route's existing root loader as an entity subject for engine.can. */
function transformEntityGetter(getEntity: EntityGetter[]) {
    const getters: ((req: Request) => Promise<Subject> | Subject)[] = [];
    // Resolve the matched request's loaded resource when admission runs; never
    // cache an entity or its authority across requests and actors.
    for (const getter of getEntity) {
        getters.push(async (req: Request) => ({
            kind: 'entity',
            entity: (await getter(req))
        }))
    }
    return getters;
}

/** Preserve document permission admission without the retired browser/API adapters. */
export function requirePermission(getEntity: EntityGetter | EntityGetter[], requiredPerm: number) {
    return requirePermInternal(transformEntityGetter(normalizeToArray(getEntity)), requiredPerm, expectedErrors);
}
