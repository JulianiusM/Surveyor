/**
 * Shared test data for entity E2E tests
 * Common patterns for survey, packing, activity, and drivers entities
 */

/**
 * Entity types supported in the application
 */
export type EntityType = 'survey' | 'packing' | 'activity' | 'drivers';

/**
 * Entity-specific configuration for generating test data
 */
interface EntityConfig {
    urlPath: string;
    displayName: string;
    displayNamePlural: string;
    accordionId: string;
    createButtonPattern: RegExp;
    emptyStatePattern: RegExp;
}

/**
 * Configuration for each entity type
 */
export const entityConfigs: Record<EntityType, EntityConfig> = {
    survey: {
        urlPath: '/survey/create',
        displayName: 'survey',
        displayNamePlural: 'surveys',
        accordionId: '#sec-surveys',
        createButtonPattern: /create.*survey/i,
        emptyStatePattern: /you don[’']t have any surveys yet/i,
    },
    packing: {
        urlPath: '/packing/create',
        displayName: 'packing list',
        displayNamePlural: 'packing lists',
        accordionId: '#sec-pack',
        createButtonPattern: /create.*list/i,
        emptyStatePattern: /you don[’']t have any packing lists yet/i,
    },
    activity: {
        urlPath: '/activity/create',
        displayName: 'activity plan',
        displayNamePlural: 'activity plans',
        accordionId: '#sec-activity',
        createButtonPattern: /create.*plan/i,
        emptyStatePattern: /you don[’']t have any activity plans yet/i,
    },
    drivers: {
        urlPath: '/drivers/create',
        displayName: 'drivers list',
        displayNamePlural: 'drivers lists',
        accordionId: '#sec-drivers',
        createButtonPattern: /create.*list/i,
        emptyStatePattern: /you don[’']t have any drivers lists yet/i,
    },
};

/**
 * Generate page access test data for an entity (both authenticated and unauthenticated)
 */
export function generatePageAccessData(entityType: EntityType) {
    const config = entityConfigs[entityType];
    return [
        {
            description: `authenticated user can access ${config.displayName} create page`,
            targetUrl: config.urlPath,
            isAuthenticated: true,
            expectedUrl: new RegExp(config.urlPath.replace(/\//g, '\\/')),
            expectedHeading: new RegExp(`create.*${config.displayName.split(' ')[0]}`, 'i'),
        },
        {
            description: `unauthenticated user cannot access ${config.displayName} create page`,
            targetUrl: config.urlPath,
            isAuthenticated: false,
            expectedRedirectUrl: /\/users\/login/,
        },
    ];
}

/**
 * Generate dashboard empty state test data for an entity
 */
export function generateDashboardEmptyStateData(entityType: EntityType) {
    const config = entityConfigs[entityType];
    return [
        {
            description: `${config.displayName} dashboard shows empty state for new user`,
            accordionId: config.accordionId,
            buttonText: new RegExp(`your ${config.displayNamePlural}`, 'i'),
            expectedEmptyText: config.emptyStatePattern,
        },
    ];
}

/**
 * Generate form validation test data for an entity
 */
export function generateFormValidationData(entityType: EntityType) {
    const config = entityConfigs[entityType];
    return [
        {
            description: `${config.displayName} form validates required fields`,
            titleFieldName: 'title',
            expectedRequiredAttribute: true,
            checkHtml5Validation: true,
        },
    ];
}
