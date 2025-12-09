/**
 * Test data for stub.ts module
 * Data-driven test approach following repository patterns
 */

import {deepCopy} from "../helpers/util";

export interface StubTestData {
    description: string;
    windowSurveyorExists: boolean;
    expectedCalls: {
        setCurrentNavLocation: number;
        loadPerms: number;
    };
}

const _stubInitTestData: StubTestData[] = [
    {
        description: 'should initialize with navigation and permissions',
        windowSurveyorExists: true,
        expectedCalls: {
            setCurrentNavLocation: 1,
            loadPerms: 1
        }
    }
];

export const stubInitTestData = () => deepCopy(_stubInitTestData) as typeof _stubInitTestData;
