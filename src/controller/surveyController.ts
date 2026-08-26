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

import {Request} from "express";
import Joi from 'joi';
import {Survey} from "../modules/database/entities/surveys/Survey";
import {SurveyCombination} from "../modules/database/entities/surveys/SurveyCombination";

import * as surveyService from "../modules/database/services/SurveyService";
import {ExpectedError, ValidationError} from "../modules/lib/errors";
import {performImageSwap} from "../modules/lib/fileCommons";
import type {SurveyAnswer, WeekDay, WeekInMonth} from "../types/SurveyTypes";
import type {EntityBase} from "../types/UserTypes";

const CREATE_TEMPLATE = 'surveyor/survey-create';

function preprocessCreate(body: any): Partial<Survey> & { combinations: Partial<SurveyCombination>[] } {
    // 1) normalize combinations into an array of objects
    let combos = body.combinations;
    if (!combos) {
        combos = [];
    } else if (!Array.isArray(combos)) {
        // qs parsing gives an object with numeric keys
        combos = Object.values(combos);
    }

    // 2) declare Joi schema
    const schema = Joi.object({
        title: Joi.string().trim().required(),
        description: Joi.string().trim().allow('').required(),
        combinations: Joi.array()
            .items(
                Joi.object({
                    weekday: Joi.string()
                        .valid('MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN')
                        .required(),
                    week: Joi.alternatives()
                        .try(Joi.number().integer().min(1).max(4), Joi.string().valid('LAST'))
                        .required()
                })
            )
            .min(1)
            .required()
    });

    // 3) validate & throw on error
    const {error, value} = schema.validate(
        {
            title: body.title?.trim(),
            description: body.description?.trim(),
            combinations: combos
        },
        {abortEarly: false, allowUnknown: false}
    );

    if (error) {
        // Combine all messages into one
        const msg = error.details.map((d: any) => d.message).join(', ');
        // Throw a ValidationError to be caught by your centralized error handler
        throw new ValidationError(CREATE_TEMPLATE, msg, {body});
    }

    // 3) Normalize to entity types:
    //    week (number | 'LAST') -> nthWeek: WeekInMonth ('1' | '2' | '3' | '4' | 'LAST')
    const normalized: Partial<SurveyCombination>[] = value.combinations.map(
        (c: { weekday: WeekDay; week: number | 'LAST' }) => ({
            weekday: c.weekday,
            nthWeek: (typeof c.week === 'number' ? String(c.week) : c.week) as WeekInMonth,
        })
    );

    return {
        title: value.title,
        description: value.description || null,
        combinations: normalized,
    };
}

async function createEntity(
    ownerId: string,
    p: Partial<Survey> & { combinations: Partial<SurveyCombination>[] },
) {
    return surveyService.createSurveyTx(
        ownerId,
        p.title!,
        p.description!,
        p.combinations.map((it) => ({
            weekday: it.weekday!,
            week: it.nthWeek!,
        })),
        p.headerImg,
    );
}


async function afterCreateItems() {
    // Nothing to do here.
}

async function fetchForView(survey: Survey, req: Request) {
    const combinations = await surveyService.getCombinationsBySurveyId(survey.id);
    const responses = await surveyService.getResponsesSorted(survey.id);
    return {survey, combinations, responses};
}

async function fetchForDuplicate(survey: Survey, session: Request['session']) {
    return await surveyService.getCombinationsBySurveyId(survey.id);
}

async function deleteEntity(survey: Survey, session: Request['session']) {
    return await surveyService.deleteSurvey(survey.id);
}

async function addCombination(survey: Survey, weekday: WeekDay, nth: WeekInMonth) {
    if (!weekday || !nth) throw new ExpectedError('Invalid selection', 'error', 400);
    await surveyService.addCombination(survey.id, weekday, nth);
}

async function submitResponses(survey: Survey, session: Request['session'], body: any) {
    const answers: { [p: string]: SurveyAnswer } = body;
    if (session.profile) {
        const gid = session.profile.id;
        const combinations = await surveyService.getCombinationsBySurveyId(survey.id);
        const allowedCombinationIds = new Set(combinations.map((combination) => combination.id));
        const invalidEntry = Object.entries(answers).find(([combId, answer]) => {
            const parsedId = Number(combId);
            return !Number.isInteger(parsedId)
                || !allowedCombinationIds.has(parsedId)
                || !['yes', 'maybe', 'no', ''].includes(answer ?? '');
        });
        if (invalidEntry) {
            throw new ExpectedError('Invalid survey response', 'error', 400);
        }
        await surveyService.deleteResponsesByProfileId(gid, survey.id);
        for (const [combId, ans] of Object.entries(answers)) {
            await surveyService.saveResponse(survey.id, gid, Number(combId), ans);
        }
    }
}

async function updateHeaderImg(entity: EntityBase, file?: Express.Multer.File) {
    await performImageSwap(entity, surveyService.updateHeaderImage, file);
    return 'Image updated';
}

async function deleteHeaderImg(entity: EntityBase) {
    await performImageSwap(entity, surveyService.updateHeaderImage);
    return 'Image deleted';
}

export default {
    preprocessCreate,
    createEntity,
    afterCreateItems,
    fetchForView,
    fetchForDuplicate,
    deleteEntity,

    addCombination,
    submitResponses,

    updateHeaderImg,
    deleteHeaderImg,
}
