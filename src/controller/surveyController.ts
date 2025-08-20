import Joi from 'joi';

import * as surveyService from "../modules/database/services/SurveyService";
import {ExpectedError, ValidationError} from "../modules/lib/errors";
import {Survey} from "../modules/database/entities/surveys/Survey";
import {SurveyAnswer} from "../types/SurveyTypes";

const CREATE_TEMPLATE = 'surveyor/survey-create';

function preprocessCreate(body: any) {
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
                        .valid('MO', 'DI', 'MI', 'DO', 'FR', 'SA', 'SO')
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

    // On success, return the sanitized values
    return {
        title: value.title,
        description: value.description || null,
        combinations: value.combinations
    };
}

async function createEntity(ownerId: number, p: any) {
    return surveyService.createSurvey(ownerId, p.title, p.description, p.combinations); // gibt surveyId
}


async function afterCreateItems() {
}

async function fetchForView(survey: Survey, session: any) {
    const combinations = await surveyService.getCombinationsBySurveyId(survey.id);
    const responses = await surveyService.getResponsesSorted(survey.id);
    return {survey, combinations, responses};
}

async function fetchForDuplicate(survey: any, session: any) {
    return await surveyService.getCombinationsBySurveyId(survey.id);
}

async function deleteEntity(survey: any, session: any) {
    return await surveyService.deleteSurvey(survey.id);
}

async function addCombination(survey: any, weekday: any, nth: any) {
    if (!weekday || !nth) throw new ExpectedError('Invalid selection', 'error', 400);
    await surveyService.addCombination(survey.id, weekday, nth);
}

async function submitResponses(survey: Survey, session: any, body: any) {
    const answers: { [p: string]: SurveyAnswer } = body;
    if (session.user) {
        const uid = session.user.id;
        await surveyService.deleteResponsesByUserId(uid, survey.id);
        for (const [combId, ans] of Object.entries(answers)) {
            await surveyService.saveResponseUser(survey.id, uid, Number(combId), ans);
        }
    } else if (session.guest) {
        const gid = session.guest.id;
        await surveyService.deleteResponsesByGuestId(gid, survey.id);
        for (const [combId, ans] of Object.entries(answers)) {
            await surveyService.saveResponseGuest(survey.id, gid, Number(combId), ans);
        }
    }
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
}