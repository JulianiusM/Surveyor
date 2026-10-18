import {Request} from 'express';
import {randomUUID} from 'node:crypto';
import {EntityTarget, ObjectLiteral} from 'typeorm';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import activityController from '../../src/controller/activityController';
import driversController from '../../src/controller/driversController';
import eventController from '../../src/controller/eventController';
import packingController from '../../src/controller/packingController';
import {IncreaseFreeTextLimits1789776000000} from '../../src/migrations/1789776000000-IncreaseFreeTextLimits';
import {AppDataSource} from '../../src/modules/database/dataSource';
import {ActivityRole} from '../../src/modules/database/entities/activity/ActivityRole';
import {ActivitySlot} from '../../src/modules/database/entities/activity/ActivitySlot';
import {DriversItem} from '../../src/modules/database/entities/drivers/DriversItem';
import {EventRegistrationDietary} from '../../src/modules/database/entities/event/EventRegistrationDietary';
import {PackingItem} from '../../src/modules/database/entities/packing/PackingItem';
import {SurveyCombination} from '../../src/modules/database/entities/surveys/SurveyCombination';
import {Profile} from '../../src/modules/database/entities/user/Profile';
import * as activityService from '../../src/modules/database/services/ActivityService';
import * as driverService from '../../src/modules/database/services/DriverService';
import * as eventService from '../../src/modules/database/services/EventService';
import * as packingService from '../../src/modules/database/services/PackingService';
import {buildPermBundle} from '../../src/modules/permissionEngine';
import {createActivitySlotEntity} from '../factories/integrationEntityFactory';
import {
    createActivityPlanWithSlot,
    createDriversListWithItem,
    createIntegrationEvent,
    createPackingListWithItem,
    createSurveyWithCombinations,
    persistIntegrationProfile,
    registerEventAttendance,
} from '../keywords/coreDomainKeywords';
import {closeIntegrationDatabase, initializeIntegrationDatabase} from '../support/database';

let owner: Profile;
// Includes multiline prose, non-ASCII characters, and supplementary Unicode characters.
const description = 'Plan 食 🥜\n'.repeat(1600);
const notes = 'Allergies: ä 食 🥜\n'.repeat(250).slice(0, 4000);

beforeAll(async () => {
    await initializeIntegrationDatabase();
    owner = await persistIntegrationProfile();
});

afterAll(closeIntegrationDatabase);

describe('long free-text persistence and validation', () => {
    it('upgrades existing short and null values, stores longer content in every inherited column, and refuses lossy reversion', async () => {
        const planId = await createActivityPlanWithSlot(owner.id);
        const [slot] = await activityService.getActivitySlotsFlat(planId);
        const [role] = await activityService.ensureRoleId(planId, 'Preparation', false);
        const [, driver] = await createDriversListWithItem(owner.id);
        const [, packing] = await createPackingListWithItem(owner.id);
        const [, combinations] = await createSurveyWithCombinations(owner.id);
        const items: {entity: EntityTarget<ObjectLiteral>; item: {id: string | number; description?: string | null}}[] = [
            {entity: ActivityRole, item: role},
            {entity: ActivitySlot, item: slot},
            {entity: DriversItem, item: driver},
            {entity: PackingItem, item: packing},
            {entity: SurveyCombination, item: combinations[0]},
        ];
        const originalDescriptions = items.map(({item}) => item.description ?? null);
        const eventId = await createIntegrationEvent(owner.id, 'Dietary migration');
        await registerEventAttendance(eventId, owner, {
            arrivalDate: '2027-06-01', departureDate: '2027-06-03',
            dietary: ['MEAT', 'ALLERGIES'], allergyNotes: 'Peanuts',
        });
        const registration = (await eventService.getRegistrationFor(owner.id, eventId))!;
        const allergy = registration.dietaryChoices.find(choice => choice.choice === 'ALLERGIES')!;
        const dietaryRepo = AppDataSource.getRepository(EventRegistrationDietary);
        const migration = new IncreaseFreeTextLimits1789776000000();
        const runner = AppDataSource.createQueryRunner();
        try {
            await migration.down(runner);
            for (const {entity} of items) {
                const table = AppDataSource.getMetadata(entity).tableName;
                const [column] = await runner.query(
                    "SELECT CHARACTER_MAXIMUM_LENGTH AS maximum FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'description'",
                    [table],
                );
                expect(Number(column.maximum)).toBe(255);
            }
            await migration.up(runner);
            await migration.up(runner); // Also supports a schema already created from current entities.
            for (const [index, {entity, item}] of items.entries()) {
                const repo = AppDataSource.getRepository(entity);
                expect((await repo.findOneByOrFail({id: item.id})).description).toBe(originalDescriptions[index]);
            }
            expect((await dietaryRepo.findOneByOrFail({id: allergy.id})).additionalInfo).toBe('Peanuts');
            expect((await dietaryRepo.findOneByOrFail({id: registration.dietaryChoices.find(choice => choice.choice === 'MEAT')!.id})).additionalInfo).toBeNull();

            // Dietary notes are the last migration column: a refusal must leave earlier columns wide.
            await dietaryRepo.update(allergy.id, {additionalInfo: notes});
            await expect(migration.down(runner)).rejects.toThrow('event_registration_dietary.additional_info');
            expect((await dietaryRepo.findOneByOrFail({id: allergy.id})).additionalInfo).toBe(notes);
            for (const {entity, item} of items) {
                const repo = AppDataSource.getRepository(entity);
                await repo.update(item.id, {description});
                expect((await repo.findOneByOrFail({id: item.id})).description).toBe(description);
                const table = await runner.getTable(repo.metadata.tableName);
                expect(table?.findColumnByName('title')?.length).toBe('255');
            }
            await expect(migration.down(runner)).rejects.toThrow('activity_roles.description');
        } finally {
            await migration.up(runner);
            await runner.release();
        }
    });

    it('creates and edits long event descriptions and saves allergy details and comments without truncation', async () => {
        const body = {
            title: 'Detailed event', description,
            startDate: '2027-06-01', endDate: '2027-06-03',
            requireDietaryInfo: 'on', allowDietComment: 'on',
        };
        const eventId = await eventController.createEntity(owner.id, {
            ...eventController.preprocessCreate(body),
            title: body.title, startDate: body.startDate, endDate: body.endDate,
        });
        let event = (await eventService.getEventById(eventId))!;
        expect(event.description).toBe(description);
        expect(() => eventController.preprocessCreate({...body, description: 'x'.repeat(16001)})).toThrow();
        const permissions = await buildPermBundle({entityType: 'event', entityId: event.id, ownerId: owner.id}, [], {profile: owner});
        const edited = 'Updated!!\n' + description.slice(10);
        await eventController.updateEventSettings(event, {description: edited}, permissions);
        event = (await eventService.getEventById(eventId))!;
        expect(event.description).toBe(edited);
        await expect(eventController.updateEventSettings(event, {description: 'x'.repeat(16001)}, permissions)).rejects.toThrow();

        const attendance = {
            arrivalDate: '2027-06-01', departureDate: '2027-06-03',
            dietary: ['MEAT', 'ALLERGIES', 'COMMENT'], allergyNotes: notes, dietComment: notes,
        };
        await registerEventAttendance(eventId, owner, attendance);
        const registration = (await eventService.getRegistrationFor(owner.id, eventId))!;
        for (const choice of ['ALLERGIES', 'COMMENT']) {
            expect(registration.dietaryChoices.find(dietary => dietary.choice === choice)?.additionalInfo).toBe(notes.trim());
        }
        for (const field of ['allergyNotes', 'dietComment']) {
            await expect(eventController.registerAttendance(event, {...attendance, [field]: 'x'.repeat(4001)}, {
                session: {profile: owner},
            } as Request)).rejects.toThrow();
        }
    });

    it('creates and edits long activity descriptions and shared text while retaining short titles', async () => {
        const slot = createActivitySlotEntity({id: randomUUID(), description, day: '2027-06-01'});
        const body = {
            title: 'Detailed activity plan', description,
            startDate: '2027-06-01', endDate: '2027-06-03',
            slots: JSON.stringify({'2027-06-01': [slot]}),
        };
        const planId = await activityController.createEntity(owner.id, activityController.preprocessCreate(body));
        expect((await activityService.getActivityPlanById(planId))?.description).toBe(description);
        expect((await activityService.getActivitySlotsFlat(planId))[0].description).toBe(description);
        expect(() => activityController.preprocessCreate({...body, description: 'x'.repeat(16001)})).toThrow();
        await activityController.updateDescription(planId, {description});
        await expect(activityController.updateDescription(planId, {description: 'x'.repeat(16001)})).rejects.toThrow();

        const field = await activityController.createTextField(planId, {title: 'Preparation', text: description});
        expect((await activityService.getActivityPlanTextFieldById(field.id))?.text).toBe(description);
        const edited = 'Updated!!\n' + description.slice(10);
        await activityController.updateTextField(planId, field.id, {text: edited});
        expect((await activityService.getActivityPlanTextFieldById(field.id))?.text).toBe(edited);
        await expect(activityController.createTextField(planId, {title: 'Notes', text: 'x'.repeat(16001)})).rejects.toThrow('Text too long');
        await expect(activityController.updateTextField(planId, field.id, {text: 'x'.repeat(16001)})).rejects.toThrow('Text too long');
        await expect(activityController.createTextField(planId, {title: 'x'.repeat(256), text: ''})).rejects.toThrow('Title too long');
    });

    it('edits long driver and packing list descriptions through their controllers', async () => {
        const [driversId] = await createDriversListWithItem(owner.id);
        const [packingId] = await createPackingListWithItem(owner.id);
        await driversController.updateDescription(driversId, {description});
        await packingController.updateDescription(packingId, {description});
        expect((await driverService.getDriversListById(driversId))?.description).toBe(description);
        expect((await packingService.getPackingListById(packingId))?.description).toBe(description);
        await expect(driversController.updateDescription(driversId, {description: 'x'.repeat(16001)})).rejects.toThrow();
        await expect(packingController.updateDescription(packingId, {description: 'x'.repeat(16001)})).rejects.toThrow();
    });
});
