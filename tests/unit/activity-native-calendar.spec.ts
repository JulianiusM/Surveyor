import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';

/** Run the shared Vue calendar and actual versioned projection in an
 * isolated Node process. Its timezone changes never modify Vitest's workers,
 * disposable database setup or another suite's established UTC contract. */
function calendarComparisons() {
    const script = `
        const {projectActivityScheduleWeeks} = require('./src/controller/activityController');
        const {activityCreationWeeks, activityDateLabel, activityDayLabel} = require('./src/frontend/features/activity/presentation');
        const {formatEventCivilDate, formatEventDate, formatEventTimestamp} = require('./src/frontend/features/event/presentation');
        const results = [];
        for (const zone of ['UTC', 'Europe/Berlin', 'America/Los_Angeles', 'Asia/Tokyo']) {
            process.env.TZ = zone;
            for (const [startDate, endDate] of [
                ['2027-03-20', '2027-03-31'],
                ['2027-10-23', '2027-11-03'],
                ['2030-06-01', '2030-06-02'],
                ['1000-01-01', '1000-01-02'],
            ]) {
                results.push({zone, startDate, endDate, offset: new Date('2027-03-31T00:00:00Z').getTimezoneOffset(),
                    projection: projectActivityScheduleWeeks(startDate, endDate),
                    creation: activityCreationWeeks(startDate, endDate),
                    activityDate: activityDateLabel('2030-06-01', 'en'), activityDay: activityDayLabel('2030-06-01', 'en'),
                    eventFull: formatEventCivilDate('2030-06-01', 'en'), eventDate: formatEventDate('2030-06-01', 'de'),
                    timestamp: formatEventTimestamp('2030-06-01T00:00:00Z', 'en')});
            }
        }
        process.stdout.write(JSON.stringify(results));
    `;
    // The child loads normal production modules without opening a database or
    // HTTP application. Synthetic civil dates exercise actual presentation logic.
    const result = spawnSync(process.execPath, ['--require', 'ts-node/register/transpile-only', '-e', script], {
        cwd: resolve('.'), encoding: 'utf8', timeout: 30_000,
        env: {...process.env, TS_NODE_PROJECT: resolve('tsconfig.server.json'), TZ: 'UTC', DOTENV_CONFIG_QUIET: 'true'},
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(result.stderr || 'Calendar comparison process failed.');
    return JSON.parse(result.stdout) as Array<{zone: string; startDate: string; endDate: string; offset: number;
        projection: Array<{start: string; days: string[]}>;
        creation: string[][]; activityDate: string; activityDay: string; eventFull: string; eventDate: string; timestamp: string}>;
}

describe('civil calendar and timestamp presentation', () => {
    it('keeps Vue creation and versioned weeks identical across real timezone/DST transitions while retaining civil-date and instant boundaries', () => {
        const results = calendarComparisons();
        expect(results).toHaveLength(16);
        for (const result of results) {
            expect(result.projection.length, result.zone + ' ' + result.startDate).toBeGreaterThan(0);
            const utc = results.find(candidate => candidate.zone === 'UTC' && candidate.startDate === result.startDate)!;
            expect(result.projection, result.zone + ' ' + result.startDate + ' ' + result.endDate).toEqual(utc.projection);
            expect(result.creation).toEqual(result.projection.map(week => week.days));
            expect(result.activityDate).toBe('6/1/2030');
            expect(result.activityDay).toBe('Sat');
            expect(result.eventFull).toBe('Saturday, June 1, 2030');
            expect(result.eventDate).toBe('1.6.2030');
        }
        // Distinct effective offsets establish that this compares real local
        // Date behavior, rather than repeated executions in one UTC zone.
        expect(new Set(results.map(result => result.offset)).size).toBe(4);
        // The civil week begins Monday independently of the viewer timezone.
        const negative = results.find(result => result.zone === 'America/Los_Angeles' && result.startDate === '2030-06-01')!;
        expect(negative.projection).toEqual([{start: '2030-05-27', days: ['2030-06-01', '2030-06-02']}]);
        // Timestamp presentation remains an instant in the viewer's real zone.
        expect(negative.timestamp).toContain('5/31/2030');
        expect(results.find(result => result.zone === 'Asia/Tokyo')!.timestamp).toContain('6/1/2030');
    }, 40_000);
});
