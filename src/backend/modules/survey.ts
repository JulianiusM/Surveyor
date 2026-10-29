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

import type {Survey} from './database/entities/surveys/Survey';
import type {SessionLike} from '../../types/PermissionTypes';
import type {SurveyAnswer, WeekDay, WeekInMonth} from '../../types/SurveyTypes';
import * as surveyService from './database/services/SurveyService';
import {ExpectedError} from './lib/errors';

/** Add one admitted recurring choice through its existing unique persistence constraint. */
export async function addCombination(survey: Survey, weekday: WeekDay, nth: WeekInMonth) {
    if (!weekday || !nth) throw new ExpectedError('Invalid selection', 'error', 400);
    await surveyService.addCombination(survey.id, weekday, nth);
}

/** Replace only the admitted profile's ballot through the existing delete/save
 * sequence. Validation precedes deletion; this operation deliberately retains its
 * established non-atomic persistence rather than promise concurrent replacement. */
export async function submitResponses(survey: Survey, session: SessionLike, body: any) {
    const answers: { [p: string]: SurveyAnswer } = body;
    if (session.profile) {
        const gid = session.profile.id;
        // Validate every submitted choice against this survey before deleting any
        // prior answers. An omitted choice is absent from the replacement ballot.
        const combinations = await surveyService.getCombinationsBySurveyId(survey.id);
        const allowedCombinationIds = new Set(combinations.map((combination) => combination.id));
        const hasInvalidEntry = Object.entries(answers).some(([combId, answer]) => {
            const parsedId = Number(combId);
            return !Number.isInteger(parsedId)
                || !allowedCombinationIds.has(parsedId)
                || !['yes', 'maybe', 'no', ''].includes(answer ?? '');
        });
        if (hasInvalidEntry) {
            throw new ExpectedError('Invalid survey response', 'error', 400, {}, {cause: 'SURVEY_RESPONSE_INVALID'});
        }
        // Keep the persistence order and its independently saved rows.
        await surveyService.deleteResponsesByProfileId(gid, survey.id);
        for (const [combId, ans] of Object.entries(answers)) {
            await surveyService.saveResponse(survey.id, gid, Number(combId), ans);
        }
    }
}
