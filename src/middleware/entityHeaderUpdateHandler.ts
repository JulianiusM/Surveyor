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