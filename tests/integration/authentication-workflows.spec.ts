import {findOrCreateUserFromOidc} from '../../src/backend/modules/identity';
import type {Request, Response} from 'express';
import type {SessionData} from 'express-session';
import {randomUUID} from 'node:crypto';
import nodemailer from 'nodemailer';
import type {Transporter} from 'nodemailer';
import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest';
import * as userController from '../../src/backend/controller/userController';
import {AppDataSource} from '../../src/backend/modules/database/dataSource';
import {User} from '../../src/backend/modules/database/entities/user/User';
import {Guest} from '../../src/backend/modules/database/entities/user/Guest';
import {Profile} from '../../src/backend/modules/database/entities/user/Profile';
import {Session} from '../../src/backend/modules/database/entities/session/Session';
import * as userService from '../../src/backend/modules/database/services/UserService';
import email from "../../src/backend/modules/email";
import * as emailOwner from '../../src/backend/modules/email';
import {createSessionStore, persistSession, readStoredSession} from '../../src/backend/modules/lib/session';
import {rotateFrontendSessionContext} from '../../src/backend/modules/lib/frontendSession';
import {captureApiActor, prepareAccountRegistrationReplies, prepareGuestIdentityReplies, prepareIdentityReply, sessionView} from '../../src/backend/modules/api/session';
import {prepareValidatedJson, sendPreparedJson} from '../../src/backend/modules/api/transport';
import {ApiProblem} from '../../src/backend/modules/api/problem';
import type {PreparedApiJsonResponse} from '../../src/types/ApiTransportTypes';
import type {AccountRegistrationTransactionOptions, GuestRegistrationTransactionOptions, IdentityCompletionOptions} from '../../src/types/IdentityTypes';
import type {components} from '../../src/types/api/v1';
import {createPackingListWithItem, persistIntegrationProfile, registerLocalAccount,} from '../keywords/coreDomainKeywords';
import {closeIntegrationDatabase, initializeIntegrationDatabase} from '../support/database';
import * as identity from '../../src/backend/modules/identity';
import * as oidc from '../../src/backend/modules/oidc';
import * as openid from 'openid-client';
import settings from '../../src/backend/modules/settings';

// openid-client is external ESM with immutable namespace exports. Wrap only its
// actual discovery boundary so tests can control provider failure without HTTP.
vi.mock('openid-client', async importOriginal => {
    const original = await importOriginal<typeof import('openid-client')>();
    return {...original, discovery: vi.fn(original.discovery)};
});

beforeAll(async () => {
    await initializeIntegrationDatabase();
});

afterAll(async () => {
    await closeIntegrationDatabase();
});

describe('configured Session destruction persistence', () => {
    it('acknowledges committed soft deletion while retaining the stored row evidence', async () => {
        const req = await atomicGuestRequest();
        const repository = AppDataSource.getRepository(Session);
        const before = await repository.findOneByOrFail({id: req.sessionID});
        await new Promise<void>(function destroyStoredSession(resolve, reject) {
            req.sessionStore.destroy(req.sessionID, function destroyed(error) {
                if (error) reject(error); else resolve();
            });
        });
        expect(await readStoredSession(req.sessionStore, req.sessionID)).toBeUndefined();
        expect(await repository.findOneBy({id: req.sessionID})).toBeNull();
        const retained = await repository.findOneOrFail({where: {id: req.sessionID}, withDeleted: true});
        expect(retained.destroyedAt).toBeInstanceOf(Date);
        expect(retained.json).toBe(before.json);
        expect(retained.expiredAt).toBe(before.expiredAt);
    });
});

describe('shared guest-name bounds through committed creation', () => {
    it('rejects an overlong guest before either related row or Session changes', async () => {
        const req = await atomicGuestRequest();
        const before = JSON.stringify(req.session);
        const guests = await AppDataSource.getRepository(Guest).count();
        const profiles = await AppDataSource.getRepository(Profile).count();
        const operation = userController.registerGuestWithSession('😀'.repeat(51), undefined, req, atomicGuestOptions(req));
        await expect(operation).rejects.toMatchObject({code: 'VALIDATION_FAILED'});
        expect(await AppDataSource.getRepository(Guest).count()).toBe(guests);
        expect(await AppDataSource.getRepository(Profile).count()).toBe(profiles);
        expect(JSON.stringify(req.session)).toBe(before);
    });

    it('persists fifty supplementary code points exactly in both guest and profile', async () => {
        const req = await atomicGuestRequest();
        const name = '😀'.repeat(50);
        const committed = await userController.registerGuestWithSession(name, undefined, req, atomicGuestOptions(req));
        req.session = committed.session;
        const guest = (await userService.getGuestInternal(req.session.auth!.guest!.id))!;
        expect(guest.username).toBe(name);
        expect(guest.profile.name).toBe(name);
    });
});

describe('shared profile-name bounds', () => {
    it('rejects names before profile/default writes and preserves exact accepted code points', async () => {
        const {req} = await ordinaryLogoutFixture('account');
        const original = (await userService.getProfileById(req.session.profile!.id))!;
        const profiles = await AppDataSource.getRepository(Profile).count();
        const before = JSON.stringify(req.session);
        await expect(userController.createProfile({name: '😀'.repeat(51)}, req.session.auth!.user!.id))
            .rejects.toMatchObject({code: 'VALIDATION_FAILED'});
        await expect(userController.updateProfileWithSession({name: '😀'.repeat(51), isDefault: false}, req, profileEditOptions(req)))
            .rejects.toMatchObject({code: 'VALIDATION_FAILED'});
        expect(await AppDataSource.getRepository(Profile).count()).toBe(profiles);
        expect(await userService.getProfileById(original.id)).toMatchObject({name: original.name,
            defaultForOwner: original.defaultForOwner});
        expect(JSON.stringify(req.session)).toBe(before);

        const name = '😀'.repeat(48) + 'e\u0301';
        const created = await userController.createProfile({name}, req.session.auth!.user!.id);
        const completed = await userController.updateProfileWithSession({name, isDefault: false}, req, profileEditOptions(req));
        req.session = completed.session;
        expect((await userService.getProfileById(created.id))!.name).toBe(name);
        expect((await userService.getProfileById(original.id))!.name).toBe(name);
        expect(req.session.profile!.name).toBe(name);
    });
});

describe('atomic current-profile editing', () => {
    it('retains a completed logout and rejects the earlier admitted edit before profile writes', async () => {
        const {req} = await ordinaryLogoutFixture('account');
        const original = JSON.stringify(req.session);
        const profile = (await userService.getProfileById(req.session.profile!.id))!;

        // Two requests captured the same real stored account. Complete logout
        // through its production owner before resuming the first admitted edit.
        const logout = identityRequest();
        logout.sessionID = req.sessionID;
        logout.sessionStore = req.sessionStore;
        logout.sessionStore.createSession(logout, (await readStoredSession(req.sessionStore, req.sessionID))!);
        const actor = await captureApiActor(logout);
        const completed = await userController.logoutUserWithSession(logout, {context: actor.context,
            prepareResult: staged => prepareIdentityReply(logout, staged, 'logoutIdentity')});
        logout.session = completed.session;
        const later = (await readStoredSession(req.sessionStore, req.sessionID))!;
        expect(later.auth).toBeUndefined();
        expect(later.frontendContext).not.toBe(req.apiActor!.context);

        let rejected: unknown;
        try {
            await userController.updateProfileWithSession({name: 'Retired profile edit', isDefault: false}, req, profileEditOptions(req));
        } catch (error) { rejected = error; }

        // Assert the durable and request-local boundaries together, so a later
        // rejection alone cannot hide profile writes or restored authentication.
        const stored = (await readStoredSession(req.sessionStore, req.sessionID))!;
        const saved = (await userService.getProfileById(profile.id))!;
        // Exact serialized equality is reported as a boolean so a failure never
        // prints authentication, CSRF or private capability fields into test logs.
        expect({code: (rejected as {code?: string} | undefined)?.code,
            name: saved.name, defaultForOwner: saved.defaultForOwner,
            laterSessionRetained: JSON.stringify(stored) === JSON.stringify(later),
            originalUnchanged: JSON.stringify(req.session) === original})
            .toEqual({code: 'SESSION_CONTEXT_CHANGED', name: profile.name,
                defaultForOwner: profile.defaultForOwner, laterSessionRetained: true, originalUnchanged: true});
    });

    it('rolls back the name and peer defaults when required Session persistence fails', async () => {
        const {req} = await ordinaryLogoutFixture('account');
        const profile = (await userService.getProfileById(req.session.profile!.id))!;
        const sibling = await userService.createProfile(req.session.auth!.user!.id, 'Existing default sibling');
        await userService.updateProfileDefault(sibling.id, true);
        const original = JSON.stringify(req.session);
        const stored = JSON.stringify(await readStoredSession(req.sessionStore, req.sessionID));

        // A real database rejection exercises the configured store and the
        // operation's transaction, without replacing repositories or save logic.
        await AppDataSource.query("CREATE TRIGGER reject_profile_edit_session BEFORE UPDATE ON `session` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Controlled profile Session failure'");
        try {
            expect(await AppDataSource.getRepository(Session).existsBy({id: req.sessionID})).toBe(true);
            expect(await AppDataSource.query("SHOW TRIGGERS WHERE `Trigger` = 'reject_profile_edit_session'")).toHaveLength(1);
            // Installed connect-typeorm catches the rejected UPDATE and tries
            // INSERT for this existing SID, exposing the real duplicate-key error.
            await expect(userController.updateProfileWithSession({name: 'Uncommitted profile name', isDefault: true}, req, profileEditOptions(req)))
                .rejects.toMatchObject({name: 'QueryFailedError', code: 'ER_DUP_ENTRY', errno: 1062, sqlState: '23000'});
        } finally {
            await AppDataSource.query('DROP TRIGGER reject_profile_edit_session');
        }

        expect.soft((await userService.getProfileById(profile.id))!).toMatchObject({name: profile.name, defaultForOwner: false});
        expect.soft((await userService.getProfileById(sibling.id))!).toMatchObject({defaultForOwner: true});
        expect.soft(JSON.stringify(await readStoredSession(req.sessionStore, req.sessionID)) === stored,
            'Stored Session must remain byte-for-byte unchanged').toBe(true);
        expect.soft(JSON.stringify(req.session) === original,
            'Original request Session must remain byte-for-byte unchanged').toBe(true);
    });

    it.each(['account', 'guest'] as const)('preserves internal omitted fields and acknowledged saves for %s edits', async kind => {
        const {req} = await ordinaryLogoutFixture(kind);
        const original = req.session;
        const originalJson = JSON.stringify(original);
        const profile = original.profile!;
        const completed = await userController.updateProfileWithSession({}, req, profileEditOptions(req));

        // Internal omission keeps the exact name and coerces the absent default
        // flag to false. The public API separately requires both input fields.
        expect(completed.session.profile).toMatchObject({id: profile.id, name: profile.name, defaultForOwner: false});
        expect(JSON.parse(completed.result.json)).toEqual({changed: true});
        expect(completed.result.context).toBe(req.apiActor!.context);
        expect(completed.session.frontendContext).toBe(original.frontendContext);
        expect(completed.session.frontendCsrfToken).toBe(original.frontendCsrfToken);
        expect(req.session).toBe(original);
        expect(JSON.stringify(original) === originalJson).toBe(true);

        // An adopted response acknowledges its completed write. Saving that old
        // receipt after a later real logout cannot reinstall the earlier actor.
        req.session = completed.session;
        const loggedOut = await userController.logoutUserWithSession(req, {context: req.apiActor!.context,
            prepareResult: staged => prepareIdentityReply(req, staged, 'logoutIdentity')});
        req.session = loggedOut.session;
        const later = JSON.stringify(await readStoredSession(req.sessionStore, req.sessionID));
        await persistSession(completed.session);
        expect(JSON.stringify(await readStoredSession(req.sessionStore, req.sessionID)) === later,
            'An acknowledged profile edit must not overwrite later logout').toBe(true);
    });

    it('rolls back profile and defaults when generated acknowledgement preparation fails', async () => {
        const {req} = await ordinaryLogoutFixture('account');
        const profile = (await userService.getProfileById(req.session.profile!.id))!;
        const sibling = await userService.createProfile(req.session.auth!.user!.id, 'Default before rejected receipt');
        await userService.updateProfileDefault(sibling.id, true);
        const original = JSON.stringify(req.session);
        const stored = JSON.stringify(await readStoredSession(req.sessionStore, req.sessionID));

        /** Exercise actual output validation after the required business writes. */
        function prepareInvalidResult() {
            return prepareValidatedJson(req, 'updateIdentityProfile', 200,
                {changed: 'invalid'} as unknown as components['schemas']['MutationResult']);
        }
        await expect(userController.updateProfileWithSession({name: 'Uncommitted acknowledgement', isDefault: true}, req,
            {context: req.apiActor!.context, prepareResult: prepareInvalidResult}))
            .rejects.toMatchObject({code: 'INTERNAL_ERROR'});
        expect(await userService.getProfileById(profile.id)).toMatchObject({name: profile.name, defaultForOwner: false});
        expect(await userService.getProfileById(sibling.id)).toMatchObject({defaultForOwner: true});
        expect(JSON.stringify(req.session) === original).toBe(true);
        expect(JSON.stringify(await readStoredSession(req.sessionStore, req.sessionID)) === stored).toBe(true);
    });

    it('rechecks transferred profile ownership before editing a still-matching Session generation', async () => {
        const {req} = await ordinaryLogoutFixture('account');
        const original = JSON.stringify(req.session);
        const profile = req.session.profile!;
        const recipient = await registerLocalAccount('profile-edit-recipient');
        await userService.moveProfileToUserTx(profile.id, recipient.id);
        const stored = JSON.stringify(await readStoredSession(req.sessionStore, req.sessionID));

        await expect(userController.updateProfileWithSession({name: 'Former owner edit', isDefault: true}, req, profileEditOptions(req)))
            .rejects.toMatchObject({code: 'SESSION_CONTEXT_CHANGED'});
        expect(await userService.getProfileById(profile.id)).toMatchObject({name: profile.name, userId: recipient.id});
        expect(JSON.stringify(req.session) === original).toBe(true);
        expect(JSON.stringify(await readStoredSession(req.sessionStore, req.sessionID)) === stored).toBe(true);
    });

    it('rejects a prior profile edit after the same Session selects another owned profile', async () => {
        const {req} = await ordinaryLogoutFixture('account');
        const profile = req.session.profile!;
        const sibling = await userService.createProfile(req.session.auth!.user!.id, 'Later selected profile');
        const selected = await userController.changeActiveProfileWithSession(sibling.id, req,
            {context: req.apiActor!.context, prepareResult: staged => prepareIdentityReply(req, staged, 'switchIdentityProfile')});
        const later = JSON.stringify(await readStoredSession(req.sessionStore, req.sessionID));

        // The request deliberately retains its original admitted snapshot. The
        // matching principal alone cannot authorize editing after profile change.
        expect(selected.session.profile!.id).toBe(sibling.id);
        await expect(userController.updateProfileWithSession({name: 'Old selected profile edit', isDefault: false}, req, profileEditOptions(req)))
            .rejects.toMatchObject({code: 'SESSION_CONTEXT_CHANGED'});
        expect(await userService.getProfileById(profile.id)).toMatchObject({name: profile.name, defaultForOwner: true});
        expect(JSON.stringify(await readStoredSession(req.sessionStore, req.sessionID)) === later).toBe(true);
    });

    it.each(['absent', 'partial'] as const)('retains %s legacy transport metadata without generation rotation', async kind => {
        const {req} = await ordinaryLogoutFixture('account');
        if (kind === 'absent') delete req.session.frontendContext;
        delete req.session.frontendCsrfToken;
        await persistSession(req.session);
        req.apiActor = undefined;
        const actor = await captureApiActor(req);
        const rawContext = req.session.frontendContext;
        const completed = await userController.updateProfileWithSession({name: 'Legacy profile edit', isDefault: false}, req, profileEditOptions(req));

        expect(completed.result.context).toBe(actor.context);
        expect(completed.session.frontendContext).toBe(rawContext);
        expect(completed.session.frontendCsrfToken).toBeUndefined();
        expect(completed.session.profile!.name).toBe('Legacy profile edit');
        expect((await readStoredSession(req.sessionStore, req.sessionID))?.frontendContext).toBe(rawContext);
    });
});

describe('exact provider identity and bounded display provisioning', () => {
    it('shares exact issuer/subject lookup across full and private projected callers', async () => {
        const account = await registerLocalAccount('oidc-byte-exact');
        const issuer = 'https://identity.example/CaseSensitive';
        const subject = `CaseSensitiveSubject-${randomUUID()}`;
        await userService.linkUserToOidc(account.id, issuer, subject);
        const full = await userService.findOidcAccount(issuer, subject);
        const projected = await userService.getUserByOidc(issuer, subject);
        expect(full).toMatchObject({id: account.id, oidcIssuer: issuer, oidcSub: subject});
        expect(full!.password).toEqual(expect.any(String));
        expect(projected).toMatchObject({id: full!.id, name: full!.name, username: full!.username,
            email: full!.email, isActive: full!.isActive});
        // TypeORM constructs User class fields even when SQL did not select them.
        // Undefined credentials must stay absent from the serialized private projection.
        expect(projected!.password).toBeUndefined();
        const serializedProjection = JSON.parse(JSON.stringify(projected)) as Record<string, unknown>;
        expect(Object.keys(serializedProjection).sort()).toEqual(['email', 'id', 'isActive', 'name', 'profiles', 'username']);
        expect(projected!.profiles.map(profile => profile.id)).toEqual(full!.profiles.map(profile => profile.id));
        for (const [differentIssuer, differentSubject] of [
            [issuer.toLowerCase(), subject], [issuer, subject.toLowerCase()], [issuer, subject + ' '],
        ]) {
            expect(await userService.findOidcAccount(differentIssuer, differentSubject)).toBeNull();
            expect(await userService.getUserByOidc(differentIssuer, differentSubject)).toBeNull();
        }
        const configuration = vi.spyOn(settings, 'value', 'get').mockReturnValue({...settings.value,
            oidcLinkByEmail: false, oidcAllowEmailRebinding: false});
        try {
            const distinct = await findOrCreateUserFromOidc(issuer, {sub: subject.toLowerCase(),
                preferred_username: `distinct-${randomUUID()}`, name: 'Distinct identity'});
            expect(distinct.id).not.toBe(account.id);
            expect(distinct.oidcSub).toBe(subject.toLowerCase());
        } finally { configuration.mockRestore(); }
    });

    it('projects a new provider display once and never changes an existing exact account name', async () => {
        const configuration = vi.spyOn(settings, 'value', 'get').mockReturnValue({...settings.value,
            oidcLinkByEmail: false, oidcAllowEmailRebinding: false});
        const issuer = `https://identity.example/${randomUUID()}`;
        const subject = `CaseSubject-${randomUUID()}`;
        try {
            const user = await findOrCreateUserFromOidc(issuer, {sub: subject,
                preferred_username: `provider-${randomUUID()}`, name: '😀'.repeat(51)});
            expect(user.name).toBe('😀'.repeat(50));
            expect(user.profiles[0].name).toBe(user.name);
            expect(user.oidcIssuer).toBe(issuer);
            expect(user.oidcSub).toBe(subject);
            const again = await findOrCreateUserFromOidc(issuer, {sub: subject, name: 'Changed upstream name'});
            expect(again.id).toBe(user.id);
            expect(again.name).toBe(user.name);
        } finally { configuration.mockRestore(); }
    });
});

describe('local registration name bounds through committed completion', () => {
    it('rejects either overlength name before account/profile writes or mail preparation', async () => {
        const req = await initialIdentityRequest();
        const originalSession = JSON.stringify(req.session);
        const userCount = await AppDataSource.getRepository(User).count();
        const profileCount = await AppDataSource.getRepository(Profile).count();
        const {prepared, deliver} = preparedMailDelivery(true);
        try {
            for (const field of ['username', 'displayname']) {
                const input = {...accountRegistrationInput(`name-limit-${randomUUID().slice(0, 8)}`), [field]: '😀'.repeat(51)};
                const operation = userController.registerUserWithSession(input, req, atomicAccountOptions(req));
                await expect(operation).rejects.toMatchObject({name: 'ValidationError', cause: 'VALIDATION_FAILED', data: {}});
                expect(await AppDataSource.getRepository(User).count()).toBe(userCount);
                expect(await AppDataSource.getRepository(Profile).count()).toBe(profileCount);
            }
            expect(prepared).not.toHaveBeenCalled();
            expect(deliver).not.toHaveBeenCalled();
            expect(JSON.stringify(req.session)).toBe(originalSession);
        } finally { prepared.mockRestore(); }
    });

    it('persists fifty Unicode code points exactly in the account and default profile', async () => {
        const suffix = randomUUID().slice(0, 8);
        const input = {...accountRegistrationInput('😀'.repeat(42) + suffix),
            displayname: '😀'.repeat(50), email: `unicode-${suffix}@example.test`};
        const {prepared} = preparedMailDelivery(true);
        try {
            const req = await initialIdentityRequest();
            await userController.registerUserWithSession(input, req, atomicAccountOptions(req));
            const account = await AppDataSource.getRepository(User).findOneOrFail({
                where: {username: input.username}, relations: {profiles: true},
            });
            expect(account.username).toBe(input.username);
            expect(account.name).toBe(input.displayname);
            expect(account.profiles).toHaveLength(1);
            expect(account.profiles[0].name).toBe(input.displayname);
        } finally { prepared.mockRestore(); }
    });
});

describe('approved new-password admission through committed completion', () => {
    it('rejects short Unicode and over-limit byte inputs before registration writes or mail preparation', async () => {
        const req = await initialIdentityRequest();
        const originalSession = JSON.stringify(req.session);
        const userCount = await AppDataSource.getRepository(User).count();
        const profileCount = await AppDataSource.getRepository(Profile).count();
        const {prepared, deliver} = preparedMailDelivery(true);
        // Fourteen astral characters exceed the old UTF-16 minimum but are still
        // too short. Both ASCII and multibyte 73-byte inputs exceed bcrypt's bound.
        const rejected = ['😀'.repeat(14), 'a'.repeat(73), '😀'.repeat(18) + 'a'];
        try {
            for (const password of rejected) {
                const input = {...accountRegistrationInput(`rejected-password-${randomUUID().slice(0, 8)}`),
                    password, password_repeat: password};
                const operation = userController.registerUserWithSession(input, req, atomicAccountOptions(req));
                await expect(operation).rejects.toMatchObject({name: 'ValidationError', cause: 'VALIDATION_FAILED', data: {}});
                await expect(operation).rejects.toHaveProperty('data', {});
                expect(await AppDataSource.getRepository(User).count()).toBe(userCount);
                expect(await AppDataSource.getRepository(Profile).count()).toBe(profileCount);
            }
            expect(prepared).not.toHaveBeenCalled();
            expect(deliver).not.toHaveBeenCalled();
            expect(JSON.stringify(req.session)).toBe(originalSession);
            expect(await readStoredSession(req.sessionStore, req.sessionID)).toBeUndefined();
        } finally { prepared.mockRestore(); }
    });

    it('rejects invalid replacement passwords without changing the hash, reset capability or stored session', async () => {
        // Pure DBAL intentionally seeds an existing short credential; creation
        // policy must not move into persistence or invalidate existing login.
        const account = await registerLocalAccount('password-policy-reset');
        const token = await userService.generatePasswordResetToken(account.username);
        const before = await AppDataSource.getRepository(User).findOneByOrFail({id: account.id});
        const req = await atomicGuestRequest();
        const stored = await AppDataSource.getRepository(Session).findOneByOrFail({id: req.sessionID});
        const originalSession = JSON.stringify(req.session);
        const prepareResult = vi.fn(() => prepareValidatedJson(req, 'resetAccountPassword', 200, {changed: true}));
        for (const password of ['😀'.repeat(14), 'a'.repeat(73), '😀'.repeat(18) + 'a']) {
            const input = {password, confirmPassword: password};
            const operation = userController.resetPasswordWithSession(token, input, req, {context: req.apiActor!.context, prepareResult});
            await expect(operation).rejects.toMatchObject({name: 'ValidationError', cause: 'VALIDATION_FAILED', data: {}});
            await expect(operation).rejects.toHaveProperty('data', {});
            const after = await AppDataSource.getRepository(User).findOneByOrFail({id: account.id});
            expect(after.password).toBe(before.password);
            expect(after.resetToken).toBe(before.resetToken);
            expect(after.resetTokenExpiration).toEqual(before.resetTokenExpiration);
            expect(await userService.verifyPasswordResetToken(token)).toMatchObject({id: account.id});
        }
        expect(prepareResult).not.toHaveBeenCalled();
        expect(JSON.stringify(req.session)).toBe(originalSession);
        expect((await AppDataSource.getRepository(Session).findOneByOrFail({id: req.sessionID})).json).toBe(stored.json);
        expect(await userService.verifyPassword(account.id, 'initial-secret')).toBe(true);
    });

    it.each([
        {label: '15 lowercase code points without a digit', password: 'a'.repeat(15)},
        {label: '15 astral code points without ASCII categories', password: '😀'.repeat(15)},
        {label: 'exactly 72 UTF-8 bytes', password: '😀'.repeat(18)},
        {label: 'decomposed Unicode and surrounding spaces', password: '  cafe\u0301-not-normalized  '},
    ])('registers and resets the exact $label input', async ({password}) => {
        const username = `exact-password-${randomUUID().slice(0, 8)}`;
        const input = {...accountRegistrationInput(username), password, password_repeat: password};
        const {prepared} = preparedMailDelivery(true);
        try {
            const req = await initialIdentityRequest();
            await userController.registerUserWithSession(input, req, atomicAccountOptions(req));
        } finally { prepared.mockRestore(); }

        const registered = await AppDataSource.getRepository(User).findOneByOrFail({username});
        expect(registered.password).not.toBe(password);
        expect(await userService.verifyPassword(registered.id, password)).toBe(true);
        // Byte admission does not authorize trimming or NFC conversion. Compare
        // through the real hash owner before and after reset, using distinct inputs.
        const changedInputs = [...new Set([password.trim(), password.normalize('NFC')])]
            .filter(value => value !== password);
        for (const changed of changedInputs) expect(await userService.verifyPassword(registered.id, changed)).toBe(false);

        const token = await userService.generatePasswordResetToken(username);
        const replacement = {password, confirmPassword: password};
        const req = await atomicGuestRequest();
        await userController.resetPasswordWithSession(token, replacement, req, {context: req.apiActor!.context,
            prepareResult: () => prepareValidatedJson(req, 'resetAccountPassword', 200, {changed: true})});
        const reset = await AppDataSource.getRepository(User).findOneByOrFail({id: registered.id});
        expect(reset.password).not.toBe(registered.password);
        expect(await userService.verifyPassword(registered.id, password)).toBe(true);
        for (const changed of changedInputs) expect(await userService.verifyPassword(registered.id, changed)).toBe(false);
        expect(await userService.verifyPasswordResetToken(token)).toBeNull();
    });
});

describe('approved profile migration locking and completion', () => {
    it('rejects former-owner issuance and rolls back capability replacement when its reply cannot prepare', async () => {
        const guest = await userService.createGuest(`Migration source ${randomUUID().slice(0, 8)}`);
        const actor = {auth: {guest}, profile: guest.profile};
        const initial = await userController.requestProfileMigrationToken(actor);
        await expect(userController.requestProfileMigrationToken(actor, () => { throw new Error('Rejected capability receipt'); }))
            .rejects.toMatchObject({code: 'WORKFLOW_OUTCOME_UNKNOWN'});
        expect((await userService.getProfileById(guest.profile.id))?.migrationToken).toBe(initial.token);

        const recipient = await registerLocalAccount('issuance-recipient');
        await userService.moveProfileToUserTx(guest.profile.id, recipient.id);
        await expect(userController.requestProfileMigrationToken(actor)).rejects.toMatchObject({code: 'SESSION_CONTEXT_CHANGED'});
        expect(await userService.getProfileById(guest.profile.id)).toMatchObject({userId: recipient.id, migrationToken: null});
    });

    it('allows only one competing transfer to consume the same current capability', async () => {
        const guest = await userService.createGuest(`One consumption ${randomUUID().slice(0, 8)}`);
        const recipient = await registerLocalAccount('first-recipient');
        const contender = await registerLocalAccount('second-recipient');
        const {token} = await userController.requestProfileMigrationToken({auth: {guest}, profile: guest.profile});
        const entered = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        const first = identity.migrateProfile(recipient.id, token, async cleanup => {
            entered.resolve();
            await release.promise;
            return cleanup;
        });
        await entered.promise;
        const second = identity.migrateProfile(contender.id, token, cleanup => cleanup);
        // Both actual database operations are entered before releasing the first
        // transaction; the capability check must be repeated after any lock wait.
        release.resolve();
        const results = await Promise.allSettled([first, second]);
        expect(results[0]).toMatchObject({status: 'fulfilled', value: 'guest-deleted'});
        expect(results[1]).toMatchObject({status: 'rejected', reason: {cause: 'TOKEN_INVALID'}});
        expect(await userService.getProfileById(guest.profile.id)).toMatchObject({userId: recipient.id,
            guestId: null, migrationToken: null, migrationTokenExpiration: null});
        expect(await AppDataSource.getRepository(Guest).findOneBy({id: guest.id})).toBeNull();
    });

    it('rolls back transfer, token consumption and former-owner deletion when completion preparation fails', async () => {
        const guest = await userService.createGuest(`Rollback transfer ${randomUUID().slice(0, 8)}`);
        const recipient = await registerLocalAccount('rollback-recipient');
        const {token} = await userController.requestProfileMigrationToken({auth: {guest}, profile: guest.profile});
        await expect(identity.migrateProfile(recipient.id, token, () => { throw new Error('Rejected transfer receipt'); }))
            .rejects.toThrow('Rejected transfer receipt');
        expect(await userService.getProfileById(guest.profile.id)).toMatchObject({guestId: guest.id, userId: null, migrationToken: token});
        expect(await AppDataSource.getRepository(Guest).findOneBy({id: guest.id})).not.toBeNull();
    });

    it('serializes reciprocal transfers through a consistent account lock order', async () => {
        const first = await registerLocalAccount('reciprocal-first');
        const second = await registerLocalAccount('reciprocal-second');
        const firstProfile = (await userService.getProfilesForUser(first.id))[0];
        const secondProfile = (await userService.getProfilesForUser(second.id))[0];
        await userService.createProfile(first.id, 'Remaining first profile');
        await userService.createProfile(second.id, 'Remaining second profile');
        const {token: firstToken} = await userController.requestProfileMigrationToken({auth: {user: {id: first.id}}, profile: firstProfile});
        const {token: secondToken} = await userController.requestProfileMigrationToken({auth: {user: {id: second.id}}, profile: secondProfile});
        const render = emailOwner.prepareMigrationEmail;
        const prepared = vi.spyOn(emailOwner, 'prepareMigrationEmail').mockImplementation((...args) => {
            render(...args);
            return {deliver: vi.fn().mockResolvedValue(true)};
        });
        try {
            await expect(Promise.all([
                identity.migrateProfile(second.id, firstToken, cleanup => cleanup),
                identity.migrateProfile(first.id, secondToken, cleanup => cleanup),
            ])).resolves.toEqual(['none', 'none']);
        } finally { prepared.mockRestore(); }
        expect(await userService.getProfileById(firstProfile.id)).toMatchObject({userId: second.id, migrationToken: null});
        expect(await userService.getProfileById(secondProfile.id)).toMatchObject({userId: first.id, migrationToken: null});
    });

    it('rolls back ownership and capability when required former-owner database cleanup fails', async () => {
        const guest = await userService.createGuest(`Cleanup failure ${randomUUID().slice(0, 8)}`);
        const recipient = await registerLocalAccount('cleanup-recipient');
        const {token} = await userController.requestProfileMigrationToken({auth: {guest}, profile: guest.profile});
        // Only this guarded disposable suite schema receives the temporary failure
        // trigger. Persistence and the complete production workflow stay real.
        await AppDataSource.query("CREATE TRIGGER reject_migration_cleanup BEFORE DELETE ON guests FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Controlled owner cleanup failure'");
        try {
            await expect(identity.migrateProfile(recipient.id, token, cleanup => cleanup)).rejects.toThrow('Controlled owner cleanup failure');
        } finally { await AppDataSource.query('DROP TRIGGER reject_migration_cleanup'); }
        expect(await userService.getProfileById(guest.profile.id)).toMatchObject({guestId: guest.id, userId: null, migrationToken: token});
        expect(await AppDataSource.getRepository(Guest).findOneBy({id: guest.id})).not.toBeNull();
    });
});

/** Construct the ordinary library Session without persisting an anonymous visitor. */
function identityRequest(): Request {
    const store = createSessionStore(AppDataSource.manager);
    const req = {sessionID: randomUUID(), sessionStore: store,
        get: function getHeader(name: string) { return name.toLowerCase() === 'x-surveyor-locale' ? 'en' : undefined; },
    } as unknown as Request;
    store.createSession(req, {cookie: {expires: new Date(Date.now() + 86_400_000), originalMaxAge: 86_400_000,
        httpOnly: true, secure: false, path: '/', sameSite: 'lax'}} as SessionData);
    return req;
}

/** Persist an existing anonymous cookie session for the established coexistence cases. */
async function atomicGuestRequest(): Promise<Request> {
    const req = identityRequest();
    rotateFrontendSessionContext(req.session);
    await persistSession(req.session);
    req.apiActor = {context: req.session.frontendContext!};
    return req;
}

/** Admit a first explicit action from the same uninitialized candidate as a cookie-free browser. */
async function initialIdentityRequest(): Promise<Request> {
    const req = identityRequest();
    await captureApiActor(req);
    return req;
}

/** Bind the same production response preparer used by the versioned route. */
function atomicGuestOptions(req: Request): GuestRegistrationTransactionOptions<PreparedApiJsonResponse> {
    function prepareResult(staged: Request['session'], personalLink: string) {
        return prepareGuestIdentityReplies(req, staged, personalLink);
    }
    return {frontend: true, next: '/', context: req.apiActor!.context, prepareResult};
}

/** Check both real related tables after a rollback, rather than mocking creation repositories. */
async function expectGuestAbsent(username: string): Promise<void> {
    expect(await AppDataSource.getRepository(Guest).countBy({username})).toBe(0);
    expect(await AppDataSource.getRepository(Profile).countBy({name: username})).toBe(0);
}

/** Signup uses the production generated reply owner while preserving this anonymous actor. */
function atomicAccountOptions(req: Request): AccountRegistrationTransactionOptions<PreparedApiJsonResponse> {
    function prepareResult() {
        return prepareAccountRegistrationReplies(req);
    }
    return {frontend: true, next: '/', context: req.apiActor!.context, prepareResult};
}

/** Keep valid credentials private to the production registration call and its real ORM fixture. */
function accountRegistrationInput(username: string) {
    return {username, displayname: username, email: `${username}@example.test`,
        password: 'registration-secret', password_repeat: 'registration-secret'};
}

/** Replace only SMTP; the selected production recipient and template preparation still run. */
function preparedMailDelivery(accepted: boolean,
    method: 'prepareActivationEmail' | 'preparePasswordResetEmail' | 'prepareGuestLinkEmail' = 'prepareActivationEmail') {
    const render = emailOwner[method];
    const deliver = vi.fn().mockResolvedValue(accepted);
    const prepared = vi.spyOn(emailOwner, method).mockImplementation(function prepareMail(recipient, link) {
        render(recipient, link);
        return {deliver};
    });
    return {prepared, deliver};
}

/** Use the actual activation contract before token consumption and optional document persistence. */
function activationOptions(req: Request, persistCompletion = false): IdentityCompletionOptions<PreparedApiJsonResponse> {
    function prepareResult() {
        return prepareValidatedJson(req, 'activateIdentity', 200, {changed: true});
    }
    return {context: req.apiActor!.context, persistCompletion, prepareResult};
}

/** Keep profile-edit regressions on the live route's generated acknowledgement. */
function profileEditOptions(req: Request): IdentityCompletionOptions<PreparedApiJsonResponse> {
    function prepareResult() {
        return prepareValidatedJson(req, 'updateIdentityProfile', 200, {changed: true});
    }
    return {context: req.apiActor!.context, prepareResult};
}

type OrdinaryIdentityKind = 'account' | 'guest' | 'profile';

/** Actual owned identity records drive the three production completion adapters; repositories are never mocked. */
async function ordinaryIdentityFixture(kind: OrdinaryIdentityKind) {
    const req = await atomicGuestRequest();
    let username = '';
    let guestId = '';
    let guestToken = '';
    let profileId = '';
    if (kind === 'guest') {
        const guest = await userService.createGuest(`Existing guest ${randomUUID().slice(0, 8)}`);
        guestId = guest.id;
        guestToken = guest.token;
    } else {
        const account = await registerLocalAccount(`ordinary-${kind}`);
        username = account.username;
        await userService.activateUser(account.id);
        if (kind === 'profile') {
            const user = await userService.getUserById(account.id);
            const second = await AppDataSource.getRepository(Profile).save({name: 'Second owned profile',
                defaultForOwner: false, user: user!});
            const current = await userService.getUserById(account.id);
            req.session.auth = {user: current!};
            req.session.profile = userController.getDefaultProfile(current!.profiles);
            await persistSession(req.session);
            req.apiActor = {context: req.session.frontendContext!, auth: req.session.auth, profile: req.session.profile};
            profileId = second.id;
        }
    }
    const operation: Parameters<typeof prepareIdentityReply>[2] = kind === 'account' ? 'loginIdentity'
        : kind === 'guest' ? 'loginGuestIdentity' : 'switchIdentityProfile';
    function prepareResult(staged: Request['session']) {
        return prepareIdentityReply(req, staged, operation);
    }
    const options: IdentityCompletionOptions<PreparedApiJsonResponse> = {context: req.apiActor!.context, prepareResult};
    function run(selected = options) {
        if (kind === 'account') return userController.loginUserWithSession({username, password: 'initial-secret'}, req, selected);
        if (kind === 'guest') return userController.loginGuestWithSession(guestId, guestToken, req, selected);
        return userController.changeActiveProfileWithSession(profileId, req, selected);
    }
    return {req, options, run, operation};
}

/** Begin logout from real persisted account/guest authority with the normal writable store session. */
async function ordinaryLogoutFixture(kind: Exclude<OrdinaryIdentityKind, 'profile'>) {
    const {req, run} = await ordinaryIdentityFixture(kind);
    await run();
    const stored = await readStoredSession(req.sessionStore, req.sessionID);
    req.sessionStore.createSession(req, stored!);
    req.session.frontendAuthReturn = '/packing/return-after-login';
    await persistSession(req.session);
    req.apiActor = {context: req.session.frontendContext!, auth: req.session.auth, profile: req.session.profile};

    function prepareResult(staged: Request['session']) {
        return prepareIdentityReply(req, staged, 'logoutIdentity');
    }
    const options: IdentityCompletionOptions<PreparedApiJsonResponse> = {context: req.apiActor.context, prepareResult};
    return {req, options};
}

/** Capture only HTTP delivery; the production generated API preparer owns validation and serialization. */
function preparedResponse() {
    const headers = new Map<string, string>();
    let body: string | null = null;
    let statusCode: number | null = null;
    const res = {
        set: function setHeader(name: string, value: string) { headers.set(name, value); return res; },
        type: function setType(value: string) { headers.set('Content-Type', value); return res; },
        status: function setStatus(value: number) { statusCode = value; return res; },
        vary: function varyHeader(_name: string) { return res; },
        send: function sendBody(value: string) { body = value; return res; },
    } as unknown as Response;
    return {res, headers, get body() { return body; }, get statusCode() { return statusCode; }};
}

/** Persist malformed server evidence to exercise retirement before any principal lookup.
 * The real session row/store, rather than a substituted repository, owns this fixture. */
async function invalidAdmissionRequest(): Promise<Request> {
    const req = await atomicGuestRequest();
    const stored = JSON.parse(JSON.stringify(req.session)) as SessionData;
    stored.auth = {user: {id: -1} as User, guest: {id: randomUUID()} as Guest};
    stored.tokens = {access_token: 'stored-access-evidence', token_type: 'bearer', id_token: 'stored-provider-evidence'};
    req.sessionStore.createSession(req, stored);
    await persistSession(req.session);
    req.apiActor = undefined;
    return req;
}

describe('read-only frontend session admission', () => {
    it('projects a cookie-free anonymous visit without creating or mutating its server session', async () => {
        const req = identityRequest();
        const original = req.session;
        const before = JSON.stringify(original);

        const view = await sessionView(req);
        expect(view).toMatchObject({kind: 'anonymous', context: null, csrfToken: null});
        expect(req.session).toBe(original);
        expect(JSON.stringify(original)).toBe(before);
        expect(req.apiSessionStored).toBe(false);
        expect(await AppDataSource.getRepository(Session).findOneBy({id: req.sessionID})).toBeNull();
    });

    it.each(['account', 'guest'] as const)('projects a valid legacy %s without persisting metadata or changing its Session', async kind => {
        const {req, run} = await ordinaryIdentityFixture(kind);
        await run();
        const stored = await readStoredSession(req.sessionStore, req.sessionID);
        req.sessionStore.createSession(req, stored!);
        delete req.session.frontendContext;
        delete req.session.frontendCsrfToken;
        await persistSession(req.session);
        req.apiActor = undefined;
        const original = req.session;
        const originalJson = JSON.stringify(original);
        const before = await AppDataSource.getRepository(Session).findOneByOrFail({id: req.sessionID});

        const view = await sessionView(req);
        expect(view.kind).toBe(kind);
        expect(view.context).toBeTruthy();
        expect(view.csrfToken).toBeTruthy();
        expect(view.csrfToken).not.toBe(view.context);
        expect(JSON.stringify(view)).not.toContain(req.sessionID);
        expect(req.session).toBe(original);
        expect(JSON.stringify(original)).toBe(originalJson);
        req.apiActor = undefined;
        expect((await sessionView(req)).context).toBe(view.context);
        const after = await AppDataSource.getRepository(Session).findOneByOrFail({id: req.sessionID});
        expect(after.json).toBe(before.json);
        expect(after.expiredAt).toBe(before.expiredAt);

        // The same server principal/profile in another real session cannot
        // reuse this session's derived context or CSRF proof.
        const other = identityRequest();
        other.sessionStore.createSession(other, JSON.parse(originalJson) as SessionData);
        await persistSession(other.session);
        const otherView = await sessionView(other);
        expect(otherView.context).not.toBe(view.context);
        expect(otherView.csrfToken).not.toBe(view.csrfToken);
        expect(other.session.frontendContext).toBeUndefined();
        expect(other.session.frontendCsrfToken).toBeUndefined();
    });

    it.each(['account', 'guest'] as const)('retains the admitted partial-legacy %s scope in actor-preserving prepared receipts', async kind => {
        const {req, run} = await ordinaryIdentityFixture(kind);
        await run();
        const stored = await readStoredSession(req.sessionStore, req.sessionID);
        req.sessionStore.createSession(req, stored!);
        // Keep a real stored context while removing only CSRF. This forces the
        // read-only fallback to differ from the raw partial generation; missing
        // both fields would accidentally exercise a default-argument shortcut.
        delete req.session.frontendCsrfToken;
        await persistSession(req.session);
        req.apiActor = undefined;
        const original = req.session;
        const originalJson = JSON.stringify(original);
        const actor = await captureApiActor(req);
        expect(actor.context).toBeTruthy();
        expect(actor.context).not.toBe(original.frontendContext);
        const before = await AppDataSource.getRepository(Session).findOneByOrFail({id: req.sessionID});

        // Signup and activation use the actual locked transaction, generated
        // response preparation and mail renderer. Only SMTP delivery is replaced.
        const username = `partial-legacy-${kind}-${randomUUID().slice(0, 8)}`;
        const {prepared} = preparedMailDelivery(true);
        try {
            const signup = await userController.registerUserWithSession(accountRegistrationInput(username), req, atomicAccountOptions(req));
            expect(signup.result.context).toBe(actor.context);
            const account = await AppDataSource.getRepository(User).findOneByOrFail({username});
            const activation = await userController.activateAccountWithSession(account.activationToken!, req, activationOptions(req));
            expect(activation.result.context).toBe(actor.context);
            const response = preparedResponse();
            sendPreparedJson(req, response.res, activation.result);
            expect(response.headers.get('X-Surveyor-Context')).toBe(actor.context);
            expect(await userService.verifyActivationToken(account.activationToken!)).toBeNull();

            // Neither unchanged-actor operation installs staging, repairs the
            // partial Session or writes its row merely to deliver confirmation.
            const after = await AppDataSource.getRepository(Session).findOneByOrFail({id: req.sessionID});
            expect(after.json).toBe(before.json);
            expect(after.expiredAt).toBe(before.expiredAt);
            expect(req.session).toBe(original);
            expect(JSON.stringify(original)).toBe(originalJson);
        } finally { prepared.mockRestore(); }
    });

    it('rejects malformed stored authority without clearing provider evidence or writing on admission', async () => {
        const req = await invalidAdmissionRequest();
        const original = req.session;
        const before = await AppDataSource.getRepository(Session).findOneByOrFail({id: req.sessionID});

        await expect(captureApiActor(req)).rejects.toMatchObject({code: 'AUTH_REQUIRED'});
        const after = await AppDataSource.getRepository(Session).findOneByOrFail({id: req.sessionID});
        expect(after.json).toBe(before.json);
        expect(after.expiredAt).toBe(before.expiredAt);
        expect(req.session).toBe(original);
        expect(original.tokens?.id_token).toBe('stored-provider-evidence');
    });

    it('rejects a changed stored generation without installing it into the middleware Session', async () => {
        const req = await atomicGuestRequest();
        req.apiActor = undefined;
        const original = req.session;
        const current = JSON.parse(JSON.stringify(original)) as SessionData;
        current.frontendContext = 'later-server-context';
        current.frontendCsrfToken = 'later-server-csrf';
        await AppDataSource.getRepository(Session).update({id: req.sessionID}, {json: JSON.stringify(current)});

        await expect(captureApiActor(req)).rejects.toMatchObject({code: 'SESSION_CONTEXT_CHANGED'});
        expect(req.session).toBe(original);
        expect(original.frontendContext).not.toBe(current.frontendContext);
        expect(await readStoredSession(req.sessionStore, req.sessionID)).toMatchObject({
            frontendContext: current.frontendContext, frontendCsrfToken: current.frontendCsrfToken,
        });
    });

    it('retains stored authority when its actual admission store read fails', async () => {
        const req = await invalidAdmissionRequest();
        const before = await AppDataSource.getRepository(Session).findOneByOrFail({id: req.sessionID});
        const failure = new Error('Controlled session-store read failure');
        const failedRead = vi.spyOn(req.sessionStore, 'get').mockImplementationOnce(function rejectRead(_id, callback) {
            callback(failure);
        });
        try {
            await expect(captureApiActor(req)).rejects.toBe(failure);
            const after = await AppDataSource.getRepository(Session).findOneByOrFail({id: req.sessionID});
            expect(after.json).toBe(before.json);
            expect(after.expiredAt).toBe(before.expiredAt);
        } finally { failedRead.mockRestore(); }
    });

    it('does not reinterpret a recognized metadata-less record as a first session after it disappears', async () => {
        const req = identityRequest();
        await persistSession(req.session);
        Object.assign(req, {headers: {cookie: 'existing-server-cookie'}});
        await captureApiActor(req);
        expect(req.apiSessionStored).toBe(true);
        expect(req.apiActor?.context).toBeNull();
        await AppDataSource.getRepository(Session).delete({id: req.sessionID});
        const username = `Retired legacy anonymous ${randomUUID().slice(0, 8)}`;

        await expect(userController.registerGuestWithSession(username, undefined, req, atomicGuestOptions(req)))
            .rejects.toMatchObject({code: 'SESSION_CONTEXT_CHANGED'});
        await expectGuestAbsent(username);
        expect(await AppDataSource.getRepository(Session).findOneBy({id: req.sessionID})).toBeNull();
    });
});
describe('atomic versioned guest registration', () => {
    it('creates the first guest, profile, completed session and receipt in one transaction', async () => {
        const req = await initialIdentityRequest();
        const original = req.session;
        const before = JSON.stringify(original);
        const username = `First guest ${randomUUID().slice(0, 8)}`;
        expect(await readStoredSession(req.sessionStore, req.sessionID)).toBeUndefined();

        const committed = await userController.registerGuestWithSession(username, undefined, req, atomicGuestOptions(req));
        const reply = JSON.parse(committed.result.json) as components['schemas']['IdentityResult'];
        const stored = await readStoredSession(req.sessionStore, req.sessionID);
        expect(stored?.auth.guest?.username).toBe(username);
        expect(stored?.profile?.name).toBe(username);
        expect(reply.session).toMatchObject({kind: 'guest', context: stored!.frontendContext,
            csrfToken: stored!.frontendCsrfToken, activeProfile: {id: stored!.profile!.id}});
        expect(req.session).toBe(original);
        expect(JSON.stringify(original)).toBe(before);
        expect(committed.session).not.toBe(original);
    });

    it('leaves no anonymous row or identity rows when first guest result preparation fails', async () => {
        const req = await initialIdentityRequest();
        const username = `Rejected first guest ${randomUUID().slice(0, 8)}`;
        const failure = new Error('Controlled first completion failure');
        const options = atomicGuestOptions(req);
        function rejectPreparedResult(): never { throw failure; }
        options.prepareResult = rejectPreparedResult;

        await expect(userController.registerGuestWithSession(username, undefined, req, options)).rejects.toBe(failure);
        await expectGuestAbsent(username);
        expect(await readStoredSession(req.sessionStore, req.sessionID)).toBeUndefined();
        expect(req.session.auth).toBeUndefined();
        expect(req.session.frontendContext).toBeUndefined();
    });

    it('commits guest, profile and stored identity together with a prevalidated private receipt', async () => {
        const req = await atomicGuestRequest();
        const original = req.session;
        const context = original.frontendContext;
        const username = `Atomic ${randomUUID().slice(0, 8)}`;
        const committed = await userController.registerGuestWithSession(username, undefined, req, atomicGuestOptions(req));
        const reply = JSON.parse(committed.result.json) as components['schemas']['IdentityResult'];
        const stored = await readStoredSession(req.sessionStore, req.sessionID);

        expect(req.session).toBe(original);
        expect(req.session.auth).toBeUndefined();
        expect(stored?.frontendContext).not.toBe(context);
        expect(reply).toMatchObject({emailDelivery: 'not-requested', session: {kind: 'guest', context: stored!.frontendContext,
            activeProfile: {id: stored!.profile!.id, name: username}}});
        expect(committed.result.context).toBe(reply.session.context);
        expect(await userService.getGuestInternal(stored!.auth.guest!.id)).toMatchObject({username, profile: {id: stored!.profile!.id}});
        expect(reply.personalLink).toContain(`/guest/${stored!.auth.guest!.id}/login/`);
        expect(committed.result.json).not.toContain('"token"');
    });

    it('rolls back both new rows when output validation rejects before session persistence', async () => {
        const req = await atomicGuestRequest();
        const original = JSON.stringify(req.session);
        const username = `Invalid receipt ${randomUUID().slice(0, 8)}`;
        const options = atomicGuestOptions(req);
        function prepareInvalidResult(staged: Request['session'], personalLink: string) {
            staged.frontendCsrfToken = '';
            return prepareGuestIdentityReplies(req, staged, personalLink);
        }
        options.prepareResult = prepareInvalidResult;

        await expect(userController.registerGuestWithSession(username, undefined, req, options))
            .rejects.toMatchObject({code: 'INTERNAL_ERROR'});
        await expectGuestAbsent(username);
        expect(JSON.stringify(req.session)).toBe(original);
        expect((await readStoredSession(req.sessionStore, req.sessionID))?.frontendContext).toBe(req.apiActor!.context);
    });

    it('rolls back guest and profile when the configured store cannot serialize the staged session', async () => {
        const req = await atomicGuestRequest();
        const original = JSON.stringify(req.session);
        const username = `Invalid stored ${randomUUID().slice(0, 8)}`;
        const options = atomicGuestOptions(req);
        function prepareUnserializableSession(staged: Request['session'], personalLink: string) {
            const replies = prepareGuestIdentityReplies(req, staged, personalLink);
            // The actual store's JSON writer rejects this cycle after the valid
            // wire replies exist, exercising rollback at persistence preparation.
            Object.defineProperty(staged, 'serializationCycle', {value: staged, enumerable: true});
            return replies;
        }
        options.prepareResult = prepareUnserializableSession;

        await expect(userController.registerGuestWithSession(username, undefined, req, options)).rejects.toBeInstanceOf(TypeError);
        await expectGuestAbsent(username);
        expect(JSON.stringify(req.session)).toBe(original);
        expect((await readStoredSession(req.sessionStore, req.sessionID))?.frontendContext).toBe(req.apiActor!.context);
    });

    it.each(['stale', 'expired', 'destroyed', 'missing', 'malformed'] as const)('rejects %s stored admission without creating an identity', async condition => {
        const req = await atomicGuestRequest();
        const username = `Rejected ${condition} ${randomUUID().slice(0, 8)}`;
        const repo = AppDataSource.getRepository(Session);
        if (condition === 'stale') {
            const changed = {...JSON.parse(JSON.stringify(req.session)), frontendContext: 'another-context'};
            await repo.update({id: req.sessionID}, {json: JSON.stringify(changed)});
        } else if (condition === 'expired') await repo.update({id: req.sessionID}, {expiredAt: Date.now() - 1});
        else if (condition === 'destroyed') await repo.softDelete({id: req.sessionID});
        else if (condition === 'missing') await repo.delete({id: req.sessionID});
        else await repo.update({id: req.sessionID}, {json: '{malformed'});

        const operation = userController.registerGuestWithSession(username, undefined, req, atomicGuestOptions(req));
        if (condition === 'malformed') await expect(operation).rejects.toBeInstanceOf(SyntaxError);
        else await expect(operation).rejects.toMatchObject({code: 'SESSION_CONTEXT_CHANGED'});
        await expectGuestAbsent(username);
        expect(req.session.auth).toBeUndefined();
        expect(req.session.frontendContext).toBe(req.apiActor!.context);
    });

    it('retains the committed guest receipt and never resaves over a later session actor', async () => {
        const req = await atomicGuestRequest();
        const username = `Final commit ${randomUUID().slice(0, 8)}`;
        const committed = await userController.registerGuestWithSession(username, undefined, req, atomicGuestOptions(req));
        const completed = JSON.parse(committed.result.json) as components['schemas']['IdentityResult'];
        const later = {...JSON.parse(JSON.stringify(req.session)), frontendContext: 'later-actor-context'};
        await AppDataSource.getRepository(Session).update({id: req.sessionID}, {json: JSON.stringify(later)});

        // The adapter adopts this exact receipt only after commit. Express uses
        // its nonenumerable save acknowledgement rather than a second DB write.
        req.session = committed.session;
        await persistSession(req.session);
        expect(Object.keys(req.session)).not.toContain('save');
        expect((await readStoredSession(req.sessionStore, req.sessionID))?.frontendContext).toBe('later-actor-context');
        expect(completed.session.context).not.toBe('later-actor-context');
        expect(await AppDataSource.getRepository(Guest).countBy({username})).toBe(1);
    });

    it('serializes a later identity write behind guest creation until its atomic commit', async () => {
        const req = await atomicGuestRequest();
        const username = `Locked identity ${randomUUID().slice(0, 8)}`;
        const options = atomicGuestOptions(req);
        let enterPreparation!: () => void;
        let releasePreparation!: () => void;
        const entered = new Promise<void>(function captureEntry(resolve) { enterPreparation = resolve; });
        const released = new Promise<void>(function captureRelease(resolve) { releasePreparation = resolve; });
        async function prepareUnderLock(staged: Request['session'], personalLink: string) {
            const results = prepareGuestIdentityReplies(req, staged, personalLink);
            enterPreparation();
            await released;
            return results;
        }
        options.prepareResult = prepareUnderLock;

        const registering = userController.registerGuestWithSession(username, undefined, req, options);
        await entered;
        const writer = AppDataSource.createQueryRunner();
        try {
            await writer.connect();
            await writer.startTransaction();
            const later = {...JSON.parse(JSON.stringify(req.session)), frontendContext: 'queued-later-context'};
            const changing = writer.manager.update(Session, {id: req.sessionID}, {json: JSON.stringify(later)});

            // This real second transaction targets the row still locked by
            // registration. Release output preparation so creation can commit.
            releasePreparation();
            const committed = await registering;
            await changing;
            await writer.commitTransaction();
            expect(JSON.parse(committed.result.json).session.kind).toBe('guest');
            expect((await readStoredSession(req.sessionStore, req.sessionID))?.frontendContext).toBe('queued-later-context');
            expect(await AppDataSource.getRepository(Guest).countBy({username})).toBe(1);
        } finally {
            releasePreparation();
            if (writer.isTransactionActive) await writer.rollbackTransaction();
            await writer.release();
        }
    });

    it('rolls back before commit when the actual guest-mail renderer rejects its recipient', async () => {
        const req = await atomicGuestRequest();
        const username = '  \r\n  ';
        await expect(userController.registerGuestWithSession(username, 'invalid-recipient@example.test', req, atomicGuestOptions(req)))
            .rejects.toThrow('recipients require a name');
        await expectGuestAbsent(username);
        expect(req.session.auth).toBeUndefined();
        expect((await readStoredSession(req.sessionStore, req.sessionID))?.frontendContext).toBe(req.apiActor!.context);
    });

    it.each([true, false])('keeps committed creation when prepared SMTP acceptance is %s', async accepted => {
        const req = await atomicGuestRequest();
        const username = `Mail receipt ${randomUUID().slice(0, 8)}`;
        const render = emailOwner.prepareGuestLinkEmail;
        const deliver = vi.fn().mockResolvedValue(accepted);
        const prepared = vi.spyOn(emailOwner, 'prepareGuestLinkEmail').mockImplementation(function prepareMail(recipient, link) {
            // Keep actual recipient/template preparation; replace only the opaque
            // external SMTP delivery boundary after the transaction has committed.
            render(recipient, link);
            return {deliver};
        });
        try {
            const committed = await userController.registerGuestWithSession(username, 'atomic-guest@example.test', req, atomicGuestOptions(req));
            const result = JSON.parse(committed.result.json) as components['schemas']['IdentityResult'];
            expect(result.emailDelivery).toBe(accepted ? 'sent' : 'failed');
            expect(result.personalLink).toBeTruthy();
            expect(result.session.kind).toBe('guest');
            expect(await AppDataSource.getRepository(Guest).countBy({username})).toBe(1);
            expect(deliver).toHaveBeenCalledOnce();
            expect(prepared).toHaveBeenCalledOnce();
        } finally { prepared.mockRestore(); }
    });
});

describe('atomic versioned account registration', () => {
    it('commits first account signup without initializing or persisting an anonymous session', async () => {
        const req = await initialIdentityRequest();
        const original = JSON.stringify(req.session);
        const username = `first-account-${randomUUID().slice(0, 8)}`;
        const {prepared, deliver} = preparedMailDelivery(true);
        try {
            const committed = await userController.registerUserWithSession(accountRegistrationInput(username), req, atomicAccountOptions(req));
            expect(JSON.parse(committed.result.json)).toEqual({changed: true, emailDelivery: 'sent'});
            const account = await AppDataSource.getRepository(User).findOneOrFail({where: {username}, relations: {profiles: true}});
            expect(account.profiles).toHaveLength(1);
            expect(account.activationToken).toBeTruthy();
            expect(await readStoredSession(req.sessionStore, req.sessionID)).toBeUndefined();
            expect(JSON.stringify(req.session)).toBe(original);
            expect(committed.result.context).toBeUndefined();
            expect(deliver).toHaveBeenCalledOnce();
        } finally { prepared.mockRestore(); }
    });

    it.each([true, false])('commits account/profile/activation together and reports SMTP acceptance %s without changing actor', async accepted => {
        const req = await atomicGuestRequest();
        const original = req.session;
        const originalJson = JSON.stringify(original);
        const username = `atomic-account-${randomUUID().slice(0, 8)}`;
        const {prepared, deliver} = preparedMailDelivery(accepted);
        try {
            const committed = await userController.registerUserWithSession(accountRegistrationInput(username), req, atomicAccountOptions(req));
            const result = JSON.parse(committed.result.json) as components['schemas']['RegistrationResult'];
            const account = await AppDataSource.getRepository(User).findOneOrFail({where: {username}, relations: {profiles: true}});
            // This established tinyint column hydrates as 0/1 in the MariaDB
            // driver; test its business meaning without changing native metadata.
            expect(Boolean(account.isActive)).toBe(false);
            expect(account).toMatchObject({profiles: [{name: username, defaultForOwner: true}]});
            expect(account.activationToken).toBeTruthy();
            expect(account.activationTokenExpiration!.getTime()).toBeGreaterThan(Date.now());
            expect(result).toEqual({changed: true, emailDelivery: accepted ? 'sent' : 'failed'});
            expect(committed.result.context).toBe(req.apiActor!.context);
            expect(committed.result.json).not.toContain(account.activationToken!);
            expect(committed.result.json).not.toContain('activationToken');
            expect(req.session).toBe(original);
            expect(JSON.stringify(req.session)).toBe(originalJson);
            expect((await readStoredSession(req.sessionStore, req.sessionID))?.frontendContext).toBe(req.apiActor!.context);
            expect(deliver).toHaveBeenCalledOnce();
            expect(prepared).toHaveBeenCalledOnce();
        } finally { prepared.mockRestore(); }
    });

    it('rolls back account, default profile and activation token when its generated completion is invalid', async () => {
        const req = await atomicGuestRequest();
        const originalJson = JSON.stringify(req.session);
        const username = `invalid-account-${randomUUID().slice(0, 8)}`;
        const {prepared, deliver} = preparedMailDelivery(true);
        const options = atomicAccountOptions(req);
        function prepareInvalidResult() {
            // Exercise the production generated validator after record/token
            // preparation, without substituting DBAL or transaction behavior.
            const replies = prepareAccountRegistrationReplies(req);
            const malformed = {changed: 'yes'} as unknown as components['schemas']['RegistrationResult'];
            const invalid = prepareValidatedJson(req, 'registerAccount', 200, malformed);
            return {...replies, sent: invalid};
        }
        options.prepareResult = prepareInvalidResult;
        try {
            await expect(userController.registerUserWithSession(accountRegistrationInput(username), req, options))
                .rejects.toMatchObject({code: 'INTERNAL_ERROR'});
            expect(await AppDataSource.getRepository(User).countBy({username})).toBe(0);
            expect(await AppDataSource.getRepository(Profile).countBy({name: username})).toBe(0);
            expect(JSON.stringify(req.session)).toBe(originalJson);
            expect((await readStoredSession(req.sessionStore, req.sessionID))?.frontendContext).toBe(req.apiActor!.context);
            expect(deliver).not.toHaveBeenCalled();
        } finally { prepared.mockRestore(); }
    });

    it('rolls back the prepared account and token when the actual activation renderer rejects its recipient', async () => {
        const req = await atomicGuestRequest();
        const username = `invalid-mail-${randomUUID().slice(0, 8)}`;
        const input = {...accountRegistrationInput(username), email: '   '};
        await expect(userController.registerUserWithSession(input, req, atomicAccountOptions(req)))
            .rejects.toThrow('recipients require a name and an address');
        expect(await AppDataSource.getRepository(User).countBy({username})).toBe(0);
        expect(await AppDataSource.getRepository(Profile).countBy({name: username})).toBe(0);
        expect(req.session.auth).toBeUndefined();
    });

    it('rejects a later stored actor before allocating an account or preparing activation mail', async () => {
        const req = await atomicGuestRequest();
        const username = `stale-account-${randomUUID().slice(0, 8)}`;
        const later = {...JSON.parse(JSON.stringify(req.session)), frontendContext: 'later-account-context'};
        await AppDataSource.getRepository(Session).update({id: req.sessionID}, {json: JSON.stringify(later)});
        const {prepared, deliver} = preparedMailDelivery(true);
        try {
            await expect(userController.registerUserWithSession(accountRegistrationInput(username), req, atomicAccountOptions(req)))
                .rejects.toMatchObject({code: 'SESSION_CONTEXT_CHANGED'});
            expect(await AppDataSource.getRepository(User).countBy({username})).toBe(0);
            expect(await AppDataSource.getRepository(Profile).countBy({name: username})).toBe(0);
            expect(prepared).not.toHaveBeenCalled();
            expect(deliver).not.toHaveBeenCalled();
        } finally { prepared.mockRestore(); }
    });
});

describe('atomic frontend activation completion', () => {
    it('consumes its token with a prevalidated receipt and staged document feedback without a later session save', async () => {
        const {id} = await registerLocalAccount('atomic-activation');
        const token = await userService.generateActivationToken(id);
        const req = await atomicGuestRequest();
        const original = req.session;
        const options = activationOptions(req, true);
        function prepareDocumentCompletion(staged: Request['session']) {
            // The document adapter writes this same connect-flash shape only on
            // isolated staging; private activation tokens never enter feedback.
            Object.defineProperty(staged, 'flash', {value: {'frontend': ['auth.activated']}, enumerable: true});
            return prepareValidatedJson(req, 'activateIdentity', 200, {changed: true});
        }
        options.prepareResult = prepareDocumentCompletion;
        const committed = await userController.activateAccountWithSession(token, req, options);
        expect(JSON.parse(committed.result.json)).toEqual({changed: true});
        expect(committed.result.json).not.toContain(token);
        expect(req.session).toBe(original);
        expect(JSON.stringify(original)).not.toContain('auth.activated');
        const user = await AppDataSource.getRepository(User).findOneByOrFail({id});
        expect(Boolean(user.isActive)).toBe(true);
        expect(user).toMatchObject({activationToken: null, activationTokenExpiration: null});
        expect(JSON.stringify(await readStoredSession(req.sessionStore, req.sessionID))).toContain('auth.activated');

        // A later actor remains authoritative even when Express acknowledges this
        // older completed document response after the activation transaction.
        const later = {...JSON.parse(JSON.stringify(original)), frontendContext: 'later-activation-actor'};
        await AppDataSource.getRepository(Session).update({id: req.sessionID}, {json: JSON.stringify(later)});
        req.session = committed.session;
        await persistSession(req.session);
        expect((await readStoredSession(req.sessionStore, req.sessionID))?.frontendContext).toBe('later-activation-actor');
    });

    it('retains the usable activation token when staged document serialization fails', async () => {
        const {id} = await registerLocalAccount('rolled-back-activation');
        const token = await userService.generateActivationToken(id);
        const req = await atomicGuestRequest();
        const originalJson = JSON.stringify(req.session);
        const options = activationOptions(req, true);
        function prepareUnserializableCompletion(staged: Request['session']) {
            const reply = prepareValidatedJson(req, 'activateIdentity', 200, {changed: true});
            Object.defineProperty(staged, 'serializationCycle', {value: staged, enumerable: true});
            return reply;
        }
        options.prepareResult = prepareUnserializableCompletion;
        await expect(userController.activateAccountWithSession(token, req, options)).rejects.toBeInstanceOf(TypeError);
        const retained = await userService.verifyActivationToken(token);
        expect(retained?.id).toBe(id);
        expect(Boolean(retained?.isActive)).toBe(false);
        expect(JSON.stringify(req.session)).toBe(originalJson);
        expect((await readStoredSession(req.sessionStore, req.sessionID))?.frontendContext).toBe(req.apiActor!.context);
    });

    it('allows only one activation when two independently admitted sessions consume the same token', async () => {
        const {id} = await registerLocalAccount('concurrent-activation');
        const token = await userService.generateActivationToken(id);
        const first = await atomicGuestRequest();
        const second = await atomicGuestRequest();
        const outcomes = await Promise.allSettled([
            userController.activateAccountWithSession(token, first, activationOptions(first)),
            userController.activateAccountWithSession(token, second, activationOptions(second)),
        ]);
        const confirmed = outcomes.filter(result => result.status === 'fulfilled');
        const rejected = outcomes.find(result => result.status === 'rejected');
        expect(confirmed).toHaveLength(1);
        expect(rejected?.status === 'rejected' && rejected.reason).toMatchObject({cause: 'TOKEN_INVALID'});
        expect(await userService.verifyActivationToken(token)).toBeNull();
        expect(Boolean((await AppDataSource.getRepository(User).findOneByOrFail({id})).isActive)).toBe(true);
        expect(first.session.auth).toBeUndefined();
        expect(second.session.auth).toBeUndefined();
    });
});

describe('atomic ordinary frontend identity completion', () => {
    it('creates its first account session only after credentials and prepared identity completion succeed', async () => {
        const account = await registerLocalAccount('first-account-login');
        await userService.activateUser(account.id);
        const req = await initialIdentityRequest();
        const original = JSON.stringify(req.session);
        function prepareResult(staged: Request['session']) {
            return prepareIdentityReply(req, staged, 'loginIdentity');
        }
        const options: IdentityCompletionOptions<PreparedApiJsonResponse> = {context: null, prepareResult};

        // A rejected explicit action must not leave an anonymous bootstrap row.
        await expect(userController.loginUserWithSession({username: account.username, password: 'incorrect'}, req, options)).rejects.toBeDefined();
        expect(await readStoredSession(req.sessionStore, req.sessionID)).toBeUndefined();
        expect(JSON.stringify(req.session)).toBe(original);

        const committed = await userController.loginUserWithSession({username: account.username, password: 'initial-secret'}, req, options);
        const stored = await readStoredSession(req.sessionStore, req.sessionID);
        expect(stored?.auth.user?.id).toBe(account.id);
        expect(JSON.parse(committed.result.json).session).toMatchObject({kind: 'account',
            context: stored!.frontendContext, csrfToken: stored!.frontendCsrfToken});
        expect(JSON.stringify(req.session)).toBe(original);
    });

    it('accepts a validated legacy context under the lock and rotates ordinary stored metadata on profile selection', async () => {
        const {req, run, options} = await ordinaryIdentityFixture('profile');
        delete req.session.frontendContext;
        delete req.session.frontendCsrfToken;
        await persistSession(req.session);
        req.apiActor = undefined;
        const actor = await captureApiActor(req);
        expect(actor.context).toBeTruthy();
        expect(req.session.frontendContext).toBeUndefined();

        const committed = await run({...options, context: actor.context});
        const stored = await readStoredSession(req.sessionStore, req.sessionID);
        expect(stored?.frontendContext).toBeTruthy();
        expect(stored?.frontendContext).not.toBe(actor.context);
        expect(JSON.parse(committed.result.json).session.context).toBe(stored!.frontendContext);
        expect(req.session.frontendContext).toBeUndefined();
    });

    it.each(['account', 'guest', 'profile'] as const)('rolls back %s authority when its generated completion rejects after inner deferred save', async kind => {
        const {req, options, run, operation} = await ordinaryIdentityFixture(kind);
        const original = req.session;
        const originalJson = JSON.stringify(original);
        function rejectGeneratedCompletion(staged: Request['session']) {
            // Existing controller logic has already called persistSession on
            // isolated staging. That inner save must not write before validation.
            staged.frontendCsrfToken = '';
            return prepareIdentityReply(req, staged, operation);
        }
        options.prepareResult = rejectGeneratedCompletion;
        await expect(run()).rejects.toMatchObject({code: 'INTERNAL_ERROR'});
        expect(req.session).toBe(original);
        expect(JSON.stringify(req.session)).toBe(originalJson);
        const stored = await readStoredSession(req.sessionStore, req.sessionID);
        expect(stored?.frontendContext).toBe(original.frontendContext);
        expect(stored?.profile?.id).toBe(original.profile?.id);
        expect(stored?.auth?.user?.id).toBe(original.auth?.user?.id);
        expect(stored?.auth?.guest?.id).toBe(original.auth?.guest?.id);
    });

    it.each(['account', 'guest', 'profile'] as const)('returns prepared %s confirmation without overwriting a later actor', async kind => {
        const {req, run} = await ordinaryIdentityFixture(kind);
        const original = req.session;
        const committed = await run();
        const reply = JSON.parse(committed.result.json) as components['schemas']['IdentityResult'];
        expect(reply).toMatchObject({session: {kind: kind === 'guest' ? 'guest' : 'account'}, personalLink: null, redirect: null});
        expect(reply.session.context).not.toBe(original.frontendContext);
        expect(committed.result.context).toBe(reply.session.context);
        expect(req.session).toBe(original);
        expect((await readStoredSession(req.sessionStore, req.sessionID))?.frontendContext).toBe(reply.session.context);

        const later = {...JSON.parse(JSON.stringify(original)), frontendContext: `later-${kind}-actor`};
        await AppDataSource.getRepository(Session).update({id: req.sessionID}, {json: JSON.stringify(later)});
        req.session = committed.session;
        await persistSession(req.session);
        expect((await readStoredSession(req.sessionStore, req.sessionID))?.frontendContext).toBe(`later-${kind}-actor`);
        expect(JSON.parse(committed.result.json).session.context).toBe(reply.session.context);
    });

    it('preserves inactive-login activation resend before rejection without rolling its token back or mutating authority', async () => {
        const account = await registerLocalAccount('ordinary-inactive');
        const req = await atomicGuestRequest();
        const originalJson = JSON.stringify(req.session);
        const prepareResult = vi.fn();
        const sent = vi.spyOn(email, 'sendActivationEmail').mockImplementation(async function acceptPreparedNativeMail(recipient, link) {
            // Keep actual template/recipient preparation; suppress only external
            // delivery so this known native rejection sends no real email.
            emailOwner.prepareActivationEmail(recipient, link);
        });
        try {
            await expect(userController.loginUserWithSession({username: account.username, password: 'initial-secret'}, req,
                {frontend: true, context: req.apiActor!.context, prepareResult})).rejects.toMatchObject({cause: 'ACTIVATION_RESENT'});
            const link = new URL(sent.mock.calls[0][1]);
            const token = link.pathname.split('/').at(-1)!;
            expect(await userService.verifyActivationToken(token)).toMatchObject({id: account.id});
            expect(prepareResult).not.toHaveBeenCalled();
            expect(JSON.stringify(req.session)).toBe(originalJson);
            expect((await readStoredSession(req.sessionStore, req.sessionID))?.frontendContext).toBe(req.apiActor!.context);
        } finally { sent.mockRestore(); }
    });
});

describe('atomic ordinary frontend logout completion', () => {
    it.each(['account', 'guest'] as const)('commits anonymous %s logout and its prepared receipt without a later actor resave', async kind => {
        const {req, options} = await ordinaryLogoutFixture(kind);
        const original = req.session;
        const committed = await userController.logoutUserWithSession(req, options);
        const reply = JSON.parse(committed.result.json) as components['schemas']['IdentityResult'];
        expect(reply).toMatchObject({session: {kind: 'anonymous', activeProfile: null, profiles: []}, personalLink: null, redirect: null});
        expect(reply.session.context).not.toBe(original.frontendContext);
        expect(reply.session.csrfToken).not.toBe(original.frontendCsrfToken);
        expect(req.session).toBe(original);
        expect(original.auth?.[kind === 'account' ? 'user' : 'guest']).toBeTruthy();
        const stored = await readStoredSession(req.sessionStore, req.sessionID);
        expect(stored?.frontendContext).toBe(reply.session.context);
        expect(stored?.auth).toBeUndefined();
        expect(stored?.profile).toBeUndefined();
        expect(stored?.tokens).toBeUndefined();
        expect(stored?.frontendAuthReturn).toBeUndefined();

        // A later admitted identity remains authoritative. Adopting this completed
        // logout acknowledges its stored write rather than saving its old JSON again.
        const later = {...JSON.parse(JSON.stringify(original)), frontendContext: `later-${kind}-after-logout`};
        await AppDataSource.getRepository(Session).update({id: req.sessionID}, {json: JSON.stringify(later)});
        req.session = committed.session;
        await persistSession(req.session);
        expect((await readStoredSession(req.sessionStore, req.sessionID))?.frontendContext).toBe(later.frontendContext);
        expect(JSON.parse(committed.result.json).session.context).toBe(reply.session.context);
    });

    it('rolls back ordinary logout when its generated response cannot prepare', async () => {
        const {req, options} = await ordinaryLogoutFixture('account');
        const original = req.session;
        const originalJson = JSON.stringify(original);
        function rejectCompletion(staged: Request['session']) {
            // The retained API requires a complete anonymous projection before
            // the stored actor changes; the retired document adapter is not exercised.
            staged.frontendCsrfToken = '';
            return prepareIdentityReply(req, staged, 'logoutIdentity');
        }
        options.prepareResult = rejectCompletion;
        await expect(userController.logoutUserWithSession(req, options)).rejects.toMatchObject({code: 'INTERNAL_ERROR'});

        expect(req.session).toBe(original);
        expect(JSON.stringify(req.session)).toBe(originalJson);
        const stored = await readStoredSession(req.sessionStore, req.sessionID);
        expect(stored?.auth?.user?.id).toBe(original.auth?.user?.id);
        expect(stored?.profile?.id).toBe(original.profile?.id);
        expect(stored?.frontendContext).toBe(original.frontendContext);
        expect(stored?.frontendCsrfToken).toBe(original.frontendCsrfToken);
        expect(stored?.frontendAuthReturn).toBe(original.frontendAuthReturn);
        expect(JSON.stringify(stored)).not.toContain('auth.logoutDone');
    });

    it('rejects stale ordinary logout before mutating request authority or a later stored guest', async () => {
        const {req, options} = await ordinaryLogoutFixture('account');
        const originalJson = JSON.stringify(req.session);
        const guest = await userService.createGuest(`Later logout actor ${randomUUID().slice(0, 8)}`);
        const later = {...JSON.parse(originalJson), auth: {guest}, profile: guest.profile,
            frontendContext: 'later-guest-before-logout'};
        await AppDataSource.getRepository(Session).update({id: req.sessionID}, {json: JSON.stringify(later)});
        const prepare = vi.fn(options.prepareResult);
        options.prepareResult = prepare;

        await expect(userController.logoutUserWithSession(req, options)).rejects.toMatchObject({code: 'SESSION_CONTEXT_CHANGED'});
        expect(prepare).not.toHaveBeenCalled();
        expect(JSON.stringify(req.session)).toBe(originalJson);
        const stored = await readStoredSession(req.sessionStore, req.sessionID);
        expect(stored?.frontendContext).toBe(later.frontendContext);
        expect(stored?.auth?.guest?.id).toBe(guest.id);
        expect(stored?.profile?.id).toBe(guest.profile.id);
    });

    it.each([
        {name: 'empty', kind: 'account', tokens: {}},
        {name: 'populated', kind: 'guest', tokens: {access_token: 'provider-fixture', token_type: 'Bearer'}},
    ] as const)('rejects fresh $name provider tokens without provider requests or completion', async fixture => {
        const {req, options} = await ordinaryLogoutFixture(fixture.kind);
        const originalJson = JSON.stringify(req.session);
        const storedProvider = {...JSON.parse(originalJson), tokens: fixture.tokens};
        // The earlier request remains token-free. This actual stored evidence
        // proves the wrapper repeats classification under its Session lock.
        await AppDataSource.getRepository(Session).update({id: req.sessionID}, {json: JSON.stringify(storedProvider)});
        const providerRequest = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected external provider request'));
        const prepare = vi.fn(options.prepareResult);
        options.prepareResult = prepare;
        try {
            await expect(userController.logoutUserWithSession(req, options)).rejects.toMatchObject({code: 'SESSION_CONTEXT_CHANGED'});
            expect(providerRequest).not.toHaveBeenCalled();
            expect(prepare).not.toHaveBeenCalled();
            expect(JSON.stringify(req.session)).toBe(originalJson);
            const stored = await readStoredSession(req.sessionStore, req.sessionID);
            expect(stored?.tokens).toEqual(fixture.tokens);
            expect(stored?.frontendContext).toBe(req.apiActor!.context);
            expect(stored?.profile?.id).toBe(req.session.profile?.id);
        } finally { providerRequest.mockRestore(); }
    });
});

describe('atomic frontend password-reset consumption', () => {
    it('allows only one of two independent frontend sessions to consume a reset token and write its password', async () => {
        const account = await registerLocalAccount('concurrent-reset');
        const token = await userService.generatePasswordResetToken(account.username);
        const first = await atomicGuestRequest();
        const second = await atomicGuestRequest();
        function options(req: Request): IdentityCompletionOptions<PreparedApiJsonResponse> {
            function prepareResult() {
                return prepareValidatedJson(req, 'resetAccountPassword', 200, {changed: true});
            }
            return {context: req.apiActor!.context, prepareResult};
        }
        const passwords = ['first-reset-secret', 'second-reset-secret'];
        const outcomes = await Promise.allSettled([
            userController.resetPasswordWithSession(token, {password: passwords[0], confirmPassword: passwords[0]}, first, options(first)),
            userController.resetPasswordWithSession(token, {password: passwords[1], confirmPassword: passwords[1]}, second, options(second)),
        ]);
        const winner = outcomes.findIndex(result => result.status === 'fulfilled');
        expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        const rejected = outcomes.find(result => result.status === 'rejected');
        expect(rejected?.status === 'rejected' && rejected.reason).toMatchObject({cause: 'TOKEN_INVALID'});
        expect(await userService.verifyPassword(account.id, passwords[winner])).toBe(true);
        expect(await userService.verifyPassword(account.id, passwords[1 - winner])).toBe(false);
        expect(await userService.verifyPasswordResetToken(token)).toBeNull();
        expect(first.session.auth).toBeUndefined();
        expect(second.session.auth).toBeUndefined();
    });

    it('rolls back password and token consumption when the actual API completion cannot serialize', async () => {
        const account = await registerLocalAccount('serialization-failed-reset');
        const token = await userService.generatePasswordResetToken(account.username);
        const req = await atomicGuestRequest();
        const originalJson = JSON.stringify(req.session);
        const response = preparedResponse();
        function prepareInvalidReply() {
            const result: components['schemas']['MutationResult'] = {changed: true};
            // The real generated validator admits the ordinary wire fields. A
            // non-enumerable serializer fault then proves output preparation still
            // precedes password/token commit without mocking persistence or locks.
            Object.defineProperty(result, 'toJSON', {value: function rejectSerialization(): never {
                throw new TypeError('Reset completion serialization failed');
            }});
            return prepareValidatedJson(req, 'resetAccountPassword', 200, result);
        }
        // Capture only the error so an unexpected fulfilled receipt cannot print
        // its private capability URL in the assertion output.
        let preparationFailure: unknown;
        try {
            await userController.resetPasswordWithSession(token, {password: 'uncommitted-secret', confirmPassword: 'uncommitted-secret'}, req,
                {context: req.apiActor!.context, prepareResult: prepareInvalidReply});
        } catch (failure) { preparationFailure = failure; }
        expect(preparationFailure).toBeInstanceOf(TypeError);
        expect(await userService.verifyPassword(account.id, 'initial-secret')).toBe(true);
        expect(await userService.verifyPasswordResetToken(token)).toMatchObject({id: account.id});
        expect(JSON.stringify(req.session)).toBe(originalJson);
        expect(response.body).toBeNull();
    });

    it('prepares the API success receipt without unchanged session writes or later actor resaves', async () => {
        const account = await registerLocalAccount('prepared-reset-reply');
        const token = await userService.generatePasswordResetToken(account.username);
        const req = await atomicGuestRequest();
        const original = req.session;
        const before = await AppDataSource.getRepository(Session).findOneByOrFail({id: req.sessionID});
        const response = preparedResponse();
        function prepareReply() {
            return prepareValidatedJson(req, 'resetAccountPassword', 200, {changed: true});
        }
        const committed = await userController.resetPasswordWithSession(token,
            {password: 'confirmed-reset-secret', confirmPassword: 'confirmed-reset-secret'}, req,
            {context: req.apiActor!.context, prepareResult: prepareReply});
        expect(JSON.parse(committed.result.json)).toEqual({changed: true});
        expect(committed.result.context).toBe(req.apiActor!.context);
        expect(response.body).toBeNull();
        expect(await userService.verifyPassword(account.id, 'confirmed-reset-secret')).toBe(true);
        expect(await userService.verifyPasswordResetToken(token)).toBeNull();
        const after = await AppDataSource.getRepository(Session).findOneByOrFail({id: req.sessionID});
        expect(after.json).toBe(before.json);
        expect(after.expiredAt).toBe(before.expiredAt);

        const later = {...JSON.parse(JSON.stringify(original)), frontendContext: 'later-reset-actor'};
        await AppDataSource.getRepository(Session).update({id: req.sessionID}, {json: JSON.stringify(later)});
        req.session = committed.session;
        await persistSession(req.session);
        sendPreparedJson(req, response.res, committed.result);
        expect(response.statusCode).toBe(200);
        expect(response.body).toBe(committed.result.json);
        expect(response.headers.get('Cache-Control')).toBe('private, no-store');
        expect(response.headers.get('Content-Language')).toBe('en');
        expect(response.headers.get('X-Surveyor-Context')).toBe(committed.result.context);
        expect((await readStoredSession(req.sessionStore, req.sessionID))?.frontendContext).toBe('later-reset-actor');
    });

    it('preserves mismatch-before-invalid-token diagnostics at the live completion', async () => {
        const req = await atomicGuestRequest();
        const body = {password: 'first-value', confirmPassword: 'other-value'};
        function unusedResult(): PreparedApiJsonResponse { throw new Error('Mismatch must precede preparation'); }
        await expect(userController.resetPasswordWithSession('invalid-token', body, req,
            {context: req.apiActor!.context, prepareResult: unusedResult})).rejects.toMatchObject({cause: 'PASSWORD_MISMATCH'});
    });
});

describe('atomic frontend password-reset mail preparation', () => {
    it('rolls back a known account token when cached SMTP setup fails before commit', async () => {
        const account = await registerLocalAccount('reset-setup-failed');
        const oldToken = await userService.generatePasswordResetToken(account.username);
        const req = await atomicGuestRequest();
        const failedSetup = new Error('Controlled SMTP setup failure');
        const create = vi.spyOn(nodemailer, 'createTransport').mockImplementation(function failSetup(): never { throw failedSetup; });
        function prepareReply() {
            return prepareValidatedJson(req, 'requestPasswordReset', 200, {changed: true});
        }
        try {
            await expect(userController.requestPasswordResetWithSession(account.username, req,
                {context: req.apiActor!.context, prepareResult: prepareReply})).rejects.toBe(failedSetup);
            expect(await userService.verifyPasswordResetToken(oldToken)).toMatchObject({id: account.id});
            expect(create).toHaveBeenCalledOnce();
            expect(req.session.auth).toBeUndefined();
        } finally { create.mockRestore(); }
    });

    it('keeps identical generic unknown/SMTP-failed receipts and never overwrites a later session actor', async () => {
        const transport = nodemailer.createTransport({streamTransport: true, buffer: true, newline: 'unix'});
        const create = vi.spyOn(nodemailer, 'createTransport').mockReturnValue(transport as unknown as Transporter);
        const send = vi.spyOn(transport, 'sendMail');
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        const account = await registerLocalAccount('reset-smtp-failed');
        const unknown = await atomicGuestRequest();
        const known = await atomicGuestRequest();
        function options(req: Request): IdentityCompletionOptions<PreparedApiJsonResponse> {
            function prepareResult() {
                return prepareValidatedJson(req, 'requestPasswordReset', 200, {changed: true});
            }
            return {frontend: true, context: req.apiActor!.context, prepareResult};
        }
        try {
            const absent = await userController.requestPasswordResetWithSession('missing-reset-account', unknown, options(unknown));
            expect(create).not.toHaveBeenCalled();
            expect(send).not.toHaveBeenCalled();
            send.mockImplementationOnce(async function failDeliveryAfterCommit() {
                const target = await AppDataSource.getRepository(User).findOneByOrFail({id: account.id});
                expect(target.resetToken).toBeTruthy();
                const later = {...JSON.parse(JSON.stringify(known.session)), frontendContext: 'later-reset-mail-actor'};
                await AppDataSource.getRepository(Session).update({id: known.sessionID}, {json: JSON.stringify(later)});
                throw new Error('Controlled SMTP refusal');
            });
            const result = await userController.requestPasswordResetWithSession(account.email, known, options(known));
            expect(result.result.json).toBe(absent.result.json);
            expect(JSON.parse(result.result.json)).toEqual({changed: true});
            expect(result.result.context).toBe(known.apiActor!.context);
            expect(create).toHaveBeenCalledOnce();
            expect(send).toHaveBeenCalledOnce();
            expect((await readStoredSession(known.sessionStore, known.sessionID))?.frontendContext).toBe('later-reset-mail-actor');
            expect(known.session.auth).toBeUndefined();
        } finally { create.mockRestore(); send.mockRestore(); log.mockRestore(); transport.close(); }
    });

    it('retains the committed generic confirmation if the opaque delivery boundary unexpectedly rejects', async () => {
        const account = await registerLocalAccount('reset-opaque-rejection');
        const req = await atomicGuestRequest();
        const prepare = emailOwner.preparePasswordResetEmail;
        const delivery = vi.fn().mockRejectedValue(new Error('Controlled opaque delivery rejection'));
        const replacement = vi.spyOn(emailOwner, 'preparePasswordResetEmail').mockImplementation(function prepareCapturedMail(recipient, link) {
            prepare(recipient, link);
            return {deliver: delivery};
        });
        function prepareReply() {
            return prepareValidatedJson(req, 'requestPasswordReset', 200, {changed: true});
        }
        try {
            const committed = await userController.requestPasswordResetWithSession(account.username, req,
                {context: req.apiActor!.context, prepareResult: prepareReply});
            expect(JSON.parse(committed.result.json)).toEqual({changed: true});
            const target = await AppDataSource.getRepository(User).findOneByOrFail({id: account.id});
            expect(await userService.verifyPasswordResetToken(target.resetToken!)).toMatchObject({id: account.id});
            expect(delivery).toHaveBeenCalledOnce();
        } finally { replacement.mockRestore(); }
    });
});

describe('authentication user stories', () => {
    it('preserves the original Session and discards staged completion feedback when identity persistence fails', async () => {
        const {id, username} = await registerLocalAccount('frontend-failed-identity-save');
        await userService.activateUser(id);
        const req = await atomicGuestRequest();
        req.apiActor = undefined;
        await captureApiActor(req);
        /** Prepare the real account result, then fail only the staged store JSON write. */
        function prepareFailingSave(staged: Request['session']): PreparedApiJsonResponse {
            const result = prepareIdentityReply(req, staged, 'loginIdentity');
            Object.defineProperty(staged, 'flash', {value: {
                'frontend-notice': [JSON.stringify({kind: 'success', messageKey: 'auth.loginDone'})],
            }, enumerable: true});
            Object.defineProperty(staged, 'serializationCycle', {value: staged, enumerable: true});
            return result;
        }
        await expect(userController.loginUserWithSession({username, password: 'initial-secret'}, req,
            {context: req.apiActor!.context, prepareResult: prepareFailingSave})).rejects.toBeInstanceOf(TypeError);

        // Explicit completion staging protects the original middleware Session;
        // ordinary read-only admission never needs to repair or reload it afterward.
        req.apiActor = undefined;
        const reloaded = await sessionView(req);
        expect(reloaded.kind).toBe('anonymous');
        expect(req.session.auth).toBeUndefined();
        expect(JSON.stringify(req.session)).not.toContain('auth.loginDone');
        await persistSession(req.session);
        const stored = await readStoredSession(req.sessionStore, req.sessionID);
        expect(stored?.auth).toBeUndefined();
        expect(JSON.stringify(stored)).not.toContain('auth.loginDone');
    });

    it('rechecks transport admission after credential verification before replacing an identity', async () => {
        const {id, username} = await registerLocalAccount('frontend-stale-login');
        await userService.activateUser(id);
        const req = await atomicGuestRequest();
        const original = JSON.stringify(req.session);
        // Another tab changes the actual stored generation. Credential success
        // cannot replace that newer authority through a stale request snapshot.
        const later = {...JSON.parse(original), frontendContext: 'later-login-context'};
        await AppDataSource.getRepository(Session).update({id: req.sessionID}, {json: JSON.stringify(later)});
        await expect(userController.loginUserWithSession({username, password: 'initial-secret'}, req,
            {context: req.apiActor!.context, prepareResult: staged => prepareIdentityReply(req, staged, 'loginIdentity')}))
            .rejects.toMatchObject({code: 'SESSION_CONTEXT_CHANGED'});
        expect(JSON.stringify(req.session)).toBe(original);
        expect((await readStoredSession(req.sessionStore, req.sessionID))?.frontendContext).toBe('later-login-context');
    });

    it('uses one controller workflow for frontend account and guest email links with bounded return destinations', async () => {
        const {prepared: activation} = preparedMailDelivery(true);
        const {prepared: reset} = preparedMailDelivery(true, 'preparePasswordResetEmail');
        const {prepared: guestMail} = preparedMailDelivery(true, 'prepareGuestLinkEmail');
        const recovery = vi.spyOn(email, 'sendGuestRecoveryEmail').mockResolvedValue(undefined);
        try {
            const next = '/packing/example?locale=de#items';
            const accountReq = await initialIdentityRequest();
            await userController.registerUserWithSession({username: 'frontend-link-account', displayname: 'Frontend Name',
                email: 'frontend-links@example.test', password: 'registration-secret', password_repeat: 'registration-secret'},
                accountReq, {...atomicAccountOptions(accountReq), next});
            const activateUrl = new URL(activation.mock.calls[0][1]);
            expect(activateUrl.pathname).toMatch(/^\/users\/activate\/[^/]+$/);
            expect(activateUrl.searchParams.get('next')).toBe(next);
            await userController.requestPasswordResetWithSession('frontend-link-account', accountReq,
                {context: accountReq.apiActor!.context, frontend: true, next: '//outside.invalid',
                    prepareResult: () => prepareValidatedJson(accountReq, 'requestPasswordReset', 200, {changed: true})});
            const resetUrl = new URL(reset.mock.calls[0][1]);
            expect(resetUrl.pathname).toMatch(/^\/users\/reset-password\/[^/]+$/);
            expect(resetUrl.searchParams.get('next')).toBe('/users/dashboard');

            const guestReq = await initialIdentityRequest();
            const committed = await userController.registerGuestWithSession('Frontend Guest', '  FRONTEND-GUEST@example.test  ', guestReq,
                {...atomicGuestOptions(guestReq), next});
            const session = committed.session;
            const link = JSON.parse(committed.result.json).personalLink as string;
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
        const {prepared: activation} = preparedMailDelivery(true);
        try {
            const req = await initialIdentityRequest();
            await userController.registerUserWithSession({
                username, displayname, email: `${username}@example.test`,
                password: 'test-password-1', password_repeat: 'test-password-1',
            }, req, atomicAccountOptions(req));
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
        const {prepared: recovery} = preparedMailDelivery(true, 'preparePasswordResetEmail');
        try {
            const req = await initialIdentityRequest();
            await userController.requestPasswordResetWithSession(profile.user!.username, req,
                {context: req.apiActor!.context, prepareResult: () => prepareValidatedJson(req, 'requestPasswordReset', 200, {changed: true})});
            expect(recovery).toHaveBeenCalledWith({name: 'legacy-blank-name', address: 'legacy-name@example.test'}, expect.any(String));
        } finally {
            recovery.mockRestore();
        }
    });

    it('addresses activation and password recovery to the saved account name', async () => {
        const {prepared: activation} = preparedMailDelivery(true);
        const {prepared: recovery} = preparedMailDelivery(true, 'preparePasswordResetEmail');
        try {
            const req = await initialIdentityRequest();
            await userController.registerUserWithSession({
                username: 'named-email-account', displayname: 'Morgan Example', email: 'named-account@example.test',
                password: 'test-password-1', password_repeat: 'test-password-1',
            }, req, atomicAccountOptions(req));
            expect(activation).toHaveBeenCalledWith(
                {name: 'Morgan Example', address: 'named-account@example.test'}, expect.stringContaining('/users/activate/'),
            );
            await userController.requestPasswordResetWithSession('named-email-account', req,
                {context: req.apiActor!.context, prepareResult: () => prepareValidatedJson(req, 'requestPasswordReset', 200, {changed: true})});
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

    it('registers an inactive account with a usable profile, all account lookups, and verified password', async () => {
        // These reads exercise the same newly committed account/profile transaction.
        // Reusing that account keeps each persistence and password assertion without
        // repeating registration and its deliberately expensive password hashing.
        const {id: userId, username, email: accountEmail} = await registerLocalAccount('registration');

        const account = await userService.getUserByUsername(username);
        expect(account?.id).toBe(userId);
        expect(Boolean(account?.isActive)).toBe(false);
        expect(account?.profiles).toHaveLength(1);
        expect(await userService.getUserByEmail(accountEmail)).toMatchObject({id: userId, username});
        expect((await userService.findUserByNameOrEmail(username))?.id).toBe(userId);
        expect((await userService.findUserByNameOrEmail(accountEmail))?.id).toBe(userId);
        expect((await userService.findUserByNameOrEmail(userId))?.id).toBe(userId);
        await expect(userService.verifyPassword(userId, 'initial-secret')).resolves.toBe(true);
        await expect(userService.verifyPassword(userId, 'wrong-secret')).resolves.toBe(false);
    });

    it('logs in an active local account with its username and email in independent sessions', async () => {
        // This existing 14-character credential is intentionally below the new
        // registration/reset minimum. Login must keep accepting its saved hash.
        const {id: userId, username, email: accountEmail} = await registerLocalAccount('local-login');
        await userService.activateUser(userId);
        const req = await initialIdentityRequest();
        const committed = await userController.loginUserWithSession({username, password: 'initial-secret'}, req,
            {context: req.apiActor!.context, prepareResult: staged => prepareIdentityReply(req, staged, 'loginIdentity')});
        const session = committed.session;

        // Canary: the existing username credential must continue to establish the user and default-profile session.
        expect(session.auth?.user?.id).toBe(userId);
        expect(session.profile?.id).toBe(session.auth?.user?.profiles[0].id);
        // A fresh session proves email login establishes its own identity rather
        // than accidentally retaining the preceding username login's state.
        const emailReq = await initialIdentityRequest();
        const emailCommitted = await userController.loginUserWithSession({username: accountEmail, password: 'initial-secret'}, emailReq,
            {context: emailReq.apiActor!.context, prepareResult: staged => prepareIdentityReply(emailReq, staged, 'loginIdentity')});
        const emailSession = emailCommitted.session;

        // Regression: local users who enter their email must receive the same authenticated session as username users.
        expect(emailSession.auth?.user?.id).toBe(userId);
        expect(emailSession.profile?.id).toBe(emailSession.auth?.user?.profiles[0].id);
    });

    it('activates an account with its persisted token and consumes the token', async () => {
        const {id: userId} = await registerLocalAccount('activation');

        const token = await userService.generateActivationToken(userId);
        expect((await userService.verifyActivationToken(token))?.id).toBe(userId);
        const req = await initialIdentityRequest();
        await userController.activateAccountWithSession(token, req, activationOptions(req));
        expect(Boolean((await userService.getUserById(userId))?.isActive)).toBe(true);
        expect(await userService.verifyActivationToken(token)).toBeNull();
    });

    it('resets a password through the recovery-token workflow and consumes the token', async () => {
        const {id: userId, username} = await registerLocalAccount('password-reset');

        const token = await userService.generatePasswordResetToken(username);
        expect((await userService.verifyPasswordResetToken(token))?.id).toBe(userId);
        // Both native GET and v1 preflight call this non-consuming controller admission.
        await expect(userController.checkPasswordForgotToken(token)).resolves.toBeUndefined();
        await expect(userController.checkPasswordForgotToken(token)).resolves.toBeUndefined();
        const req = await initialIdentityRequest();
        await userController.resetPasswordWithSession(token, {
            password: 'replacement-secret',
            confirmPassword: 'replacement-secret'
        }, req, {context: req.apiActor!.context,
            prepareResult: () => prepareValidatedJson(req, 'resetAccountPassword', 200, {changed: true})});
        await expect(userService.verifyPassword(userId, 'replacement-secret')).resolves.toBe(true);
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

    it('links and unlinks OIDC without deleting the existing local account', async () => {
        const {id: userId} = await registerLocalAccount('oidc-link');

        await userService.linkUserToOidc(userId, 'https://identity.example', 'linked-subject');
        expect(await userService.getUserByOidc('https://identity.example', 'linked-subject')).toMatchObject({id: userId});
        await userService.unlinkOidc(userId);
        expect(await userService.getUserByOidc('https://identity.example', 'linked-subject')).toBeNull();
        expect(await userService.getUserById(userId)).not.toBeNull();
    });

    it('keeps an exact OIDC account match authoritative over changed provider email and name claims', async () => {
        const {id, email, username} = await registerLocalAccount('oidc-exact-policy');
        await userService.linkUserToOidc(id, 'https://identity.example', 'exact-policy-subject');
        const profiles = await userService.getProfilesForUser(id);
        const usersBefore = await AppDataSource.getRepository(User).count();

        const account = await findOrCreateUserFromOidc('https://identity.example', {
            sub: 'exact-policy-subject', email: 'changed-exact-claim@example.com',
            preferred_username: 'changed-provider-username', name: 'Changed provider name',
        });

        // An exact issuer/subject match historically does not relink by email,
        // rename the account, activate it or replace its existing profiles.
        expect(account).toMatchObject({id, email, username});
        expect(Boolean(account.isActive)).toBe(false);
        expect(account.profiles.map(profile => profile.id).sort()).toEqual(profiles.map(profile => profile.id).sort());
        expect(await AppDataSource.getRepository(User).count()).toBe(usersBefore);
        await expect(userService.verifyPassword(id, 'initial-secret')).resolves.toBe(true);
        expect(await AppDataSource.getRepository(User).findOneBy({id})).toMatchObject({email, username, oidcSub: 'exact-policy-subject'});
    });

    it('links an existing email account and activates it without replacing its password or profiles', async () => {
        const {id, email, username} = await registerLocalAccount('oidc-email-policy');
        await userService.createProfile(id, 'Additional OIDC policy profile');
        const profiles = await userService.getProfilesForUser(id);
        const usersBefore = await AppDataSource.getRepository(User).count();

        const configuration = vi.spyOn(settings, 'value', 'get').mockReturnValue({...settings.value,
            oidcLinkByEmail: true, oidcAllowEmailRebinding: false});
        let account: User;
        try {
            // Explicit provider trust does not require its optional verification claim.
            account = await findOrCreateUserFromOidc('https://identity.example', {
                sub: 'email-policy-subject', email, email_verified: false,
                preferred_username: 'unused-provider-name', name: 'Unused provider label',
            });
        } finally { configuration.mockRestore(); }

        // Email linking preserves the local identity and its profiles; only the
        // existing activation/link fields are selected by this policy branch.
        expect(account).toMatchObject({id, email, username, oidcIssuer: 'https://identity.example', oidcSub: 'email-policy-subject'});
        expect(Boolean(account.isActive)).toBe(true);
        expect(account.profiles.map(profile => profile.id).sort()).toEqual(profiles.map(profile => profile.id).sort());
        expect(await AppDataSource.getRepository(User).count()).toBe(usersBefore);
        await expect(userService.verifyPassword(id, 'initial-secret')).resolves.toBe(true);
        const saved = await AppDataSource.getRepository(User).findOneByOrFail({id});
        expect(saved.oidcSub).toBe('email-policy-subject');
        expect(Boolean(saved.isActive)).toBe(true);
    });

    it.each([false, true])('provisions an unmatched OIDC subject with email linking set to %s', async linkByEmail => {
        const configuration = vi.spyOn(settings, 'value', 'get').mockReturnValue({...settings.value,
            oidcLinkByEmail: linkByEmail, oidcAllowEmailRebinding: false});
        const sub = `jit-provisioned-${linkByEmail}`;
        const email = `jit-${linkByEmail}@example.com`;
        try {
            const account = await findOrCreateUserFromOidc('https://identity.example', {
                sub, email, preferred_username: `jit-${linkByEmail}`, name: 'JIT User',
            });
            expect(account.oidcSub).toBe(sub);
            expect(Boolean(account.isActive)).toBe(true);
            expect(account.profiles).toHaveLength(1);
            // Preserve the inherited disabled-linking branch even without a
            // collision: only an enabled, unclaimed email retains its claim.
            expect(account.email).toBe(linkByEmail ? email : `${sub}@no-email.local`);
        } finally { configuration.mockRestore(); }
    });

    it('keeps a matching local account untouched when automatic email linking is disabled', async () => {
        const local = await registerLocalAccount('oidc-disabled');
        const configuration = vi.spyOn(settings, 'value', 'get').mockReturnValue({...settings.value,
            oidcLinkByEmail: false, oidcAllowEmailRebinding: true});
        try {
            const account = await findOrCreateUserFromOidc('https://identity.example', {
                sub: 'disabled-link-subject', email: local.email, preferred_username: 'separate-oidc-user', name: 'Separate user',
            });
            expect(account.id).not.toBe(local.id);
            expect(account.email).toBe('disabled-link-subject@no-email.local');
            const saved = await AppDataSource.getRepository(User).findOneByOrFail({id: local.id});
            expect(saved.oidcIssuer).toBeNull();
            expect(saved.oidcSub).toBeNull();
            expect(Boolean(saved.isActive)).toBe(false);
        } finally { configuration.mockRestore(); }
    });

    it('rejects a conflicting binding before activation or replacement without its separate opt-in', async () => {
        const local = await registerLocalAccount('oidc-conflict');
        await userService.linkUserToOidc(local.id, 'https://original.example', 'original-subject');
        const before = await AppDataSource.getRepository(User).findOneByOrFail({id: local.id});
        const configuration = vi.spyOn(settings, 'value', 'get').mockReturnValue({...settings.value,
            oidcLinkByEmail: true, oidcAllowEmailRebinding: false});
        try {
            await expect(findOrCreateUserFromOidc('https://identity.example', {
                sub: 'conflicting-subject', email: local.email, email_verified: true,
            })).rejects.toMatchObject({code: 'FORBIDDEN', status: 403});
            const saved = await AppDataSource.getRepository(User).findOneByOrFail({id: local.id});
            expect(saved).toMatchObject({oidcIssuer: before.oidcIssuer, oidcSub: before.oidcSub,
                isActive: before.isActive, password: before.password, email: before.email, name: before.name});
        } finally { configuration.mockRestore(); }
    });

    it('replaces a binding only with both operator settings enabled while preserving local records', async () => {
        const local = await registerLocalAccount('oidc-rebind');
        await userService.linkUserToOidc(local.id, 'https://original.example', 'original-rebind-subject');
        const profiles = await userService.getProfilesForUser(local.id);
        const configuration = vi.spyOn(settings, 'value', 'get').mockReturnValue({...settings.value,
            oidcLinkByEmail: true, oidcAllowEmailRebinding: true});
        try {
            const account = await findOrCreateUserFromOidc('https://identity.example', {
                sub: 'replacement-subject', email: local.email, name: 'Ignored replacement name',
            });
            expect(account).toMatchObject({id: local.id, oidcIssuer: 'https://identity.example', oidcSub: 'replacement-subject'});
            expect(Boolean(account.isActive)).toBe(true);
            expect(account.profiles.map(profile => profile.id)).toEqual(profiles.map(profile => profile.id));
            await expect(userService.verifyPassword(local.id, 'initial-secret')).resolves.toBe(true);
        } finally { configuration.mockRestore(); }
    });

    it('serializes competing first links so only one subject acquires the email account', async () => {
        const local = await registerLocalAccount('oidc-concurrent');
        const configuration = vi.spyOn(settings, 'value', 'get').mockReturnValue({...settings.value,
            oidcLinkByEmail: true, oidcAllowEmailRebinding: false});
        try {
            const subjects = ['concurrent-link-first', 'concurrent-link-second'];
            const outcomes = await Promise.allSettled(subjects.map(sub =>
                findOrCreateUserFromOidc('https://identity.example', {sub, email: local.email})));
            const completed = outcomes.filter(outcome => outcome.status === 'fulfilled');
            const rejected = outcomes.filter(outcome => outcome.status === 'rejected');
            expect(completed).toHaveLength(1);
            expect(rejected).toHaveLength(1);
            expect(rejected[0]).toMatchObject({reason: {code: 'FORBIDDEN', status: 403}});
            const saved = await AppDataSource.getRepository(User).findOneByOrFail({id: local.id});
            const successful = completed[0] as PromiseFulfilledResult<User>;
            expect(saved.oidcSub).toBe(successful.value.oidcSub);
            expect(subjects).toContain(saved.oidcSub);
        } finally { configuration.mockRestore(); }
    });

});


/** Retain real recipient/template preparation while replacing only SMTP delivery. */
function deletionDelivery(accepted = true) {
    const render = emailOwner.prepareDeletionEmail;
    const deliver = vi.fn().mockResolvedValue(accepted);
    const prepared = vi.spyOn(emailOwner, 'prepareDeletionEmail').mockImplementation((...args) => {
        render(...args);
        return {deliver};
    });
    return {prepared, deliver};
}

describe('approved local identity deletion and provider outcome', () => {
    it('rejects an admitted former-owner deactivation after actual transfer without detaching the recipient profile', async () => {
        const {req} = await ordinaryLogoutFixture('account');
        const profile = req.session.profile!;
        const original = JSON.stringify(req.session);
        const [listId, item] = await createPackingListWithItem(profile.id);
        const recipient = await ordinaryLogoutFixture('account');
        const recipientId = recipient.req.session.auth!.user!.id;
        const {token} = await userController.requestProfileMigrationToken(req.apiActor!);

        // The original request remains admitted under its captured owner. Finish
        // a real capability transfer through the production feature/controller
        // before allowing that old deactivation to resume; no DBAL is substituted.
        await userController.executeIdentityProfileMigration(recipient.req, token);
        expect(await userService.getProfileById(profile.id)).toMatchObject({userId: recipientId, guestId: null});
        const recipientBefore = JSON.stringify(await userService.getUserById(recipientId));
        const storedBefore = JSON.stringify(await readStoredSession(req.sessionStore, req.sessionID));
        const domainBefore = {
            list: await AppDataSource.query('SELECT * FROM packing_lists WHERE id = ?', [listId]),
            item: await AppDataSource.query('SELECT * FROM packing_items WHERE id = ?', [item.id]),
        };

        let rejected: unknown;
        try {
            await userController.deactivateIdentityProfile(req, {name: profile.name});
        } catch (error) { rejected = error; }

        // Safe diagnostics compare entire serialized identity snapshots without
        // printing password hashes, CSRF values or private capabilities on failure.
        const current = await userService.getProfileById(profile.id);
        expect.soft({code: (rejected as {code?: string} | undefined)?.code,
            userId: current?.userId, guestId: current?.guestId})
            .toEqual({code: 'SESSION_CONTEXT_CHANGED', userId: recipientId, guestId: null});
        expect.soft(JSON.stringify(await userService.getUserById(recipientId)) === recipientBefore,
            'The recipient account and owned profiles must remain unchanged').toBe(true);
        expect.soft(JSON.stringify(req.session) === original, 'The admitted request must stay untouched').toBe(true);
        expect.soft(JSON.stringify(await readStoredSession(req.sessionStore, req.sessionID)) === storedBefore,
            'Rejected deactivation must not save its old Session').toBe(true);
        expect.soft({list: await AppDataSource.query('SELECT * FROM packing_lists WHERE id = ?', [listId]),
            item: await AppDataSource.query('SELECT * FROM packing_items WHERE id = ?', [item.id])}).toEqual(domainBefore);
    });

    it.each(['ordinary', 'same-code'] as const)('preserves %s deactivation mail failure without a whole-operation transaction', async kind => {
        const {req} = await ordinaryLogoutFixture('account');
        const user = req.session.auth!.user!;
        const profile = req.session.profile!;
        // Only SMTP delivery is replaced. A later error cannot borrow the
        // earlier ownership guard's provenance merely by sharing its API code.
        const failure = kind === 'same-code' ? new ApiProblem('SESSION_CONTEXT_CHANGED')
            : new Error('Controlled deactivation mail failure');
        const delivery = vi.spyOn(email, 'sendDeletionEmail').mockRejectedValueOnce(failure);
        try {
            await expect(userController.deactivateIdentityProfile(req, {name: profile.name}))
                .rejects.toMatchObject({code: 'WORKFLOW_OUTCOME_UNKNOWN'});
            expect(await userService.getUserById(user.id)).toBeNull();
            expect(await userService.getProfileById(profile.id)).toMatchObject({userId: null});
            expect(req.session.auth?.user?.id).toBe(user.id);
        } finally { delivery.mockRestore(); }
    });

    it.each(['detached', 'missing'] as const)('rejects an already %s profile before cleanup or Session changes', async kind => {
        const {req} = await ordinaryLogoutFixture('account');
        const profile = req.session.profile!;
        const userId = req.session.auth!.user!.id;
        const original = JSON.stringify(req.session);
        if (kind === 'detached') await userService.removeProfileFromOwner(profile.id);
        else await AppDataSource.getRepository(Profile).delete(profile.id);
        const stored = JSON.stringify(await readStoredSession(req.sessionStore, req.sessionID));

        await expect(userController.deactivateIdentityProfile(req, {name: profile.name}))
            .rejects.toMatchObject({code: 'SESSION_CONTEXT_CHANGED'});
        expect(await userService.getUserById(userId)).not.toBeNull();
        if (kind === 'detached') expect(await userService.getProfileById(profile.id)).toMatchObject({userId: null});
        else expect(await userService.getProfileById(profile.id)).toBeNull();
        expect(JSON.stringify(req.session) === original).toBe(true);
        expect(JSON.stringify(await readStoredSession(req.sessionStore, req.sessionID)) === stored).toBe(true);
    });

    it('serializes two admitted deactivations and rejects only the later detach', async () => {
        const {req} = await ordinaryLogoutFixture('account');
        const profile = req.session.profile!;
        const second = identityRequest();
        second.sessionID = req.sessionID;
        second.sessionStore = req.sessionStore;
        second.sessionStore.createSession(second, (await readStoredSession(req.sessionStore, req.sessionID))!);
        await captureApiActor(second);

        // Both captured requests enter the real operation. The shared owner and
        // Profile locks permit one detach; no synthetic gate replaces persistence.
        const results = await Promise.allSettled([req, second].map(request =>
            userController.deactivateIdentityProfile(request, {name: profile.name})));
        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        expect(results.filter(result => result.status === 'rejected'))
            .toEqual([expect.objectContaining({reason: expect.objectContaining({code: 'SESSION_CONTEXT_CHANGED'})})]);
        expect(await userService.getProfileById(profile.id)).toMatchObject({userId: null});
        expect(await userService.getUserById(req.apiActor!.auth!.user!.id)).toBeNull();
        expect((await readStoredSession(req.sessionStore, req.sessionID))?.auth).toBeUndefined();
    });

    it('retains shared guest deactivation rights without extending the account-only API', async () => {
        const {req} = await ordinaryLogoutFixture('guest');
        const profile = req.session.profile!;
        const guestId = req.session.auth!.guest!.id;
        await expect(identity.deactivateProfile({name: profile.name}, req.session)).resolves.toBe('guest-deleted');
        expect(await userService.getProfileById(profile.id)).toMatchObject({guestId: null, defaultForOwner: false});
        expect(await AppDataSource.getRepository(Guest).findOneBy({id: guestId})).toBeNull();
    });

    it('retains detach and cleanup when the later local Session save fails', async () => {
        const {req} = await ordinaryLogoutFixture('account');
        const profile = req.session.profile!;
        const userId = req.session.auth!.user!.id;
        const stored = JSON.stringify(await readStoredSession(req.sessionStore, req.sessionID));
        const storeFailures: string[] = [];
        function observeStoreFailure(error: unknown): void {
            storeFailures.push((error as {code?: string})?.code ?? 'unclassified');
        }
        req.sessionStore.on('disconnect', observeStoreFailure);
        // The real store must fail after the approved short detach transaction
        // and existing account cleanup; this remains an unknown partial outcome.
        await AppDataSource.query("CREATE TRIGGER reject_deactivation_save BEFORE UPDATE ON `session` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Controlled deactivation Session failure'");
        try {
            await expect(userController.deactivateIdentityProfile(req, {name: profile.name}))
                .rejects.toMatchObject({code: 'WORKFLOW_OUTCOME_UNKNOWN'});
        } finally {
            req.sessionStore.off('disconnect', observeStoreFailure);
            await AppDataSource.query('DROP TRIGGER reject_deactivation_save');
        }
        // The installed store reports the failed UPDATE's duplicate INSERT
        // fallback. This proves the test reached local save, rather than failing
        // earlier during optional mail delivery or completion preparation.
        expect(storeFailures).toContain('ER_DUP_ENTRY');
        expect(await userService.getProfileById(profile.id)).toMatchObject({userId: null});
        expect(await userService.getUserById(userId)).toBeNull();
        expect(JSON.stringify(await readStoredSession(req.sessionStore, req.sessionID)) === stored).toBe(true);
    });

    it.each([false, true])('leaves account and Session intact when mail preparation fails (provider=%s)', async provider => {
        const {req} = await ordinaryLogoutFixture('account');
        if (provider) {
            req.session.tokens = {access_token: 'synthetic-private-access', token_type: 'bearer'};
            await persistSession(req.session);
        }
        const original = req.session;
        const user = original.auth!.user!;
        const prepared = vi.spyOn(emailOwner, 'prepareDeletionEmail').mockImplementationOnce(() => { throw new Error('Controlled closure rendering failure'); });
        try {
            await expect(userController.deleteIdentityAccount(req, {username: user.username!}))
                .rejects.toMatchObject({code: 'WORKFLOW_OUTCOME_UNKNOWN'});
            expect(await userService.getUserById(user.id)).not.toBeNull();
            expect(await userService.getProfileById(original.profile!.id)).toMatchObject({userId: user.id});
            expect(req.session).toBe(original);
            expect((await readStoredSession(req.sessionStore, req.sessionID))?.auth?.user?.id).toBe(user.id);
        } finally { prepared.mockRestore(); }
    });

    it.each(['account', 'guest'] as const)('rolls back %s deletion and Session when its prepared response fails', async kind => {
        const {req} = await ordinaryLogoutFixture(kind);
        const original = req.session;
        const originalJson = JSON.stringify(original);
        const username = (original.auth?.user ?? original.auth?.guest)!.username!;
        await expect(userController.deleteIdentityAccount(req, {username}, () => { throw new Error('Rejected deletion receipt'); }))
            .rejects.toMatchObject({code: 'WORKFLOW_OUTCOME_UNKNOWN'});
        expect(req.session).toBe(original);
        expect(JSON.stringify(original)).toBe(originalJson);
        expect(await userService.getProfileById(original.profile!.id)).toMatchObject(kind === 'account'
            ? {userId: original.auth!.user!.id} : {guestId: original.auth!.guest!.id});
        if (kind === 'account') expect(await userService.getUserById(original.auth!.user!.id)).not.toBeNull();
        else expect(await userService.getGuestInternal(original.auth!.guest!.id)).not.toBeNull();
        expect(await readStoredSession(req.sessionStore, req.sessionID)).toMatchObject({auth: original.auth,
            frontendContext: original.frontendContext, frontendCsrfToken: original.frontendCsrfToken});
    });

    it.each([false, true])('rolls back deletion and dependents when the real Session write fails (provider=%s)', async provider => {
        const {req} = await ordinaryLogoutFixture('account');
        if (provider) {
            req.session.tokens = {access_token: 'synthetic-private-access', token_type: 'bearer'};
            await persistSession(req.session);
        }
        const original = req.session;
        const user = original.auth!.user!;
        // Inject a storage failure only in this suite's disposable schema. The
        // transaction-bound TypeORM store still performs its actual SQL write.
        await AppDataSource.query("CREATE TRIGGER reject_identity_session BEFORE UPDATE ON `session` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Controlled Session write failure'");
        try {
            await expect(userController.deleteIdentityAccount(req, {username: user.username!}))
                .rejects.toMatchObject({code: 'WORKFLOW_OUTCOME_UNKNOWN'});
        } finally { await AppDataSource.query('DROP TRIGGER reject_identity_session'); }
        expect(req.session).toBe(original);
        expect(await userService.getUserById(user.id)).not.toBeNull();
        expect(await userService.getProfileById(original.profile!.id)).toMatchObject({userId: user.id});
        expect((await readStoredSession(req.sessionStore, req.sessionID))?.auth?.user?.id).toBe(user.id);
    });

    it('retains committed deletion and anonymous authority after delivery rejects', async () => {
        const {req} = await ordinaryLogoutFixture('account');
        const user = req.session.auth!.user!;
        const profileId = req.session.profile!.id;
        const render = emailOwner.prepareDeletionEmail;
        const deliver = vi.fn().mockRejectedValue(new Error('Controlled SMTP failure'));
        const prepared = vi.spyOn(emailOwner, 'prepareDeletionEmail').mockImplementation((...args) => {
            render(...args);
            return {deliver};
        });
        try {
            const completion = await userController.deleteIdentityAccount(req, {username: user.username!});
            expect(completion).toMatchObject({destination: '/', redirect: null, notice: {messageKey: 'profile.accountDeleted'}});
            expect(deliver).toHaveBeenCalledOnce();
            expect(await userService.getUserById(user.id)).toBeNull();
            expect(await userService.getProfileById(profileId)).toMatchObject({userId: null});
            expect(req.session.auth).toBeUndefined();
            expect((await readStoredSession(req.sessionStore, req.sessionID))?.auth).toBeUndefined();
        } finally { prepared.mockRestore(); }
    });

    it('reports provider discovery failure only after real local sign-out is persisted', async () => {
        const {req} = await ordinaryLogoutFixture('account');
        req.session.tokens = {id_token: 'private-provider-evidence', access_token: 'private-access', token_type: 'bearer'};
        await persistSession(req.session);
        const beforeContext = req.session.frontendContext;
        const configuration = vi.spyOn(settings, 'value', 'get').mockReturnValue({...settings.value, initialized: true,
            oidcIssuerBaseUrl: 'https://identity.example.test', rootUrl: 'https://surveyor.example.test'});
        const discovery = vi.spyOn(openid, 'discovery').mockImplementation(async () => {
            // This is the first external boundary; the real store must already be anonymous.
            const stored = await readStoredSession(req.sessionStore, req.sessionID);
            expect(stored?.auth).toBeUndefined();
            expect(stored?.tokens).toBeUndefined();
            throw new Error('Controlled discovery failure');
        });
        try {
            await expect(userController.logoutUserOidc(req.session, 'outcome')).resolves.toEqual({
                redirect: 'https://surveyor.example.test', providerLogout: 'unconfirmed'});
            expect(discovery).toHaveBeenCalledOnce();
            expect(req.session.frontendContext).not.toBe(beforeContext);
            expect((await readStoredSession(req.sessionStore, req.sessionID))?.profile).toBeUndefined();
        } finally { discovery.mockRestore(); configuration.mockRestore(); }
    });

    it('keeps a failed local save outside the confirmed provider outcome', async () => {
        const {req} = await ordinaryLogoutFixture('account');
        req.session.tokens = {} as NonNullable<Request['session']['tokens']>;
        await persistSession(req.session);
        const discovery = vi.spyOn(openid, 'discovery').mockRejectedValue(new Error('Unexpected provider access'));
        await AppDataSource.query("CREATE TRIGGER reject_provider_local_session BEFORE UPDATE ON `session` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Controlled provider local save failure'");
        try {
            // The store may attempt its existing insert fallback after UPDATE
            // rejection; either SQL error must remain an unconfirmed local failure.
            await expect(userController.logoutUserOidc(req.session, 'outcome')).rejects.toBeInstanceOf(Error);
            expect(discovery).not.toHaveBeenCalled();
            expect((await readStoredSession(req.sessionStore, req.sessionID))?.auth?.user).toBeTruthy();
        } finally {
            await AppDataSource.query('DROP TRIGGER reject_provider_local_session');
            discovery.mockRestore();
        }
    });

    it.each(['metadata', 'URL'] as const)('separates provider %s failure while preserving the default error contract', async failure => {
        const configuration = vi.spyOn(settings, 'value', 'get').mockReturnValue({...settings.value, initialized: true,
            oidcIssuerBaseUrl: 'https://identity.example.test'});
        const discovery = vi.spyOn(openid, 'discovery').mockResolvedValue({serverMetadata() {
            if (failure === 'metadata') throw new Error('Controlled metadata failure');
            return {end_session_endpoint: 'not an absolute URL'};
        }} as unknown as openid.Configuration);
        try {
            await oidc.initOIDC();
            const {req} = await ordinaryLogoutFixture('account');
            req.session.tokens = {} as NonNullable<Request['session']['tokens']>;
            await persistSession(req.session);
            await expect(userController.logoutUserOidc(req.session, 'outcome')).resolves.toMatchObject({providerLogout: 'unconfirmed'});
            const preserved = await ordinaryLogoutFixture('account');
            preserved.req.session.tokens = {} as NonNullable<Request['session']['tokens']>;
            await persistSession(preserved.req.session);
            await expect(userController.logoutUserOidc(preserved.req.session)).rejects.toThrow();
            expect((await readStoredSession(preserved.req.sessionStore, preserved.req.sessionID))?.auth).toBeUndefined();
        } finally { discovery.mockRestore(); configuration.mockRestore(); }
    });

    it('confirms provider-bearing deletion with a separate provider failure warning', async () => {
        const {req} = await ordinaryLogoutFixture('account');
        const user = req.session.auth!.user!;
        req.session.tokens = {} as NonNullable<Request['session']['tokens']>;
        await persistSession(req.session);
        const configuration = vi.spyOn(settings, 'value', 'get').mockReturnValue({...settings.value, initialized: true,
            oidcIssuerBaseUrl: 'https://identity.example.test'});
        const discovery = vi.spyOn(openid, 'discovery').mockResolvedValue({serverMetadata() {
            throw new Error('Controlled provider-bearing deletion failure');
        }} as unknown as openid.Configuration);
        const delivery = deletionDelivery();
        try {
            await oidc.initOIDC();
            await expect(userController.deleteIdentityAccount(req, {username: user.username!}))
                .resolves.toMatchObject({destination: '/', redirect: null,
                    notice: {kind: 'info', messageKey: 'profile.accountDeletedProviderUnconfirmed'}});
            expect(await userService.getUserById(user.id)).toBeNull();
            expect((await readStoredSession(req.sessionStore, req.sessionID))?.auth).toBeUndefined();
            expect(delivery.deliver).toHaveBeenCalledOnce();
        } finally { discovery.mockRestore(); configuration.mockRestore(); delivery.prepared.mockRestore(); }
    });

    it('keeps a prepared local confirmation when only postcommit provider URL serialization fails', async () => {
        const {req} = await ordinaryLogoutFixture('account');
        const user = req.session.auth!.user!;
        req.session.tokens = {id_token: 'synthetic-private-hint', access_token: 'synthetic-access', token_type: 'bearer'};
        await persistSession(req.session);
        const delivery = deletionDelivery();
        const provider = vi.spyOn(oidc, 'prepareProviderLogout').mockImplementation(async () => {
            expect(await userService.getUserById(user.id)).toBeNull();
            expect((await readStoredSession(req.sessionStore, req.sessionID))?.auth).toBeUndefined();
            return {redirect: 'https://identity.example/logout'};
        });
        try {
            function prepareCompletion(completion: components['schemas']['ProfileWorkflowCompletion']) {
                if (completion.redirect) throw new Error('Controlled external URL serialization failure');
                return prepareValidatedJson(req, 'deleteIdentityAccount', 200, completion, completion.resultingContext);
            }
            const reply = await userController.deleteIdentityAccount(req, {username: user.username!}, prepareCompletion);
            expect(JSON.parse(reply.json)).toMatchObject({redirect: null,
                notice: {kind: 'info', messageKey: 'profile.accountDeletedProviderUnconfirmed'}});
            expect(provider).toHaveBeenCalledOnce();
            expect(delivery.deliver).toHaveBeenCalledOnce();
            expect(req.session.tokens).toBeUndefined();
            expect(JSON.stringify(reply)).not.toContain('synthetic-private-hint');
        } finally { provider.mockRestore(); delivery.prepared.mockRestore(); }
    });

    it('keeps provider-bearing deletion confirmed and local when mail delivery fails', async () => {
        const {req} = await ordinaryLogoutFixture('account');
        const user = req.session.auth!.user!;
        req.session.tokens = {access_token: 'synthetic-private-access', token_type: 'bearer'};
        await persistSession(req.session);
        const delivery = deletionDelivery(false);
        const provider = vi.spyOn(oidc, 'prepareProviderLogout');
        try {
            await expect(userController.deleteIdentityAccount(req, {username: user.username!}))
                .resolves.toMatchObject({redirect: null,
                    notice: {kind: 'info', messageKey: 'profile.accountDeletedDeliveryUnconfirmed'}});
            expect(provider).not.toHaveBeenCalled();
            expect(delivery.deliver).toHaveBeenCalledOnce();
            expect(await userService.getUserById(user.id)).toBeNull();
            expect((await readStoredSession(req.sessionStore, req.sessionID))?.tokens).toBeUndefined();
        } finally { provider.mockRestore(); delivery.prepared.mockRestore(); }
    });

    it('preserves a successful provider handoff after confirmed local sign-out', async () => {
        const {req} = await ordinaryLogoutFixture('account');
        req.session.tokens = {id_token: 'provider-hint', access_token: 'private-access', token_type: 'bearer'};
        await persistSession(req.session);
        const configuration = vi.spyOn(settings, 'value', 'get').mockReturnValue({...settings.value, initialized: true,
            oidcIssuerBaseUrl: 'https://identity.example.test', rootUrl: 'https://surveyor.example.test'});
        const discovery = vi.spyOn(openid, 'discovery').mockResolvedValue({serverMetadata() {
            return {end_session_endpoint: 'https://identity.example.test/logout'};
        }} as unknown as openid.Configuration);
        try {
            await oidc.initOIDC();
            const outcome = await userController.logoutUserOidc(req.session, 'outcome');
            const target = new URL(outcome.redirect);
            expect(target.origin + target.pathname).toBe('https://identity.example.test/logout');
            expect(target.searchParams.get('id_token_hint')).toBe('provider-hint');
            expect(target.searchParams.get('post_logout_redirect_uri')).toBe('https://surveyor.example.test');
            expect(outcome.providerLogout).toBeUndefined();
            expect((await readStoredSession(req.sessionStore, req.sessionID))?.auth).toBeUndefined();
        } finally { discovery.mockRestore(); configuration.mockRestore(); }
    });
});
