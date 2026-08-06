/**
 * Unit tests for timebox utilities
 * Uses data-driven testing approach with test data in tests/data/unit/timeboxData.ts
 */

import {compareSlotsByDayAndTime, parseTimeToMinutes, slotsOverlap} from '../../../src/modules/activity/timebox';

// Import test data
import {parseTimeToMinutesData, compareSlotsData, slotsOverlapData} from '../../data/unit/timeboxData';

// Import test keywords
import {verifyResult} from '../../keywords/common/controllerKeywords';

describe('modules/activity/timebox - Data Driven', () => {
    describe('parseTimeToMinutes', () => {
        test.each(parseTimeToMinutesData)(
            '$description',
            ({input, expected}) => {
                const result = parseTimeToMinutes(input as any);
                verifyResult(result, expected);
            }
        );
    });

    describe('compareSlotsByDayAndTime', () => {
        test(compareSlotsData.description, () => {
            const sorted = [...compareSlotsData.unsorted].sort(compareSlotsByDayAndTime);
            verifyResult(sorted, compareSlotsData.expected);
        });
    });

    describe('slotsOverlap', () => {
        test.each(slotsOverlapData)(
            '$description',
            ({slotA, slotB, expected}) => {
                const result = slotsOverlap(slotA, slotB);
                verifyResult(result, expected);
            }
        );
    });
});
