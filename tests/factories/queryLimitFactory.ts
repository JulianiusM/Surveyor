import type {coerceLimit} from '../../src/modules/lib/util';

export interface QueryLimitCase {
    description: string;
    input: Parameters<typeof coerceLimit>[0];
    defaultLimit?: Parameters<typeof coerceLimit>[1];
    maxLimit?: Parameters<typeof coerceLimit>[2];
    expectedLimit: ReturnType<typeof coerceLimit>;
}

export function createQueryLimitCase(overrides: Partial<QueryLimitCase> = {}): QueryLimitCase {
    const baseCase: QueryLimitCase = {
        description: 'uses the requested API limit when it is within bounds',
        input: '12',
        defaultLimit: 10,
        maxLimit: 25,
        expectedLimit: 12,
    };

    return {
        ...baseCase,
        ...overrides,
    };
}
