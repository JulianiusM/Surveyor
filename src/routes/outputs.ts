import type {RequestHandler} from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import {captureApiActor} from '../modules/api/session';
import {asyncHandler} from '../modules/lib/asyncHandler';
import {APIError} from '../modules/lib/errors';
import type {SessionLike} from '../types/PermissionTypes';
import settings from '../modules/settings';

/** Serve a domain-authorized header file with its stored MIME and private cache
 * policy. The calling domain supplies its controller read; this adapter owns
 * only application-relative file confinement and HTTP delivery. */
export function createHeaderHandler(read: (id: string, session: SessionLike) => Promise<string>): RequestHandler {
    return asyncHandler(async function downloadHeader(req, res) {
        const actor = await captureApiActor(req);
        const storedPath = await read(String(req.params.headerId), actor);
        // Resolve only beneath the configured header root before touching the file.
        const root = path.resolve(process.cwd(), settings.value.headerImgDir);
        const file = path.resolve(process.cwd(), storedPath);
        const relative = path.relative(root, file);
        if (relative.startsWith('..') || path.isAbsolute(relative)) throw new APIError('No image available', {}, 400);
        try { await fs.access(file, fs.constants.R_OK); }
        catch { throw new APIError('No image available', {}, 404); }
        res.set('Cache-Control', 'private, no-store').sendFile(file);
    });
}
