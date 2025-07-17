// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'express'.
const express = require('express');
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'app'.
const app = express.Router();

// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'db'.
const db = require("../modules/database/db");
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'asyncHandl... Remove this comment to see the full error message
const {asyncHandler} = require("../modules/lib/asyncHandler");

// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'createGues... Remove this comment to see the full error message
const {createGuestFlowRouter} = require("../middleware/guestFlowFactory");

// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'controller... Remove this comment to see the full error message
const controller = require("../controller/surveyController");
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'getResourc... Remove this comment to see the full error message
const {getResource} = require("../modules/lib/util");

// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'entityName... Remove this comment to see the full error message
const entityName = 'survey';
// @ts-expect-error TS(2588): Cannot assign to 'resFct' because it is a constant... Remove this comment to see the full error message
resFct = (req: any) => getResource(req, entityName);

// Helper to DRY up flash + redirect logic
function handleAction(actionFn: any, successMsg: any) {
    return asyncHandler(async (req: any, res: any) => {
        const surveyId = resFct(req).id;
        try {
            // Execute the provided controller action
            await actionFn(req);
            req.flash('success', successMsg);
        } catch (err) {
            // @ts-expect-error TS(2571): Object is of type 'unknown'.
            req.flash('error', err.message);
        }
        res.redirect(`/survey/${surveyId}`);
    });
}

app.use('/', createGuestFlowRouter({
    entityType: entityName,
    db: {
        getById: db.getSurveyById,
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
        (req: any) => controller.addCombination(resFct(req), req.body.weekday, req.body.nth),
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
        (req: any) => controller.submitResponses(resFct(req), req.session, req.body),
        'Answers updated'
    )
);

// @ts-expect-error TS(2580): Cannot find name 'module'. Do you need to install ... Remove this comment to see the full error message
module.exports = app;