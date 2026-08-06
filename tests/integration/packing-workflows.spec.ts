import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {Request} from 'express';
import activityController from '../../src/controller/activityController';
import driversController from '../../src/controller/driversController';
import * as entityAdminController from '../../src/controller/entityAdminController';
import eventPoolController from '../../src/controller/eventPoolController';
import * as helpController from '../../src/controller/helpController';
import eventController from '../../src/controller/eventController';
import packingController from '../../src/controller/packingController';
import surveyController from '../../src/controller/surveyController';
import * as userController from '../../src/controller/userController';
import {Profile} from '../../src/modules/database/entities/user/Profile';
import {PERM} from '../../src/modules/lib/permissions';
import * as activityService from '../../src/modules/database/services/ActivityService';
import * as driverService from '../../src/modules/database/services/DriverService';
import * as adminService from '../../src/modules/database/services/EntityAdminService';
import * as eventService from '../../src/modules/database/services/EventService';
import * as invoiceService from '../../src/modules/database/services/EventInvoiceService';
import * as packingService from '../../src/modules/database/services/PackingService';
import * as surveyService from '../../src/modules/database/services/SurveyService';
import * as userService from '../../src/modules/database/services/UserService';
import {
    createActivitySlotEntity,
    createDriversItemEntity,
    createPackingItemEntity,
} from '../factories/integrationEntityFactory';
import {
    assignActivitySlot,
    assignDriversItem,
    assignPackingItem,
    createActivityPlanWithSlot,
    createDriversListWithItem,
    createIntegrationEvent,
    createPackingListWithItem,
    createSurveyWithCombinations,
    persistIntegrationProfile,
    registerEventAttendance,
    registerLocalAccount,
    submitSurveyResponses,
    unassignDriversItem,
    unassignPackingItem,
} from '../keywords/coreDomainKeywords';
import {closeIntegrationDatabase, initializeIntegrationDatabase} from '../support/database';

let owner: Profile;
let participant: Profile;
let secondParticipant: Profile;

beforeAll(async () => {
    await initializeIntegrationDatabase();
    owner = await persistIntegrationProfile();
    participant = await persistIntegrationProfile();
    secondParticipant = await persistIntegrationProfile();
});

afterAll(async () => {
    await closeIntegrationDatabase();
});

describe('packing list user stories', () => {
    it('creates a list and all shared items transactionally', async () => {
        const [listId, item] = await createPackingListWithItem(owner.id);

        expect(await packingService.getPackingListById(listId)).toMatchObject({title: 'Camp packing list', ownerId: owner.id});
        expect(item).toMatchObject({title: 'Group tent', assignedCount: 0});
    });

    it('rejects a packing list without a participant-visible item', async () => {
        expect(() => packingController.preprocessCreate({
            title: 'Camp packing list', description: 'Shared equipment', items: '[]',
        })).toThrow('items');
    });

    it('adds several organizer-authored items at once', async () => {
        const [listId] = await createPackingListWithItem(owner.id);

        const list = await packingService.getPackingListById(listId);
        await packingController.quickAddItem(list!, {title: 'Lantern'}, {profile: owner} as never);
        await packingController.quickAddItem(list!, {title: 'Stove'}, {profile: owner} as never);
        expect((await packingService.getPackingItems(listId)).map((entry) => entry.title)).toEqual(expect.arrayContaining(['Group tent', 'Lantern', 'Stove']));
    });

    it('updates list title, description, and header image', async () => {
        const [listId] = await createPackingListWithItem(owner.id);

        await packingService.updatePackingListTitle(listId, 'Updated packing');
        await packingController.updateDescription(listId, {description: 'Updated equipment'});
        await packingService.updateHeaderImage(listId, 'packing.jpg');
        expect(await packingService.getPackingListById(listId)).toMatchObject({title: 'Updated packing', description: 'Updated equipment', headerImg: 'packing.jpg'});
    });

    it('updates item details and capacity', async () => {
        const [, item] = await createPackingListWithItem(owner.id);

        await packingController.updateItemAttr(item.id, {field: 'title', value: 'Updated item'});
        await packingController.updateItemDescription(item.id, {description: 'Updated details'});
        await packingController.updateItemAttr(item.id, {field: 'maxAssignees', value: 4});
        expect(await packingService.getPackingItemById(item.id)).toMatchObject({title: 'Updated item', description: 'Updated details', maxAssignees: 4});
    });

    it('reorders items for participant display', async () => {
        const [listId, item] = await createPackingListWithItem(owner.id);

        const second = createPackingItemEntity({title: 'First item', pos: 2});
        const list = await packingService.getPackingListById(listId);
        await packingController.quickAddItem(list!, second, {profile: owner} as never);
        const added = (await packingService.getPackingItems(listId)).find((entry) => entry.title === 'First item')!;
        await packingController.reorderItems(listId, [{itemId: item.id, position: 2}, {itemId: added.id, position: 1}]);
        expect((await packingService.getPackingItems(listId)).map((entry) => entry.title)).toEqual(['First item', 'Group tent']);
    });

    it('assigns a participant idempotently', async () => {
        const [listId, item] = await createPackingListWithItem(owner.id);

        await assignPackingItem(item.id, participant.id);
        await assignPackingItem(item.id, participant.id);
        expect(await packingService.getPackingAssignments(listId, participant.id)).toEqual([item.id]);
    });

    it('shows assignment counts beside items', async () => {
        const [listId, item] = await createPackingListWithItem(owner.id);

        await assignPackingItem(item.id, participant.id);
        await assignPackingItem(item.id, secondParticipant.id);
        expect(await packingService.getPackingAssignmentCounts(listId)).toEqual({[item.id]: 2});
    });

    it('shows assignee names to organizers', async () => {
        const [listId, item] = await createPackingListWithItem(owner.id);

        await assignPackingItem(item.id, participant.id);
        expect(await packingService.getPackingItemAssignees(listId)).toEqual({[item.id]: [expect.objectContaining({name: participant.name})]});
    });

    it('removes a participant assignment', async () => {
        const [listId, item] = await createPackingListWithItem(owner.id);

        await assignPackingItem(item.id, participant.id);
        await unassignPackingItem(item.id, participant.id);
        expect(await packingService.getPackingAssignments(listId, participant.id)).toEqual([]);
    });

    it('marks an item as required by everyone', async () => {
        const [, item] = await createPackingListWithItem(owner.id);

        await packingController.updateRequired(item.id, {flag: true});
        expect(Boolean((await packingService.getPackingItemById(item.id))?.requiredByAll)).toBe(true);
    });

    it('finds lists in which a participant volunteered', async () => {
        const [listId, item] = await createPackingListWithItem(owner.id);

        await assignPackingItem(item.id, participant.id);
        expect((await packingService.getPackingListByParticipant(participant.id)).map((list) => list.id)).toContain(listId);
    });

    it('includes a delegated list in the management dashboard', async () => {
        const [listId] = await createPackingListWithItem(owner.id);

        await entityAdminController.addAdmin('packing', listId, {profileId: participant.id, mask: PERM.ACCESS_ADMIN});
        expect((await packingService.getManagedLists(participant.id)).map((list) => list.id)).toContain(listId);
    });

    it('deletes an item and its visible assignment', async () => {
        const [listId, item] = await createPackingListWithItem(owner.id);

        await assignPackingItem(item.id, participant.id);
        await packingController.deleteItem(item.id);
        expect(await packingService.getPackingItems(listId)).toEqual([]);
    });

    it('deletes a packing list from the owner dashboard', async () => {
        const [listId] = await createPackingListWithItem(owner.id);

        const list = await packingService.getPackingListById(listId);
        await packingController.deleteEntity(list!, {} as never);
        expect((await packingService.getPackingListByProfileId(owner.id)).map((list) => list.id)).not.toContain(listId);
    });

});
