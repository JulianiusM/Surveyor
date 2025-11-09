import {User} from '../modules/database/entities/user/User';
import * as userService from "../modules/database/services/UserService";
import * as activityService from "../modules/database/services/ActivityService";
import * as driverService from "../modules/database/services/DriverService";
import * as eventService from "../modules/database/services/EventService";
import * as packingService from "../modules/database/services/PackingService";
import * as surveyService from "../modules/database/services/SurveyService";
import settings from "../modules/settings";
import mailer from "../modules/email";
import {ExpectedError, ValidationError} from "../modules/lib/errors";
import {Guest} from "../modules/database/entities/user/Guest";
import {Request} from "express";
import * as oidc from "../modules/oidc";

const CREATE_TEMPLATE = 'users/register';
const LOGIN_TEMPLATE = 'users/login';

export async function registerUser(body: any) {
    const {username, displayname, password, password_repeat, email} = body;
    const returnInfo = {username, email};

    if (!username || !password || !password_repeat || !email) {
        throw new ValidationError(CREATE_TEMPLATE, 'Not all fields were filled out.', returnInfo);
    }

    if (password !== password_repeat) {
        throw new ValidationError(CREATE_TEMPLATE, 'Passwords do not match.', returnInfo);
    }

    const existingUser = await userService.getUserByUsername(username);
    if (existingUser) {
        throw new ValidationError(CREATE_TEMPLATE, 'This username is already taken.', returnInfo);
    }

    // Benutzer registrieren
    let userId = await userService.registerUser(username, displayname || username, password, email);

    // Generiere den Aktivierungs-Token und sende ihn per E-Mail
    const token = await userService.generateActivationToken(userId);
    const activationLink = `${settings.value.rootUrl}/users/activate/${token}`;

    await mailer.sendActivationEmail(email, activationLink);
}

export async function loginUser(body: any, session: Request["session"]) {
    const {username, password} = body;
    const returnInfo = {username};

    if (!username || !password) {
        throw new ValidationError(LOGIN_TEMPLATE, 'Invalid username or password', returnInfo);
    }

    const user = await userService.getUserByUsername(username);
    if (!user) {
        throw new ValidationError(LOGIN_TEMPLATE, 'Invalid username or password', returnInfo);
    }

    const isValidPassword = await userService.verifyPassword(user.id, password);
    if (!isValidPassword) {
        throw new ValidationError(LOGIN_TEMPLATE, 'Invalid username or password', returnInfo);
    }

    if (!user.isActive) {
        let errorMsg = "User not activated.";
        if ((user.activationTokenExpiration ?? new Date(0)) < new Date()) {
            // Generiere den Aktivierungs-Token und sende ihn per E-Mail
            const token = await userService.generateActivationToken(user.id);
            const activationLink = `${settings.value.rootUrl}/users/activate/${token}`;

            await mailer.sendActivationEmail(user.email, activationLink);
            errorMsg += " The activation link has expired. A new one has been sent to your email account.";
        }
        throw new ValidationError(LOGIN_TEMPLATE, errorMsg, returnInfo);
    }

    session.user = user;
    
    // Explicitly save the session to ensure it's persisted before redirect
    // This is critical for async session stores like TypeormStore
    return new Promise<void>((resolve, reject) => {
        session.save((err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

export async function getUserDashboardEntities(user: User) {
    const surveys = await surveyService.getSurveysByUserId(user.id);
    const packlists = await packingService.getPackingListByUserId(user.id);
    const activityplans = await activityService.getActivityPlansByUserId(user.id);
    const driverslists = await driverService.getDriversListByUserId(user.id);
    const events = await eventService.getEventsByOwnerId(user.id);
    const registeredEvents = await eventService.getRegisteredEventsFor({userId: user.id});
    return {surveys, packlists, activityplans, driverslists, events, registeredEvents};
}

export async function getGuestDashboardEntities(guest: Guest) {
    const registeredEvents = await eventService.getRegisteredEventsFor({guestId: guest.id});
    return {registeredEvents}
}

export async function sendPasswordForgotMail(username: string) {
    const user = await userService.getUserByUsername(username);
    if (!user) {
        return;
    }

    // Generiere ein Passwort-Zurücksetzungs-Token und speichere es in der Datenbank
    const token = await userService.generatePasswordResetToken(username);
    const resetLink = `${settings.value.rootUrl}/users/reset-password/${token}`;

    // Sende eine E-Mail mit dem Zurücksetzungs-Link
    await mailer.sendPasswordResetEmail(user.email, resetLink);
}

export async function checkPasswordForgotToken(token: string) {
    // Überprüfe, ob der Token gültig ist
    const user = await userService.verifyPasswordResetToken(token);
    if (!user) {
        throw new ExpectedError('Invalid or expired token', 'error', 401);
    }
}

export async function resetPassword(token: string, body: any) {
    const {password, confirmPassword} = body;

    if (password !== confirmPassword) {
        throw new ValidationError('users/reset-password', 'Passwords do not match!', {token})
    }

    // Überprüfe den Token und setze das Passwort zurück
    const user = await userService.verifyPasswordResetToken(token);
    if (!user) {
        throw new ExpectedError('Invalid or expired token', 'error', 401);
    }

    // Setze das Passwort zurück
    await userService.resetPassword(user.username, password);
}

export async function activateAccount(token: string) {
    // Überprüfe, ob der Aktivierungs-Token gültig ist
    const user = await userService.verifyActivationToken(token);
    if (!user) {
        throw new ExpectedError('Invalid or expired token', 'error', 401);
    }

    // Aktiviere den Benutzer
    await userService.activateUser(user.id);
}

/**
 * ---- OIDC integration (v6) ----
 * These are thin controller wrappers that delegate to your oidc module.
 * They keep your controller layer consistent with the manual login flow.
 */

// GET /auth/login → redirect to Authentik
export async function loginUserWithOidc(session: Request['session']) {
    // Delegates to startLogin (buildAuthorizationUrl + session PKCE/nonce)
    return oidc.startLogin(session);
}

// GET /auth/callback → handles code exchange, JIT-provision, session setup, redirect
export async function loginUserWithOidcCallback(req: Request) {
    // oidcCallback sets req.session.userId and req.session.user, then redirects
    return oidc.callback(req);
}

// POST /auth/logout → clears local session and (if available) does RP-initiated logout
export async function logoutUserOidc(session: Request['session']) {
    return oidc.logout(session);
}
