/**
 * Tests for surveysService using the mysql (MariaDB/mysql2) DataSource mock.
 * Adjusted for enum string types in SurveyCombination.weekday and .nthWeek.
 */

jest.mock('../../src/modules/database/dataSource', () =>
    require('../util/db/mariadb-datasource.mock')
);

import {
    addCombination,
    createSurveyTx,
    deleteResponsesByGuestId,
    deleteResponsesByUserId,
    deleteSurvey,
    getCombinationsBySurveyId,
    getResponsesByGuestId,
    getResponsesSorted,
    getSurveyByGuestId,
    getSurveyById,
    getSurveysByUserId,
    saveResponseGuest,
    saveResponseUser,
} from '../../src/modules/database/services/SurveyService';

import {AppDataSource, initDataSource} from '../../src/modules/database/dataSource';

// Entities for setup/cleanup
import {Survey} from '../../src/modules/database/entities/surveys/Survey';
import {SurveyCombination} from '../../src/modules/database/entities/surveys/SurveyCombination';
import {SurveyResponse} from '../../src/modules/database/entities/surveys/SurveyResponse';
import {GuestLink} from '../../src/modules/database/entities/user/GuestLink';
import {User} from '../../src/modules/database/entities/user/User';
import {Guest} from '../../src/modules/database/entities/user/Guest';

// Helper to clear relevant tables between tests (order matters due to FKs)
async function truncateAll() {
    await AppDataSource.query('SET FOREIGN_KEY_CHECKS=0');

    await AppDataSource.createQueryBuilder().delete().from(SurveyResponse).execute();
    await AppDataSource.createQueryBuilder().delete().from(SurveyCombination).execute();
    await AppDataSource.createQueryBuilder().delete().from(Survey).execute();
    await AppDataSource.createQueryBuilder().delete().from(GuestLink).execute();
    await AppDataSource.createQueryBuilder().delete().from(User).execute();
    await AppDataSource.createQueryBuilder().delete().from(Guest).execute();

    await AppDataSource.query('SET FOREIGN_KEY_CHECKS=1');
}

beforeAll(async () => {
    await initDataSource();
    if ('synchronize' in AppDataSource) {
        await (AppDataSource as any).synchronize(true);
    }
}, 60_000);

afterAll(async () => {
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
});

beforeEach(async () => {
    // Default owner for surveys
    const owner = AppDataSource.getRepository(User).create({
        id: 1,
        username: 'owner',
        name: 'Owner One',
        email: 'owner@example.com',
    });
    await AppDataSource.getRepository(User).save(owner);
});

afterEach(async () => {
    await truncateAll();
}, 60_000);

describe('surveysService (mysql) with enum combinations', () => {
    it('creates a survey tx, returns combinations ordered (weekday ASC, nthWeek ASC), supports add & delete', async () => {
        // Create with 3 enum combos that will sort deterministically by string ASC:
        // Expect order: MON/1, MON/3, WED/2 (since 'MON' < 'WED' alphabetically, and '1' < '3')
        const surveyId = await createSurveyTx(1, 'Team Lunch', 'Pick a weekday', [
            {weekday: 'WED' as any, week: '2' as any},
            {weekday: 'MON' as any, week: '3' as any},
            {weekday: 'MON' as any, week: '1' as any},
        ]);

        const survey = await getSurveyById(surveyId);
        expect(survey).toBeTruthy();
        expect(survey!.id).toBe(surveyId);
        expect(survey!.title).toBe('Team Lunch');
        expect(survey!.description).toBe('Pick a weekday');

        const combos = await getCombinationsBySurveyId(surveyId);
        expect(combos).toHaveLength(3);
        expect(combos.map(c => [c.weekday, c.nthWeek])).toEqual([
            ['MON', '1'],
            ['MON', '3'],
            ['WED', '2'],
        ]);

        // Add another combination (ensure it's present and ordering by strings works)
        const newComboId = await addCombination(surveyId, 'TUE' as any, '4' as any);
        expect(typeof newComboId).toBe('number');

        const combosAfter = await getCombinationsBySurveyId(surveyId);
        expect(combosAfter).toHaveLength(4);
        expect(combosAfter.some(c => c.weekday === 'TUE' && c.nthWeek === '4')).toBe(true);

        // By user
        const byUser = await getSurveysByUserId(1);
        expect(byUser.map(s => s.id)).toContain(surveyId);

        // Delete survey (should cascade delete combinations)
        await deleteSurvey(surveyId);
        const deletedSurvey = await getSurveyById(surveyId);
        expect(deletedSurvey).toBeNull();

        const combosAfterDelete = await getCombinationsBySurveyId(surveyId);
        expect(combosAfterDelete).toHaveLength(0);
    });

    it('handles responses (user/guest), grouping/sorting, and survey lookup via guest link', async () => {
        // Principals
        const u2 = AppDataSource.getRepository(User).create({
            id: 2,
            username: 'u2',
            name: 'User Two',
            email: 'u2@example.com',
        });
        await AppDataSource.getRepository(User).save(u2);

        const g10 = AppDataSource.getRepository(Guest).create({
            id: 10,
            username: 'guest10',
        });
        await AppDataSource.getRepository(Guest).save(g10);

        // Survey + combinations
        const surveyId = await createSurveyTx(1, 'Retro', 'When can you join?', [
            {weekday: 'TUE' as any, week: '1' as any},
            {weekday: 'THU' as any, week: '2' as any},
            {weekday: 'THU' as any, week: '3' as any},
        ]);
        const combos = await getCombinationsBySurveyId(surveyId);
        const [c1, c2] = combos; // first two for responses

        // Save responses (undefined answer defaults to 'no')
        await saveResponseUser(surveyId, 2, c1.id, 'yes');
        await saveResponseUser(surveyId, 2, c2.id, undefined as any);

        await saveResponseGuest(surveyId, 10, c1.id, 'maybe');
        await saveResponseGuest(surveyId, 10, c2.id, 'yes');

        // Guest rows ordered by combination.id ASC
        const guestRows = await getResponsesByGuestId(10);
        expect(guestRows).toHaveLength(2);
        const combIds = guestRows.map(r => r.combinationId);
        expect([...combIds].sort((a, b) => Number(a) - Number(b))).toEqual(combIds);

        // Grouped across user/guest
        const grouped = await getResponsesSorted(surveyId);
        expect(Object.keys(grouped).sort()).toEqual(['g_10', 'u_2']);
        expect(grouped['u_2']).toHaveLength(2);
        expect(grouped['g_10']).toHaveLength(2);

        const userAnswers = grouped['u_2'].map(i => i.answer).sort();
        expect(userAnswers).toEqual(['no', 'yes']); // defaulted + explicit

        const guestAnswers = grouped['g_10'].map(i => i.answer).sort();
        expect(guestAnswers).toEqual(['maybe', 'yes']);

        // Guest link -> survey
        await AppDataSource.getRepository(GuestLink).save({
            guest: {id: 10},
            entityType: 'survey',
            entityId: surveyId,
            token: 'irrelevant'
        });
        const linkedSurvey = await getSurveyByGuestId(10);
        expect(linkedSurvey).toBeTruthy();
        expect(linkedSurvey!.id).toBe(surveyId);

        // Delete user responses → only guest remains
        await deleteResponsesByUserId(2, surveyId);
        const afterUserDelete = await getResponsesSorted(surveyId);
        expect(afterUserDelete['u_2'] ?? []).toHaveLength(0);
        expect(afterUserDelete['g_10']).toHaveLength(2);

        // Delete guest responses → none remain
        await deleteResponsesByGuestId(10, surveyId);
        const afterGuestDelete = await getResponsesSorted(surveyId);
        expect(Object.keys(afterGuestDelete)).toHaveLength(0);
    });
});
