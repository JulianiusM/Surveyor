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

import {Request, Response, Router} from "express";
import {asyncHandler} from "../modules/lib/asyncHandler";
import {prepareFileUploader} from "../modules/lib/fileCommons";
import {PERM} from "../modules/lib/permissions";
import renderer from '../modules/renderer';
import settings from "../modules/settings";
import type {EntityGetter, GetResource} from "../types/PermissionTypes";
import type {EntityBase} from "../types/UserTypes";
import {requirePermissionApi} from "./permissionMiddleware";

const fileUploader = prepareFileUploader(settings.value.headerImgDir);

/** Attach native header writes to the existing feature's admitted resource.
 * Method permission precedes multipart storage; feature callbacks own image
 * validation/persistence/cleanup and return their established literal messages.
 * The read/download route and its page admission remain separate responsibilities.
 */
export function createEntityHeaderUpdateRouter(
    app: Router,
    permFct: EntityGetter,
    resFct: GetResource,
    setImg: (entity: EntityBase, file?: Express.Multer.File) => Promise<string>,
    delImg: (entity: EntityBase) => Promise<string>
) {
    // Reject missing method authority before the uploader writes a new file.
    app.put("/:id/header",
        requirePermissionApi(permFct, PERM.EDIT_META),
        fileUploader.single("image"),
        asyncHandler(async (req: Request, res: Response) => {
            const msg = await setImg(resFct(req), req.file);
            renderer.respondWithSuccessJson(res, msg)
        }));

    // Removal needs the same method authority but has no multipart side effect.
    app.delete("/:id/header",
        requirePermissionApi(permFct, PERM.EDIT_META),
        asyncHandler(async (req: Request, res: Response) => {
            const msg = await delImg(resFct(req));
            renderer.respondWithSuccessJson(res, msg);
        }));
}