/**
 * Test data for user-dashboard.ts module
 * Data-driven test approach following repository patterns
 */

export interface UserDashboardTestData {
    description: string;
    expectedCalls: {
        setCurrentNavLocation: number;
        loadPerms: number;
        initEntityLists: number;
    };
}

export const userDashboardInitTestData: UserDashboardTestData[] = [
    {
        description: 'should initialize with navigation, permissions, and entity lists',
        expectedCalls: {
            setCurrentNavLocation: 1,
            loadPerms: 1,
            initEntityLists: 1
        }
    }
];

export const userDashboardCallOrderData = {
    description: 'should call functions in correct order',
    expectedOrder: ['setCurrentNavLocation', 'loadPerms', 'initEntityLists']
};
