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
    };
}

const _userDashboardInitTestData: UserDashboardTestData[] = [
    {
        description: 'should initialize with navigation, permissions, and entity lists',
        expectedCalls: {
            setCurrentNavLocation: 1,
            loadPerms: 1,
            initEntityLists: 1
        }
    }
];

export const userDashboardInitTestData = () => deepCopy(_userDashboardInitTestData) as typeof _userDashboardInitTestData;

const _userDashboardCallOrderData = {
    description: 'should call functions in correct order',
    expectedOrder: ['setCurrentNavLocation', 'loadPerms', 'initEntityLists']
};

export const userDashboardCallOrderData = () => deepCopy(_userDashboardCallOrderData) as typeof _userDashboardCallOrderData;
