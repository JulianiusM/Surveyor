const express = require('express');
const app = express.Router();
const db = require("../modules/db");
const {isAuthenticated, generateUniqueToken} = require("../modules/util");
const renderer = require("../modules/renderer");
const mailer = require("../modules/email");
const settings = require("../modules/settings");

app.get('/create', isAuthenticated, (req, res) => {
    renderer.render(res, 'survey-create');
});

// POST: Umfrage erstellen
app.post('/create', isAuthenticated, async (req, res) => {
    const {title, combinations} = req.body;

    // Validierung
    if (!title || !combinations || combinations.length === 0) {
        renderer.renderWithErrorData(res, 'survey-create', "Title and combinations must be selected", {
            title,
            combinations
        });
    }

    try {
        // Umfrage erstellen
        const surveyId = await db.createSurvey(req.session.user.id, title, combinations);

        // Erfolgsnachricht oder Weiterleitung
        req.flash('success', 'Survey successfully created');
        res.redirect(`/survey/${surveyId}`);
    } catch (error) {
        renderer.renderWithErrorData(res, 'survey-create', error.message, {title, combinations});
    }
});

app.get('/:id/guest', async (req, res) => {
    const surveyId = req.params.id;

    // Hole Umfrage aus der Datenbank
    const survey = await db.getSurveyById(surveyId);
    if (!survey) {
        return renderer.renderError(res, 'Survey not found')
    }

    renderer.renderWithData(res, 'register-guest', {survey});
})

// Route für die Gastanmeldung
app.post('/:id/guest', async (req, res) => {
    const surveyId = req.params.id;

    // Hole Umfrage aus der Datenbank
    const survey = await db.getSurveyById(surveyId);
    if (!survey) {
        return renderer.renderError(res, 'Survey not found');
    }

    const {username, email} = req.body;
    if (!username) {
        req.flash('error', 'Username is required.');
        return renderer.renderWithData(res, 'register-guest', {survey});
    }

    // Generiere einen einzigartigen Token für den Link
    const token = generateUniqueToken();

    // Füge den Gast in die Datenbank ein
    const gid = await db.addGuest(surveyId, username, email, token);
    req.session.guest = await db.getGuest(gid);

    // Erstelle den Link zum Bearbeiten der Antworten
    const editLink = `${settings.rootUrl}/survey/${surveyId}/edit/${token}`;
    if (email) {
        // E-Mail versenden
        await mailer.sendSurveyLinkEmail(email, editLink);
    }

    req.flash('success', `Login as guest successful. Use ${editLink} to edit your answers later.`);
    res.redirect(`/survey/${surveyId}`);
});

// Route zum Bearbeiten der Antworten
app.get('/:id/edit/:token', async (req, res) => {
    const surveyId = req.params.id;
    const token = req.params.token;

    // Hole Gast und Kombinationen aus der Datenbank
    const guest = await db.getGuestByToken(token);
    if (!guest) return renderer.renderError(res, 'Invalid token');

    // Logout user
    req.session.user = undefined;
    req.session.guest = guest;
    req.flash('info', 'switched to guest edit (logged out)');
    res.redirect(`/survey/${surveyId}`);
});

// ---------- SAFE ZONE ----------
// ---------- MUST STAY LAST ----------
app.use('/:id', async (req, res, next) => {
    const surveyId = req.params.id;

    // Wenn der Benutzer nicht eingeloggt ist und kein Gast ist, leite zur Gastanmeldung um
    if (!req.session.user) {
        if (!req.session.guest) {
            req.flash('Register as a guest to answer this survey');
            return res.redirect(`/survey/${surveyId}/guest`);
        }

        const gid = await db.getSurveyByGuestId(req.session.guest.id);
        if (!gid || surveyId !== gid.id) {
            req.flash('Register as a guest to answer this survey');
            return res.redirect(`/survey/${surveyId}/guest`);
        }
    }

    next(); // Wenn der Benutzer als Gast angemeldet ist, fahre mit der Umfrage fort
});

// Route für die Anzeige der Umfrage-Seite nach der Gastanmeldung
app.get('/:id', async (req, res) => {
    const surveyId = req.params.id;

    // Hole Umfrage aus der Datenbank
    const survey = await db.getSurveyById(surveyId);
    if (!survey) return renderer.renderError(res, 'Survey not found');

    // Hole Kombinationen der Umfrage
    let combinations = await db.getCombinationsBySurveyId(surveyId);

    let responses = await db.getResponsesSorted(surveyId);

    // Umfrage-Seite anzeigen, wenn der Gast angemeldet ist
    renderer.renderWithData(res, 'survey-vote', {survey, combinations, responses});
});

// Kombination hinzufügen (Ändern von Woche auf n-te Wochentag)
app.post('/:id/add-combination', async (req, res) => {
    const surveyId = req.params.id;

    // Hole Umfrage aus der Datenbank
    const survey = await db.getSurveyById(surveyId);
    if (!survey) {
        return renderer.renderError(res, 'Survey not found');
    }

    const {weekday, nth} = req.body; // n-te Woche oder letzter Wochentag
    if (!weekday || !nth) {
        req.flash('error', 'Invalid selection');
        return res.redirect(`/survey/${surveyId}`);
    }

    // Prüfen, ob es sich um den letzten Wochentag handelt
    try {
        await db.addCombination(surveyId, weekday, nth);
        req.flash('success', 'Combination successfully added')
    } catch (e) {
        req.flash('error', e.message);
    }

    res.redirect(`/survey/${surveyId}`);
});

// Beispiel Route für das Speichern der Antworten
app.post('/:id/submit', async (req, res) => {
    const surveyId = req.params.id;

    // Hole Umfrage aus der Datenbank
    const survey = await db.getSurveyById(surveyId);
    if (!survey) {
        return renderer.renderError(res, 'Survey not found');
    }

    const answers = req.body; // Antworten des Benutzers

    if (req.session.user) {
        const user = req.session.user;

        // Lösche bisherige Antworten
        await db.deleteResponsesByUserId(user.id, surveyId);

        // Speichere die neuen Antworten
        for (const [combinationId, answer] of Object.entries(answers)) {
            await db.saveResponseUser(surveyId, user.id, combinationId, answer);
        }
        req.flash('success', 'Answers updated');
    } else if (req.session.guest) {
        const guest = req.session.guest;

        // Lösche bisherige Antworten des Gastes
        await db.deleteResponsesByGuestId(guest.id, surveyId);

        // Speichere die neuen Antworten
        for (const [combinationId, answer] of Object.entries(answers)) {
            await db.saveResponse(surveyId, guest.id, combinationId, answer);
        }
        req.flash('success', 'Answers updated');
    } else {
        req.flash('error', 'Session expired');
    }

    res.redirect(`/survey/${surveyId}`);
});

module.exports = app;