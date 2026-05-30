import { PERM } from '../../src/modules/lib/permissions';

const apiParamHandler = jest.fn();
const requirePermissionApi = jest.fn(() => (_req: any, _res: any, next: any) => next());
const requireItemPermissionApi = jest.fn(() => (_req: any, _res: any, next: any) => next());
const attachPermBundle = jest.fn(() => (_req: any, _res: any, next: any) => next());
const attachAssignRoutes = jest.fn();
const createEntityAdminApiRouter = jest.fn();

jest.mock('../../src/middleware/paramHandler', () => ({
    apiParamHandler: (...args: any[]) => apiParamHandler(...args),
}));

jest.mock('../../src/middleware/permissionMiddleware', () => ({
    attachPermBundle: (...args: any[]) => attachPermBundle(...args),
    requirePermissionApi: (...args: any[]) => requirePermissionApi(...args),
    requireItemPermissionApi: (...args: any[]) => requireItemPermissionApi(...args),
}));

jest.mock('../../src/middleware/assignFlowFactory', () => ({
    attachAssignRoutes: (...args: any[]) => attachAssignRoutes(...args),
}));

jest.mock('../../src/middleware/adminApiFactory', () => ({
    createEntityAdminApiRouter: (...args: any[]) => createEntityAdminApiRouter(...args),
}));

jest.mock('../../src/modules/database/services/PackingService', () => ({
    getPackingListById: jest.fn(),
    getPackingItemById: jest.fn(),
    getPackingAssignmentById: jest.fn(),
    getPackingItems: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../src/controller/packingController', () => ({
    __esModule: true,
    default: {
        updateDescription: jest.fn(),
        getAssignmentAccessMapping: jest.fn(() => ({})),
        reorderItems: jest.fn(),
        quickAddItem: jest.fn(),
        updateItemDescription: jest.fn(),
        updateItemAttr: jest.fn(),
        updateRequired: jest.fn(),
        deleteAssignment: jest.fn(),
        updateSettings: jest.fn(),
        deleteItem: jest.fn(),
    },
}));

jest.mock('../../src/modules/renderer', () => ({
    __esModule: true,
    default: {
        respondWithSuccessJson: jest.fn(),
    },
}));

describe('packing API route permission wiring', () => {
    beforeEach(() => {
        jest.resetModules();
        apiParamHandler.mockClear();
        requirePermissionApi.mockClear();
        requireItemPermissionApi.mockClear();
    });

    it('registers item param under packingItem and enforces item-level delete permission', async () => {
        await import('../../src/routes/api/packing');

        const itemParamCall = apiParamHandler.mock.calls.find((call) => call[0] === 'itemId');
        expect(itemParamCall?.[3]).toBe('packingItem');

        expect(requireItemPermissionApi).toHaveBeenCalledWith(expect.any(Function), PERM.ITEM_DELETE, PERM.ITEM_DELETE);
        expect(requirePermissionApi).not.toHaveBeenCalledWith(expect.any(Function), PERM.ITEM_DELETE);
    });
});
