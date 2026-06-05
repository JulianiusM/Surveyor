import type {
    GroupedResponses,
    GroupKey,
    GuestResponseItem,
    SurveyAnswer,
    UserResponseItem,
    WeekDay,
    WeekInMonth
} from "../../../types/SurveyTypes";
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
        where: {survey: {id: surveyId}},
        order: {weekday: 'ASC', nthWeek: 'ASC'},
    });
}

export async function createSurveyTx(userId: number, title: string, desc: string, combinations: {
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

export async function getSurveysByParticipantUserId(userId: number) {
    return await AppDataSource.getRepository(Survey).createQueryBuilder('survey')
        .whereExists(AppDataSource.getRepository(SurveyResponse)
            .createQueryBuilder("resp")
            .where("resp.survey_id = survey.id")
            .andWhere("resp.user_id = :userId", {userId: userId})
        ).getMany();
}

export async function getSurveysByParticipantGuestId(guestId: string) {
    return await AppDataSource.getRepository(Survey).createQueryBuilder('survey')
        .whereExists(AppDataSource.getRepository(SurveyResponse)
            .createQueryBuilder("resp")
            .where("resp.survey_id = survey.id")
            .andWhere("resp.guest_id = :guestId", {guestId: guestId})
        ).getMany();
}

export async function deleteSurvey(id: string) {
    await AppDataSource.getRepository(Survey).delete({id});
}

// Responses

export async function saveResponseGuest(surveyId: string, guestId: string, combinationId: number, answer: SurveyAnswer) {
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

export async function deleteResponsesByGuestId(guestId: string, surveyId: string) {
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

export async function getResponsesByGuestId(guestId: string) {
    return await AppDataSource.getRepository(SurveyResponse).find({
        where: {guest: {id: guestId}},
        order: {combination: {id: 'ASC'}},
    });
}

function isUserResponse(
    r: UserResponseItem | GuestResponseItem
): r is UserResponseItem {
    return (r as UserResponseItem).kind === "user";
}

export async function getResponsesSorted(surveyId: string): Promise<GroupedResponses> {
    const repo = AppDataSource.getRepository(SurveyResponse);

    // Load all responses for the survey with both possible assignee relations
    const responses = await repo.find({
        where: {survey: {id: surveyId}},
        relations: {user: true, guest: true, combination: true},
    });

    const combined: Array<UserResponseItem | GuestResponseItem> = [];

    for (const r of responses) {
        if (r.user) {
            const item: UserResponseItem = {
                kind: "user",
                id: r.id,
                answer: r.answer,
                combinationId: r.combinationId,
                userId: r.user.id,
                username: r.user.username,
                name: r.user.name,
            };
            combined.push(item);
        } else if (r.guest) {
            const item: GuestResponseItem = {
                kind: "guest",
                id: r.id,
                answer: r.answer,
                combinationId: r.combinationId,
                guestId: r.guest.id,
                username: r.guest.username,
            };
            combined.push(item);
        }
        // If a row could have neither, it’s ignored (matches your original inner joins).
    }

    // Group into u_<id> / g_<id> buckets
    return combined.reduce<GroupedResponses>((acc, item) => {
        const key: GroupKey =
            item.kind === "user" ? `u_${item.userId}` : `g_${item.guestId}`;
        (acc[key] ??= []).push(item);
        return acc;
    }, {});
}

