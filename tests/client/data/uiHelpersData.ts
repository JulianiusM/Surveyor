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
