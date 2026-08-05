import type {ActivityPlan} from '../../src/modules/database/entities/activity/ActivityPlan';
import type {ActivitySlot} from '../../src/modules/database/entities/activity/ActivitySlot';
import type {DriversList} from '../../src/modules/database/entities/drivers/DriversList';
import type {Event} from '../../src/modules/database/entities/event/Event';
import type {PackingItem} from '../../src/modules/database/entities/packing/PackingItem';
import type {PackingList} from '../../src/modules/database/entities/packing/PackingList';
import type {Survey} from '../../src/modules/database/entities/surveys/Survey';
import type {SurveyCombination} from '../../src/modules/database/entities/surveys/SurveyCombination';

export interface E2ECreateCase<TForm extends E2ECreateForm> {
    title: string;
    createPath: string;
    expectedViewText: string;
    form: TForm;
}

export interface E2ELoginCredentials {
    username: string;
    password: string;
}

export interface E2EEventForm extends Pick<Event, 'title' | 'description' | 'startDate' | 'endDate' | 'location'> {
    maxParticipants: string;
    bindingDeadline: string;
    deadlineTz: string;
    requireDietaryInfo: 'on';
    allowDietComment: 'on';
}

export interface E2ESurveyForm extends Pick<Survey, 'title' | 'description'> {
    'combinations[0][weekday]': SurveyCombination['weekday'];
    'combinations[0][week]': SurveyCombination['nthWeek'];
}

export interface E2EActivityPlanForm extends Pick<ActivityPlan, 'title' | 'description' | 'startDate' | 'endDate'> {
    slots: string;
}

export interface E2EDriversListForm extends Pick<DriversList, 'title' | 'description'> {}

export interface E2EPackingListForm extends Pick<PackingList, 'title' | 'description'> {
    items: string;
}

export type E2ECreateForm = E2EEventForm | E2ESurveyForm | E2EActivityPlanForm | E2EDriversListForm | E2EPackingListForm;

export function createE2ELogin(): E2ELoginCredentials {
    return {
        username: process.env.E2E_ADMIN_USERNAME ?? 'tester',
        password: process.env.E2E_ADMIN_PASSWORD ?? 'passw0rd!',
    };
}

export function createE2EEvent(overrides: Partial<E2ECreateCase<E2EEventForm>> = {}): E2ECreateCase<E2EEventForm> {
    return {
        title: 'E2E Core Event',
        createPath: '/event/create',
        expectedViewText: 'E2E Core Event',
        form: {
            title: 'E2E Core Event',
            description: 'Core workflow event created by smoke E2E',
            startDate: '2026-08-05',
            endDate: '2026-08-07',
            location: 'E2E Camp Site',
            maxParticipants: '30',
            bindingDeadline: '',
            deadlineTz: 'UTC',
            requireDietaryInfo: 'on',
            allowDietComment: 'on',
        },
        ...overrides,
    };
}

export function createE2ESurvey(overrides: Partial<E2ECreateCase<E2ESurveyForm>> = {}): E2ECreateCase<E2ESurveyForm> {
    return {
        title: 'E2E Core Survey',
        createPath: '/survey/create',
        expectedViewText: 'E2E Core Survey',
        form: {
            title: 'E2E Core Survey',
            description: 'Choose a date',
            'combinations[0][weekday]': 'MON',
            'combinations[0][week]': '1',
        },
        ...overrides,
    };
}

export function createE2EActivityPlan(overrides: Partial<E2ECreateCase<E2EActivityPlanForm>> = {}): E2ECreateCase<E2EActivityPlanForm> {
    const slot: Partial<ActivitySlot> = {id: '44444444-4444-4444-8444-444444444444', day: '2026-08-05', pos: 0, title: 'Breakfast help', description: 'Serve breakfast', startTime: '08:00', endTime: '09:00', maxAssignees: 2};

    return {
        title: 'E2E Core Activity Plan',
        createPath: '/activity/create',
        expectedViewText: 'E2E Core Activity Plan',
        form: {
            title: 'E2E Core Activity Plan',
            description: 'Shared camp duties',
            startDate: '2026-08-05',
            endDate: '2026-08-07',
            slots: JSON.stringify({'2026-08-05': [slot]}),
        },
        ...overrides,
    };
}

export function createE2EDriversList(overrides: Partial<E2ECreateCase<E2EDriversListForm>> = {}): E2ECreateCase<E2EDriversListForm> {
    return {
        title: 'E2E Core Drivers List',
        createPath: '/drivers/create',
        expectedViewText: 'E2E Core Drivers List',
        form: {
            title: 'E2E Core Drivers List',
            description: 'Airport pickup coordination',
        },
        ...overrides,
    };
}

export function createE2EPackingList(overrides: Partial<E2ECreateCase<E2EPackingListForm>> = {}): E2ECreateCase<E2EPackingListForm> {
    const items: Partial<PackingItem>[] = [{title: 'Tent', description: 'Two person tent', maxAssignees: 1, requiredByAll: false}];

    return {
        title: 'E2E Core Packing List',
        createPath: '/packing/create',
        expectedViewText: 'E2E Core Packing List',
        form: {
            title: 'E2E Core Packing List',
            description: 'Shared equipment',
            items: JSON.stringify(items),
        },
        ...overrides,
    };
}
