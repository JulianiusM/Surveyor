import {PERM, toMaskFromBodyValue} from '../../src/modules/lib/permissions';

export interface PermissionBodyCase {
    description: string;
    input: Parameters<typeof toMaskFromBodyValue>[0];
    expectedMask: ReturnType<typeof toMaskFromBodyValue>;
}

export function createPermissionBodyCase(overrides: Partial<PermissionBodyCase> = {}): PermissionBodyCase {
    const baseCase: PermissionBodyCase = {
        description: 'converts a posted permission key into a permission mask',
        input: 'ACCESS_VIEW',
        expectedMask: PERM.ACCESS_VIEW,
    };

    return {
        ...baseCase,
        ...overrides,
    };
}
