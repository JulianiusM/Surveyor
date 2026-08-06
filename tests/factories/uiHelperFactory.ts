import type {createBadge} from '../../src/public/js/shared/ui-helpers';
export interface BadgeCase {
    description: string;
    status: string;
    colorMap?: Parameters<typeof createBadge>[1];
    expectedMarkup: string;
}

export interface DurationCase {
    description: string;
    milliseconds: number;
    expectedLabel: string;
}

export function createBadgeCase(overrides: Partial<BadgeCase> = {}): BadgeCase {
    const baseCase: BadgeCase = {
        description: 'renders a known status as a Bootstrap badge',
        status: 'active',
        expectedMarkup: '<span class="badge text-bg-success text-uppercase">active</span>',
    };

    return {
        ...baseCase,
        ...overrides,
    };
}

export function createDurationCase(overrides: Partial<DurationCase> = {}): DurationCase {
    const baseCase: DurationCase = {
        description: 'formats a positive duration into days, hours, and minutes',
        milliseconds: ((2 * 24 + 3) * 60 + 45) * 60 * 1000,
        expectedLabel: '2d 3h 45m',
    };

    return {
        ...baseCase,
        ...overrides,
    };
}
