/*
 * Copyright 2026 Julian Malovanij
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type {EntityManager} from 'typeorm';
import type {OidcClaims} from '../../../types/UserTypes';
import {User} from '../database/entities/user/User';

import * as userService from '../database/services/UserService';

/** Preserve provider username normalization, sequential suffix selection and final clock-based fallback. */
async function toUniqueUsername(base: string): Promise<string> {
    // Normalize before any uniqueness query; all candidates share the same original policy.
    const sanitized = base
        .toLowerCase()
        .replace(/[^a-z0-9._-]/g, '')
        .slice(0, 30) || 'user';
    if (!(await userService.usernameExists(sanitized))) return sanitized;

    // add numeric suffix
    for (let i = 1; i < 10_000; i++) {
        const candidate = `${sanitized}-${i}`;
        if (!(await userService.usernameExists(candidate))) return candidate;
    }
    // fallback (should never happen)
    return `${sanitized}-${Date.now()}`;
}

/**
 * Find or create a user from OIDC claims.
 * - Primary key: (issuer, sub)
 * - Optional fallback: email match (link existing local account)
 * - JIT-provisions a new user when needed.
 */
export async function findOrCreateUserFromOidc(
    oidcIssuer: string,
    claims: OidcClaims,
    {linkByEmail = true} = {}
) {
    const {sub, email, preferred_username, name} = claims;

    // 1) Try exact OIDC match first
    let user = await userService.findOidcAccount(oidcIssuer, sub);

    // 2) If not found: try link-by-email (optional)
    if (!user && linkByEmail && email) {
        user = await userService.findOidcEmailAccount(email);
        if (user) {
            user.oidcIssuer = oidcIssuer;
            user.oidcSub = sub;
            if (user.isActive !== true) user.isActive = true;
            await userService.saveOidcAccount(user);
        }
    }

    // 3) If still not found: create a new local user (JIT provisioning)
    if (!user) {
        const baseUsername =
            preferred_username ||
            (email ? email.split('@')[0] : `oidc_${sub.slice(0, 8)}`);
        const uniqueUsername = await toUniqueUsername(baseUsername);
        const displayName = name || baseUsername;

        // Ensure we don't violate unique(email)
        let emailToUse = email || `${sub}@no-email.local`;

        // If linkByEmail is disabled OR the email is already taken, use a synthetic email
        if (email) {
            const emailTaken = await userService.accountEmailExists(email);
            if (!linkByEmail || emailTaken) {
                emailToUse = `${sub}@no-email.local`;
            }
        }

        return await userService.withUserTransaction(
        /** Prepare the existing ORM records and save profile then account on their original transaction. */
        async function provisionAccount(manager) {
            // Repository construction preserves relation-copy semantics; the business owner chooses every value.
            const {user: newUsr, profile: newProfile} = userService.prepareOidcRecords(manager, {
                username: uniqueUsername,
                name: displayName,
                email: emailToUse,
                password: null,
                isActive: true,
                oidcIssuer,
                oidcSub: sub,
            }, {
                name: displayName,
                defaultForOwner: true,
            });
            // Keep the inherited write order and returned profile fallback without repairing provisioning behavior.
            const savedProfile = await userService.saveProvisionedProfile(newProfile, manager);
            user = await handleUserSaving(newUsr, sub, manager);
            if (!user.profiles || user.profiles.length === 0) {
                user.profiles = [savedProfile];
            }

            return user;
        });
    }

    return user;
}

/** Keep the existing duplicate-constraint email fallback inside the caller's provisioning transaction. */
async function handleUserSaving(user: User, sub: string, manager?: EntityManager) {
    // Try the selected values first. Only the original database constraint signals permit the fallback save.
    try {
        user = await userService.saveOidcAccount(user, manager);
    } catch (err: any) {
        // Last-chance fallback for race conditions (MySQL/PG/SQLite)
        const message = String(err?.message || '');
        if (
            err?.code === 'ER_DUP_ENTRY' || // MySQL/MariaDB
            err?.code === '23505' ||        // Postgres
            message.includes('UNIQUE')      // SQLite/others
        ) {
            user.email = `${sub}@no-email.local`;
            user = await userService.saveOidcAccount(user, manager);
        } else {
            throw err;
        }
    }
    return user;
}
