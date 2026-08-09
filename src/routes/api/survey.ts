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