/**
 * Test data for timezone-select.ts
 * Data-driven test cases for timezone selection UI
 */

export const timezoneSelectInitData = [
    {
        description: 'should initialize with provided timezone',
        id: 1,
        opts: { value: 'Europe/Berlin', refDateIso: '2024-01-15T12:00:00Z' },
        expectedZone: 'Europe/Berlin',
        expectedLabelContains: 'Europe/Berlin',
    },
    {
        description: 'should handle custom common timezones',
        id: 3,
        opts: {
            value: 'Asia/Tokyo',
            common: ['Asia/Tokyo', 'America/New_York', 'Europe/London'],
        },
        expectedZone: 'Asia/Tokyo',
        expectedCommonCount: 3,
    },
];

export const timezoneSelectSetZoneData = [
    {
        description: 'should set valid timezone',
        zone: 'America/New_York',
        shouldSet: true,
    },
    {
        description: 'should ignore invalid timezone',
        zone: 'Invalid/Timezone',
        shouldSet: false,
    },
    {
        description: 'should ignore empty timezone',
        zone: '',
        shouldSet: false,
    },
];

export const timezoneSelectFilterData = [
    {
        description: 'should filter by query "london"',
        query: 'london',
        expectedMatches: ['Europe/London'],
    },
    {
        description: 'should filter by query "america"',
        query: 'america',
        expectedMatches: ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Sao_Paulo'],
    },
    {
        description: 'should show all zones with empty query',
        query: '',
        expectedMatchesAll: true,
    },
    {
        description: 'should show "No matches" for non-existent zone',
        query: 'NonExistentZone',
        expectedNoMatches: true,
    },
];
