import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {
    archiveKey, automaticArchiveCutoff, isEffectivelyArchived, isHiddenInOverview,
} from '../../src/modules/archive/policy';

// These cases exercise pure policy and runner coordination only. Replace the runner's
// persistence boundary so no unit test can connect to or mutate a configured database;
// the integration suite separately exercises the real archival service and its transactions.
const archiveExpiredEntities = vi.hoisted(() => vi.fn());
vi.mock('../../src/modules/database/services/EntityLifecycleService', () => ({archiveExpiredEntities}));
vi.mock('../../src/modules/settings', () => ({default: {value: {autoArchiveEnabled: true, autoArchiveAfterDays: 30}}}));
import settings from '../../src/modules/settings';
import {runEntityArchival, startEntityArchivalJob} from '../../src/modules/entityArchival';

describe('archival calendar policy', () => {
    it('waits until the day after an inclusive end date and the full configured delay', () => {
        // Test either side of UTC midnight: the same ended period becomes eligible only
        // after every configured whole day has elapsed, including with a zero-day delay.
        expect(automaticArchiveCutoff(30, new Date('2026-10-16T23:59:59.999Z'))).toBe('2026-09-15');
        expect(automaticArchiveCutoff(30, new Date('2026-10-17T00:00:00.000Z'))).toBe('2026-09-16');
        expect(automaticArchiveCutoff(0, new Date('2026-09-16T23:59:59.999Z'))).toBe('2026-09-15');
        expect(automaticArchiveCutoff(0, new Date('2026-09-17T00:00:00.000Z'))).toBe('2026-09-16');
    });

    // Leap days, year rollover and explicit timezone offsets must yield the same UTC-date
    // contract used by SQL DATE comparisons, independently of the machine's local timezone.
    it.each([
        ['2024-03-01T00:00:00Z', 0, '2024-02-29'],
        ['2025-03-01T00:00:00Z', 0, '2025-02-28'],
        ['2027-01-01T00:00:00Z', 0, '2026-12-31'],
        ['2026-10-17T02:00:00+02:00', 30, '2026-09-16'],
        ['2026-10-17T01:59:59+02:00', 30, '2026-09-15'],
    ])('uses UTC dates across calendar boundaries (%s)', (now, delay, cutoff) => {
        expect(automaticArchiveCutoff(delay, new Date(now))).toBe(cutoff);
    });

    it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER])('rejects invalid or unrepresentable delay %s', (delay) => {
        // A numerically valid integer can still overflow the database's representable date
        // range. Reject it before a background sweep can send a malformed cutoff to MariaDB.
        expect(() => automaticArchiveCutoff(delay, new Date('2026-09-16T00:00:00Z'))).toThrow();
    });

    it('rejects invalid clocks and cutoffs outside SQL DATE storage', () => {
        expect(() => automaticArchiveCutoff(30, new Date('invalid'))).toThrow();
        expect(() => automaticArchiveCutoff(0, new Date('+010000-01-02T00:00:00Z'))).toThrow();
    });
});

describe('effective archival and personal placement', () => {
    const archivedAt = new Date('2026-09-01T00:00:00Z');
    it('inherits an event archive and preserves an independent child archive after event restoration', () => {
        // Parent inheritance and a child's own marker are independent inputs. Clearing one
        // must not erase the other; neither operation implies deletion of the underlying root.
        expect(isEffectivelyArchived(null, archivedAt)).toBe(true);
        expect(isEffectivelyArchived(archivedAt, null)).toBe(true);
        expect(isEffectivelyArchived(null, null)).toBe(false);
    });

    // Exercise the complete shared-state/private-choice matrix. Explicit show/hide changes
    // only overview placement, while default follows the authoritative archive state.
    it.each([
        [false, 'default', false], [true, 'default', true],
        [false, 'hidden', true], [true, 'hidden', true],
        [false, 'shown', false], [true, 'shown', false],
    ] as const)('places archive=%s with preference=%s in hidden=%s', (archived, visibility, hidden) => {
        expect(isHiddenInOverview(archived, visibility)).toBe(hidden);
    });

    it('keeps equal IDs in different domains distinct', () => {
        // Mixed dashboard maps must key by entity kind as well as ID; IDs alone do not
        // describe a polymorphic entity reference, even when production uses random UUIDs.
        expect(archiveKey({type: 'event', id: 'same'})).not.toBe(archiveKey({type: 'activity', id: 'same'}));
    });
});

describe('automatic archival runner', () => {
    beforeEach(() => {
        // Each case starts with a successful persistence boundary and valid configuration.
        // Reset mutated settings explicitly because restoring spies does not undo object writes.
        archiveExpiredEntities.mockReset().mockResolvedValue(0);
        settings.value.autoArchiveEnabled = true;
        settings.value.autoArchiveAfterDays = 30;
    });
    afterEach(() => vi.restoreAllMocks());

    it('uses one supplied clock and skips writes when disabled', async () => {
        // A captured clock is forwarded unchanged so one sweep cannot gain another eligible
        // date halfway through a run. Disabling automation must bypass persistence entirely.
        const now = new Date('2026-09-16T14:00:00Z');
        await runEntityArchival(now);
        // The controller resolves policy into one SQL date before calling the pure DBAL.
        expect(archiveExpiredEntities).toHaveBeenCalledWith('2026-08-16', now);
        settings.value.autoArchiveEnabled = false;
        expect(await runEntityArchival(now)).toBe(0);
        expect(archiveExpiredEntities).toHaveBeenCalledTimes(1);
    });

    it('validates delay before scheduling, even when automation is disabled', async () => {
        // Invalid configuration must fail startup deterministically instead of remaining
        // dormant until an operator later enables the job.
        settings.value.autoArchiveEnabled = false;
        settings.value.autoArchiveAfterDays = -1;
        await expect(startEntityArchivalJob()).rejects.toThrow('AUTO_ARCHIVE_AFTER_DAYS');
        expect(archiveExpiredEntities).not.toHaveBeenCalled();
    });

    it('coalesces overlapping sweeps and allows later sweeps', async () => {
        // Hold the first write boundary open without timers or a database. A second caller
        // must share that in-flight result; after resolution, a later call starts fresh work.
        let finish!: (count: number) => void;
        archiveExpiredEntities.mockImplementationOnce(() => new Promise<number>((resolve) => { finish = resolve; }));
        const first = runEntityArchival();
        const second = runEntityArchival();
        expect(archiveExpiredEntities).toHaveBeenCalledTimes(1);
        finish(0);
        expect(await Promise.all([first, second])).toEqual([0, 0]);
        await runEntityArchival();
        expect(archiveExpiredEntities).toHaveBeenCalledTimes(2);
    });

    it('permits recovery after a failed sweep', async () => {
        // A rejected persistence call must also release the in-flight guard, otherwise one
        // transient database failure would silently disable every later scheduled attempt.
        archiveExpiredEntities.mockRejectedValueOnce(new Error('temporary database error'));
        await expect(runEntityArchival()).rejects.toThrow('temporary database error');
        await expect(runEntityArchival()).resolves.toBe(0);
    });

    it('starts immediately and schedules one unreferenced hourly timer', async () => {
        // Substitute only the timer handle: startup still runs its immediate sweep, but no
        // real interval survives the test. Repeated startup may sweep again without adding
        // another interval, and unref keeps the timer from holding the process open by itself.
        const timer = {unref: vi.fn()} as unknown as NodeJS.Timeout;
        const interval = vi.spyOn(global, 'setInterval').mockReturnValue(timer);
        await startEntityArchivalJob();
        await startEntityArchivalJob();
        expect(archiveExpiredEntities).toHaveBeenCalledTimes(2);
        expect(interval).toHaveBeenCalledTimes(1);
        expect(interval).toHaveBeenCalledWith(expect.any(Function), 60 * 60 * 1000);
        expect(timer.unref).toHaveBeenCalledOnce();
    });
});
