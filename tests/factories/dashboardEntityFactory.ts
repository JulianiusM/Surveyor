import type {DashboardEntities, Entity, EntityBase} from '../../src/types/UserTypes';
import {createEntityBase, createExpectedEntity} from './entitiesFactory';

export interface DashboardEntityInput {
    surveys?: EntityBase[];
    activityPlans?: EntityBase[];
    packingLists?: EntityBase[];
    driversLists?: EntityBase[];
    events?: EntityBase[];
}

export interface DashboardEntityCase {
    description: string;
    dashboardEntities: DashboardEntityInput;
    expectedEntities: Entity[];
}

export function createDashboardEntityCase(overrides: Partial<DashboardEntityCase> = {}): DashboardEntityCase {
    const survey = createEntityBase({
        id: 'survey-1',
        title: 'Camp Survey',
        description: 'Choose dates',
        headerImg: 'survey.png',
    });
    const event = createEntityBase({
        id: 'event-1',
        title: 'Summer Camp',
    });

    const baseCase: DashboardEntityCase = {
        description: 'flattens mixed dashboard entity groups into unified cards',
        dashboardEntities: {
            surveys: [survey],
            events: [event],
        },
        expectedEntities: [
            createExpectedEntity('survey', survey),
            createExpectedEntity('event', event),
        ],
    };

    return {
        ...baseCase,
        ...overrides,
        dashboardEntities: overrides.dashboardEntities ?? baseCase.dashboardEntities,
        expectedEntities: overrides.expectedEntities ?? baseCase.expectedEntities,
    };
}
