// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'express'.
const express = require('express');
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'db'.
const db = require("../modules/database/db");
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'mailer'.
const mailer = require("../modules/email");
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'renderer'.
const renderer = require("../modules/renderer");
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'settings'.
const settings = require("../modules/settings");
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'isAuthenti... Remove this comment to see the full error message
const {isAuthenticated} = require("../middleware/permissionMiddleware");

// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'app'.
const app = express.Router();

/* GET users listing. */
app.get('/', function (req: any, res: any, next: any) {
    res.redirect('/users/dashboard');
});

// Registrierung von Benutzern
app.get('/register', (req: any, res: any) => {
    renderer.render(res, 'users/register');  // Zeige das Registrierungsformular an
});

app.post('/register', async (req: any, res: any) => {
    const {username, password, password_repeat, email} = req.body;

    if (!username || !password || !password_repeat || !email) {
        return renderer.renderWithErrorData(res, 'users/register', 'Not all fields were filled out.', {
            username,
            email
        });
    }

    if (password !== password_repeat) {
        return renderer.renderWithErrorData(res, 'users/register', 'Passwords do not match.', {username, email});
    }

    const existingUser = await db.getUserByUsername(username);
    if (existingUser) {
        return renderer.renderWithErrorData(res, 'users/register', 'This username is already taken.', {
            username,
            email
        });
    }

    // Benutzer registrieren
    await db.registerUser(username, password, email);

    // Generiere den Aktivierungs-Token und sende ihn per E-Mail
    const token = await db.generateActivationToken(username);
    const activationLink = `${settings.rootUrl}/users/activate/${token}`;

    await mailer.sendActivationEmail(email, activationLink);

    renderer.renderInfo(res, 'Account successfully registered. Please activate it using the link sent to your email.');
});

// Login-Funktionalität
app.get('/login', (req: any, res: any) => {
    renderer.render(res, 'users/login');  // Zeige das Login-Formular an
});

app.post('/login', async (req: any, res: any) => {
    const {username, password} = req.body;

    if (!username || !password) {
        return renderer.renderWithErrorData(res, 'users/login', 'Invalid username or password', {username});
    }

    const user = await db.getUserByUsername(username);
    if (!user) {
        return renderer.renderWithErrorData(res, 'users/login', 'Invalid username or password', {username});
    }

    const isValidPassword = await db.verifyPassword(user.id, password);
    if (!isValidPassword) {
        return renderer.renderWithErrorData(res, 'users/login', 'Invalid username or password', {username});
    }

    if (!user.is_active) {
        return renderer.renderWithErrorData(res, 'users/login', 'User not activated.', {username});
    }

    req.session.user = user;

    req.flash('success', 'Login successful');
    res.redirect('/users/dashboard');  // Weiterleitung nach dem Login
});

// Dashboard nach dem Login
app.get('/dashboard', isAuthenticated, async (req: any, res: any) => {
    const surveys = await db.getSurveysByUserId(req.session.user.id);
    const packlists = await db.getPackingListByUserId(req.session.user.id);
    const activityplans = await db.getActivityPlansByUserId(req.session.user.id);
    const driverslists = await db.getDriversListByUserId(req.session.user.id);
    renderer.renderWithData(res, 'users/dashboard', {surveys, packlists, activityplans, driverslists});
});

// Logout
app.get('/logout', (req: any, res: any) => {
    req.session.destroy(() => {
        res.redirect('/');
    });
});

// Passwort zurücksetzen: E-Mail mit Link senden
app.get('/forgot-password', (req: any, res: any) => {
    renderer.render(res, 'users/forgot-password.pug');  // Zeige das Formular zum Zurücksetzen des Passworts
});

app.post('/forgot-password', async (req: any, res: any) => {
    const {username} = req.body;

    const user = await db.getUserByUsername(username);
    if (!user) {
        return renderer.renderSuccess(res, 'A link has been sent to the email corresponding to this account (if present).')
    }

    // Generiere ein Passwort-Zurücksetzungs-Token und speichere es in der Datenbank
    const token = await db.generatePasswordResetToken(username);

    // Sende eine E-Mail mit dem Zurücksetzungs-Link
    const resetLink = `${settings.rootUrl}/users/reset-password/${token}`;

    // Sende eine E-Mail mit dem Zurücksetzungs-Link
    await mailer.sendPasswordResetEmail(user.email, resetLink);

    renderer.renderSuccess(res, 'A link has been sent to the email corresponding to this account (if present).')
});

// Passwort zurücksetzen: Formular anzeigen
app.get('/reset-password/:token', async (req: any, res: any) => {
    const token = req.params.token;

    // Überprüfe, ob der Token gültig ist
    const user = await db.verifyPasswordResetToken(token);
    if (!user) {
        return renderer.renderError(res, 'Invalid or expired token');
    }

    renderer.renderWithData(res, 'users/reset-password', {token});  // Zeige das Passwort-Reset-Formular an
});

// Passwort zurücksetzen: Neues Passwort speichern
app.post('/reset-password/:token', async (req: any, res: any) => {
    const {token} = req.params;
    const {password} = req.body;

    // @ts-expect-error TS(2304): Cannot find name 'confirmPassword'.
    if (password !== confirmPassword) {
        req.flash('error', 'Passwords do not match.');
        return res.redirect(`/users/reset-password/${token}`);
    }

    // Überprüfe den Token und setze das Passwort zurück
    const user = await db.verifyPasswordResetToken(token);
    if (!user) {
        return renderer.renderError(res, 'Invalid or expired token');
    }

    // Setze das Passwort zurück
    await db.resetPassword(user.username, password);
    renderer.renderSuccess(res, 'Your password has been successfully reset')
});

// Aktivierungs-Link
app.get('/activate/:token', async (req: any, res: any) => {
    const token = req.params.token;

    // Überprüfe, ob der Aktivierungs-Token gültig ist
    const user = await db.verifyActivationToken(token);
    if (!user) {
        return renderer.renderError(res, 'Invalid or expired token');
    }

    // Aktiviere den Benutzer
    await db.activateUser(user.username);
    renderer.renderSuccess(res, 'Your account has been activated. You can log in now.')
});

// @ts-expect-error TS(2552): Cannot find name 'module'. Did you mean 'modules'?
module.exports = app;
