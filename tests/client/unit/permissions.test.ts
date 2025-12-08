// tests/client/unit/permissions.test.ts
// Unit tests for core/permissions.ts utilities
import {
    jsonReviver,
    loadPerms,
    getPerms,
    requireEntityPerm,
    requireItemPerm,
    requireEntityPermsForForm,
} from '../../../src/public/js/core/permissions';

describe('permissions utilities', () => {
    beforeEach(() => {
        // Reset window.Surveyor before each test
        window.Surveyor = {
            rawPermissions: undefined,
            permissions: undefined,
        };
    });

    describe('jsonReviver', () => {
        test('restores Map from serialized data', () => {
            const serialized = {
                dataType: 'Map',
                value: [['key1', 'value1'], ['key2', 'value2']],
            };
            const result = jsonReviver('test', serialized);
            expect(result).toBeInstanceOf(Map);
            expect(result.get('key1')).toBe('value1');
            expect(result.get('key2')).toBe('value2');
        });

        test('returns value unchanged if not a Map', () => {
            expect(jsonReviver('test', 'string')).toBe('string');
            expect(jsonReviver('test', 123)).toBe(123);
            expect(jsonReviver('test', null)).toBeNull();
        });

        test('returns value unchanged for non-Map objects', () => {
            const obj = { foo: 'bar' };
            expect(jsonReviver('test', obj)).toBe(obj);
        });
    });

    describe('loadPerms', () => {
        test('loads and restores permissions from window.Surveyor.rawPermissions', () => {
            const mockPermData = {
                entity: {
                    mask: 15,
                    parentMask: 0,
                    bits: { MANAGE_ASSIGNMENTS: true, VIEW_DETAILS: true },
                },
                items: {
                    dataType: 'Map',
                    value: [],
                },
            };
            window.Surveyor.rawPermissions = JSON.stringify(mockPermData);
            
            loadPerms();
            
            const perms = getPerms();
            expect(perms).toBeDefined();
            expect(perms?.entity).toBeDefined();
            expect(perms?.entity.mask).toBe(15);
        });

        test('does nothing if rawPermissions is undefined', () => {
            window.Surveyor.rawPermissions = undefined;
            
            loadPerms();
            
            const perms = getPerms();
            expect(perms).toBeUndefined();
        });
    });

    describe('getPerms', () => {
        test('returns permissions from window.Surveyor', () => {
            const mockPerms = { entity: { mask: 15 } };
            window.Surveyor.permissions = mockPerms as any;
            
            expect(getPerms()).toBe(mockPerms);
        });

        test('returns undefined if permissions not set', () => {
            window.Surveyor.permissions = undefined;
            
            expect(getPerms()).toBeUndefined();
        });
    });

    describe('requireEntityPerm', () => {
        test('does not throw when permission exists', () => {
            window.Surveyor.permissions = {
                entity: {
                    mask: 15,
                    parentMask: 0,
                    has: (key: string) => key === 'MANAGE_ASSIGNMENTS',
                    allow: jest.fn(),
                    all: jest.fn(),
                    any: jest.fn(),
                    bits: { MANAGE_ASSIGNMENTS: true },
                },
                items: new Map(),
                item: jest.fn(),
                itemHas: jest.fn(),
                itemAllow: jest.fn(),
            };
            
            expect(() => {
                requireEntityPerm('MANAGE_ASSIGNMENTS', 'test action');
            }).not.toThrow();
        });

        test('throws when permission does not exist', () => {
            window.Surveyor.permissions = {
                entity: {
                    mask: 0,
                    parentMask: 0,
                    has: () => false,
                    allow: jest.fn(),
                    all: jest.fn(),
                    any: jest.fn(),
                    bits: {},
                },
                items: new Map(),
                item: jest.fn(),
                itemHas: jest.fn(),
                itemAllow: jest.fn(),
            };
            
            expect(() => {
                requireEntityPerm('MANAGE_ASSIGNMENTS', 'test action');
            }).toThrow('You need Manage Assignments permission to test action.');
        });

        test('throws when permissions are not loaded', () => {
            window.Surveyor.permissions = undefined;
            
            expect(() => {
                requireEntityPerm('MANAGE_ASSIGNMENTS', 'test action');
            }).toThrow('Permission data is missing');
        });

        test('formats permission key in error message', () => {
            window.Surveyor.permissions = {
                entity: {
                    mask: 0,
                    parentMask: 0,
                    has: () => false,
                    allow: jest.fn(),
                    all: jest.fn(),
                    any: jest.fn(),
                    bits: {},
                },
                items: new Map(),
                item: jest.fn(),
                itemHas: jest.fn(),
                itemAllow: jest.fn(),
            };
            
            expect(() => {
                requireEntityPerm('VIEW_PARTICIPANT_DETAILS', 'view details');
            }).toThrow('You need View Participant Details permission to view details.');
        });
    });

    describe('requireItemPerm', () => {
        test('does not throw when item permission exists', () => {
            window.Surveyor.permissions = {
                entity: {
                    mask: 15,
                    parentMask: 0,
                    has: jest.fn(),
                    allow: jest.fn(),
                    all: jest.fn(),
                    any: jest.fn(),
                    bits: {},
                },
                items: new Map(),
                item: jest.fn(),
                itemHas: jest.fn(),
                itemAllow: (id: string, key: string) => id === 'item1' && key === 'EDIT',
            };
            
            expect(() => {
                requireItemPerm('item1', 'EDIT', 'edit item');
            }).not.toThrow();
        });

        test('throws when item permission does not exist', () => {
            window.Surveyor.permissions = {
                entity: {
                    mask: 0,
                    parentMask: 0,
                    has: jest.fn(),
                    allow: jest.fn(),
                    all: jest.fn(),
                    any: jest.fn(),
                    bits: {},
                },
                items: new Map(),
                item: jest.fn(),
                itemHas: jest.fn(),
                itemAllow: () => false,
            };
            
            expect(() => {
                requireItemPerm('item1', 'EDIT', 'edit item');
            }).toThrow('You need Edit permission to edit item.');
        });

        test('throws when item ID is missing', () => {
            window.Surveyor.permissions = {
                entity: {
                    mask: 0,
                    parentMask: 0,
                    has: jest.fn(),
                    allow: jest.fn(),
                    all: jest.fn(),
                    any: jest.fn(),
                    bits: {},
                },
                items: new Map(),
                item: jest.fn(),
                itemHas: jest.fn(),
                itemAllow: jest.fn(),
            };
            
            expect(() => {
                requireItemPerm('', 'EDIT', 'edit item');
            }).toThrow('Missing item context for permission check');
        });

        test('uses parent permission when provided', () => {
            window.Surveyor.permissions = {
                entity: {
                    mask: 0,
                    parentMask: 0,
                    has: jest.fn(),
                    allow: jest.fn(),
                    all: jest.fn(),
                    any: jest.fn(),
                    bits: {},
                },
                items: new Map(),
                item: jest.fn(),
                itemHas: jest.fn(),
                itemAllow: () => false,
            };
            
            expect(() => {
                requireItemPerm('item1', 'EDIT', 'edit item', 'MANAGE');
            }).toThrow('You need Manage permission to edit item.');
        });
    });

    describe('requireEntityPermsForForm', () => {
        test('does not throw when required permissions exist', () => {
            window.Surveyor.permissions = {
                entity: {
                    mask: 15,
                    parentMask: 0,
                    has: () => true,
                    allow: jest.fn(),
                    all: jest.fn(),
                    any: jest.fn(),
                    bits: { MANAGE_ASSIGNMENTS: true },
                },
                items: new Map(),
                item: jest.fn(),
                itemHas: jest.fn(),
                itemAllow: jest.fn(),
            };
            
            const formData = new FormData();
            formData.set('title', 'New Title');
            
            const rules = [
                { perm: 'MANAGE_ASSIGNMENTS' as any, action: 'update title', fields: ['title'] },
            ];
            
            expect(() => {
                requireEntityPermsForForm(formData, rules);
            }).not.toThrow();
        });

        test('throws when required field permission is missing', () => {
            window.Surveyor.permissions = {
                entity: {
                    mask: 0,
                    parentMask: 0,
                    has: () => false,
                    allow: jest.fn(),
                    all: jest.fn(),
                    any: jest.fn(),
                    bits: {},
                },
                items: new Map(),
                item: jest.fn(),
                itemHas: jest.fn(),
                itemAllow: jest.fn(),
            };
            
            const formData = new FormData();
            formData.set('title', 'New Title');
            
            const rules = [
                { perm: 'MANAGE_ASSIGNMENTS' as any, action: 'update title', fields: ['title'] },
            ];
            
            expect(() => {
                requireEntityPermsForForm(formData, rules);
            }).toThrow('You need Manage Assignments permission to update title.');
        });

        test('does not throw when field is not in form data', () => {
            window.Surveyor.permissions = {
                entity: {
                    mask: 0,
                    parentMask: 0,
                    has: () => false,
                    allow: jest.fn(),
                    all: jest.fn(),
                    any: jest.fn(),
                    bits: {},
                },
                items: new Map(),
                item: jest.fn(),
                itemHas: jest.fn(),
                itemAllow: jest.fn(),
            };
            
            const formData = new FormData();
            formData.set('description', 'New Description');
            
            const rules = [
                { perm: 'MANAGE_ASSIGNMENTS' as any, action: 'update title', fields: ['title'] },
            ];
            
            expect(() => {
                requireEntityPermsForForm(formData, rules);
            }).not.toThrow();
        });

        test('uses predicate when provided', () => {
            window.Surveyor.permissions = {
                entity: {
                    mask: 0,
                    parentMask: 0,
                    has: () => false,
                    allow: jest.fn(),
                    all: jest.fn(),
                    any: jest.fn(),
                    bits: {},
                },
                items: new Map(),
                item: jest.fn(),
                itemHas: jest.fn(),
                itemAllow: jest.fn(),
            };
            
            const formData = new FormData();
            formData.set('special', 'value');
            
            const rules = [
                {
                    perm: 'MANAGE_ASSIGNMENTS' as any,
                    action: 'update special field',
                    predicate: (fd: FormData) => fd.has('special'),
                },
            ];
            
            expect(() => {
                requireEntityPermsForForm(formData, rules);
            }).toThrow('You need Manage Assignments permission to update special field.');
        });
    });
});
