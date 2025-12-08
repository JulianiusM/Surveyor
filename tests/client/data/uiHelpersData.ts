/**
 * Test data for UI helpers utilities
 * Data-driven test cases for UI component builders
 */

/**
 * Test cases for createBadge function
 */
export const createBadgeData = [
    {
        description: 'creates success badge',
        input: { status: 'active' },
        expectedClass: 'text-bg-success',
        expectedText: 'active',
    },
    {
        description: 'creates warning badge',
        input: { status: 'consumed' },
        expectedClass: 'text-bg-warning',
        expectedText: 'consumed',
    },
    {
        description: 'creates danger badge',
        input: { status: 'revoked' },
        expectedClass: 'text-bg-danger',
        expectedText: 'revoked',
    },
    {
        description: 'creates secondary badge for unknown status',
        input: { status: 'unknown' },
        expectedClass: 'text-bg-secondary',
        expectedText: 'unknown',
    },
    {
        description: 'handles case-insensitive status',
        input: { status: 'SUCCESS' },
        expectedClass: 'text-bg-success',
        expectedText: 'SUCCESS',
    },
];

/**
 * Test cases for createChip function
 */
export const createChipData = [
    {
        description: 'creates default chip',
        input: { text: 'Tag' },
        expectedClass: 'text-bg-secondary',
        expectedText: 'Tag',
    },
    {
        description: 'creates primary chip',
        input: { text: 'Primary', variant: 'primary' },
        expectedClass: 'text-bg-primary',
        expectedText: 'Primary',
    },
    {
        description: 'creates danger chip',
        input: { text: 'Important', variant: 'danger' },
        expectedClass: 'text-bg-danger',
        expectedText: 'Important',
    },
];

/**
 * Test cases for createDietaryChip function
 */
export const createDietaryChipData = [
    {
        description: 'creates danger chip for allergies',
        input: { choice: 'ALLERGIES' },
        expectedClass: 'text-bg-danger',
        expectedText: 'ALLERGIES',
    },
    {
        description: 'creates secondary chip for vegetarian',
        input: { choice: 'VEGETARIAN' },
        expectedClass: 'text-bg-secondary',
        expectedText: 'VEGETARIAN',
    },
    {
        description: 'creates secondary chip for vegan',
        input: { choice: 'VEGAN' },
        expectedClass: 'text-bg-secondary',
        expectedText: 'VEGAN',
    },
];

/**
 * Test cases for parseJsonScript function
 */
export const parseJsonScriptData = [
    {
        description: 'parses valid JSON from script tag',
        scriptId: 'test-json',
        scriptContent: '{"key": "value", "num": 42}',
        expected: { key: 'value', num: 42 },
    },
    {
        description: 'returns null for non-existent script',
        scriptId: 'non-existent',
        scriptContent: null,
        expected: null,
    },
    {
        description: 'returns null for empty script',
        scriptId: 'empty-script',
        scriptContent: '',
        expected: null,
    },
    {
        description: 'returns null for invalid JSON',
        scriptId: 'invalid-json',
        scriptContent: '{invalid json}',
        expected: null,
    },
];

/**
 * Test cases for formatDuration function
 */
export const formatDurationData = [
    {
        description: 'formats days, hours, and minutes',
        input: { ms: 2 * 24 * 60 * 60 * 1000 + 3 * 60 * 60 * 1000 + 45 * 60 * 1000 },
        expected: '2d 3h 45m',
    },
    {
        description: 'handles zero or negative values',
        input: { ms: 0 },
        expected: 'closed',
    },
    {
        description: 'handles negative duration',
        input: { ms: -1000 },
        expected: 'closed',
    },
    {
        description: 'formats less than one day',
        input: { ms: 5 * 60 * 60 * 1000 + 30 * 60 * 1000 },
        expected: '0d 5h 30m',
    },
    {
        description: 'formats exactly one day',
        input: { ms: 24 * 60 * 60 * 1000 },
        expected: '1d 0h 0m',
    },
];
