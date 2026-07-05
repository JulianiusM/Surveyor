/**
 * Test data for user-dashboard.ts module
 * Data-driven test approach following repository patterns
 */

import {deepCopy} from "../helpers/util";

export interface UserDashboardTestData {
    description: string;
    expectedCalls: {
        setCurrentNavLocation: number;
        loadPerms: number;
        initEntityLists: number;
        initEntityOverview: number;
    };
}

const _userDashboardInitTestData: UserDashboardTestData[] = [
    {
        description: 'should initialize with navigation, permissions, and entity lists',
        expectedCalls: {
            setCurrentNavLocation: 1,
            loadPerms: 1,
            initEntityLists: 0,
            initEntityOverview: 2
        }
    }
];

export const userDashboardInitTestData = () => deepCopy(_userDashboardInitTestData) as typeof _userDashboardInitTestData;

const _userDashboardCallOrderData = {
    description: 'should call functions in correct order',
    expectedOrder: ['setCurrentNavLocation', 'loadPerms', 'initEntityOverview', 'initEntityOverview']
};

export const userDashboardCallOrderData = () => deepCopy(_userDashboardCallOrderData) as typeof _userDashboardCallOrderData;
