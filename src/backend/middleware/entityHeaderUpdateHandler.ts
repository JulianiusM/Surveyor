/*
 * Copyright 2026 Julian Malovanij
 * Licensed under the Apache License, Version 2.0.
 */

import type {Request, Response, Router} from 'express';
import type {PreparedApiJsonResponse} from '../../types/ApiTransportTypes';
import type {EntityHeaderCommand, EntityHeaderCommandInput, EntityHeaderDeleteOperation,
    EntityHeaderUpdateConfig, EntityHeaderUploadOperation} from '../../types/EntityHeaderTypes';
import {ApiProblem} from '../modules/api/problem';
import {requireApiContext} from '../modules/api/session';
import {decodeApiMultipartImage, prepareValidatedJson, receiveApiUpload, sendPreparedJson,
    sendValidatedJson, validateOperationRequest} from '../modules/api/transport';
import {asyncHandler} from '../modules/lib/asyncHandler';
import {prepareFileUploader, removeImage} from '../modules/lib/fileCommons';
import settings from '../modules/settings';

/** Execute an existing feature image operation with its original receipt timing.
 * Upload ownership transfers on controller success, before response delivery;
 * this helper performs no new authorization, read, write or session operation. */
async function executeHeaderCommand(req: Request, res: Response,
    operation: EntityHeaderUploadOperation | EntityHeaderDeleteOperation,
    input: EntityHeaderCommandInput, command: EntityHeaderCommand, committed?: () => void): Promise<void> {
    // Packing and Event retain their actual-result validation after the original
    // operation completes. A serialization failure must not discard saved bytes.
    if (command.receipt === 'after-write') {
        const result = await command.execute(input);
        committed?.();
        sendValidatedJson(req, res, operation, 200, result);
        return;
    }

    let prepared: PreparedApiJsonResponse;
    if (command.receipt === 'before-write') {
        // Activity's existing adapter prepares its invariant acknowledgement
        // before its unchanged operation; it does not invent a new transaction.
        prepared = prepareValidatedJson(req, operation, 200, {changed: true});
        await command.execute(input);
    } else {
        // Drivers and Survey retain the controller-selected preparation point:
        // under the transaction or before the existing image swap, respectively.
        await command.execute(input, function prepareHeaderResult(result) {
            prepared = prepareValidatedJson(req, operation, 200, result);
        });
    }

    // Delivery only consumes the prepared bytes. Preserve the existing controller
    // contract that its preparation callback runs before successful completion.
    committed?.();
    sendPreparedJson(req, res, prepared!);
}

/** Register the common PUT/DELETE header routes for a feature's existing router.
 * Context and upload preflight precede disk writes; generated decoding/validation
 * precedes the feature controller. Only an uncommitted request upload is removed
 * here; the established image-swap owner retains old-file cleanup and persistence. */
export function createEntityHeaderUpdateRouter(router: Router, config: EntityHeaderUpdateConfig): void {
    const route = `/:${config.parameter}/header`;
    const upload = prepareFileUploader(settings.value.headerImgDir).single('image');

    /** Receive one admitted image and release request-owned bytes on rejection. */
    async function uploadEntityHeader(req: Request, res: Response): Promise<void> {
        const actor = await requireApiContext(req, res, config.requireProfile);
        const id = String(req.params[config.parameter]);
        // The feature preflight rejects forbidden callers before accepting bytes;
        // its command still performs its existing current-authority checks.
        await config.admitUpload(id, actor);
        let committed = false;
        try {
            await receiveApiUpload(req, res, upload);
            validateOperationRequest(req, config.uploadOperation, body => decodeApiMultipartImage(body, req.file));
            if (!req.file) throw new ApiProblem('UPLOAD_INVALID');

            await executeHeaderCommand(req, res, config.uploadOperation,
                {id, actor, file: req.file, ifMatch: req.get('If-Match')}, config.command,
                function retainCommittedUpload() { committed = true; });
        } finally {
            // A confirmed write retains its image even when delivery later fails.
            // Rejected parsing, validation or business operations release only
            // this request's upload, never the previously stored image reference.
            if (!committed && req.file) removeImage(req.file.path);
        }
    }

    /** Remove a header through its existing operation without accepting bytes. */
    async function deleteEntityHeader(req: Request, res: Response): Promise<void> {
        const actor = await requireApiContext(req, res, config.requireProfile);
        // Removal has no upload preflight; retain its original validation and
        // controller authority rather than adding an extra read or grant check.
        validateOperationRequest(req, config.deleteOperation);
        await executeHeaderCommand(req, res, config.deleteOperation,
            {id: String(req.params[config.parameter]), actor, file: undefined, ifMatch: req.get('If-Match')},
            config.command);
    }

    router.put(route, asyncHandler(uploadEntityHeader));
    router.delete(route, asyncHandler(deleteEntityHeader));
}
