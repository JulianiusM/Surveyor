import type {Request} from 'express';
import type {EntityManager} from 'typeorm';
import type {SessionLike} from '../../types/PermissionTypes';
import type {PreparedOwnerCleanup, ProfileOwnerCleanup} from '../../types/IdentityTypes';
import type {PreparedIdentityEmail} from '../../types/EmailTypes';
import {User} from './database/entities/user/User';
import {Guest} from './database/entities/user/Guest';
import {Profile} from './database/entities/user/Profile';
import * as userService from './database/services/UserService';
import mailer, {prepareDeletionEmail, prepareMigrationEmail, resolveEmailRecipientName} from './email';
import {ExpectedError, ValidationError} from './lib/errors';
import {ApiProblem} from './api/problem';
import {uuidKey} from './lib/util';
import * as oidc from './oidc';
import {isNewPasswordValid} from '../../common/lib/frontendIdentity';
import {createTranslator} from '../../common/localization/translator';

/** Enforce the same authored new-credential rule before registration or reset can write anything. */
export function requireNewPassword(password: unknown, template: 'users/register' | 'users/reset-password'): asserts password is string {
    // No submitted secret, form body, trimming or normalized replacement enters
    // the diagnostic. Hashing receives exactly the validated input string.
    if (!isNewPasswordValid(password)) {
        throw new ValidationError(template,
            createTranslator('en').t('auth.passwordRequirements'),
            {}, {cause: 'VALIDATION_FAILED'});
    }
}

/** Apply the captured account/guest's ownership policy while its profile write is locked. */
export function requireCurrentProfileOwner(profile: Profile | null, actor: SessionLike): asserts profile is Profile {
    // A stale admitted profile does not authorize issuance after transfer or detachment.
    const account = actor.auth?.user;
    const guest = actor.auth?.guest;
    if (!profile || (account ? profile.userId !== account.id : !guest || !profile.guestId
        || uuidKey(profile.guestId) !== uuidKey(guest.id))) throw new ApiProblem('SESSION_CONTEXT_CHANGED');
}

/** Issue exactly once after the owning transaction has rechecked the captured principal. */
export async function issueMigrationToken<Result>(actor: SessionLike,
    prepareResult: (result: {token: string}) => Result | Promise<Result>): Promise<Result> {
    /** The same lock serializes token replacement with consumption and ownership changes. */
    async function issueLocked(manager: EntityManager, profile: Profile | null) {
        requireCurrentProfileOwner(profile, actor);
        const token = await userService.generateMigrationToken(profile.id, manager);
        return prepareResult({token});
    }
    return userService.withMigrationProfileTransaction(actor.profile!.id, issueLocked);
}

/** A capability must still be current and unexpired after waiting for the transfer lock. */
export function requireCurrentMigrationToken(profile: Profile | null, token: string): asserts profile is Profile {
    // Never substitute token identity normalization: these opaque capabilities are case sensitive.
    if (!profile || profile.migrationToken !== token || !profile.migrationTokenExpiration
        || profile.migrationTokenExpiration.getTime() <= Date.now()) {
        throw new ExpectedError('Invalid or mismatched token', 'error', 401, {}, {cause: 'TOKEN_INVALID'});
    }
}

/** Resolve the same capability for preview and transfer; consumption repeats this check after locking. */
export async function getProfileToMigrate(token: string): Promise<Profile> {
    const profile = await userService.verifyMigrationToken(token);
    requireCurrentMigrationToken(profile, token);
    return profile;
}

/** Preserve account/guest deletion confirmation before any destructive write. */
export function requireAccountDeletion(body: {username?: unknown}, session: SessionLike): void {
    const {username} = body;
    if (!username || (username !== session.auth?.guest?.username && username !== session.auth?.user?.username)) {
        throw new ValidationError('users/delete-account', 'Invalid account deletion verification', {username},
            {cause: 'ACCOUNT_DELETION_CONFIRMATION_INVALID'});
    }
    if (session.auth?.guest && session.auth.user) throw new ExpectedError('Ambiguous session. Log out and try again', 'error', 500);
    const account = session.auth?.user ?? session.auth?.guest;
    if (!account) throw new ExpectedError('Invalid session. Log out and try again', 'error', 500);
}

/** Retain provider-bearing deletion's existing delete, immediate-mail and provider-logout order. */
export async function deleteAccount(body: {username?: unknown}, session: Request['session']): Promise<string> {
    requireAccountDeletion(body, session);
    const deleted = session.auth?.user ? await userService.deleteUser(session.auth.user.id)
        : await userService.deleteGuest(session.auth!.guest!.id);
    // This path intentionally keeps its established later failures/unknown outcome.
    // Token-free callers use prepared deletion inside the shared Session transaction instead.
    if (deleted?.email) {
        await mailer.sendDeletionEmail({name: resolveEmailRecipientName(deleted instanceof User ? deleted.name : undefined, deleted.username),
            address: deleted.email}, deleted);
    }
    return oidc.logout(session);
}

/** Prepare a removed account's existing notification without sending during a transaction. */
function deletionEmail(account: User | Guest): PreparedIdentityEmail[] {
    if (!account.email) return [];
    const name = resolveEmailRecipientName(account instanceof User ? account.name : undefined, account.username);
    return [prepareDeletionEmail({name, address: account.email}, account)];
}

/** Remove only a former owner made redundant by this transfer, preparing all fallible notification data. */
async function cleanupFormerOwner(owner: User | Guest | null | undefined, manager?: EntityManager): Promise<PreparedOwnerCleanup> {
    // The caller holds the former owner row before checking remaining profiles.
    // Distinct transfers therefore cannot both skip the eventual last-account cleanup.
    if (!owner || (owner instanceof User && (await userService.getProfilesForUser(owner.id, manager)).length !== 0)) {
        return {cleanup: 'none', emails: []};
    }
    // Transfer opts into precommit mail preparation through its supplied manager.
    // Deactivation keeps its separately approved delete-before-mail sequence.
    const emails = manager ? deletionEmail(owner) : [];
    if (owner instanceof User) await userService.deleteUser(owner.id, manager);
    else await userService.deleteGuest(owner.id, manager);
    if (!manager && owner.email) {
        await mailer.sendDeletionEmail({name: resolveEmailRecipientName(owner instanceof User ? owner.name : undefined, owner.username),
            address: owner.email}, owner);
    }
    return {cleanup: owner instanceof User ? 'account-deleted' : 'guest-deleted', emails};
}

/** Detach the selected profile, preserving its domain rows and deactivation's existing partial failures. */
export async function deactivateProfile(body: {name?: unknown}, session: Request['session']): Promise<ProfileOwnerCleanup> {
    const {name} = body;
    if (!name || name !== session.profile?.name) {
        throw new ValidationError('users/profile/delete', 'Invalid profile deactivation verification', {name},
            {cause: 'PROFILE_DEACTIVATION_CONFIRMATION_INVALID'});
    }
    if (!session.profile) throw new ExpectedError('No active profile!', 'error', 401);
    // No whole-operation transaction is added: detach, required cleanup and its
    // existing mail complete before the controller selects a remaining profile or signs out.
    const previousOwner = await userService.removeProfileFromOwner(session.profile.id);
    return (await cleanupFormerOwner(previousOwner)).cleanup;
}

/** SMTP delivery cannot reject a committed transfer or deletion or cause an automatic replay. */
export async function deliverPreparedIdentityEmails(emails: PreparedIdentityEmail[]): Promise<void> {
    // All recipient/template/result work already completed. Each external delivery is independent.
    for (const email of emails) {
        try { await email.deliver(); }
        catch { /* Delivery uncertainty does not reopen committed identity persistence. */ }
    }
}

/** Consume a current capability, clean up its former owner and prepare completion before one commit. */
export async function migrateProfile<Result>(userId: number, token: string,
    prepareResult: (cleanup: ProfileOwnerCleanup) => Result | Promise<Result>): Promise<Result> {
    const candidate = await getProfileToMigrate(token);

    /** The DBAL owns locks/transaction; this feature owns capability, cleanup and notification policy. */
    async function transferLocked(manager: EntityManager, profile: Profile | null) {
        requireCurrentMigrationToken(profile, token);
        const previousOwner = await userService.lockIdentityOwner(profile, manager);
        const recipient = await userService.getUserById(userId, manager);
        if (!recipient) throw new ApiProblem('AUTH_REQUIRED');

        // Prepare migration content from the locked source and current recipient,
        // then retain the established detach/assign/consume DBAL operation.
        const emails = previousOwner?.email ? [prepareMigrationEmail({
            name: resolveEmailRecipientName(previousOwner instanceof User ? previousOwner.name : undefined, previousOwner.username),
            address: previousOwner.email,
        }, profile, recipient)] : [];
        await userService.moveProfileToUserTx(profile.id, userId, manager);
        const cleanup = await cleanupFormerOwner(previousOwner, manager);
        emails.push(...cleanup.emails);
        const result = await prepareResult(cleanup.cleanup);
        return {result, emails};
    }

    const committed = await userService.withMigrationProfileTransaction(candidate.id, transferLocked, candidate, userId);
    await deliverPreparedIdentityEmails(committed.emails);
    return committed.result;
}

/** Delete a token-free principal on the identity completion's existing transaction; Session preparation stays with its owner. */
export async function prepareAccountDeletion(body: {username?: unknown}, session: Request['session'],
    manager: EntityManager): Promise<PreparedIdentityEmail[]> {
    // The session lock rechecks token classification; provider-bearing deletion
    // remains outside this operation even if the earlier request saw no tokens.
    if (session.tokens) throw new ApiProblem('SESSION_CONTEXT_CHANGED');
    requireAccountDeletion(body, session);
    const owner = await userService.lockIdentityOwner({userId: session.auth?.user?.id, guestId: session.auth?.guest?.id}, manager);
    if (!owner) throw new ApiProblem('AUTH_REQUIRED');
    const emails = deletionEmail(owner);
    if (owner instanceof User) await userService.deleteUser(owner.id, manager);
    else await userService.deleteGuest(owner.id, manager);
    return emails;
}
