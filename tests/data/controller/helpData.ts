// Test data for help controller tests
export const helpDocsList = [
    {
        name: 'GETTING_STARTED.md',
        title: 'Getting Started with Surveyor',
        path: 'getting_started',
    },
    {
        name: 'DASHBOARD.md',
        title: 'Dashboard',
        path: 'dashboard',
    },
    {
        name: 'SURVEYS.md',
        title: 'Surveys',
        path: 'surveys',
    },
];

export const helpIndexData = [
    {
        description: 'should render help index with README content',
        expectedTitle: 'Surveyor User Guide',
        expectedDocsCount: 9, // Number of docs in user-guide directory
    },
];

export const helpDocData = [
    {
        description: 'should render getting started doc',
        docName: 'getting_started',
        expectedTitle: 'Getting Started with Surveyor',
        expectedStatus: 200,
    },
    {
        description: 'should render dashboard doc',
        docName: 'dashboard',
        expectedTitle: 'Dashboard',
        expectedStatus: 200,
    },
    {
        description: 'should handle non-existent doc',
        docName: 'nonexistent',
        expectedStatus: 404,
    },
    {
        description: 'should prevent path traversal',
        docName: '../../../package',
        expectedStatus: 404,
    },
];
