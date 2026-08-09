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

export function createEntityHeaderUpdateRouter(app: Router, permFct: EntityGetter, resFct: GetResource, setImg: (entity: EntityBase, file?: Express.Multer.File) => Promise<string>, delImg: (entity: EntityBase) => Promise<string>) {
    app.put("/:id/header",
        requirePermissionApi(permFct, PERM.EDIT_META),
        fileUploader.single("image"),
        asyncHandler(async (req: Request, res: Response) => {
            const msg = await setImg(resFct(req), req.file);
            renderer.respondWithSuccessJson(res, msg)
        }));

    app.delete("/:id/header",
        requirePermissionApi(permFct, PERM.EDIT_META),
        asyncHandler(async (req: Request, res: Response) => {
            const msg = await delImg(resFct(req));
            renderer.respondWithSuccessJson(res, msg);
        }));
}