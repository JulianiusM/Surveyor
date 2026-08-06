/**
 * Common mock configurations shared across controller tests
 */

export const ENTITIES_MOCK = {
    ACTIVITY: 'activity',
    DRIVERS: 'drivers',
    EVENT: 'event',
    PACKING: 'packing',
    SURVEY: 'survey',
};

export const mockUtil = (overrides = {}) => ({
    generateUniqueId: jest.fn(() => 'uid-xyz'),
    ENTITIES: ENTITIES_MOCK,
    convertToSingleList: jest.fn(() => []),
    normalizeToArray: jest.fn(normalizeToArray),
    convertToAgent: jest.fn(() => {
    }),
    ...overrides,
});

export const mockPermissionEngine = () => ({
    saveDefaultPermsFromBody: jest.fn(),
    can: jest.fn(),
});

function normalizeToArray<A>(thing: A | A[], fallback: A[] = []) {
    let arr: A[] = fallback;
    if (Array.isArray(thing)) {
        arr = thing;
    } else if (thing) {
        arr = [thing];
    }

    return arr;
}