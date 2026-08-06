import {buildPermBundle, can} from '../../src/modules/permissionEngine';
import {PERM} from '../../src/modules/lib/permissions';
import * as entityAdminService from '../../src/modules/database/services/EntityAdminService';

jest.mock('../../src/modules/database/services/EntityAdminService', () => ({
    getUserPerms: jest.fn(),
    getDefaultPerms: jest.fn().mockResolvedValue({}),
    updatePerms: jest.fn(),
}));

jest.mock('../../src/modules/database/services/EventService', () => ({
    isRegisteredForEvent: jest.fn().mockResolvedValue(false),
}));

describe('item description parent permission', () => {
    const getUserPerms = entityAdminService.getUserPerms as jest.Mock;

    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('can allows description edits when parent has ITEM_EDIT_DESC', async () => {
        getUserPerms.mockImplementation((_type: string, id: string) =>
            id === 'parent-1' ? PERM.ITEM_EDIT_DESC : 0
        );

        const subject = {
            kind: 'item',
            item: {entityType: 'packingItem', entityId: 'item-1'},
            parent: {entityType: 'packing', entityId: 'parent-1'},
        } as any;

        const result = await can(subject, {user: {id: 42}}, PERM.EDIT_DESC, [PERM.ITEM_EDIT, PERM.ITEM_EDIT_DESC]);

        expect(result).toBe(true);
    });

    test('entity description still requires EDIT_DESC on the entity', async () => {
        getUserPerms.mockResolvedValue(PERM.ITEM_EDIT_DESC);

        const subject = {kind: 'entity', entity: {entityType: 'packing', entityId: 'parent-1'}} as any;

        const result = await can(subject, {user: {id: 42}}, PERM.EDIT_DESC);

        expect(result).toBe(false);
    });

    test('perm bundle allows item descriptions via ITEM_EDIT_DESC fallback', async () => {
        getUserPerms.mockImplementation((_type: string, id: string) =>
            id === 'parent-1' ? PERM.ITEM_EDIT_DESC : 0
        );

        const bundle = await buildPermBundle(
            {entityType: 'packing', entityId: 'parent-1'} as any,
            [{entityType: 'packingItem', entityId: 'item-1'}] as any,
            {user: {id: 42}}
        );

        expect(bundle.itemAllow('item-1', 'EDIT_DESC', ['ITEM_EDIT', 'ITEM_EDIT_DESC'])).toBe(true);
        expect(bundle.entity.has('EDIT_DESC')).toBe(false);
    });
});
