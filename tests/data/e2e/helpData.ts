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
