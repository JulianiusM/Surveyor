import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';
import {addCivilDays, civilDateWeeks, civilDateWindow, formatCivilDate} from '../../src/common/lib/civilDate';
import {activityCreationWeeks} from '../../src/frontend/features/activity/presentation';
import {countInclusiveDays} from '../../src/common/activity/requirements';
import {formatEventCivilDate, formatEventDate, formatEventTimestamp} from '../../src/frontend/features/event/presentation';

describe('shared civil calendar presentation', () => {
    it('bounds a centuries-long saved calendar before day allocation and rejects oversized creation previews', () => {
        const first = civilDateWindow('1000-01-01', '9999-12-31', 366);
        expect(first).toMatchObject({startDate: '1000-01-01', endDate: '1000-02-11', previous: null,
            next: '1000-02-12', oversized: true, maxDurationDays: 366});
        expect(civilDateWeeks(first.startDate, first.endDate).flatMap(week => week.days)).toHaveLength(42);
        const final = civilDateWindow('1000-01-01', '9999-12-31', 366, '9999-12-31');
        expect(final).toMatchObject({startDate: '9999-12-31', endDate: '9999-12-31', next: null});
        expect(civilDateWindow('1000-01-01', '9999-12-31', 366, 'invalid')).toEqual(first);
        expect(activityCreationWeeks('1000-01-01', '9999-12-31', 366)).toEqual([]);
        expect(activityCreationWeeks('2032-01-01', '2032-12-31', 366).flat()).toHaveLength(366);
        expect(activityCreationWeeks('2032-01-01', '2032-12-31', 100)).toEqual([]);
        expect(countInclusiveDays('1000-01-01', '9999-12-31')).toBe(3_287_182);
    });
    it.each([
        ['2032-02-28', 1, '2032-02-29'], ['2032-02-29', 1, '2032-03-01'],
        ['2027-12-31', 1, '2028-01-01'], ['2027-03-28', 1, '2027-03-29'],
        ['2027-11-01', -1, '2027-10-31'], ['2027-02-29', 1, '2027-03-02'],
        ['9999-12-31', 1, '+010000-01-01'], ['+010000-01-01', 1, '+010000-01-02'],
        ['+010000-01-01', -1, '9999-12-31'], ['0000-01-01', -1, '-000001-12-31'],
    ] as const)('retains calculation-day stepping from %s by %s days', (day, days, expected) => {
        expect(addCivilDays(day, days)).toBe(expected);
    });

    it('retains the calculation primitive\'s invalid-date failure separately from display validation', () => {
        expect(() => addCivilDays('invalid', 1)).toThrow(RangeError);
        expect(() => countInclusiveDays('invalid', 'invalid')).toThrow(RangeError);
        expect(countInclusiveDays('2032-03-01', '2032-02-28')).toBe(0);
        expect(countInclusiveDays('2032-02-28', '2032-03-01')).toBe(3);
        expect(countInclusiveDays('2027-02-29', '2027-02-29')).toBe(1);
    });

    it('finishes upper-year Activity requirements and Event totals within a bounded process', () => {
        // Keep the real production loops outside Vitest: a regression must fail
        // at the child deadline instead of freezing the runner's event loop.
        const script = `
            const {countInclusiveDays, calculateParticipantRequirement} = require('./src/common/activity/requirements');
            const {buildDateTotals} = require('./src/backend/modules/lib/util');
            const plan = {startDate: '9999-12-30', endDate: '9999-12-31',
                assignmentMode: 'REQUIRED', generalRequiredShifts: 4, roundingMode: 'CEIL'};
            process.stdout.write(JSON.stringify({
                singleDay: countInclusiveDays('9999-12-31', '9999-12-31'),
                interval: countInclusiveDays('9999-12-29', '9999-12-31'),
                singleTotals: buildDateTotals('9999-12-31', '9999-12-31', [{arrivalDate: null, departureDate: null}]),
                totals: buildDateTotals('9999-12-29', '9999-12-31', [
                    {arrivalDate: null, departureDate: null},
                    {arrivalDate: '9999-12-30', departureDate: '9999-12-31'}]),
                requirement: calculateParticipantRequirement(plan,
                    {profileId: 'participant', arrivalDate: '9999-12-31', departureDate: '9999-12-31'},
                    [], [], [{stayDays: 1, requiredShifts: 2}]),
            }));
        `;
        // Load source owners without an application, database or generated build.
        // Only the child receives the loader settings and hard termination limit.
        const result = spawnSync(process.execPath, ['--require', 'ts-node/register/transpile-only', '-e', script], {
            cwd: resolve('.'), encoding: 'utf8', timeout: 5_000, windowsHide: true,
            env: {...process.env, TS_NODE_PROJECT: resolve('tsconfig.server.json'), TZ: 'UTC', DOTENV_CONFIG_QUIET: 'true'},
        });
        expect(result.error).toBeUndefined();
        expect(result.status, result.stderr).toBe(0);
        expect(JSON.parse(result.stdout)).toEqual({
            singleDay: 1, interval: 3, singleTotals: {'9999-12-31': 1},
            totals: {'9999-12-29': 1, '9999-12-30': 2, '9999-12-31': 2},
            requirement: {participantKey: 'profile:participant', requiredShifts: 2, source: 'general',
                breakdown: {attendanceDays: 1, planDays: 2, proportionalRequirement: 2,
                    stayDurationRequirement: 2, appliedRounding: 'CEIL'}},
        });
    });

    it.each([
        {start: '2032-02-28', end: '2032-03-02', weeks: [
            {start: '2032-02-23', days: ['2032-02-28', '2032-02-29']},
            {start: '2032-03-01', days: ['2032-03-01', '2032-03-02']}]},
        {start: '2027-12-31', end: '2028-01-03', weeks: [
            {start: '2027-12-27', days: ['2027-12-31', '2028-01-01', '2028-01-02']},
            {start: '2028-01-03', days: ['2028-01-03']}]},
        {start: '0099-01-01', end: '0099-01-02', weeks: [
            {start: '0098-12-29', days: ['0099-01-01', '0099-01-02']}]},
        {start: '0000-01-01', end: '0000-01-02', weeks: [
            {start: '-000001-12-27', days: ['0000-01-01', '0000-01-02']}]},
        {start: '1000-01-01', end: '1000-01-02', weeks: [
            {start: '0999-12-30', days: ['1000-01-01', '1000-01-02']}]},
        {start: '9999-12-30', end: '9999-12-31', weeks: [
            {start: '9999-12-27', days: ['9999-12-30', '9999-12-31']}]},
    ])('clips $start through $end to their actual Monday weeks', ({start, end, weeks}) => {
        expect(civilDateWeeks(start, end)).toEqual(weeks);
    });

    it.each(['', '2027-02-29', '2027-04-31', '2027-13-01', '2027-06-1', '2027-06-01T12:00:00Z'])
    ('rejects an invalid civil input without normalizing it: %s', value => {
        expect(formatCivilDate(value, 'en')).toBeNull();
        expect(civilDateWeeks(value, '2027-06-03')).toEqual([]);
        expect(civilDateWeeks('2027-06-01', value)).toEqual([]);
    });

    it('keeps an inverted range empty and does not mutate later calls or date inputs', () => {
        expect(civilDateWeeks('2027-06-03', '2027-06-01')).toEqual([]);
        const first = civilDateWeeks('2027-06-01', '2027-06-01');
        first[0].days.push('not a stored date');
        expect(civilDateWeeks('2027-06-01', '2027-06-01'))
            .toEqual([{start: '2027-05-31', days: ['2027-06-01']}]);
    });

    it('formats the stored weekday/day in the selected locale and keeps feature fallbacks', () => {
        expect(formatCivilDate('2030-06-01', 'en', {weekday: 'short', timeZone: 'America/Los_Angeles'})).toBe('Sat');
        expect(formatCivilDate('2030-06-01', 'en')).toBe('6/1/2030');
        expect(formatCivilDate('2030-06-01', 'de')).toBe('1.6.2030');
        expect(formatEventCivilDate('2030-06-01', 'en')).toBe('Saturday, June 1, 2030');
        expect(formatEventDate('2030-06-01', 'de')).toBe('1.6.2030');
        expect(formatEventCivilDate('invalid', 'en')).toBe('Invalid Date');
        expect(formatEventDate('invalid', 'en')).toBe('invalid');
        expect(formatEventDate(null, 'de')).toBe('—');
        expect(formatEventDate(undefined, 'en')).toBe('—');
        expect(formatEventTimestamp(null, 'de')).toBe('—');
        expect(formatEventTimestamp('invalid', 'en')).toBe('—');
    });
});
