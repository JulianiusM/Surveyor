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
import {EntityBase} from "../../types/UserTypes";
import type {ImageSwapReceipt} from '../../types/UtilTypes';
import {APIError} from "./errors";

export function prepareFileUploader(dir: string, allowImg: boolean = true, allowPdf: boolean = false) {
// Storage setup
    const proofDir = path.join(process.cwd(), dir);
    const proofStorage = multer.diskStorage({
        destination: (_req, _file, cb) => {
            fs.mkdirSync(proofDir, {recursive: true});
            cb(null, proofDir);
        },
        filename: (_req, file, cb) => {
            const allowedExts: string[] = [];
            if (allowImg) {
                allowedExts.push('.jpg', '.jpeg', '.png', '.gif');
            }
            if (allowPdf) {
                allowedExts.push(".pdf");
            }
            const ext = path.extname(file.originalname).toLowerCase();
            if (!allowedExts.includes(ext)) {
                return cb(new Error('Invalid file extension'), '');
            }
            cb(null, `${Date.now()}-${uuidv4()}${ext}`);
        },
    });

    const proofUpload = multer({
        storage: proofStorage,
        limits: {fileSize: 10 * 1024 * 1024},
        fileFilter: (_req, file, cb) => {
            const mimetypes: string[] = [];
            if (allowImg) {
                mimetypes.push("image/jpeg", "image/png", "image/gif");
            }
            if (allowPdf) {
                mimetypes.push("application/pdf");
            }

            const ok = mimetypes.includes(file.mimetype);
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
 * Existing native callbacks return void and use the supplied entity's old path.
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
    // Void native callbacks retain the original resource's previous reference.
    const previousImage = saved && typeof saved === 'object' ? saved.previousImage : entity.headerImg;
    if (previousImage) {
        removeImage(previousImage);
    }
    return saved;
}

/** Retain native image-type admission and its invalid-upload cleanup. Multipart
 * byte/extension limits belong to the uploader; this helper checks the admitted MIME. */
export function checkNewImage(file?: Express.Multer.File) {
    const mimetypes = ["image/jpeg", "image/png", "image/gif"];
    const isValidImg = file ? mimetypes.includes(file.mimetype) : false;
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
