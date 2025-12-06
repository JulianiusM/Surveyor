/**
 * Test data for timebox utility functions
 */

export const parseTimeToMinutesData = [
    {description: 'parses HH:MM format', input: '08:30', expected: 510},
    {description: 'parses HH:MM:SS format with rounding', input: '08:30:30', expected: 511},
    {description: 'returns null for null input', input: null, expected: null},
    {description: 'returns null for invalid format', input: 'invalid', expected: null},
];

export const makeSlot = (overrides: Partial<{day: string; startTime: string | null; endTime: string | null; pos: number | null}>) => ({
    day: '2025-01-31',
    startTime: null,
    endTime: null,
    pos: 0,
    ...overrides,
});

export const compareSlotsData = {
    description: 'orders by day, then start time, then position',
    unsorted: [
        makeSlot({day: '2025-02-01', pos: 2}),
        makeSlot({startTime: '09:00', pos: 1}),
        makeSlot({startTime: null, pos: 0}),
        makeSlot({startTime: '08:00', pos: 5}),
    ],
    expected: [
        makeSlot({startTime: '08:00', pos: 5}),
        makeSlot({startTime: '09:00', pos: 1}),
        makeSlot({startTime: null, pos: 0}),
        makeSlot({day: '2025-02-01', pos: 2}),
    ],
};

export const slotsOverlapData = [
    {
        description: 'detects overlap on same day',
        slotA: makeSlot({startTime: '09:00', endTime: '10:00'}),
        slotB: makeSlot({startTime: '09:30', endTime: '10:30'}),
        expected: true,
    },
    {
        description: 'returns false for touching boundaries',
        slotA: makeSlot({startTime: '10:00', endTime: '11:00'}),
        slotB: makeSlot({startTime: '11:00', endTime: '12:00'}),
        expected: false,
    },
    {
        description: 'returns false when start time is missing',
        slotA: makeSlot({startTime: '09:00'}),
        slotB: makeSlot({startTime: '09:30', endTime: '10:30'}),
        expected: false,
    },
    {
        description: 'returns false when days differ',
        slotA: makeSlot({day: '2025-02-01', startTime: '09:30', endTime: '10:30'}),
        slotB: makeSlot({startTime: '09:30', endTime: '10:30'}),
        expected: false,
    },
];
