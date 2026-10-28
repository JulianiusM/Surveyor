import {afterEach, describe, expect, it, vi} from 'vitest';
import {Profile} from '../../src/backend/modules/database/entities/user/Profile';
import {requireCurrentMigrationToken, requireCurrentProfileOwner, requireLocalRegistrationNames} from '../../src/backend/modules/identity';

afterEach(() => vi.useRealTimers());

describe('local registration name admission', () => {
    it('counts Unicode code points through the authored schema without changing entered text', () => {
        expect(() => requireLocalRegistrationNames('u'.repeat(50), '😀'.repeat(50))).not.toThrow();
        expect(() => requireLocalRegistrationNames('😀'.repeat(50), ' Name with spaces ')).not.toThrow();
        for (const names of [['u'.repeat(51), 'Display name'], ['username', '😀'.repeat(51)]]) {
            expect(() => requireLocalRegistrationNames(...names as [string, string]))
                .toThrowError(expect.objectContaining({name: 'ValidationError', cause: 'VALIDATION_FAILED', data: {}}));
        }
    });
});

describe('current profile migration admission', () => {
    it('requires the captured principal to remain the persisted profile owner', () => {
        const profile: Profile = Object.assign(new Profile(), {id: '00000000-0000-4000-8000-000000000001', userId: 12});
        const actor = {auth: {user: {id: 12}}, profile};
        expect(() => requireCurrentProfileOwner(profile, actor)).not.toThrow();
        profile.userId = 34;
        expect(() => requireCurrentProfileOwner(profile, actor)).toThrowError(expect.objectContaining({code: 'SESSION_CONTEXT_CHANGED'}));
        expect(() => requireCurrentProfileOwner(null, actor)).toThrowError(expect.objectContaining({code: 'SESSION_CONTEXT_CHANGED'}));
    });

    it('normalizes guest UUID identity while retaining the exact migration capability', () => {
        const guestId = 'abcdef01-0000-4000-8000-000000000001';
        const profile: Profile = Object.assign(new Profile(), {guestId: guestId.toUpperCase(), migrationToken: 'CaseSensitive',
            migrationTokenExpiration: new Date(Date.now() + 60_000)});
        expect(() => requireCurrentProfileOwner(profile, {auth: {guest: {id: guestId}}})).not.toThrow();
        expect(() => requireCurrentMigrationToken(profile, 'CaseSensitive')).not.toThrow();
        expect(() => requireCurrentMigrationToken(profile, 'casesensitive')).toThrowError(expect.objectContaining({cause: 'TOKEN_INVALID'}));
        profile.guestId = undefined;
        expect(() => requireCurrentProfileOwner(profile, {auth: {guest: {id: guestId}}})).toThrow();
    });

    it('rejects expiration at the current instant and token removal after admission', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-28T10:00:00Z'));
        const profile: Profile = Object.assign(new Profile(), {migrationToken: 'current', migrationTokenExpiration: new Date(Date.now() + 1)});
        expect(() => requireCurrentMigrationToken(profile, 'current')).not.toThrow();
        vi.advanceTimersByTime(1);
        expect(() => requireCurrentMigrationToken(profile, 'current')).toThrowError(expect.objectContaining({cause: 'TOKEN_INVALID'}));
        profile.migrationTokenExpiration = new Date(Date.now() + 60_000);
        profile.migrationToken = null;
        expect(() => requireCurrentMigrationToken(profile, 'current')).toThrowError(expect.objectContaining({cause: 'TOKEN_INVALID'}));
    });
});
