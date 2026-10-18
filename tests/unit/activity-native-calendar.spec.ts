import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';

/** Run the actual controller projection and immutable native Pug oracle in an
 * isolated Node process. Its timezone changes never modify Vitest's workers,
 * disposable database setup or another suite's established UTC contract. */
function nativeCalendarComparisons() {
    const script = `
        const pug = require('pug');
        const {projectActivityScheduleWeeks} = require('./src/controller/activityController');
        const render = pug.compileFile('src/views/activity/activity-view.pug');
        const results = [];
        for (const zone of ['UTC', 'Europe/Berlin', 'America/Los_Angeles', 'Asia/Tokyo']) {
            process.env.TZ = zone;
            for (const [startDate, endDate] of [
                ['2027-03-20', '2027-03-31'],
                ['2027-10-23', '2027-11-03'],
                ['2030-06-01', '2030-06-02'],
                ['1000-01-01', '1000-01-02'],
            ]) {
                const html = render({
                    status: undefined, messages: {}, version: 'test', nxtUrl: '/activity/fixture',
                    settings: {imprintUrl: '/imprint', privacyPolicyUrl: '/privacy'},
                    profile: {name: 'Reader', guestId: 'guest'}, admins: [], perms: {},
                    permData: {entity: {has: () => false}, itemAllow: () => false},
                    data: {
                        plan: {id: 'calendar-fixture', title: 'Calendar parity', startDate, endDate},
                        archive: null, entityProperties: null, canSelfAssign: false,
                        assignments: [], assigneeLists: {}, slots: {}, participantList: [], textFields: [],
                        roles: {allRoles: [], slotRoles: {}}, counters: {participants: 0, open: 0, empty: 0},
                    },
                });
                const nativeWeeks = [...html.matchAll(/<h4 class="mt-4 mb-2">Week of ([0-9-]+)<\\/h4>[\\s\\S]*?<table[^>]*activity-table[^>]*>([\\s\\S]*?)<\\/table>/g)]
                    .map(match => ({start: match[1], days: [...match[2].matchAll(/<th[^>]*data-date="([^"]+)"/g)].map(day => day[1])}));
                results.push({zone, startDate, endDate, offset: new Date('2027-03-31T00:00:00Z').getTimezoneOffset(),
                    nativeWeeks, projection: projectActivityScheduleWeeks(startDate, endDate)});
            }
        }
        process.stdout.write(JSON.stringify(results));
    `;
    // The child loads normal production modules without opening a database or
    // HTTP application. Only its explicit synthetic view data enters Pug.
    const result = spawnSync(process.execPath, ['--require', 'ts-node/register/transpile-only', '-e', script], {
        cwd: resolve('.'), encoding: 'utf8', timeout: 30_000,
        env: {...process.env, TS_NODE_PROJECT: resolve('tsconfig.server.json'), TZ: 'UTC', DOTENV_CONFIG_QUIET: 'true'},
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(result.stderr || 'Native calendar comparison process failed.');
    return JSON.parse(result.stdout) as Array<{zone: string; startDate: string; endDate: string; offset: number;
        nativeWeeks: Array<{start: string; days: string[]}>; projection: Array<{start: string; days: string[]}>}>;
}

describe('Activity native calendar presentation', () => {
    it('matches actual native template week/day keys through spring and autumn timezone transitions', () => {
        const results = nativeCalendarComparisons();
        expect(results).toHaveLength(16);
        for (const result of results) {
            expect(result.nativeWeeks.length, result.zone + ' ' + result.startDate).toBeGreaterThan(0);
            expect(result.projection, result.zone + ' ' + result.startDate + ' ' + result.endDate).toEqual(result.nativeWeeks);
        }
        // Distinct effective offsets establish that this compares real local
        // Date behavior, rather than repeated executions in one UTC zone.
        expect(new Set(results.map(result => result.offset)).size).toBe(4);
    }, 40_000);
});
