import type {Request} from 'express';
import type {ActivityPlan} from '../../src/modules/database/entities/activity/ActivityPlan';
import type {ActivitySlot} from '../../src/modules/database/entities/activity/ActivitySlot';
import type {DriversList} from '../../src/modules/database/entities/drivers/DriversList';
import type {Event} from '../../src/modules/database/entities/event/Event';
import type {PackingItem} from '../../src/modules/database/entities/packing/PackingItem';
import type {PackingList} from '../../src/modules/database/entities/packing/PackingList';
import type {Survey} from '../../src/modules/database/entities/surveys/Survey';
import type {SurveyCombination} from '../../src/modules/database/entities/surveys/SurveyCombination';
import type {WeekDay, WeekInMonth} from '../../src/types/SurveyTypes';

export interface CoreIds {
    owner: string;
    profile: string;
    entity: string;
    item: string;
    role: string;
}

export const ids: CoreIds = {
    owner: '11111111-1111-4111-8111-111111111111',
    profile: '22222222-2222-4222-8222-222222222222',
    entity: '33333333-3333-4333-8333-333333333333',
    item: '44444444-4444-4444-8444-444444444444',
    role: '55555555-5555-4555-8555-555555555555',
};

export interface AuthRegistrationBody {
    username: string;
    displayname: string;
    email: string;
    password: string;
    password_repeat: string;
}

export interface AuthLoginBody {
    username: string;
    password: string;
}

interface SurveyCombinationInput {
    weekday: WeekDay;
    week: WeekInMonth | number;
}

export interface SurveyCombinationInputMap {
    [index: number]: SurveyCombinationInput;
}

export interface SurveyCreateBody extends Pick<Survey, 'title' | 'description'> {
    combinations: SurveyCombinationInput[] | SurveyCombinationInputMap;
}

export interface EventCreateBody extends Pick<Event, 'title' | 'description' | 'startDate' | 'endDate' | 'location' | 'bindingDeadline'> {
    maxParticipants: Event['maxParticipants'] | '';
    requireDietaryInfo: 'on' | '';
    allowDietComment: 'on' | '';
    deadlineTz: string;
}

export interface ActivityCreateBody extends Pick<ActivityPlan, 'title' | 'description' | 'startDate' | 'endDate'> {
    slots: string;
    event_id: string;
}

export interface DriversCreateBody extends Pick<DriversList, 'title' | 'description'> {
    event_id: string;
}

export interface PackingCreateBody extends Pick<PackingList, 'title' | 'description'> {
    event_id: string;
    items: string;
}

export type TestSession = Pick<Request, 'session'>['session'];

export function createAuthBody(overrides: Partial<AuthRegistrationBody> = {}): AuthRegistrationBody {
    return {username: 'organizer', displayname: 'Camp Organizer', email: 'organizer@example.com', password: 'secret-123', password_repeat: 'secret-123', ...overrides};
}

export function createLoginBody(overrides: Partial<AuthLoginBody> = {}): AuthLoginBody {
    return {username: 'organizer', password: 'secret-123', ...overrides};
}

export function createSurveyBody(overrides: Partial<SurveyCreateBody> = {}): SurveyCreateBody {
    return {title: 'Camp Survey', description: 'Pick preferred dates', combinations: [{weekday: 'MON', week: 1}], ...overrides};
}

export function createEventBody(overrides: Partial<EventCreateBody> = {}): EventCreateBody {
    return {title: 'Summer Camp', description: 'Main camp', startDate: '2026-08-05', endDate: '2026-08-07', location: 'Lake', bindingDeadline: '', requireDietaryInfo: 'on', allowDietComment: 'on', maxParticipants: 25, deadlineTz: 'UTC', ...overrides};
}

export function createActivityBody(overrides: Partial<ActivityCreateBody> = {}): ActivityCreateBody {
    const slot: Partial<ActivitySlot> = {id: ids.item, day: '2026-08-05', pos: 0, title: 'Breakfast', description: 'Help serve', startTime: '08:00', endTime: '09:00', maxAssignees: 2};
    return {title: 'Camp Activities', description: 'Shared duties', startDate: '2026-08-05', endDate: '2026-08-07', slots: JSON.stringify({'2026-08-05': [slot]}), event_id: ids.entity, ...overrides};
}

export function createDriversBody(overrides: Partial<DriversCreateBody> = {}): DriversCreateBody {
    return {title: 'Camp Drivers', description: 'Airport pickups', event_id: ids.entity, ...overrides};
}

export function createPackingBody(overrides: Partial<PackingCreateBody> = {}): PackingCreateBody {
    const items: Partial<PackingItem>[] = [{title: 'Tent', description: 'Two person tent', maxAssignees: 1, requiredByAll: false}];
    return {title: 'Camp Packing', description: 'Shared equipment', event_id: ids.entity, items: JSON.stringify(items), ...overrides};
}

export function createSession(overrides: Partial<TestSession> = {}): TestSession {
    return {profile: {id: ids.profile}, auth: {}, save: (done: (err?: unknown) => void) => done(), ...overrides} as TestSession;
}
