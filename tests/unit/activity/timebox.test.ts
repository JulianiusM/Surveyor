import {compareSlotsByDayAndTime, parseTimeToMinutes, slotsOverlap} from '../../../src/modules/activity/timebox';

const makeSlot = (overrides: Partial<{ day: string; startTime: string | null; endTime: string | null; pos: number | null }>) => ({
    day: '2025-01-31',
    startTime: null,
    endTime: null,
    pos: 0,
    ...overrides,
});

describe('modules/activity/timebox', () => {
    describe('parseTimeToMinutes', () => {
        const cases = [
            {input: '08:30', expected: 510},
            {input: '08:30:30', expected: 510.5},
            {input: null, expected: null},
            {input: 'invalid', expected: null},
        ];

        test.each(cases)('parses %s', ({input, expected}) => {
            expect(parseTimeToMinutes(input as any)).toBe(expected);
        });
    });

    describe('compareSlotsByDayAndTime', () => {
        test('orders by day, then start time, then position', () => {
            const slots = [
                makeSlot({day: '2025-02-01', pos: 2}),
                makeSlot({startTime: '09:00', pos: 1}),
                makeSlot({startTime: null, pos: 0}),
                makeSlot({startTime: '08:00', pos: 5}),
            ];

            const sorted = [...slots].sort(compareSlotsByDayAndTime);
            expect(sorted).toEqual([
                makeSlot({startTime: '08:00', pos: 5}),
                makeSlot({startTime: '09:00', pos: 1}),
                makeSlot({startTime: null, pos: 0}),
                makeSlot({day: '2025-02-01', pos: 2}),
            ]);
        });
    });

    describe('slotsOverlap', () => {
        test('detects overlap on same day', () => {
            const slotA = makeSlot({startTime: '09:00', endTime: '10:00'});
            const slotB = makeSlot({startTime: '09:30', endTime: '10:30'});

            expect(slotsOverlap(slotA, slotB)).toBe(true);
        });

        test('returns false for touching boundaries', () => {
            const slotA = makeSlot({startTime: '10:00', endTime: '11:00'});
            const slotB = makeSlot({startTime: '11:00', endTime: '12:00'});

            expect(slotsOverlap(slotA, slotB)).toBe(false);
        });

        test('returns false when times are missing or days differ', () => {
            const slotWithMissingTimes = makeSlot({startTime: '09:00'});
            const slotWithDifferentDay = makeSlot({day: '2025-02-01', startTime: '09:30', endTime: '10:30'});
            const completeSlot = makeSlot({startTime: '09:30', endTime: '10:30'});

            expect(slotsOverlap(slotWithMissingTimes, completeSlot)).toBe(false);
            expect(slotsOverlap(completeSlot, slotWithMissingTimes)).toBe(false);
            expect(slotsOverlap(completeSlot, slotWithDifferentDay)).toBe(false);
        });
    });
});
