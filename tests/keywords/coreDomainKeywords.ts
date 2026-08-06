import {AppDataSource} from '../../src/modules/database/dataSource';
import {Profile} from '../../src/modules/database/entities/user/Profile';
import {User} from '../../src/modules/database/entities/user/User';
import {DriversItem} from '../../src/modules/database/entities/drivers/DriversItem';
import {PackingItem} from '../../src/modules/database/entities/packing/PackingItem';
import {SurveyCombination} from '../../src/modules/database/entities/surveys/SurveyCombination';
import {Request} from 'express';
import {randomUUID} from 'node:crypto';
import activityController from '../../src/controller/activityController';
import driversController from '../../src/controller/driversController';
import eventController from '../../src/controller/eventController';
import packingController from '../../src/controller/packingController';
import surveyController from '../../src/controller/surveyController';
import * as driverService from '../../src/modules/database/services/DriverService';
import * as eventService from '../../src/modules/database/services/EventService';
import * as packingService from '../../src/modules/database/services/PackingService';
import * as surveyService from '../../src/modules/database/services/SurveyService';
import * as userService from '../../src/modules/database/services/UserService';
import {
    createActivitySlotEntity,
    createDriversItemEntity,
    createPackingItemEntity,
    createProfileEntity,
    createUserEntity,
} from '../factories/integrationEntityFactory';

export async function persistIntegrationProfile(overrides: Partial<User> = {}): Promise<Profile> {
    const user = await AppDataSource.getRepository(User).save(createUserEntity(overrides));
    return await AppDataSource.getRepository(Profile).save(createProfileEntity(user));
}

export async function createIntegrationEvent(
    ownerId: string,
    title: string,
    capacity: number | null = 20,
): Promise<string> {
    const event = eventController.preprocessCreate({
        title,
        description: 'A production-shaped integration workflow',
        startDate: '2027-06-01',
        endDate: '2027-06-03',
        location: 'Lakeside',
        requireDietaryInfo: 'on',
        allowDietComment: 'on',
        maxParticipants: capacity ?? '',
        deadlineTz: 'UTC',
    });
    return await eventController.createEntity(ownerId, event);
}

export async function registerLocalAccount(label: string): Promise<Pick<User, 'id' | 'username' | 'email'>> {
    const user = createUserEntity();
    const username = `${label}-${user.username}`;
    const email = `${label}-${user.email}`;
    const id = await userService.registerUser(username, user.name, 'initial-secret', email);
    return {email, id, username};
}

export async function createActivityPlanWithSlot(ownerId: string): Promise<string> {
    const slot = createActivitySlotEntity({id: randomUUID(), title: 'Morning activity', day: '2027-06-01'});
    const plan = activityController.preprocessCreate({
        title: 'Camp activity plan',
        description: 'Shared schedule',
        startDate: '2027-06-01',
        endDate: '2027-06-03',
        slots: JSON.stringify({'2027-06-01': [slot]}),
    });
    return await activityController.createEntity(ownerId, plan);
}

export async function createDriversListWithItem(ownerId: string): Promise<[string, DriversItem]> {
    const list = driversController.preprocessCreate({title: 'Camp drivers', description: 'Shared rides'});
    const listId = await driversController.createEntity(ownerId, list);
    const persistedList = await driverService.getDriversListById(listId);
    await driversController.quickAddItem(
        persistedList!,
        createDriversItemEntity({title: 'Airport journey'}),
        {profile: {id: ownerId}} as never,
    );
    const [item] = await driverService.getDriversItems(listId);
    return [listId, item];
}

export async function createPackingListWithItem(ownerId: string): Promise<[string, PackingItem]> {
    const itemInput = createPackingItemEntity({title: 'Group tent'});
    const list = packingController.preprocessCreate({
        title: 'Camp packing list',
        description: 'Shared equipment',
        items: JSON.stringify([itemInput]),
    });
    const listId = await packingController.createEntity(ownerId, list);
    const [item] = await packingService.getPackingItems(listId);
    return [listId, item];
}

export async function createSurveyWithCombinations(ownerId: string): Promise<[string, SurveyCombination[]]> {
    const survey = surveyController.preprocessCreate({
        title: 'Camp date survey',
        description: 'Choose dates',
        combinations: [
            {weekday: 'MON', week: '1'},
            {weekday: 'FRI', week: 'LAST'},
        ],
    });
    const surveyId = await surveyController.createEntity(ownerId, survey);
    const combinations = await surveyService.getCombinationsBySurveyId(surveyId);
    return [surveyId, combinations];
}

export async function registerEventAttendance(
    eventId: string,
    profile: Profile,
    body: Record<string, unknown>,
): Promise<void> {
    const event = await eventService.getEventById(eventId);
    await eventController.registerAttendance(event!, body, {session: {profile}} as Request);
}

export async function assignActivitySlot(itemId: string, profileId: string): Promise<void> {
    await activityController.getAssignmentAccessMapping().assign({itemId}, profileId);
}

export async function assignDriversItem(itemId: string, profileId: string): Promise<void> {
    await driversController.getAssignmentAccessMapping().assign({itemId}, profileId);
}

export async function unassignDriversItem(itemId: string, profileId: string): Promise<void> {
    await driversController.getAssignmentAccessMapping().unassign({itemId}, profileId);
}

export async function assignPackingItem(itemId: string, profileId: string): Promise<void> {
    await packingController.getAssignmentAccessMapping().assign({itemId}, profileId);
}

export async function unassignPackingItem(itemId: string, profileId: string): Promise<void> {
    await packingController.getAssignmentAccessMapping().unassign({itemId}, profileId);
}

export async function submitSurveyResponses(
    surveyId: string,
    profile: Profile,
    answers: Record<number, 'yes' | 'maybe' | 'no'>,
): Promise<void> {
    const survey = await surveyService.getSurveyById(surveyId);
    await surveyController.submitResponses(survey!, {profile} as Request['session'], answers);
}
