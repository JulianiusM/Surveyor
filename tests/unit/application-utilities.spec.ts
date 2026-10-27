import {describe, expect, it} from 'vitest';
import {
    buildDateTotals,
    convertToSingleList,
    formatAmount,
    maskEmail,
    projectEventParticipants,
    resolveActorLabel,
    resolveInvoiceAmount,
    sanitizeForEmail,
    toAmount,
    uuidKey, sameUuid, indexByUuid, groupByUuid, resolveUuidReferences, resolveCompleteUuidOrder,
} from '../../src/backend/modules/lib/util';
import {DEFAULT_PERM, getInitialPerms, getPermMeta, getPresetMask, hasPerm, PERM, toMask, toMaskFromBodyValue} from '../../src/backend/modules/lib/permissions';
import type {DashboardEntities} from '../../src/types/UserTypes';
import {createEntityBase, createExpectedEntity} from '../factories/entitiesFactory';
import {createDateTotalsCase} from '../factories/dateTotalsFactory';
import {createProfileEntity, createUserEntity} from '../factories/integrationEntityFactory';
import {EventRegistration} from '../../src/backend/modules/database/entities/event/EventRegistration';
import {Profile} from '../../src/backend/modules/database/entities/user/Profile';

const survey = createEntityBase({id: 'survey-1', title: 'Camp Survey', headerImg: 'survey.png'});
const activity = createEntityBase({id: 'activity-1', title: 'Morning Activities', eventId: 'event-1'});
const event = createEntityBase({id: 'event-1', title: 'Summer Camp'});

describe('backend application behavior suite', () => {
    describe('shared UUID reference identity', () => {
        const first = 'a103fc16-052d-4269-8abc-432853059a6c';
        const second = 'b204fc16-052d-4269-8abc-432853059a6d';

        it('accepts UUID spelling aliases without reinterpreting opaque, numeric or padded values', () => {
            expect(uuidKey(first.toUpperCase())).toBe(first);
            expect(sameUuid(first, first.toUpperCase())).toBe(true);
            expect(sameUuid(first, second)).toBe(false);
            for (const value of ['OpaqueTokenABC', '001', ` ${first}`, `urn:uuid:${first.toUpperCase()}`]) {
                expect(uuidKey(value)).toBe(value);
            }
            expect(sameUuid(null, null)).toBe(false);
            expect(sameUuid(undefined, undefined)).toBe(false);
            expect(sameUuid('', '')).toBe(false);
        });

        it('resolves aliases to the actual loaded rows and preserves partial ordering and multiplicity', () => {
            const rows = [{id: first.toUpperCase(), label: 'Stored uppercase'}, {id: second, label: 'Second'}];
            expect(indexByUuid(rows, row => row.id).get(first)).toBe(rows[0]);
            const partial = resolveUuidReferences([second.toUpperCase(), first, second], rows, row => row.id)!;
            expect(partial).toEqual([rows[1], rows[0], rows[1]]);
            expect(partial[1]).toBe(rows[0]);
            expect(rows[0]!.id).toBe(first.toUpperCase());
            expect(resolveUuidReferences(['c304fc16-052d-4269-8abc-432853059a6e'], rows, row => row.id)).toBeUndefined();
            const aliasRow = {id: first, label: 'Another row for the same resource'};
            const groups = groupByUuid([...rows, aliasRow], row => row.id);
            expect(groups.size).toBe(2);
            expect(groups.get(first)).toEqual([rows[0], aliasRow]);
            expect(groups.get(first)![0]).toBe(rows[0]);
        });

        it('requires one occurrence of every actual row only for complete-order workflows', () => {
            const rows = [{id: first.toUpperCase()}, {id: second}];
            expect(resolveCompleteUuidOrder([second.toUpperCase(), first], rows)).toEqual([rows[1], rows[0]]);
            expect(resolveCompleteUuidOrder([first, first.toUpperCase()], rows)).toBeUndefined();
            expect(resolveCompleteUuidOrder([first], rows)).toBeUndefined();
            expect(resolveCompleteUuidOrder([], [])).toEqual([]);
        });
    });

    it('retains Event name/contact fallbacks, row order and dietary absence after raw-row projection', () => {
        const user = createUserEntity({name: '  Account   Name  ', username: 'account-login', email: 'account@example.test'});
        const profile = createProfileEntity(user, {name: '   '});
        const guest = Object.assign(new Profile(), {id: 'guest-profile', name: '', guest: {username: 'guest-login', email: 'guest@example.test'}});
        const absent = Object.assign(new Profile(), {id: 'absent-profile', name: ''});
        const rows = [profile, guest, absent].map((row, index) => Object.assign(new EventRegistration(), {
            id: 10 - index, profile: row, arrivalDate: '2027-06-01', departureDate: '2027-06-03',
        }));
        const projected = projectEventParticipants(rows);
        expect(projected.map(row => row.id)).toEqual([10, 9, 8]);
        expect(projected.map(row => [row.name, row.email, row.dietaryChoices])).toEqual([
            ['Account   Name', 'account@example.test', null], ['guest-login', 'guest@example.test', null], ['—', '—', null],
        ]);
        expect(profile.name).toBe('   ');
        expect(user.name).toBe('  Account   Name  ');
    });

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
                {...createExpectedEntity('survey', survey), imageVersion: expect.any(String)},
                {...createExpectedEntity('activity', activity), imageVersion: null},
                {...createExpectedEntity('event', event), imageVersion: null},
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
                {...createExpectedEntity('packing', packing), imageVersion: null},
                {...createExpectedEntity('drivers', drivers), imageVersion: null},
            ]);
        });

        it('changes an opaque header version on replacement without exposing the storage path', () => {
            const firstPath = 'private-storage/first-image.png';
            const secondPath = 'private-storage/replacement-image.png';
            const card = (headerImg: string | null) => convertToSingleList({packingLists: [
                createEntityBase({id: 'packing-1', headerImg}),
            ]} as Partial<DashboardEntities>)[0];
            const first = card(firstPath);
            const replacement = card(secondPath);
            expect(first.imageVersion).toEqual(expect.any(String));
            expect(card(firstPath).imageVersion).toBe(first.imageVersion);
            expect(replacement.imageUrl).toBe(first.imageUrl);
            expect(replacement.imageVersion).not.toBe(first.imageVersion);
            expect(JSON.stringify(first)).not.toContain(firstPath);
            expect(JSON.stringify(replacement)).not.toContain(secondPath);
            expect(card(null)).toMatchObject({imageUrl: undefined, imageVersion: null});
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

        // Canary: protects delegated activity time editing when the full-item preset is assigned.
        it('includes item metadata editing in the full-item permission preset', () => {
            expect(hasPerm(DEFAULT_PERM.FULL_ITEM, PERM.ITEM_EDIT_META)).toBe(true);
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
    });
});
