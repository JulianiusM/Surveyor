import express, {Request} from "express";
import controller from "../../controller/surveyController";
import {createEntityHeaderUpdateRouter} from "../../middleware/entityHeaderUpdateHandler";
import {apiParamHandler} from "../../middleware/paramHandler";
import * as surveyService from "../../modules/database/services/SurveyService";
import {ENTITIES, getPermFct, getResource} from "../../modules/lib/util";
import type {EntityType} from "../../types/UtilTypes";

const app = express.Router();

const entityName: EntityType = ENTITIES.SURVEY;
const resFct = (req: Request) => getResource(req, entityName);
const permFct = getPermFct(resFct, entityName);

apiParamHandler('id', app, surveyService.getSurveyById, entityName);

createEntityHeaderUpdateRouter(app, permFct, resFct, controller.updateHeaderImg, controller.deleteHeaderImg);

export default app;