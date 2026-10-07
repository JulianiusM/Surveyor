import type {Request} from 'express';
import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest';
import * as userController from '../../src/controller/userController';
import {AppDataSource} from '../../src/modules/database/dataSource';
import {Profile} from '../../src/modules/database/entities/user/Profile';
import {User} from '../../src/modules/database/entities/user/User';
import * as userService from '../../src/modules/database/services/UserService';
import email from "../../src/modules/email";
import {persistIntegrationProfile, registerLocalAccount,} from '../keywords/coreDomainKeywords';
import {closeIntegrationDatabase, initializeIntegrationDatabase} from '../support/database';

let owner: Profile;
let participant: Profile;
let secondParticipant: Profile;

beforeAll(async () => {
    await initializeIntegrationDatabase();
    owner = await persistIntegrationProfile();
    participant = await persistIntegrationProfile();
    secondParticipant = await persistIntegrationProfile();
});

afterAll(async () => {
    await closeIntegrationDatabase();
});

describe('authentication user stories', () => {
    it('rechecks transport admission after credential verification before replacing an identity', async () => {
        const {id, username} = await registerLocalAccount('frontend-stale-login');
        await userService.activateUser(id);
        const session = {frontendContext: 'old-context', frontendCsrfToken: 'old-csrf'} as Request['session'];
        const rejected = new Error('identity changed during verification');
        const beforeTransition = vi.fn(async () => { throw rejected; });
        await expect(userController.loginUser({username, password: 'initial-secret'}, session, {beforeTransition})).rejects.toBe(rejected);
        expect(beforeTransition).toHaveBeenCalledOnce();
        expect(session.auth).toBeUndefined();
        expect(session.profile).toBeUndefined();
        expect(session.frontendContext).toBe('old-context');
        expect(session.frontendCsrfToken).toBe('old-csrf');
    });

    it('uses one controller workflow for frontend account and guest email links with bounded return destinations', async () => {
        const activation = vi.spyOn(email, 'sendActivationEmail').mockResolvedValue(undefined);
        const reset = vi.spyOn(email, 'sendPasswordResetEmail').mockResolvedValue(undefined);
        const guestMail = vi.spyOn(email, 'sendLinkEmail').mockResolvedValue(undefined);
        const recovery = vi.spyOn(email, 'sendGuestRecoveryEmail').mockResolvedValue(undefined);
        try {
            const next = '/frontend-pilot/packing/example?locale=de#items';
            await userController.registerUser({username: 'frontend-link-account', displayname: 'Frontend Name',
                email: 'frontend-links@example.test', password: 'initial-secret', password_repeat: 'initial-secret'},
                undefined, {frontend: true, next});
            const activateUrl = new URL(activation.mock.calls[0][1]);
            expect(activateUrl.pathname).toMatch(/^\/frontend-pilot\/users\/activate\/[^/]+$/);
            expect(activateUrl.searchParams.get('next')).toBe(next);
            await userController.sendPasswordForgotMail('frontend-link-account', {frontend: true, next: '//outside.invalid'});
            const resetUrl = new URL(reset.mock.calls[0][1]);
            expect(resetUrl.pathname).toMatch(/^\/frontend-pilot\/users\/reset-password\/[^/]+$/);
            expect(resetUrl.searchParams.get('next')).toBe('/frontend-pilot');

            const session = {} as Request['session'];
            const link = await userController.registerGuest('Frontend Guest', '  FRONTEND-GUEST@example.test  ', session,
                {frontend: true, next});
            expect(session.auth?.guest?.username).toBe('Frontend Guest');
            expect(session.profile?.guestId).toBe(session.auth?.guest?.id);
            expect(session.frontendContext).toBeTruthy();
            expect(guestMail).toHaveBeenCalledWith({name: 'Frontend Guest', address: 'frontend-guest@example.test'}, link);
            expect(new URL(link).searchParams.get('next')).toBe(next);
            await userController.recoverGuestAccount('frontend-guest@example.test', {frontend: true, next});
            const recovered = recovery.mock.calls[0][1];
            expect(recovered).toHaveLength(1);
            expect(recovered[0].link).toBe(link);
        } finally {
            activation.mockRestore(); reset.mockRestore(); guestMail.mockRestore(); recovery.mockRestore();
        }
    });

    it.each([
        ['blank-name-account', '   ', 'blank-name-account'],
        ['spaced-name-account', '  Morgan\r\n  Example  ', 'Morgan Example'],
    ])('normalizes the display name before persisting and emailing account %s', async (username, displayname, expectedName) => {
        const activation = vi.spyOn(email, 'sendActivationEmail').mockResolvedValue(undefined);
        try {
            await userController.registerUser({
                username, displayname, email: `${username}@example.test`,
                password: 'test-password1', password_repeat: 'test-password1',
            });
            const account = (await userService.getUserByUsername(username))!;
            expect(account.name).toBe(expectedName);
            expect(account.profiles[0].name).toBe(expectedName);
            expect(activation).toHaveBeenCalledWith({name: expectedName, address: `${username}@example.test`}, expect.any(String));
        } finally {
            activation.mockRestore();
        }
    });

    it('falls back to an existing account username for password recovery when its stored name is blank', async () => {
        const profile = await persistIntegrationProfile({name: ' \r\n ', username: 'legacy-blank-name', email: 'legacy-name@example.test'});
        const recovery = vi.spyOn(email, 'sendPasswordResetEmail').mockResolvedValue(undefined);
        try {
            await userController.sendPasswordForgotMail(profile.user!.username);
            expect(recovery).toHaveBeenCalledWith({name: 'legacy-blank-name', address: 'legacy-name@example.test'}, expect.any(String));
        } finally {
            recovery.mockRestore();
        }
    });

    it('addresses activation and password recovery to the saved account name', async () => {
        const activation = vi.spyOn(email, 'sendActivationEmail').mockResolvedValue(undefined);
        const recovery = vi.spyOn(email, 'sendPasswordResetEmail').mockResolvedValue(undefined);
        try {
            await userController.registerUser({
                username: 'named-email-account', displayname: 'Morgan Example', email: 'named-account@example.test',
                password: 'test-password1', password_repeat: 'test-password1',
            });
            expect(activation).toHaveBeenCalledWith(
                {name: 'Morgan Example', address: 'named-account@example.test'}, expect.stringContaining('/users/activate/'),
            );
            await userController.sendPasswordForgotMail('named-email-account');
            expect(recovery).toHaveBeenCalledWith(
                {name: 'Morgan Example', address: 'named-account@example.test'}, expect.stringContaining('/users/reset-password/'),
            );
        } finally {
            activation.mockRestore();
            recovery.mockRestore();
        }
    });

    it('uses the actual guest names when one recovery email represents multiple guest identities', async () => {
        const recovery = vi.spyOn(email, 'sendGuestRecoveryEmail').mockResolvedValue(undefined);
        try {
            await userService.createGuest('Morgan Guest', 'named-guests@example.test');
            await userService.createGuest('Casey Guest', 'named-guests@example.test');
            await userController.recoverGuestAccount('named-guests@example.test');
            expect(recovery).toHaveBeenCalledOnce();
            const [recipient, guests] = recovery.mock.calls[0];
            expect(recipient.address).toBe('named-guests@example.test');
            expect(recipient.name).toContain('Morgan Guest');
            expect(recipient.name).toContain('Casey Guest');
            expect(guests.map(guest => guest.username)).toEqual(expect.arrayContaining(['Morgan Guest', 'Casey Guest']));
        } finally {
            recovery.mockRestore();
        }
    });

    it('registers an inactive account with a usable profile', async () => {
        const {id: userId, username} = await registerLocalAccount('registration');

        const account = await userService.getUserByUsername(username);
        expect(account?.id).toBe(userId);
        expect(Boolean(account?.isActive)).toBe(false);
        expect(account?.profiles).toHaveLength(1);
    });

    it('finds a newly registered account by email', async () => {
        const {email, id: userId, username} = await registerLocalAccount('email-lookup');

        expect(await userService.getUserByEmail(email)).toMatchObject({id: userId, username});
    });

    it('accepts the registered password and rejects a wrong password', async () => {
        const {id: userId} = await registerLocalAccount('password-check');

        await expect(userService.verifyPassword(userId, 'initial-secret')).resolves.toBe(true);
        await expect(userService.verifyPassword(userId, 'wrong-secret')).resolves.toBe(false);
    });

    it('logs in an active local account with its username', async () => {
        const {id: userId, username} = await registerLocalAccount('username-login');
        await userService.activateUser(userId);
        const session = {} as Request['session'];

        await userController.loginUser({username, password: 'initial-secret'}, session);

        // Canary: the existing username credential must continue to establish the user and default-profile session.
        expect(session.auth?.user?.id).toBe(userId);
        expect(session.profile?.id).toBe(session.auth?.user?.profiles[0].id);
    });

    it('logs in an active local account with its email address', async () => {
        const {email, id: userId} = await registerLocalAccount('email-login');
        await userService.activateUser(userId);
        const session = {} as Request['session'];

        await userController.loginUser({username: email, password: 'initial-secret'}, session);

        // Regression: local users who enter their email must receive the same authenticated session as username users.
        expect(session.auth?.user?.id).toBe(userId);
        expect(session.profile?.id).toBe(session.auth?.user?.profiles[0].id);
    });

    it('activates an account with its persisted activation token', async () => {
        const {id: userId} = await registerLocalAccount('activation');

        const token = await userService.generateActivationToken(userId);
        expect((await userService.verifyActivationToken(token))?.id).toBe(userId);
        await userController.activateAccount(token);
        expect(Boolean((await userService.getUserById(userId))?.isActive)).toBe(true);
    });

    it('rejects an activation token after activation consumes it', async () => {
        const {id: userId} = await registerLocalAccount('activation-consumption');

        const token = await userService.generateActivationToken(userId);
        await userController.activateAccount(token);
        expect(await userService.verifyActivationToken(token)).toBeNull();
    });

    it('resets a password through the recovery-token workflow', async () => {
        const {id: userId, username} = await registerLocalAccount('password-reset');

        const token = await userService.generatePasswordResetToken(username);
        expect((await userService.verifyPasswordResetToken(token))?.id).toBe(userId);
        // Both native GET and v1 preflight call this non-consuming controller admission.
        await expect(userController.checkPasswordForgotToken(token)).resolves.toBeUndefined();
        await expect(userController.checkPasswordForgotToken(token)).resolves.toBeUndefined();
        await userController.resetPassword(token, {
            password: 'replacement-secret',
            confirmPassword: 'replacement-secret'
        });
        await expect(userService.verifyPassword(userId, 'replacement-secret')).resolves.toBe(true);
    });

    it('rejects a reset token after the password is changed', async () => {
        const {username} = await registerLocalAccount('reset-consumption');

        const token = await userService.generatePasswordResetToken(username);
        await userController.resetPassword(token, {
            password: 'replacement-secret',
            confirmPassword: 'replacement-secret'
        });
        expect(await userService.verifyPasswordResetToken(token)).toBeNull();
        await expect(userController.checkPasswordForgotToken(token)).rejects.toMatchObject({status: 401, cause: 'TOKEN_INVALID'});
    });

    it('rejects unknown and expired reset links before presenting the password form', async () => {
        await expect(userController.checkPasswordForgotToken('unknown-reset-token'))
            .rejects.toMatchObject({status: 401, cause: 'TOKEN_INVALID'});
        const {id, username} = await registerLocalAccount('reset-expiry');
        const token = await userService.generatePasswordResetToken(username);
        await AppDataSource.getRepository(User).update(id, {resetTokenExpiration: new Date('2000-01-01T00:00:00Z')});
        await expect(userController.checkPasswordForgotToken(token)).rejects.toMatchObject({status: 401, cause: 'TOKEN_INVALID'});
        // Rejection leaves the existing password unchanged; only a successful reset consumes it.
        await expect(userService.verifyPassword(id, 'initial-secret')).resolves.toBe(true);
    });

    it('creates a guest identity with a linked profile', async () => {
        const guest = await userService.createGuest('Camp Guest', 'camp-guest@example.com');
        expect(guest.profile).toMatchObject({name: 'Camp Guest', guestId: guest.id});
    });

    it('restores a guest session using its private link token', async () => {
        const guest = await userService.createGuest('Returning Guest');
        const token = await userService.getGuestLinkToken(guest.id);
        expect(await userService.getGuestByToken(token!, guest.id)).toMatchObject({
            id: guest.id,
            profile: {id: guest.profile.id}
        });
    });

    it('matches guest email addresses after normalization', async () => {
        const guestEmail = 'normalized-guest@example.com';
        const guest = await userService.createGuest('Normalized Guest', `  ${guestEmail.toUpperCase()}  `);
        expect((await userService.getGuestByEmail(guestEmail)).map((match) => match.id)).toContain(guest.id);
    });

    it('links an existing local account to an OIDC identity', async () => {
        const {id: userId} = await registerLocalAccount('oidc-link');

        await userService.linkUserToOidc(userId, 'https://identity.example', 'linked-subject');
        expect(await userService.getUserByOidc('https://identity.example', 'linked-subject')).toMatchObject({id: userId});
    });

    it('unlinks OIDC without deleting the local account', async () => {
        const {id: userId} = await registerLocalAccount('oidc-unlink');

        await userService.linkUserToOidc(userId, 'https://identity.example', 'unlinked-subject');
        await userService.unlinkOidc(userId);
        expect(await userService.getUserByOidc('https://identity.example', 'unlinked-subject')).toBeNull();
        expect(await userService.getUserById(userId)).not.toBeNull();
    });

    it('provisions an active OIDC account and profile just in time', async () => {
        const oidc = await userService.findOrCreateUserFromOidc('https://identity.example', {
            sub: 'jit-provisioned-subject',
            email: 'jit-user@example.com',
            preferred_username: 'jit-user',
            name: 'JIT User',
        });
        expect(oidc.oidcSub).toBe('jit-provisioned-subject');
        expect(Boolean(oidc.isActive)).toBe(true);
        expect(oidc.profiles).toHaveLength(1);
    });

    it('resolves an account by username, email, and numeric id', async () => {
        const {email, id: userId, username} = await registerLocalAccount('account-resolution');

        expect((await userService.findUserByNameOrEmail(username))?.id).toBe(userId);
        expect((await userService.findUserByNameOrEmail(email))?.id).toBe(userId);
        expect((await userService.findUserByNameOrEmail(userId))?.id).toBe(userId);
    });

    it('searches accounts without disclosing a raw email address', async () => {
        const user = await registerLocalAccount('secure-search');
        const profiles = user.profiles;
        expect(profiles).toHaveLength(1);
        const profile = profiles![0];

        const [result] = await userService.searchUsersSecure(user.username, 5);
        expect(result).toMatchObject({id: profile.id, name: profile.name, username: user.username});
        expect(result.email).not.toBe(email);
    });

});
