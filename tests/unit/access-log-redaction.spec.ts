import {describe, expect, it} from 'vitest';
import {redactAccessLogUrl} from '../../src/backend/modules/lib/http';
import {buildSync} from 'esbuild';
import {execFileSync} from 'node:child_process';

describe('full access URL with in-place secret redaction', () => {
    it.each([
        ['/guest/public-id/login/private-cap?next=%2fevent%2Fid&locale=de', '/guest/public-id/login/[REDACTED]?next=%2fevent%2Fid&locale=de'],
        ['/users/reset-password/encoded%2Fcap?view=all', '/users/reset-password/[REDACTED]?view=all'],
        ['/USERS/activate/private/extra-unmatched?x=one+two', '/USERS/activate/[REDACTED]/extra-unmatched?x=one+two'],
        ['/users/oidc/callback?code=secret&state=opaque&scope=a%20b&session_state=provider',
            '/users/oidc/callback?code=[REDACTED]&state=[REDACTED]&scope=a%20b&session_state=[REDACTED]'],
        ['/api/v1/auth/reset-password?token=%73ecret&&locale=de&token=second',
            '/api/v1/auth/reset-password?token=[REDACTED]&&locale=de&token=[REDACTED]'],
        ['/event/public-id?regToken=secret&view=all#anchor', '/event/public-id?regToken=[REDACTED]&view=all#anchor'],
        ['/api/v1/events/public-id/entry?view=guest&regToken=secret', '/api/v1/events/public-id/entry?view=guest&regToken=[REDACTED]'],
    ])('redacts current capability positions in %s', (original, expected) => {
        expect(redactAccessLogUrl(original)).toBe(expected);
    });

    it('preserves every nonsecret byte inside encoded nested return destinations', () => {
        const original = '/users/login?next=%2Fusers%2Flogin%3Fnext%3D%252Fevent%252Fid%253FregToken%253Dsecret%2526q%253Dcaf%2525c3%2525a9&locale=de';
        const expected = '/users/login?next=%2Fusers%2Flogin%3Fnext%3D%252Fevent%252Fid%253FregToken%253D[REDACTED]%2526q%253Dcaf%2525c3%2525a9&locale=de';
        expect(redactAccessLogUrl(original)).toBe(expected);
        expect(redactAccessLogUrl('/users/login?next=%2fguest%2fname%2flogin%2fse%ZZcret%3fq%3dkeep%2bvalue'))
            .toBe('/users/login?next=%2fguest%2fname%2flogin%2f[REDACTED]%3fq%3dkeep%2bvalue');
    });

    it('retains harmless query names, punctuation, encoding and malformed URL diagnostics', () => {
        for (const original of ['/help?code=404&state=visible&token=ordinary-label',
            '/missing?empty=&q=caf%c3%a9&&next=%2Fusers%2Flogin%3Fq%3Da%2520b', '/malformed/%ZZ?q=kept+as+typed']) {
            expect(redactAccessLogUrl(original)).toBe(original);
        }
    });

    it('handles deeply nested next values without recursive traversal', () => {
        const prefix = '/users/login?next='.repeat(150);
        expect(redactAccessLogUrl(prefix + '/users/activate/capability?locale=de'))
            .toBe(prefix + '/users/activate/[REDACTED]?locale=de');
    });

    it('redacts a header-sized deeply nested URL inside a bounded heap without dropping diagnostics', () => {
        // Bundle the actual public production export in memory. A bounded child
        // contains memory exhaustion if per-character mappings regress, without
        // relying on a timing ratio or copying its private implementation.
        const built = buildSync({stdin: {contents: "export {redactAccessLogUrl} from './src/backend/modules/lib/http';",
            resolveDir: process.cwd()}, platform: 'node', format: 'cjs', bundle: true, write: false});
        const exercise = built.outputFiles[0]!.text + `
const prefix = '/x?next='.repeat(1900);
for (const token of ['private', 'malformed%ZZprivate']) {
    const original = prefix + '/users/activate/' + token + '?retained=a%2fb';
    const expected = prefix + '/users/activate/[REDACTED]?retained=a%2fb';
    if (module.exports.redactAccessLogUrl(original) !== expected) process.exit(2);
}
process.stdout.write('redacted');`;
        expect(execFileSync(process.execPath, ['--max-old-space-size=64'],
            {input: exercise, encoding: 'utf8', timeout: 8000, maxBuffer: 1024})).toBe('redacted');
    });
});
