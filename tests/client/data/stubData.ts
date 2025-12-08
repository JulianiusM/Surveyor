/**
 * Test data for stub.ts module
 * Data-driven test approach following repository patterns
 */

export interface StubTestData {
    description: string;
    windowSurveyorExists: boolean;
    expectedCalls: {
        setCurrentNavLocation: number;
        loadPerms: number;
    };
}

export const stubInitTestData: StubTestData[] = [
    {
        description: 'should initialize with navigation and permissions',
        windowSurveyorExists: true,
        expectedCalls: {
            setCurrentNavLocation: 1,
            loadPerms: 1
        }
    }
];
