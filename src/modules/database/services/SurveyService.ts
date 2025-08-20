import {AppDataSource} from '../dataSource';
import {generateUniqueId} from '../../lib/util';
import {Survey} from '../entities/surveys/Survey';
import {SurveyCombination} from '../entities/surveys/SurveyCombination';
import {SurveyResponse} from '../entities/surveys/SurveyResponse';
import {GuestLink} from '../entities/user/GuestLink';
import {SurveyAnswer, WeekDay, WeekInMonth} from "../../../types/SurveyTypes";

// Surveys

export async function getSurveyById(id: string) {
    return await AppDataSource.getRepository(Survey).findOne({where: {id}});
}

export async function getCombinationsBySurveyId(surveyId: string) {
    return await AppDataSource.getRepository(SurveyCombination).find({
        where: {survey: {id: surveyId}},
        order: {weekday: 'ASC', nthWeek: 'ASC'},
    });
}

export async function createSurvey(userId: number, title: string, desc: string, combinations: {
    weekday: WeekDay,
    week: WeekInMonth,
}[]): Promise<string> {
    return await AppDataSource.transaction(async (manager) => {
        const surveyId = generateUniqueId();

        const survey: Survey = manager.create(Survey, {
            id: surveyId,
            owner: {id: userId},
            title,
            description: desc,
        });
        await manager.save(survey);

        const plainCombos = combinations.map(c => ({
            survey: {id: surveyId},
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
        survey: {id: surveyId},
        weekday,
        nthWeek,
    });
    await AppDataSource.getRepository(SurveyCombination).save(combo);
    return combo.id;
}

export async function getSurveysByUserId(userId: number) {
    return await AppDataSource.getRepository(Survey).find({
        where: {owner: {id: userId}},
    });
}

export async function deleteSurvey(id: string) {
    await AppDataSource.getRepository(Survey).delete({id});
}

// Responses

export async function saveResponseGuest(surveyId: string, guestId: number, combinationId: number, answer: SurveyAnswer) {
    const response = AppDataSource.getRepository(SurveyResponse).create({
        survey: {id: surveyId},
        guest: {id: guestId},
        combination: {id: combinationId},
        answer: answer || 'no',
    });
    await AppDataSource.getRepository(SurveyResponse).save(response);
}

export async function saveResponseUser(surveyId: string, userId: number, combinationId: number, answer: SurveyAnswer) {
    const response = AppDataSource.getRepository(SurveyResponse).create({
        survey: {id: surveyId},
        user: {id: userId},
        combination: {id: combinationId},
        answer: answer || 'no',
    });
    await AppDataSource.getRepository(SurveyResponse).save(response);
}

export async function deleteResponsesByGuestId(guestId: number, surveyId: string) {
    await AppDataSource.getRepository(SurveyResponse).delete({
        guest: {id: guestId},
        survey: {id: surveyId},
    });
}

export async function deleteResponsesByUserId(userId: number, surveyId: string) {
    await AppDataSource.getRepository(SurveyResponse).delete({
        user: {id: userId},
        survey: {id: surveyId},
    });
}

export async function getResponsesByGuestId(guestId: number) {
    return await AppDataSource.getRepository(SurveyResponse).find({
        where: {guest: {id: guestId}},
        order: {combination: {id: 'ASC'}},
    });
}

export async function getSurveyByGuestId(guestId: number) {
    const link = await AppDataSource.getRepository(GuestLink).findOne({
        where: {
            guest: {id: guestId},
            entityType: 'survey',
        },
        relations: ['guest'],
    });

    if (!link) return null;

    return await AppDataSource.getRepository(Survey).findOne({
        where: {id: link.entityId},
    });
}

export async function getResponsesSorted(surveyId: string) {
    const guestResponses = await AppDataSource.getRepository(SurveyResponse)
        .createQueryBuilder('r')
        .innerJoinAndSelect('r.guest', 'g')
        .where('r.survey_id = :surveyId', {surveyId})
        .select([
            'r',
            'g.username',
        ])
        .getRawMany();

    const userResponses = await AppDataSource.getRepository(SurveyResponse)
        .createQueryBuilder('r')
        .innerJoinAndSelect('r.user', 'u')
        .where('r.survey_id = :surveyId', {surveyId})
        .select([
            'r',
            'u.username',
        ])
        .getRawMany();

    const combined = [...guestResponses, ...userResponses];

    return Object.groupBy(combined, (res: any) => {
        if (res.r_user_id) {
            return 'u_' + res.r_user_id;
        } else if (res.r_guest_id) {
            return 'g_' + res.r_guest_id;
        }
        return '';
    });
}
