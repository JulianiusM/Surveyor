import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import * as userController from '../../src/controller/userController';
import {Profile} from '../../src/modules/database/entities/user/Profile';
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
