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

import express, {Request, Response} from 'express';
import * as helpController from '../controller/helpController';
import {ExpectedError} from '../modules/lib/errors';
import {asyncHandler} from '../modules/lib/asyncHandler';

const router = express.Router();

// GET /help - task-oriented help home
router.get('/', asyncHandler(async (_req: Request, res: Response) => {
    res.render('help', helpController.fetchHelpIndex());
}));

// GET /help/search?q=... - search the fixed, release-shipped user guides
router.get('/search', asyncHandler(async (req: Request, res: Response) => {
    const query = typeof req.query.q === 'string' ? req.query.q : '';
    res.render('help', helpController.fetchHelpSearch(query));
}));

// GET /help/assets/:assetName - serve maintained visual aids from the fixed help source
router.get('/assets/:assetName', asyncHandler(async (req: Request, res: Response) => {
    const assetName = req.params.assetName as string;
    const assetPath = helpController.resolveHelpAssetPath(assetName);
    if (!assetPath) {
        throw new ExpectedError('Help asset not found', 'error', 404);
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(assetPath);
}));

// GET /help/:docName - specific maintained help document
router.get('/:docName', asyncHandler(async (req: Request, res: Response) => {
    const docName = req.params.docName as string;
    res.render('help', helpController.fetchHelpDoc(docName));
}));

export default router;
