const express = require('express');
const app = express.Router();
const db = require("../modules/db");
const {isAuthenticated, generateUniqueToken} = require("../modules/util");
const renderer = require("../modules/renderer");
const mailer = require("../modules/email");
const settings = require("../modules/settings");
const {createGuestFlowRouter} = require("../modules/guestFlowFactory");

/* ================================================================
   1) GENERISCHER GUEST-FLOW (create / guest / token / view)
   ================================================================ */
const core = createGuestFlowRouter({
    entityType: 'survey',

    /* ---- DB-Routinen ------------------------------------------- */
    db: {
        getById: db.getSurveyById,
        registerGuest: db.registerGuest,          // (entity, id, username, email)
        getGuestInternal: db.getGuestInternal,
        getGuestByToken: db.getGuestByToken,
    },

    /* ---- Templates --------------------------------------------- */
    templates: {
        create: 'surveyor/survey-create',
        guest: 'users/register-guest',
        view: 'surveyor/survey-vote',
    },

    /* ---- Redirect-Helfer --------------------------------------- */
    buildRedirect: id => `/survey/${id}`,

    /* ---- Body-Parsing + Validierung ----------------------------- */
    preprocessCreate(body) {
        const title = body.title?.trim();
        const combinations = Array.isArray(body.combinations)
            ? body.combinations.filter(Boolean)
            : [];
        if (!title || combinations.length === 0) {
            return {
                error: {
                    msg: 'Title and combinations must be selected',
                    data: {title, combinations},
                }
            };
        }
        return {title, combinations};
    },

    /* ---- Entität anlegen --------------------------------------- */
    async createEntity(ownerId, p) {
        return db.createSurvey(ownerId, p.title, p.combinations); // gibt surveyId
    },

    /* nach Anlage: keine extra Items nötig */
    afterCreateItems: async () => {
    },

    /* ---- Daten für View ---------------------------------------- */
    async fetchForView(id, session) {
        const survey = await db.getSurveyById(id);
        if (!survey) return null;

        const combinations = await db.getCombinationsBySurveyId(id);
        const responses = await db.getResponsesSorted(id);

        return {survey, combinations, responses};
    },

    /* ---- Daten für Duplicate ---------------------------------------- */
    async fetchForDuplicate(id, session) {
        const survey = await db.getSurveyById(id);
        if (!survey) return null;

        const combinations = await db.getCombinationsBySurveyId(id);
        return {owner_id: survey.creator_id, entity: survey, items: combinations};
    },

    async deleteEntity(id, session) {
        const survey = await db.getSurveyById(id);
        if (!survey) return null;
        if (survey.creator_id !== session.user.id)
            return {success: false, msg: "Not allowed"}

        try {
            await db.deleteSurvey(survey.id);
            return {success: true, msg: `Successfully deleted ${survey.title}`};
        } catch (err) {
            return {success: false, msg: `Failed to delete: ${err.message}`};
        }
    }
});

app.use("/", core);

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