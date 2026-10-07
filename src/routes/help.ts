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
import {createTranslator, resolveLocale} from '../modules/localization/translator';
import {requestLocale} from '../modules/api/problem';
import type {HelpPageData} from '../types/HelpTypes';

const router = express.Router();

/** Native links and forms negotiate the same content/message locale as the API and Vue renderer. */
function renderHelp(req: Request, res: Response, page: (locale: string) => HelpPageData): void {
    const locale = resolveLocale(typeof req.query.locale === 'string' ? req.query.locale : requestLocale(req));
    res.set('Content-Language', locale);
    res.render('help', {...page(locale), data: {helpText: createTranslator(locale).t, helpLocale: locale}});
}

// GET /help - task-oriented help home
router.get('/', asyncHandler(async (req: Request, res: Response) => {
    renderHelp(req, res, helpController.fetchHelpIndex);
}));

// GET /help/search?q=... - search the fixed, release-shipped user guides
router.get('/search', asyncHandler(async (req: Request, res: Response) => {
    const query = typeof req.query.q === 'string' ? req.query.q : '';
    renderHelp(req, res, locale => helpController.fetchHelpSearch(query, locale));
}));

// GET /help/assets/:assetName - serve maintained visual aids from the fixed help source
router.get('/assets/:assetName', asyncHandler(async (req: Request, res: Response) => {
    const assetName = req.params.assetName as string;
    // Figure URLs carry their article's locale explicitly, including full-size links.
    // A missing translation is a missing asset; never borrow a different corpus's image.
    const locale = resolveLocale(typeof req.query.locale === 'string' ? req.query.locale : requestLocale(req));
    const assetPath = helpController.resolveHelpAssetPath(assetName, locale);
    if (!assetPath) {
        throw new ExpectedError(createTranslator(locale).t('help.notFound'), 'error', 404);
    }
    res.set('Content-Language', locale);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(assetPath);
}));

// GET /help/:docName - specific maintained help document
router.get('/:docName', asyncHandler(async (req: Request, res: Response) => {
    const docName = req.params.docName as string;
    renderHelp(req, res, locale => helpController.fetchHelpDoc(docName, locale));
}));

export default router;
