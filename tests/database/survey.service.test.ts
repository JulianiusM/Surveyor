/**
 * Tests for surveysService using the mysql (MariaDB/mysql2) DataSource mock.
 * Migrated to data-driven approach with externalized test data.
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
    getSurveysByParticipantGuestId,
    getSurveyById,
    getSurveysByUserId,
    saveResponseGuest,
    saveResponseUser,
} from '../../src/modules/database/services/SurveyService';

import { AppDataSource, initDataSource } from '../../src/modules/database/dataSource';

// Entities for setup/cleanup
import { Survey } from '../../src/modules/database/entities/surveys/Survey';
import { SurveyCombination } from '../../src/modules/database/entities/surveys/SurveyCombination';
import { SurveyResponse } from '../../src/modules/database/entities/surveys/SurveyResponse';
import { User } from '../../src/modules/database/entities/user/User';
import { Guest } from '../../src/modules/database/entities/user/Guest';

// Test data and keywords
import { createSurveyTestData, responseTestData } from '../data/database/surveyServiceData';
import {
    createTestUser,
    createTestGuest,
    verifyCombinationsOrder,
    verifyGroupedResponses,
    verifyAnswers,
} from '../keywords/database/databaseKeywords';

function toGuestId(id: string | number) {
    const raw = String(id);
    if (raw.includes('-')) return raw;
    return `00000000-0000-4000-8000-${raw.padStart(12, '0')}`;
}

function normalizeGuestGroupKey(key: string) {
    if (!key.startsWith('g_')) return key;
    const id = key.slice(2);
    if (!/^\d+$/.test(id)) return key;
    return `g_${toGuestId(id)}`;
}

function normalizeGuestKeyMap<T>(map: Record<string, T>) {
    return Object.fromEntries(Object.entries(map).map(([k, v]) => [normalizeGuestGroupKey(k), v]));
}

// Helper to clear relevant tables between tests (order matters due to FKs)
async function truncateAll() {
    await AppDataSource.query('SET FOREIGN_KEY_CHECKS=0');

    await AppDataSource.createQueryBuilder().delete().from(SurveyResponse).execute();
    await AppDataSource.createQueryBuilder().delete().from(SurveyCombination).execute();
    await AppDataSource.createQueryBuilder().delete().from(Survey).execute();
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
    await createTestUser({
        id: 1,
        username: 'owner',
        name: 'Owner One',
        email: 'owner@example.com',
    });
});

afterEach(async () => {
    await truncateAll();
}, 60_000);

describe('surveysService (mysql) with enum combinations', () => {
    test.each(createSurveyTestData)(
        '$description',
        async ({ userId, title, descriptionText, combinations, expectedCombinationsOrder, newCombination }) => {
            // Create survey with combinations
            const surveyId = await createSurveyTx(
                userId,
                title,
                descriptionText,
                combinations.map(c => ({ weekday: c.weekday as any, week: c.week as any }))
            );

            // Verify survey creation
            const survey = await getSurveyById(surveyId);
            expect(survey).toBeTruthy();
            expect(survey!.id).toBe(surveyId);
            expect(survey!.title).toBe(title);
            expect(survey!.description).toBe(descriptionText);

            // Verify combinations order
            const combos = await getCombinationsBySurveyId(surveyId);
            expect(combos).toHaveLength(combinations.length);
            verifyCombinationsOrder(combos, expectedCombinationsOrder);

            // Add new combination if specified
            if (newCombination) {
                const newComboId = await addCombination(
                    surveyId,
                    newCombination.weekday as any,
                    newCombination.week as any
                );
                expect(typeof newComboId).toBe('number');

                const combosAfter = await getCombinationsBySurveyId(surveyId);
                expect(combosAfter).toHaveLength(combinations.length + 1);
                expect(
                    combosAfter.some(
                        c => c.weekday === newCombination.weekday && c.nthWeek === newCombination.week
                    )
                ).toBe(true);
            }

            // Verify survey by user
            const byUser = await getSurveysByUserId(userId);
            expect(byUser.map(s => s.id)).toContain(surveyId);

            // Delete survey (should cascade delete combinations)
            await deleteSurvey(surveyId);
            const deletedSurvey = await getSurveyById(surveyId);
            expect(deletedSurvey).toBeNull();

            const combosAfterDelete = await getCombinationsBySurveyId(surveyId);
            expect(combosAfterDelete).toHaveLength(0);
        }
    );

    test.each(responseTestData)(
        '$description',
        async ({
            ownerId,
            additionalUsers,
            guests,
            title,
            descriptionText,
            combinations,
            responses,
            expectedGroupedKeys,
            expectedUserAnswers,
            expectedGuestAnswers,
            guestLinkConfig,
            deletions,
        }) => {
            // Create additional users and guests
            for (const user of additionalUsers) {
                await createTestUser(user);
            }

            for (const guest of guests) {
                await createTestGuest(guest);
            }

            // Create survey with combinations
            const surveyId = await createSurveyTx(
                ownerId,
                title,
                descriptionText,
                combinations.map(c => ({ weekday: c.weekday as any, week: c.week as any }))
            );
            const combos = await getCombinationsBySurveyId(surveyId);

            // Save responses
            for (const resp of responses) {
                const comboId = combos[resp.combinationIndex].id;
                if (resp.principalType === 'user') {
                    await saveResponseUser(surveyId, resp.principalId, comboId, resp.answer as any);
                } else {
                    await saveResponseGuest(surveyId, toGuestId(resp.principalId), comboId, resp.answer as any);
                }
            }

            // Verify guest responses are ordered by combination.id ASC
            const guestIds = guests.map(g => g.id);
            for (const guestId of guestIds) {
                const guestRows = await getResponsesByGuestId(toGuestId(guestId));
                if (guestRows.length > 0) {
                    const combIds = guestRows.map(r => r.combinationId);
                    expect([...combIds].sort((a, b) => Number(a) - Number(b))).toEqual(combIds);
                }
            }

            // Verify grouped responses
            const grouped = await getResponsesSorted(surveyId);
            verifyGroupedResponses(grouped, expectedGroupedKeys.map(normalizeGuestGroupKey));

            // Verify user answers
            for (const [principalKey, expectedAnswers] of Object.entries(expectedUserAnswers)) {
                expect(grouped[principalKey]).toHaveLength(expectedAnswers.length);
                verifyAnswers(grouped, principalKey, expectedAnswers);
            }

            // Verify guest answers
            for (const [principalKey, expectedAnswers] of Object.entries(normalizeGuestKeyMap(expectedGuestAnswers))) {
                verifyAnswers(grouped, principalKey, expectedAnswers);
            }

            // Verify survey participation lookup if configured
            if (guestLinkConfig) {
                const linkedSurveys = await getSurveysByParticipantGuestId(toGuestId(guestLinkConfig.guestId));
                expect(linkedSurveys.map(s => s.id)).toContain(surveyId);
            }

            // Test deletions if configured
            if (deletions) {
                if (deletions.deleteUserId !== undefined) {
                    await deleteResponsesByUserId(deletions.deleteUserId, surveyId);
                    const afterUserDelete = await getResponsesSorted(surveyId);

                    if (deletions.expectedAfterUserDelete) {
                        for (const [key, expectedLength] of Object.entries(normalizeGuestKeyMap(deletions.expectedAfterUserDelete))) {
                            expect(afterUserDelete[key] ?? []).toHaveLength(expectedLength);
                        }
                    }
                }

                if (deletions.deleteGuestId !== undefined) {
                    await deleteResponsesByGuestId(toGuestId(deletions.deleteGuestId), surveyId);
                    const afterGuestDelete = await getResponsesSorted(surveyId);

                    if (deletions.expectedAfterGuestDelete) {
                        const totalExpected = Object.values(deletions.expectedAfterGuestDelete).reduce(
                            (sum, len) => sum + len,
                            0
                        );
                        if (totalExpected === 0) {
                            expect(Object.keys(afterGuestDelete)).toHaveLength(0);
                        }
                    }
                }
            }
        }
    );
});
