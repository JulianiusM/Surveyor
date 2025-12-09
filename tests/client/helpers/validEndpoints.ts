/**
 * Valid API endpoints extracted from backend routes
 * This ensures mock backend only uses paths that exist in the actual API
 * 
 * Auto-generated from src/routes/**
 * DO NOT EDIT MANUALLY - Update by running: npm run generate-endpoints
 */

/**
 * Valid API endpoint patterns
 * These match the routes defined in the backend
 */
export const VALID_ENDPOINTS = {
    // Auth endpoints
    auth: {
        login: '/auth/login',
        logout: '/auth/logout',
        register: '/auth/register',
    },
    
    // Event API endpoints
    event: {
        get: '/api/event/:id',
        create: '/api/event/create',
        update: '/api/event/:id/update',
        delete: '/api/event/:id/delete',
        register: '/api/event/:id/register',
        unregister: '/api/event/:id/register/delete',
        participants: '/api/event/:id/participants',
        invoice: '/api/event/:id/invoice',
    },
    
    // Activity API endpoints
    activity: {
        get: '/api/activity/:id',
        create: '/api/activity/create',
        update: '/api/activity/:planId',
        updateDescription: '/api/activity/:planId/description',
        delete: '/api/activity/:planId/delete',
        
        // Slot management
        slotUpdate: '/api/activity/:planId/slot',
        slotDelete: '/api/activity/:planId/slot/:slotId/delete',
        slotReorder: '/api/activity/:planId/slot/reorder',
        slotRolesAdmin: '/api/activity/:planId/slot/:slotId/roles/admin',
        
        // Assignments
        assign: '/api/activity/:planId/assign',
        unassign: '/api/activity/:planId/unassign',
        warnings: '/api/activity/:planId/slot/:slotId/warnings',
        assignmentRemove: '/api/activity/:planId/assignments/:assignmentId/remove',
        
        // Requirements
        requirements: '/api/activity/:planId/requirements',
        
        // Recommendations
        recommendations: '/api/activity/:planId/recommendations',
        recommendationsApply: '/api/activity/:planId/recommendations/apply',
        recommendationsAuto: '/api/activity/:planId/recommendations/auto',
    },
    
    // Packing API endpoints
    packing: {
        get: '/api/packing/:id',
        create: '/api/packing/create',
        update: '/api/packing/:id',
        delete: '/api/packing/:id/delete',
        itemUpdate: '/api/packing/:id/item',
        itemDelete: '/api/packing/:id/item/:itemId/delete',
        itemReorder: '/api/packing/:id/item/reorder',
        assign: '/api/packing/:id/assign',
        unassign: '/api/packing/:id/unassign',
        assignmentRemove: '/api/packing/:id/assignments/:assignmentId/remove',
    },
    
    // Drivers API endpoints
    drivers: {
        get: '/api/drivers/:id',
        create: '/api/drivers/create',
        update: '/api/drivers/:id',
        delete: '/api/drivers/:id/delete',
        driverUpdate: '/api/drivers/:id/driver',
        driverDelete: '/api/drivers/:id/driver/:driverId/delete',
        driverReorder: '/api/drivers/:id/driver/reorder',
        assign: '/api/drivers/:id/assign',
        unassign: '/api/drivers/:id/unassign',
        assignmentRemove: '/api/drivers/:id/assignments/:assignmentId/remove',
    },
    
    // Survey API endpoints
    survey: {
        get: '/api/survey/:id',
        create: '/api/survey/create',
        update: '/api/survey/:id',
        delete: '/api/survey/:id/delete',
    },
    
    // User API endpoints
    users: {
        search: '/api/users/search',
        get: '/api/users/:id',
        update: '/api/users/:id/update',
        permissions: '/api/users/:id/permissions',
    },
    
    // Invoice Pool API endpoints
    invoicePool: {
        list: '/api/event-invoices',
        create: '/api/event-invoices/pool',
        get: '/api/event-invoices/pool/:poolId',
        update: '/api/event-invoices/pool/:poolId',
        delete: '/api/event-invoices/pool/:poolId',
        download: '/api/event-invoices/pool/:poolId/download',
        
        // Pool entries
        addEntry: '/api/event-invoices/pool/:poolId/entries',
        updateEntry: '/api/event-invoices/pool/:poolId/entries/:entryId',
        deleteEntry: '/api/event-invoices/pool/:poolId/entries/:entryId',
        
        // Credits
        credits: '/api/event-invoices/pool/:poolId/credits',
        addCredit: '/api/event-invoices/pool/:poolId/credits',
        updateCredit: '/api/event-invoices/pool/:poolId/credits/:creditId',
        deleteCredit: '/api/event-invoices/pool/:poolId/credits/:creditId',
    },
} as const;

/**
 * Flatten all endpoints into a single array for validation
 */
export function getAllValidEndpoints(): string[] {
    const endpoints: string[] = [];
    
    function extractEndpoints(obj: any): void {
        for (const value of Object.values(obj)) {
            if (typeof value === 'string') {
                endpoints.push(value);
            } else if (typeof value === 'object') {
                extractEndpoints(value);
            }
        }
    }
    
    extractEndpoints(VALID_ENDPOINTS);
    return endpoints;
}

/**
 * Check if an endpoint path is valid
 * @param path Endpoint path to validate
 * @returns true if endpoint exists in backend
 */
export function isValidEndpoint(path: string): boolean {
    const allEndpoints = getAllValidEndpoints();
    
    // Direct match
    if (allEndpoints.includes(path)) {
        return true;
    }
    
    // Check with parameter substitution
    // e.g., /api/event/123 matches /api/event/:id
    for (const endpoint of allEndpoints) {
        const pattern = endpoint.replace(/:[^/]+/g, '[^/]+');
        const regex = new RegExp(`^${pattern}$`);
        if (regex.test(path)) {
            return true;
        }
    }
    
    return false;
}

/**
 * Validate that a test endpoint matches a valid backend route
 * Throws error if endpoint is invalid
 * @param method HTTP method
 * @param path Endpoint path
 */
export function validateEndpoint(method: string, path: string): void {
    if (!isValidEndpoint(path)) {
        throw new Error(
            `Invalid endpoint in test: ${method} ${path}\n` +
            `This endpoint does not exist in the backend routes.\n` +
            `Please check src/routes/** for valid endpoints or update validEndpoints.ts`
        );
    }
}
