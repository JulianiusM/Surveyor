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

import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {AppDataSource} from '../../src/modules/database/dataSource';
import {ActivitySlot} from '../../src/modules/database/entities/activity/ActivitySlot';
import {DriversItem} from '../../src/modules/database/entities/drivers/DriversItem';
import {PackingItem} from '../../src/modules/database/entities/packing/PackingItem';
import {Profile} from '../../src/modules/database/entities/user/Profile';
import {User} from '../../src/modules/database/entities/user/User';
import * as activityService from '../../src/modules/database/services/ActivityService';
import * as driverService from '../../src/modules/database/services/DriverService';
import * as entityAdminService from '../../src/modules/database/services/EntityAdminService';
import * as eventService from '../../src/modules/database/services/EventService';
import * as packingService from '../../src/modules/database/services/PackingService';
import * as surveyService from '../../src/modules/database/services/SurveyService';
import * as userService from '../../src/modules/database/services/UserService';
import {PERM} from '../../src/modules/lib/permissions';
import {
    createActivitySlotEntity,
    createDriversItemEntity,
    createPackingItemEntity,
    createProfileEntity,
    createUserEntity,
} from '../factories/integrationEntityFactory';
import {closeIntegrationDatabase, initializeIntegrationDatabase} from '../support/database';

let owner: Profile;
let participant: Profile;

async function persistProfile(): Promise<Profile> {
    const user = await AppDataSource.getRepository(User).save(createUserEntity());
    return await AppDataSource.getRepository(Profile).save(createProfileEntity(user));
}

beforeAll(async () => {
    // Use the real production entity metadata and MariaDB schema for the whole
    // suite; only email delivery and browser workflows belong outside it.
    await initializeIntegrationDatabase();
    owner = await persistProfile();
    participant = await persistProfile();
});

afterAll(async () => {
    await closeIntegrationDatabase();
});

describe('database-backed core service smoke suite', () => {
    describe('authentication persistence', () => {
        it('registers a local account together with its usable profile', async () => {
            // Canary: registration must commit both sides of the account/profile transaction.
            const userId = await userService.registerUser('new-organizer', 'New Organizer', 'secret-123', 'new-organizer@example.com');
            const user = await userService.getUserByUsername('new-organizer');

            expect(user).toMatchObject({id: userId, name: 'New Organizer'});
            expect(Boolean(user?.isActive)).toBe(false);
            expect(user?.profiles).toHaveLength(1);
        });

        it('verifies the persisted password without exposing its hash', async () => {
            // Canary: the complete hash-and-verify path used by local login remains operational.
            const userId = await userService.registerUser('login-user', 'Login User', 'correct-password', 'login@example.com');

            await expect(userService.verifyPassword(userId, 'correct-password')).resolves.toBe(true);
            await expect(userService.verifyPassword(userId, 'incorrect-password')).resolves.toBe(false);
        });

        it('activates an account through a persisted activation token', async () => {
            // Canary: activation links resolve from MariaDB and make the account active.
            const userId = await userService.registerUser('activation-user', 'Activation User', 'secret-123', 'activation@example.com');
            const token = await userService.generateActivationToken(userId);

            expect((await userService.verifyActivationToken(token))?.id).toBe(userId);
            await userService.activateUser(userId);
            expect(Boolean((await userService.getUserByUsername('activation-user'))?.isActive)).toBe(true);
        });

        it('resets a password through the persisted reset-token workflow', async () => {
            // Canary: password recovery updates credentials and consumes the reset token.
            const userId = await userService.registerUser('reset-user', 'Reset User', 'old-password', 'reset@example.com');
            const token = await userService.generatePasswordResetToken('reset-user');

            expect((await userService.verifyPasswordResetToken(token))?.id).toBe(userId);
            await userService.resetPassword('reset-user', 'new-password');
            await expect(userService.verifyPassword(userId, 'new-password')).resolves.toBe(true);
            await expect(userService.verifyPasswordResetToken(token)).resolves.toBeNull();
        });
    });

    describe('events and connected modules', () => {
        it('creates, loads, and updates an event owned by a real profile', async () => {
            // Canary: the central event lifecycle persists its user-visible fields and ownership.
            const eventId = await eventService.createEventTx(owner.id, {
                title: 'Summer Camp',
                description: 'Annual camp',
                startDate: '2026-08-06',
                endDate: '2026-08-09',
                location: 'Lake',
                bindingDeadline: null,
                requireDietaryInfo: true,
                allowDietComment: true,
                maxParticipants: 40,
                timezone: 'UTC'
            });
            await eventService.updateEventDescription(eventId, 'Updated annual camp');

            expect(await eventService.getEventById(eventId)).toMatchObject({
                id: eventId,
                title: 'Summer Camp',
                description: 'Updated annual camp',
                ownerId: owner.id,
            });
        });

        it('returns only events belonging to the requested owner', async () => {
            // Canary: dashboards must not mix another organizer's events into the owner list.
            await eventService.createEventTx(owner.id, {
                title: 'Owner Event',
                startDate: '2026-09-01',
                endDate: '2026-09-02'
            });
            await eventService.createEventTx(participant.id, {
                title: 'Participant Event',
                startDate: '2026-09-03',
                endDate: '2026-09-04'
            });

            const events = await eventService.getEventsByOwnerId(owner.id);
            expect(events.map((event) => event.title)).toContain('Owner Event');
            expect(events.map((event) => event.title)).not.toContain('Participant Event');
        });

        it('persists a survey and all submitted date combinations transactionally', async () => {
            // Canary: a survey is not useful unless its voting choices survive the create transaction.
            const surveyId = await surveyService.createSurveyTx(owner.id, 'Camp Dates', 'Choose dates', [
                {weekday: 'MON', week: '1'},
                {weekday: 'FRI', week: 'LAST'},
            ]);

            expect(await surveyService.getSurveyById(surveyId)).toMatchObject({title: 'Camp Dates', ownerId: owner.id});
            expect(await surveyService.getCombinationsBySurveyId(surveyId)).toMatchObject([
                {weekday: 'MON', nthWeek: '1'},
                {weekday: 'FRI', nthWeek: 'LAST'},
            ]);
        });

        it('stores and reloads a participant survey response', async () => {
            // Canary: voting must connect the survey, choice, participant, and answer in MariaDB.
            const surveyId = await surveyService.createSurveyTx(owner.id, 'Meal Survey', 'Choose', [{
                weekday: 'TUE',
                week: '2'
            }]);
            const [combination] = await surveyService.getCombinationsBySurveyId(surveyId);
            await surveyService.saveResponse(surveyId, participant.id, combination.id, 'yes');

            expect(await surveyService.getResponsesByProfileId(participant.id)).toContainEqual(expect.objectContaining({
                entityId: surveyId,
                itemId: combination.id,
                answer: 'yes',
            }));
        });

        it('groups persisted survey results by participant for result views', async () => {
            // Canary: survey result pages need names and answers joined from the persisted entity graph.
            const surveyId = await surveyService.createSurveyTx(owner.id, 'Travel Survey', 'Choose', [{
                weekday: 'THU',
                week: '4'
            }]);
            const [combination] = await surveyService.getCombinationsBySurveyId(surveyId);
            await surveyService.saveResponse(surveyId, participant.id, combination.id, 'maybe');

            expect(await surveyService.getResponsesSorted(surveyId)).toEqual({
                [participant.id]: [expect.objectContaining({
                    profileId: participant.id,
                    combinationId: combination.id,
                    name: participant.name,
                    answer: 'maybe',
                })],
            });
        });

        it('replaces a participant survey submission cleanly', async () => {
            // Canary: resubmitting a ballot must remove stale choices before the new answers are stored.
            const surveyId = await surveyService.createSurveyTx(owner.id, 'Replacement Survey', 'Choose', [{
                weekday: 'SAT',
                week: '2'
            }]);
            const [combination] = await surveyService.getCombinationsBySurveyId(surveyId);
            await surveyService.saveResponse(surveyId, participant.id, combination.id, 'yes');
            await surveyService.deleteResponsesByProfileId(participant.id, surveyId);

            expect(await surveyService.getResponsesSorted(surveyId)).toEqual({});
        });

        it('creates an activity plan with its schedule in one transaction', async () => {
            // Canary: activity-plan creation must not lose the slots participants need to select.
            const slot = createActivitySlotEntity();
            const planId = await activityService.createActivityPlanTx(owner.id, 'Camp Duties', 'Shared work', '2026-08-06', '2026-08-09', [slot]);
            const slots = await AppDataSource.getRepository(ActivitySlot).findBy({entity: {id: planId}});

            expect(await activityService.getActivityPlanById(planId)).toMatchObject({
                title: 'Camp Duties',
                ownerId: owner.id
            });
            expect(slots).toHaveLength(1);
            expect(slots[0]).toMatchObject({title: slot.title, day: slot.day, maxAssignees: slot.maxAssignees});
        });

        it('assigns a participant to an activity slot only once', async () => {
            // Canary: repeated assignment requests must remain idempotent for participant schedules.
            const planId = await activityService.createActivityPlanTx(owner.id, 'Kitchen Duties', 'Kitchen', '2026-08-06', '2026-08-09', [createActivitySlotEntity()]);
            const [slot] = await AppDataSource.getRepository(ActivitySlot).findBy({entity: {id: planId}});

            const first = await activityService.ensureAssignment(slot.id, participant.id);
            const second = await activityService.ensureAssignment(slot.id, participant.id);
            expect(second).toBe(first);
        });

        it('reloads an activity schedule with assignment counts', async () => {
            // Canary: the activity screen needs ordered slots and live volunteer counts from MariaDB.
            const planId = await activityService.createActivityPlanTx(owner.id, 'Counted Duties', 'Shared work', '2026-08-06', '2026-08-09', [
                createActivitySlotEntity({title: 'First task', pos: 1}),
                createActivitySlotEntity({title: 'Second task', pos: 2}),
            ]);
            const slots = await activityService.getActivitySlotsFlat(planId);
            await activityService.ensureAssignment(slots[0].id, participant.id);

            expect(await activityService.getActivitySlotsFlat(planId)).toMatchObject([
                {title: 'First task', assignedCount: 1},
                {title: 'Second task', assignedCount: 0},
            ]);
        });

        it('updates and reorders persisted activity slots', async () => {
            // Canary: organizer schedule edits must survive reload without recreating the plan.
            const planId = await activityService.createActivityPlanTx(owner.id, 'Editable Duties', 'Shared work', '2026-08-06', '2026-08-09', [
                createActivitySlotEntity({title: 'Original task', pos: 1}),
                createActivitySlotEntity({title: 'Later task', pos: 2}),
            ]);
            const slots = await activityService.getActivitySlotsFlat(planId);
            await activityService.updateActivitySlot(slots[0].id, {title: 'Updated task'});
            await activityService.reorderActivitySlots(planId, [
                {slotId: slots[0].id, pos: 2},
                {slotId: slots[1].id, pos: 1},
            ]);

            expect(await activityService.getActivitySlotsFlat(planId)).toMatchObject([
                {title: 'Later task', pos: 1},
                {title: 'Updated task', pos: 2},
            ]);
        });

        it('creates a packing list with the shared items participants see', async () => {
            // Canary: packing-list creation commits list and item data together.
            const item = createPackingItemEntity();
            const listId = await packingService.createPackingListTx(owner.id, 'Camp Packing', 'Shared equipment', [item]);

            expect(await packingService.getPackingListById(listId)).toMatchObject({
                title: 'Camp Packing',
                ownerId: owner.id
            });
            expect(await packingService.getPackingItems(listId)).toContainEqual(expect.objectContaining({
                title: item.title,
                assignedCount: 0
            }));
        });

        it('persists packing assignments and exposes their item ids', async () => {
            // Canary: a participant volunteering for equipment must survive a reload.
            const item = createPackingItemEntity();
            const listId = await packingService.createPackingListTx(owner.id, 'Volunteer Packing', 'Equipment', [item]);
            const [persistedItem] = await AppDataSource.getRepository(PackingItem).findBy({entity: {id: listId}});
            await packingService.assignPackingItem(persistedItem.id, participant.id);

            expect(await packingService.getPackingAssignments(listId, participant.id)).toEqual([persistedItem.id]);
        });

        it('updates packing items and removes participant assignments', async () => {
            // Canary: packing edits and opt-outs must both be reflected on the shared list.
            const listId = await packingService.createPackingListTx(owner.id, 'Editable Packing', 'Equipment', [createPackingItemEntity()]);
            const [item] = await AppDataSource.getRepository(PackingItem).findBy({entity: {id: listId}});
            await packingService.assignPackingItem(item.id, participant.id);
            await packingService.updatePackingItem(item.id, {title: 'Updated tent'});
            await packingService.unassignPackingItem(item.id, participant.id);

            expect(await packingService.getPackingItemById(item.id)).toMatchObject({title: 'Updated tent'});
            expect(await packingService.getPackingAssignments(listId, participant.id)).toEqual([]);
        });

        it('creates a drivers list and reloads its event relationship', async () => {
            // Canary: event-linked driver coordination remains visible from both modules.
            const eventId = await eventService.createEventTx(owner.id, {
                title: 'Travel Event',
                startDate: '2026-10-01',
                endDate: '2026-10-02'
            });
            const listId = await driverService.createDriversList(owner.id, 'Airport Drivers', 'Travel coordination', eventId);

            expect(await driverService.getDriversListById(listId)).toMatchObject({
                title: 'Airport Drivers',
                event: {id: eventId, title: 'Travel Event'},
            });
        });

        it('creates and updates a driver task through the production service', async () => {
            // Canary: organizers can maintain the actual pickup tasks shown to drivers.
            const listId = await driverService.createDriversList(owner.id, 'Station Drivers', 'Pickup coordination');
            const item = createDriversItemEntity();
            await driverService.createDriversItem(listId, owner.id, item);
            await driverService.updateDriversItem(item.id, {title: 'Updated station pickup'});

            expect(await AppDataSource.getRepository(DriversItem).findOneBy({id: item.id})).toMatchObject({
                title: 'Updated station pickup',
                entityId: listId,
            });
        });

        it('persists a driver assignment and exposes the assignee name', async () => {
            // Canary: transport coordination must show who volunteered for each persisted journey.
            const listId = await driverService.createDriversList(owner.id, 'Assigned Drivers', 'Pickup coordination');
            const item = createDriversItemEntity();
            await driverService.createDriversItem(listId, owner.id, item);
            await driverService.assignDriversItem(item.id, participant.id);

            expect(await driverService.getDriversAssignments(listId, participant.id)).toEqual([item.id]);
            expect(await driverService.getDriversItemAssignees(listId)).toEqual({
                [item.id]: [expect.objectContaining({profileId: participant.id, name: participant.name})],
            });
        });

        it('updates event metadata and dates used by registration screens', async () => {
            // Canary: organizer edits to capacity, location, dates, and dietary settings survive together.
            const eventId = await eventService.createEventTx(owner.id, {
                title: 'Editable Event',
                startDate: '2026-12-01',
                endDate: '2026-12-02'
            });
            await eventService.updateEventMeta(eventId, {
                location: 'Mountain Lodge',
                maxParticipants: 24,
                requireDietaryInfo: true,
                allowDietComment: true,
                allowDietUpdateAfterDeadline: true,
                allowRegCancelAfterDeadline: true,
                allowRegDateUpdateAfterDeadline: true
            });
            await eventService.updateEventDates(eventId, '2026-12-03', '2026-12-05');

            const event = await eventService.getEventById(eventId);
            expect(event).toMatchObject({
                location: 'Mountain Lodge',
                maxParticipants: 24,
                startDate: '2026-12-03',
                endDate: '2026-12-05',
            });
            expect(Boolean(event?.requireDietaryInfo)).toBe(true);
            expect(Boolean(event?.allowDietComment)).toBe(true);
            expect(Boolean(event?.allowRegDietUpdateAfterDeadline)).toBe(true);
            expect(Boolean(event?.allowRegCancelationAfterDeadline)).toBe(true);
            expect(Boolean(event?.allowRegDateUpdatesAfterDeadline)).toBe(true);
        });
    });

    describe('persisted permissions', () => {
        it('saves and updates a delegated administrator permission mask', async () => {
            // Canary: delegated administration must be enforced from persisted ACL state, not mocks.
            const eventId = await eventService.createEventTx(owner.id, {
                title: 'Managed Event',
                startDate: '2026-11-01',
                endDate: '2026-11-02'
            });
            await entityAdminService.addAdmin('event', eventId, participant.id, PERM.ACCESS_VIEW);
            await entityAdminService.updateAdminPerms('event', eventId, participant.id, PERM.ACCESS_ADMIN | PERM.ACCESS_VIEW);

            expect(await entityAdminService.isAdmin('event', eventId, participant.id)).toBe(true);
            expect(await entityAdminService.getProfilePerms('event', eventId, participant.id)).toBe(PERM.ACCESS_ADMIN | PERM.ACCESS_VIEW);
        });

        it('persists default audience permissions for a shared entity', async () => {
            // Canary: public and participant access configured by organizers survives a database round trip.
            const surveyId = await surveyService.createSurveyTx(owner.id, 'Shared Survey', 'Visibility', [{
                weekday: 'WED',
                week: '3'
            }]);
            await entityAdminService.updatePerms('survey', surveyId, {
                public: PERM.ACCESS_VIEW,
                authenticated: PERM.ACCESS_VIEW | PERM.ITEM_ADD,
            });

            expect(await entityAdminService.getDefaultPerms('survey', surveyId)).toEqual({
                public: PERM.ACCESS_VIEW,
                authenticated: PERM.ACCESS_VIEW | PERM.ITEM_ADD,
            });
        });

        it('lists and removes persisted delegated administration', async () => {
            // Canary: removing a delegated organizer must immediately remove the entity from managed lists.
            const eventId = await eventService.createEventTx(owner.id, {
                title: 'Delegated Event',
                startDate: '2027-01-01',
                endDate: '2027-01-02'
            });
            await entityAdminService.addAdmin('event', eventId, participant.id, PERM.ACCESS_ADMIN);
            expect(await entityAdminService.getIds('event', participant.id, PERM.ACCESS_ADMIN)).toContain(eventId);

            await entityAdminService.removeAdmin('event', eventId, participant.id);
            expect(await entityAdminService.getIds('event', participant.id, PERM.ACCESS_ADMIN)).not.toContain(eventId);
        });
    });
});
