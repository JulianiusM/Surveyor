import express, {Request, Response} from 'express';
import * as surveyService from "../modules/database/services/SurveyService";
import {asyncHandler} from "../modules/lib/asyncHandler";
import {createGuestFlowRouter} from "../middleware/guestFlowFactory";
import controller from "../controller/surveyController";
import {ENTITIES, ENTITY_ITEMS, getResource} from "../modules/lib/util";
import {EntityType} from "../types/UtilTypes";

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

            // @ts-expect-error TS(2571): Object is of type 'unknown'.
            req.flash('error', err.message);
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
        (req: Request) => controller.addCombination(resFct(req), req.body.weekday, req.body.nth),
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