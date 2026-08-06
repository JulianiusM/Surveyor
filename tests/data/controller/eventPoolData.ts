/**
 * Test data for eventPoolController unit tests
 */

export const createPoolData = [
    {
        description: 'Create pool with valid data',
        input: {
            name: 'Venue Payment',
            description: 'Payment for venue rental',
            assignAll: true,
        },
        expectedPoolId: 'mock-pool-id',
    },
    {
        description: 'Create pool with minimal data',
        input: {
            name: 'Equipment',
            assignAll: false,
        },
        expectedPoolId: 'mock-pool-id-2',
    },
];

export const assignmentUpdateData = [
    {
        description: 'Add assignment successfully',
        action: 'add',
        registrationId: 1,
        expectedSuccess: true,
    },
    {
        description: 'Remove assignment successfully',
        action: 'remove',
        registrationId: 1,
        expectedSuccess: true,
    },
];

export const invoiceSubmissionData = [
    {
        description: 'Submit invoice with valid data',
        input: {
            amount: 100.50,
            description: 'Venue payment',
        },
        hasFile: true,
        expectedInvoiceId: 1,
    },
    {
        description: 'Submit invoice without proof',
        input: {
            amount: 50,
            description: 'Small expense',
        },
        hasFile: false,
        expectedInvoiceId: 2,
    },
];

export const invoiceApprovalData = [
    {
        description: 'Approve invoice successfully',
        invoiceId: 1,
        mockInvoice: {
            id: 1,
            status: 'NEW',
            amount: 100,
        },
        expectedStatus: 'APPROVED',
    },
];

export const invoiceDeclineData = [
    {
        description: 'Decline invoice with reason',
        invoiceId: 1,
        reason: 'Receipt not clear',
        mockInvoice: {
            id: 1,
            status: 'NEW',
        },
        expectedSuccess: true,
    },
];

export const poolCloseData = [
    {
        description: 'Close pool successfully',
        poolId: 'test-pool-id',
        mockPool: {
            id: 'test-pool-id',
            status: 'OPEN',
            name: 'Test Pool',
        },
        expectedStatus: 'CLOSED',
    },
];

export const surchargeData = [
    {
        description: 'Add surcharge to participant',
        input: {
            amount: 50,
            note: 'Extra equipment',
        },
        registrationId: 1,
        expectedSuccess: true,
    },
];

export const takeoverData = [
    {
        description: 'Add takeover successfully',
        input: {
            payerRegistrationId: 1,
            beneficiaryRegistrationId: 2,
        },
        expectedSuccess: true,
    },
    {
        description: 'Remove takeover successfully',
        input: {
            payerRegistrationId: 1,
            beneficiaryRegistrationId: 2,
        },
        action: 'remove',
        expectedSuccess: true,
    },
];

export const proofCleanupData = [
    {
        description: 'Remove expired proof files',
        poolId: 'test-pool-id',
        mockPool: {
            event: {
                endDate: '2024-01-01',
            },
            invoices: [
                {proofPath: 'old-proof.pdf'},
            ],
        },
        shouldCleanup: true,
    },
    {
        description: 'Keep recent proof files',
        poolId: 'test-pool-id',
        mockPool: {
            event: {
                endDate: new Date().toISOString(),
            },
            invoices: [
                {proofPath: 'recent-proof.pdf'},
            ],
        },
        shouldCleanup: false,
    },
];

export const closeInvoiceData = [
    {
        description: 'submitter can close their own approved invoice',
        invoice: {
            id: 1,
            status: 'APPROVED',
            registration: {id: 5},
        },
        actorRegId: 5,
        permData: {entity: new Map()},
        allowManageOverride: true,
        expectedSuccess: true,
    },
    {
        description: 'admin can close any invoice',
        invoice: {
            id: 2,
            status: 'APPROVED',
            registration: {id: 10},
        },
        actorRegId: 5,
        permData: {entity: new Map([['MANAGE_ASSIGNMENTS', true]])},
        allowManageOverride: true,
        expectedSuccess: true,
    },
    {
        description: 'submitter cannot close unapproved invoice',
        invoice: {
            id: 3,
            status: 'NEW',
            registration: {id: 5},
        },
        actorRegId: 5,
        permData: {entity: new Map()},
        allowManageOverride: true,
        shouldThrow: 'Invoices must be approved before closing',
    },
    {
        description: 'non-submitter cannot close others invoice without admin',
        invoice: {
            id: 4,
            status: 'APPROVED',
            registration: {id: 10},
        },
        actorRegId: 5,
        permData: {entity: new Map()},
        allowManageOverride: true,
        shouldThrow: 'You can only close your own approved invoices, unless you are an administrator.',
    },
    {
        description: 'admin can close unapproved invoice',
        invoice: {
            id: 5,
            status: 'NEW',
            registration: {id: 10},
        },
        actorRegId: 5,
        permData: {entity: new Map([['MANAGE_ASSIGNMENTS', true]])},
        allowManageOverride: true,
        expectedSuccess: true,
    },
];
