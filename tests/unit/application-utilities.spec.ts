import {describe, expect, it} from 'vitest';
import {
    buildDateTotals,
    coerceLimit,
    convertToSingleList,
    formatAmount,
    maskEmail,
    resolveActorLabel,
    resolveInvoiceAmount,
    sanitizeForEmail,
    toAmount,
} from '../../src/modules/lib/util';
import {DEFAULT_PERM, getInitialPerms, getPermMeta, getPresetMask, hasPerm, PERM, toMask, toMaskFromBodyValue} from '../../src/modules/lib/permissions';
import type {DashboardEntities} from '../../src/types/UserTypes';
import {createEntityBase, createExpectedEntity} from '../factories/entitiesFactory';
import {createDateTotalsCase} from '../factories/dateTotalsFactory';

const survey = createEntityBase({id: 'survey-1', title: 'Camp Survey', headerImg: 'survey.png'});
const activity = createEntityBase({id: 'activity-1', title: 'Morning Activities', eventId: 'event-1'});
const event = createEntityBase({id: 'event-1', title: 'Summer Camp'});

describe('backend application behavior suite', () => {
    describe('money and invoice amount transformations', () => {
        // Canary: protects a high-value production behavior while avoiding private implementation details.
        it('normalizes persisted numeric strings before invoice math', () => {
            expect(toAmount('12.50')).toBe(12.5);
        });

        // Canary: protects a high-value production behavior while avoiding private implementation details.
        it('treats empty persisted amounts as zero for safe totals', () => {
            expect(toAmount(null)).toBe(0);
        });

        // Canary: protects a high-value production behavior while avoiding private implementation details.
        it('formats invoice totals with cents for user-facing output', () => {
            expect(formatAmount(19.9)).toBe('19.90');
        });

        // Canary: protects invoice screens from leaking NaN when optional form amounts are missing.
        it('uses zero when persisted invoice amounts cannot be parsed', () => {
            expect(toAmount('not-a-number')).toBe(0);
        });

        // Canary: protects invoice summaries where discounts or refunds must stay visibly negative.
        it('keeps negative adjustments intact for refund-style invoice rows', () => {
            expect(formatAmount(toAmount('-4.5'))).toBe('-4.50');
        });

        // Canary: organizer corrections must drive pool math without erasing the participant's submitted amount.
        it('uses an organizer-corrected amount when one was recorded', () => {
            expect(resolveInvoiceAmount('25.00', '21.50')).toBe(21.5);
            expect(resolveInvoiceAmount('25.00', null)).toBe(25);
        });
    });

    describe('actor labels for audit and email messages', () => {
        // Canary: protects a high-value production behavior while avoiding private implementation details.
        it('prefers the profile display name for human-readable messages', () => {
            expect(resolveActorLabel({profile: {name: 'Camp Organizer'}} as never)).toBe('Camp Organizer');
        });

        // Canary: protects a high-value production behavior while avoiding private implementation details.
        it('falls back to the account username when no profile name exists', () => {
            expect(resolveActorLabel({profile: {user: {username: 'organizer'}}} as never)).toBe('organizer');
        });

        // Canary: protects guest-facing workflows where only a guest username is available.
        it('uses the guest username for guest-only session labels', () => {
            expect(resolveActorLabel({profile: {guest: {username: 'guest-camper'}}} as never)).toBe('guest-camper');
        });

        // Canary: protects a high-value production behavior while avoiding private implementation details.
        it('falls back to a neutral organizer label for anonymous system actions', () => {
            expect(resolveActorLabel(undefined)).toBe('an organizer');
        });
    });

    describe('event registration date totals', () => {
        // Canary: protects a high-value production behavior while avoiding private implementation details.
        it('counts registrations on each date in the event window', () => {
            const testCase = createDateTotalsCase();

            expect(buildDateTotals(testCase.eventStart, testCase.eventEnd, testCase.registrations)).toEqual(testCase.expectedTotals);
        });

        // Canary: protects a high-value production behavior while avoiding private implementation details.
        it('counts full-window attendance when arrival and departure are omitted', () => {
            expect(buildDateTotals('2026-10-10', '2026-10-12', [{arrivalDate: null, departureDate: null}])).toEqual({
                '2026-10-10': 1,
                '2026-10-11': 1,
                '2026-10-12': 1,
            });
        });

        // Canary: protects a high-value production behavior while avoiding private implementation details.
        it('keeps uncovered event days visible with zero totals', () => {
            expect(buildDateTotals('2026-09-01', '2026-09-03', [])).toEqual({
                '2026-09-01': 0,
                '2026-09-02': 0,
                '2026-09-03': 0,
            });
        });

        // Canary: protects registration dashboards when a guest submits dates outside the event window.
        it('clamps registrations to the event window before counting attendance', () => {
            expect(buildDateTotals('2026-09-10', '2026-09-12', [{arrivalDate: '2026-09-09', departureDate: '2026-09-11'}])).toEqual({
                '2026-09-10': 1,
                '2026-09-11': 1,
                '2026-09-12': 0,
            });
        });
    });

    describe('dashboard entity cards', () => {
        // Canary: protects a high-value production behavior while avoiding private implementation details.
        it('combines dashboard modules into the production card order', () => {
            expect(convertToSingleList({surveys: [survey], activityPlans: [activity], events: [event]} as Partial<DashboardEntities>)).toEqual([
                createExpectedEntity('survey', survey),
                createExpectedEntity('activity', activity),
                createExpectedEntity('event', event),
            ]);
        });

        // Canary: protects a high-value production behavior while avoiding private implementation details.
        it('preserves parent event ids for child-module cards', () => {
            expect(convertToSingleList({activityPlans: [activity]} as Partial<DashboardEntities>)).toEqual([
                createExpectedEntity('activity', activity),
            ]);
        });

        // Canary: protects a high-value production behavior while avoiding private implementation details.
        it('returns an empty card list for users without visible entities', () => {
            expect(convertToSingleList({})).toEqual([]);
        });

        // Canary: protects the dashboard canary for packing and drivers modules, not only events/surveys.
        it('includes packing and drivers list cards in the shared dashboard card model', () => {
            const packing = createEntityBase({id: 'packing-1', title: 'Camp Packing', eventId: 'event-1'});
            const drivers = createEntityBase({id: 'drivers-1', title: 'Airport Drivers', eventId: 'event-1'});

            expect(convertToSingleList({packingLists: [packing], driversLists: [drivers]} as Partial<DashboardEntities>)).toEqual([
                createExpectedEntity('packing', packing),
                createExpectedEntity('drivers', drivers),
            ]);
        });
    });

    describe('permissions and privacy-safe text', () => {
        // Canary: protects a high-value production behavior while avoiding private implementation details.
        it('gives events participant visibility in their initial permissions', () => {
            expect(getInitialPerms('event').participant).toBe(PERM.ACCESS_PARTICIPANTS);
        });

        // Canary: protects a high-value production behavior while avoiding private implementation details.
        it('combines posted permission keys into the mask saved by controllers', () => {
            expect(toMaskFromBodyValue(['ACCESS_VIEW', 'ITEM_ADD'], PERM)).toBe(PERM.ACCESS_VIEW | PERM.ITEM_ADD);
        });

        // Canary: protects a high-value production behavior while avoiding private implementation details.
        it('keeps admin presets powerful enough to include view access', () => {
            expect(hasPerm(DEFAULT_PERM.ADMIN, PERM.ACCESS_VIEW)).toBe(true);
        });

        // Canary: protects permission editor posts where a single selected checkbox is submitted as one value.
        it('converts a single posted permission key into a saved mask', () => {
            expect(toMaskFromBodyValue('ACCESS_ADMIN', PERM)).toBe(PERM.ACCESS_ADMIN);
        });

        // Canary: protects permission editors from granting access for stale or misspelled keys.
        it('ignores unknown permission keys when building masks', () => {
            expect(toMask(['ACCESS_VIEW', 'REMOVED_PERMISSION'])).toBe(PERM.ACCESS_VIEW);
        });

        // Canary: protects the preset selector used by permission management screens.
        it('resolves the default entity preset used for newly shared resources', () => {
            expect(getPresetMask('DEFAULT_ENTITY')).toBe(DEFAULT_PERM.DEFAULT_ENTITY);
        });

        // Canary: protects permission-management UI data from drifting away from the production bitset.
        it('exposes permission metadata for the access-admin capability', () => {
            expect(getPermMeta()).toContainEqual({key: 'ACCESS_ADMIN', bit: PERM.ACCESS_ADMIN, label: 'Access Admin'});
        });

        // Canary: protects a high-value production behavior while avoiding private implementation details.
        it('masks email addresses before exposing them in logs or summaries', () => {
            expect(maskEmail('camper@example.com')).toBe('ca***@e***.com');
        });

        // Canary: protects a high-value production behavior while avoiding private implementation details.
        it('removes control characters from email text before sending messages', () => {
            expect(sanitizeForEmail('Hello\nBCC: attacker@example.com')).toBe('HelloBCC: attacker@example.com');
        });

        // Canary: protects API list endpoints from unbounded page sizes submitted by clients.
        it('caps requested API limits to the supported maximum', () => {
            expect(coerceLimit('250', 10, 50)).toBe(50);
        });

        // Canary: protects API list endpoints from unusable negative or zero page sizes.
        it('raises non-positive API limits to the first valid page size', () => {
            expect(coerceLimit('0', 10, 50)).toBe(1);
        });
    });
});
