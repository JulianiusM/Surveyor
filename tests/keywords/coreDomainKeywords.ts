import {AppDataSource} from '../../src/modules/database/dataSource';
import {Profile} from '../../src/modules/database/entities/user/Profile';
import {User} from '../../src/modules/database/entities/user/User';
import {DriversItem} from '../../src/modules/database/entities/drivers/DriversItem';
import {PackingItem} from '../../src/modules/database/entities/packing/PackingItem';
import {SurveyCombination} from '../../src/modules/database/entities/surveys/SurveyCombination';
import * as activityService from '../../src/modules/database/services/ActivityService';
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
    return await eventService.createEventTx(
        ownerId,
        title,
        'A production-shaped integration workflow',
        '2027-06-01',
        '2027-06-03',
        'Lakeside',
        null,
        true,
        true,
        capacity,
        'UTC',
    );
}

export async function registerLocalAccount(label: string): Promise<Pick<User, 'id' | 'username' | 'email'>> {
    const user = createUserEntity();
    const username = `${label}-${user.username}`;
    const email = `${label}-${user.email}`;
    const id = await userService.registerUser(username, user.name, 'initial-secret', email);
    return {email, id, username};
}

export async function createActivityPlanWithSlot(ownerId: string): Promise<string> {
    return await activityService.createActivityPlanTx(
        ownerId,
        'Camp activity plan',
        'Shared schedule',
        '2027-06-01',
        '2027-06-03',
        [createActivitySlotEntity({title: 'Morning activity'})],
    );
}

export async function createDriversListWithItem(ownerId: string): Promise<[string, DriversItem]> {
    const listId = await driverService.createDriversList(ownerId, 'Camp drivers', 'Shared rides');
    const item = createDriversItemEntity({title: 'Airport journey'});
    await driverService.createDriversItem(listId, ownerId, item);
    return [listId, item];
}

export async function createPackingListWithItem(ownerId: string): Promise<[string, PackingItem]> {
    const listId = await packingService.createPackingListTx(
        ownerId,
        'Camp packing list',
        'Shared equipment',
        [createPackingItemEntity({title: 'Group tent'})],
    );
    const [item] = await packingService.getPackingItems(listId);
    return [listId, item];
}

export async function createSurveyWithCombinations(ownerId: string): Promise<[string, SurveyCombination[]]> {
    const surveyId = await surveyService.createSurveyTx(ownerId, 'Camp date survey', 'Choose dates', [
        {weekday: 'MON', week: '1'},
        {weekday: 'FRI', week: 'LAST'},
    ]);
    const combinations = await surveyService.getCombinationsBySurveyId(surveyId);
    return [surveyId, combinations];
}
