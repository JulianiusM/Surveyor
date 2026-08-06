/**
 * Test data for assignFlowFactory middleware tests
 */

export const enforcePlanBindingDeadlineData = [
    {
        description: 'allows assignments when no deadline is set',
        plan: {id: 'plan-1', bindingDeadline: null},
        currentTime: '2025-01-02T12:00:00Z',
        permData: undefined,
        shouldSucceed: true,
    },
    {
        description: 'allows assignments before the deadline',
        plan: {id: 'plan-1', bindingDeadline: new Date('2025-01-03T00:00:00Z')},
        currentTime: '2025-01-02T12:00:00Z',
        permData: undefined,
        shouldSucceed: true,
    },
    {
        description: 'blocks assignments after the deadline without admin rights',
        plan: {id: 'plan-1', bindingDeadline: new Date('2025-01-01T00:00:00Z')},
        currentTime: '2025-01-02T12:00:00Z',
        permData: undefined,
        shouldSucceed: false,
        expectedError: {name: 'APIError', status: 403},
    },
    {
        description: 'allows assignments after the deadline for managers',
        plan: {id: 'plan-1', bindingDeadline: new Date('2025-01-01T00:00:00Z')},
        currentTime: '2025-01-02T12:00:00Z',
        permData: {
            entity: {has: (perm: string) => perm === 'MANAGE_ASSIGNMENTS'},
        },
        shouldSucceed: true,
    },
];
