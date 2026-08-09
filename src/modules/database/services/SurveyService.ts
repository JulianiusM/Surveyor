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

import type {BasePicked, GroupedResponses, SurveyAnswer, WeekDay, WeekInMonth} from "../../../types/SurveyTypes";
import {generateUniqueId} from '../../lib/util';
import {AppDataSource} from '../dataSource';
import {Survey} from '../entities/surveys/Survey';
import {SurveyCombination} from '../entities/surveys/SurveyCombination';
import {SurveyResponse} from '../entities/surveys/SurveyResponse';

// Surveys

export async function getSurveyById(id: string) {
    return await AppDataSource.getRepository(Survey).findOne({where: {id}});
}

export async function getCombinationsBySurveyId(surveyId: string) {
    return await AppDataSource.getRepository(SurveyCombination).find({
        where: {entity: {id: surveyId}},
        order: {weekday: 'ASC', nthWeek: 'ASC'},
    });
}

export async function createSurveyTx(ownerId: string, title: string, desc: string, combinations: {
    weekday: WeekDay,
    week: WeekInMonth,
}[], headerImg?: string | null,): Promise<string> {
    return await AppDataSource.transaction(async (manager) => {
        const surveyId = generateUniqueId();

        const survey: Survey = manager.create(Survey, {
            id: surveyId,
            owner: {id: ownerId},
            title,
            description: desc,
            headerImg,
        });
        await manager.save(survey);

        const plainCombos = combinations.map(c => ({
            entity: {id: surveyId},
            // Survey combinations inherit the generic item title column; keep it deterministic
            // so form-created surveys persist with the same production entity shape as other item lists.
            title: `${c.week} ${c.weekday}`,
            weekday: c.weekday,
            nthWeek: c.week,
        }));

        const comboEntities = manager.create(SurveyCombination, plainCombos);

        await manager.save(comboEntities);
        return surveyId;
    });
}

export async function addCombination(surveyId: string, weekday: WeekDay, nthWeek: WeekInMonth) {
    const combo = AppDataSource.getRepository(SurveyCombination).create({
        entity: {id: surveyId},
        title: `${nthWeek} ${weekday}`,
        weekday,
        nthWeek,
    });
    await AppDataSource.getRepository(SurveyCombination).save(combo);
    return combo.id;
}

export async function getSurveysByProfileId(profileId: string) {
    return await AppDataSource.getRepository(Survey).find({
        where: {owner: {id: profileId}},
    });
}

export async function getSurveysByParticipant(profileId: string) {
    return await AppDataSource.getRepository(Survey).createQueryBuilder('survey')
        .whereExists(AppDataSource.getRepository(SurveyResponse)
            .createQueryBuilder("resp")
            .where("resp.entity_id = survey.id")
            .andWhere("resp.profile_id = :userId", {userId: profileId})
        ).getMany();
}

export async function deleteSurvey(id: string) {
    await AppDataSource.getRepository(Survey).delete({id});
}

// Responses

export async function saveResponse(surveyId: string, profileId: string, combinationId: number, answer: SurveyAnswer) {
    const response = AppDataSource.getRepository(SurveyResponse).create({
        entity: {id: surveyId},
        profile: {id: profileId},
        item: {id: combinationId},
        answer: answer || 'no',
    });
    await AppDataSource.getRepository(SurveyResponse).save(response);
}

export async function deleteResponsesByProfileId(profileId: string, surveyId: string) {
    await AppDataSource.getRepository(SurveyResponse).delete({
        profile: {id: profileId},
        entity: {id: surveyId},
    });
}

export async function getResponsesByProfileId(profileId: string) {
    return await AppDataSource.getRepository(SurveyResponse).find({
        where: {profile: {id: profileId}},
        order: {item: {id: 'ASC'}},
    });
}

export async function getResponsesSorted(surveyId: string): Promise<GroupedResponses> {
    const repo = AppDataSource.getRepository(SurveyResponse);

    // Load all responses for the survey with both possible assignee relations
    const responses = await repo.find({
        where: {entity: {id: surveyId}},
        relations: {profile: true, item: true},
    });

    const combined: Array<BasePicked> = [];

    for (const r of responses) {
        const item: BasePicked = {
            id: r.id,
            answer: r.answer,
            combinationId: r.item.id,
            profileId: r.profile.id,
            name: r.profile.name,
        };
        combined.push(item);
    }

    // Group into buckets
    return combined.reduce<GroupedResponses>((acc, item) => {
        const key: string = item.profileId;
        acc[key] ??= [];
        acc[key].push(item);
        return acc;
    }, {});
}

export async function updateHeaderImage(surveyId: string, headerImg?: string | null) {
    await AppDataSource.getRepository(Survey).update(surveyId, {headerImg});
}