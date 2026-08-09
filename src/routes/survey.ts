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
import controller from "../controller/surveyController";
import {createGuestFlowRouter} from "../middleware/guestFlowFactory";
import * as surveyService from "../modules/database/services/SurveyService";
import {asyncHandler} from "../modules/lib/asyncHandler";
import {ENTITIES, ENTITY_ITEMS, getResource} from "../modules/lib/util";
import type {EntityType} from "../types/UtilTypes";

const app = express.Router();

const entityName: EntityType = ENTITIES.SURVEY;

const resFct = (req: Request) => getResource(req, entityName);

// Helper to DRY up flash + redirect logic
function handleAction(actionFn: (req: Request) => Promise<void>, successMsg: string) {
    return asyncHandler(async (req: Request, res: Response) => {
        const surveyId = resFct(req).id;
        try {
            // Execute the provided controller action
            await actionFn(req);
            req.flash('success', successMsg);
        } catch (err) {
            const message = err instanceof Error ? err.message : 'An unexpected error occurred.';
            req.flash('error', message);
        }
        res.redirect(`/survey/${surveyId}`);
    });
}

app.use('/', createGuestFlowRouter({
    addToEvent: true,
    entityType: entityName,
    entityItemType: ENTITY_ITEMS.SURVEY,
    db: {
        getById: surveyService.getSurveyById,
        getItems: surveyService.getCombinationsBySurveyId,
    },
    templates: {
        create: 'surveyor/survey-create',
        view: 'surveyor/survey-vote',
    },
    buildRedirect: (id: any) => `/survey/${id}`,
    preprocessCreate: controller.preprocessCreate,
    createEntity: controller.createEntity,
    afterCreateItems: controller.afterCreateItems,
    fetchForView: controller.fetchForView,
    fetchForDuplicate: controller.fetchForDuplicate,
    deleteEntity: controller.deleteEntity,
}));

/**
 * POST /survey/:id/add-combination
 * Add a weekday/nth combination to the survey
 */
app.post(
    '/:id/add-combination',
    handleAction(
        (req: Request) => controller.addCombination(resFct(req), req.body.weekday, req.body.nthWeek),
        'Combination successfully added'
    )
);

/**
 * POST /survey/:id/submit
 * Submit or update responses for the survey
 */
app.post(
    '/:id/submit',
    handleAction(
        (req: Request) => controller.submitResponses(resFct(req), req.session, req.body),
        'Answers updated'
    )
);

export default app;