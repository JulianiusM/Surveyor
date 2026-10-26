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

import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import {v4 as uuidv4} from "uuid";
import {EntityBase} from "../../../types/UserTypes";
import type {ImageSwapReceipt} from '../../../types/UtilTypes';
import {APIError} from "./errors";
import {isImageMimeType, uploadFileMedia} from '../../../common/lib/fileMedia';

/** Configure the existing disk uploader with its reviewed media switches.
 * Filename/extension and MIME admission remain separate server checks; byte
 * limits and storage timing retain the uploader's established behavior. */
export function prepareFileUploader(dir: string, allowImg: boolean = true, allowPdf: boolean = false) {
    // Select shared media once for this uploader, without changing its destination
    // creation or original filename extension checks for each received file.
    const media = uploadFileMedia(allowImg, allowPdf);
    const proofDir = path.join(process.cwd(), dir);
    const proofStorage = multer.diskStorage({
        destination: function uploadDestination(_req, _file, cb) {
            fs.mkdirSync(proofDir, {recursive: true});
            cb(null, proofDir);
        },
        /** Keep only a permitted original suffix and generate an opaque basename. */
        filename: function uploadFilename(_req, file, cb) {
            // Reject the original extension before allocating a stored filename.
            const ext = path.extname(file.originalname).toLowerCase();
            if (!media.extensions.includes(ext)) {
                return cb(new Error('Invalid file extension'), '');
            }
            cb(null, `${Date.now()}-${uuidv4()}${ext}`);
        },
    });

    // File size and reported MIME still pass through Multer before any controller.
    const proofUpload = multer({
        storage: proofStorage,
        limits: {fileSize: 10 * 1024 * 1024},
        /** Admit the reported MIME independently of filename and byte limits. */
        fileFilter: function uploadMimeType(_req, file, cb) {
            // The shared descriptor preserves this uploader's image/PDF switches.
            const ok = media.mimeTypes.includes(file.mimetype);
            if (ok) {
                cb(null, true);
            } else {
                cb(new Error("File type not allowed"));
            }
        },
    });

    return proofUpload;
}

/** Validate and replace an image through its owning persistence operation.
 * Callbacks without a completion receipt return void and use the supplied entity's old path.
 * A locked controller callback returns its actual previous path only after commit;
 * unlinking therefore cannot destroy the authoritative image on a rolled-back write.
 * A failed write removes the newly uploaded file through this same policy owner. */
export async function performImageSwap<T extends void | ImageSwapReceipt>(
    entity: Pick<EntityBase, 'id' | 'headerImg'>,
    updateFct: (id: string, path?: string | null) => Promise<T>,
    file?: Express.Multer.File,
): Promise<T> {
    // Apply the existing upload-type policy before the persistence callback.
    // The checker owns immediate cleanup when this first admission fails.
    checkNewImage(file);

    let saved: T;
    try {
        saved = await updateFct(entity.id, file ? file.path : null);
    } catch (err) {
        if (file) {
            removeImage(file.path);
        }
        throw err;
    }

    // Callback resolution is the commit boundary for receipt-producing owners.
    // Callbacks returning void retain the original resource's previous reference.
    const previousImage = saved && typeof saved === 'object' ? saved.previousImage : entity.headerImg;
    if (previousImage) {
        removeImage(previousImage);
    }
    return saved;
}

/** Retain image-type admission and its invalid-upload cleanup. Multipart
 * byte/extension limits belong to the uploader; this helper checks the admitted MIME. */
export function checkNewImage(file?: Express.Multer.File) {
    const isValidImg = file ? isImageMimeType(file.mimetype) : false;
    if (!isValidImg && file) {
        // Clean up unexpected uploads immediately to avoid orphan files
        removeImage(file.path);
        throw new APIError('Unsupported image type', {}, 400);
    }
}

/** Best-effort filesystem cleanup after the owning operation selects the path.
 * This intentionally stays fire-and-forget and tolerates an already missing file;
 * an unlink failure must not turn a committed business write into a failed command. */
export function removeImage(path: string) {
    void fs.promises.unlink(path).catch(() => undefined);
}
