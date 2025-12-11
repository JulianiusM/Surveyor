// Test data for help E2E tests
export const helpNavigationData = [
    {
        description: 'should navigate to help from navbar',
        navLinkText: 'Help',
        expectedUrl: '/help',
        expectedHeading: 'Surveyor User Guide',
    },
];

export const helpDocsData = [
    {
        description: 'should display Getting Started doc',
        docName: 'getting_started',
        expectedTitle: 'Getting Started with Surveyor',
    },
    {
        description: 'should display Surveys doc',
        docName: 'surveys',
        expectedTitle: 'Surveys',
    },
    {
        description: 'should display Activity Plans doc',
        docName: 'activity_plans',
        expectedTitle: 'Activity Plans',
    },
];

export const helpButtonData = [
    {
        description: 'help button on survey create page',
        createUrl: '/survey/create',
        helpUrl: '/help/surveys',
    },
    {
        description: 'help button on activity create page',
        createUrl: '/activity/create',
        helpUrl: '/help/activity_plans',
    },
    {
        description: 'help button on packing create page',
        createUrl: '/packing/create',
        helpUrl: '/help/packing_lists',
    },
    {
        description: 'help button on drivers create page',
        createUrl: '/drivers/create',
        helpUrl: '/help/drivers_lists',
    },
];
