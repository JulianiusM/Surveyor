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

import {NextFunction, Request, Response} from 'express';

/** Forward the existing asynchronous handler rejection to Express's error owner. */
export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => any) {
    // Preserve handler arguments and completion; no business retry or translation occurs.
    return (req: Request, res: Response, next: NextFunction) =>
        Promise.resolve(fn(req, res, next)).catch(next);
}

/** Apply the same rejection handoff to an Express parameter loader. */
export function asyncParamHandler(fn: (req: Request, res: Response, next: NextFunction, id: any) => any) {
    // The matched ID remains the loader's input, independently of later admission.
    return (req: Request, res: Response, next: NextFunction, id: any) =>
        Promise.resolve(fn(req, res, next, id)).catch(next);
}
