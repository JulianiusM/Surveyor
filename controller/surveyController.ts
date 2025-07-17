// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'Joi'.
const Joi = require('joi');

// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'db'.
const db = require("../modules/database/db");
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'Validation... Remove this comment to see the full error message
const {ValidationError, ExpectedError} = require("../modules/lib/errors");

// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'CREATE_TEM... Remove this comment to see the full error message
const CREATE_TEMPLATE = 'surveyor/survey-create';

function preprocessCreate(body: any) {
    // 1) normalize combinations into an array of objects
    let combos = body.combinations;
    if (!combos) {
        combos = [];
    } else if (!Array.isArray(combos)) {
        // qs parsing gives an object with numeric keys
        // @ts-expect-error TS(2550): Property 'values' does not exist on type 'ObjectCo... Remove this comment to see the full error message
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

async function createEntity(ownerId: any, p: any) {
    return db.createSurvey(ownerId, p.title, p.description, p.combinations); // gibt surveyId
}

// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'afterCreat... Remove this comment to see the full error message
async function afterCreateItems() {
}

async function fetchForView(survey: any, session: any) {
    const combinations = await db.getCombinationsBySurveyId(survey.id);
    const responses = await db.getResponsesSorted(survey.id);
    return {survey, combinations, responses};
}

async function fetchForDuplicate(survey: any, session: any) {
    return await db.getCombinationsBySurveyId(survey.id);
}

async function deleteEntity(survey: any, session: any) {
    return await db.deleteSurvey(survey.id);
}

// @ts-expect-error TS(2393): Duplicate function implementation.
async function addCombination(survey: any, weekday: any, nth: any) {
    if (!weekday || !nth) throw new ExpectedError('Invalid selection', 'error', {}, 400);
    await db.addCombination(survey.id, weekday, nth);
}

async function submitResponses(survey: any, session: any, answers: any) {
    if (session.user) {
        const uid = session.user.id;
        await db.deleteResponsesByUserId(uid, survey.id);
        // @ts-expect-error TS(2550): Property 'entries' does not exist on type 'ObjectC... Remove this comment to see the full error message
        for (const [combId, ans] of Object.entries(answers)) {
            await db.saveResponseUser(survey.id, uid, combId, ans);
        }
    } else if (session.guest) {
        const gid = session.guest.id;
        await db.deleteResponsesByGuestId(gid, survey.id);
        // @ts-expect-error TS(2550): Property 'entries' does not exist on type 'ObjectC... Remove this comment to see the full error message
        for (const [combId, ans] of Object.entries(answers)) {
            await db.saveResponseGuest(survey.id, gid, combId, ans);
        }
    }
}

// @ts-expect-error TS(2552): Cannot find name 'module'. Did you mean 'modules'?
module.exports = {
    preprocessCreate,
    createEntity,
    afterCreateItems,
    fetchForView,
    fetchForDuplicate,
    deleteEntity,

    addCombination,
    submitResponses,
}