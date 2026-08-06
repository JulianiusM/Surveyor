import type {buildDateTotals} from '../../src/modules/lib/util';

type RegistrationDateRange = Parameters<typeof buildDateTotals>[2][number];

export interface DateTotalsCase {
    description: string;
    eventStart: string;
    eventEnd: string;
    registrations: RegistrationDateRange[];
    expectedTotals: ReturnType<typeof buildDateTotals>;
}

export function createDateTotalsCase(overrides: Partial<DateTotalsCase> = {}): DateTotalsCase {
    const baseCase: DateTotalsCase = {
        description: 'counts registrations on each date in the event window',
        eventStart: '2026-08-05',
        eventEnd: '2026-08-07',
        registrations: [
            {arrivalDate: '2026-08-05', departureDate: '2026-08-06'},
            {arrivalDate: null, departureDate: '2026-08-07'},
            {arrivalDate: '2026-08-08', departureDate: '2026-08-09'},
        ],
        expectedTotals: {
            '2026-08-05': 2,
            '2026-08-06': 2,
            '2026-08-07': 1,
        },
    };

    return {
        ...baseCase,
        ...overrides,
        registrations: overrides.registrations ?? baseCase.registrations,
        expectedTotals: overrides.expectedTotals ?? baseCase.expectedTotals,
    };
}
