import express from 'express';
import * as surveyService from "../modules/database/services/SurveyService";
import {asyncHandler} from "../modules/lib/asyncHandler";
import {createGuestFlowRouter} from "../middleware/guestFlowFactory";
import controller from "../controller/surveyController";
import {getResource} from "../modules/lib/util";

const app = express.Router();

const entityName = 'survey';

const resFct = (req: any) => getResource(req, entityName);

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
        getById: surveyService.getSurveyById,
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

export default app;