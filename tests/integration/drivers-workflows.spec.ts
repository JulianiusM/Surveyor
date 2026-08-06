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

describe('drivers list user stories', () => {
    it('creates an event-linked drivers list', async () => {
        const eventId = await createIntegrationEvent(owner.id, 'Drivers event');
        const listId = await driverService.createDriversList(owner.id, 'Camp drivers', 'Shared rides', eventId);

        expect(await driverService.getDriversListById(listId)).toMatchObject({event: {id: eventId}});
    });

    it('updates list title, description, and header image', async () => {
        const listId = await driverService.createDriversList(owner.id, 'Camp drivers', 'Shared rides');

        await driverService.updateDriversListTitle(listId, 'Updated drivers');
        await driversController.updateDescription(listId, {description: 'Updated rides'});
        await driverService.updateHeaderImage(listId, 'drivers.jpg');
        expect(await driverService.getDriversListById(listId)).toMatchObject({title: 'Updated drivers', description: 'Updated rides', headerImg: 'drivers.jpg'});
    });

    it('adds a driver-authored journey', async () => {
        const [, item] = await createDriversListWithItem(owner.id);

        expect(await driverService.getDriversItemById(item.id)).toMatchObject({title: 'Airport journey', driverName: owner.name, assignedCount: 0});
    });

    it('adds multiple journeys in display order', async () => {
        const [listId, item] = await createDriversListWithItem(owner.id);

        const second = createDriversItemEntity({title: 'Second journey', pos: 2});
        const list = await driverService.getDriversListById(listId);
        await driversController.quickAddItem(list!, second, {profile: owner} as never);
        expect((await driverService.getDriversItems(listId)).map((entry) => entry.title)).toEqual(['Airport journey', 'Second journey']);
    });

    it('updates journey details and capacity', async () => {
        const [, item] = await createDriversListWithItem(owner.id);

        await driversController.updateItemAttr(item.id, {field: 'title', value: 'Changed journey'});
        await driversController.updateItemDescription(item.id, {description: 'Changed pickup'});
        await driversController.updateItemAttr(item.id, {field: 'maxAssignees', value: 5});
        expect(await driverService.getDriversItemById(item.id)).toMatchObject({title: 'Changed journey', description: 'Changed pickup', maxAssignees: 5});
    });

    it('reorders journeys for the shared list', async () => {
        const [listId, item] = await createDriversListWithItem(owner.id);

        const second = createDriversItemEntity({title: 'First journey', pos: 2});
        const list = await driverService.getDriversListById(listId);
        await driversController.quickAddItem(list!, second, {profile: owner} as never);
        const added = (await driverService.getDriversItems(listId)).find((entry) => entry.title === 'First journey')!;
        await driversController.reorderItems(listId, [{itemId: item.id, position: 2}, {itemId: added.id, position: 1}]);
        expect((await driverService.getDriversItems(listId)).map((entry) => entry.title)).toEqual(['First journey', 'Airport journey']);
    });

    it('assigns a volunteer driver idempotently', async () => {
        const [listId, item] = await createDriversListWithItem(owner.id);

        await assignDriversItem(item.id, participant.id);
        await assignDriversItem(item.id, participant.id);
        expect(await driverService.getDriversAssignments(listId, participant.id)).toEqual([item.id]);
    });

    it('shows assignment counts beside journeys', async () => {
        const [listId, item] = await createDriversListWithItem(owner.id);

        await assignDriversItem(item.id, participant.id);
        await assignDriversItem(item.id, secondParticipant.id);
        expect(await driverService.getDriversAssignmentCounts(listId)).toEqual({[item.id]: 2});
    });

    it('shows volunteer names to coordinators', async () => {
        const [listId, item] = await createDriversListWithItem(owner.id);

        await assignDriversItem(item.id, participant.id);
        expect(await driverService.getDriversItemAssignees(listId)).toEqual({[item.id]: [expect.objectContaining({name: participant.name})]});
    });

    it('removes a volunteer from a journey', async () => {
        const [listId, item] = await createDriversListWithItem(owner.id);

        await assignDriversItem(item.id, participant.id);
        await unassignDriversItem(item.id, participant.id);
        expect(await driverService.getDriversAssignments(listId, participant.id)).toEqual([]);
    });

    it('finds the next journey position', async () => {
        const [listId, item] = await createDriversListWithItem(owner.id);

        expect(await driverService.getLastDriversItemNumber(listId)).toBe(1);
    });

    it('lists only lists owned by the requested profile', async () => {
        const [listId, item] = await createDriversListWithItem(owner.id);

        expect((await driverService.getDriversListByProfileId(owner.id)).map((list) => list.id)).toContain(listId);
        expect((await driverService.getDriversListByProfileId(participant.id)).map((list) => list.id)).not.toContain(listId);
    });

    it('includes a delegated list in the management dashboard', async () => {
        const [listId, item] = await createDriversListWithItem(owner.id);

        await entityAdminController.addAdmin('drivers', listId, {profileId: participant.id, mask: PERM.ACCESS_ADMIN});
        expect((await driverService.getManagedListsForProfile(participant.id)).map((list) => list.id)).toContain(listId);
    });

    it('deletes a journey and its visible assignment', async () => {
        const [listId, item] = await createDriversListWithItem(owner.id);

        await assignDriversItem(item.id, participant.id);
        await driversController.deleteItem(item.id);
        expect(await driverService.getDriversItems(listId)).toEqual([]);
    });

    it('deletes a drivers list from the owner dashboard', async () => {
        const listId = await driverService.createDriversList(owner.id, 'Camp drivers', 'Shared rides');

        const list = await driverService.getDriversListById(listId);
        await driversController.deleteEntity(list!, {} as never);
        expect((await driverService.getDriversListByProfileId(owner.id)).map((list) => list.id)).not.toContain(listId);
    });

});
