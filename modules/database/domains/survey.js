const {generateUniqueId} = require('../../lib/util');
const {init, db} = require('../pool');

// Surveys
async function getSurveyById(id) {
    init();
    const [rows] = await db().execute(
        `SELECT *
         FROM surveys
         WHERE id = ?`,
        [id]
    );
    return rows[0] || null;
}

async function getCombinationsBySurveyId(surveyId) {
    init();
    const [rows] = await db().execute(
        `SELECT *
         FROM survey_combinations
         WHERE survey_id = ?
         ORDER BY weekday, nth_week`,
        [surveyId]
    );
    return rows;
}

async function createSurvey(userId, title, desc, combinations) {
    init();
    const conn = await db().getConnection();
    try {
        await conn.beginTransaction();
        const surveyId = generateUniqueId();
        await conn.query(
            `INSERT INTO surveys (id, owner_id, title, description)
             VALUES (?, ?, ?, ?)`,
            [surveyId, userId, title, desc]
        );
        for (const c of combinations) {
            await conn.query(
                `INSERT INTO survey_combinations (survey_id, weekday, nth_week)
                 VALUES (?, ?, ?)`,
                [surveyId, c.weekday, c.week]
            );
        }
        await conn.commit();
        return surveyId;
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

async function addCombination(surveyId, weekday, nthWeek) {
    init();
    const [res] = await db().execute(
        `INSERT INTO survey_combinations (survey_id, weekday, nth_week)
         VALUES (?, ?, ?)`,
        [surveyId, weekday, nthWeek]
    );
    return res.insertId;
}

async function getSurveysByUserId(userId) {
    init();
    const [rows] = await db().execute(
        `SELECT *
         FROM surveys
         WHERE owner_id = ?`,
        [userId]
    );
    return rows;
}

async function deleteSurvey(id) {
    init();
    await db().execute(
        `DELETE
         FROM surveys
         WHERE id = ?`,
        [id]
    );
}

// Responses
// 5. Speichere eine Antwort für einen Gast

async function saveResponseGuest(surveyId, guestId, combinationId, answer) {
    init();
    await db().execute(`INSERT INTO survey_responses (survey_id, guest_id, combination_id, answer)
                        VALUES (?, ?, ?, ?)`, [surveyId, guestId, combinationId, answer || 'no']);
}

// 5. Speichere eine Antwort für einen Gast
async function saveResponseUser(surveyId, userId, combinationId, answer) {
    init();
    await db().execute(`INSERT INTO survey_responses (survey_id, user_id, combination_id, answer)
                        VALUES (?, ?, ?, ?)`, [surveyId, userId, combinationId, answer || 'no']);
}

async function deleteResponsesByGuestId(guestId, surveyId) {
    init();
    await db().execute(
        `DELETE
         FROM survey_responses
         WHERE guest_id = ?
           AND survey_id = ?`,
        [guestId, surveyId]
    );
}

async function deleteResponsesByUserId(userId, surveyId) {
    init();
    await db().execute(
        `DELETE
         FROM survey_responses
         WHERE user_id = ?
           AND survey_id = ?`,
        [userId, surveyId]
    );
}

async function getResponsesByGuestId(guestId) {
    init();
    const [rows] = await db().execute(
        `SELECT *
         FROM survey_responses
         WHERE guest_id = ?
         ORDER BY combination_id`,
        [guestId]
    );
    return rows;
}

async function getSurveyByGuestId(guestId) {
    init();
    const [rows] = await db().execute(
        `SELECT s.*
         FROM guest_links g
                  JOIN surveys s ON (g.entity_type = 'survey' AND s.id = g.entity_id)
         WHERE g.guest_id = ?`,
        [guestId]
    );
    return rows[0] || null;
}

async function getResponsesSorted(surveyId) {
    init();
    const [rows] = await db().execute(
        `(SELECT r.*, g.username
      FROM survey_responses r
      JOIN guests g ON r.guest_id = g.id
      WHERE r.survey_id = ?)
     UNION
     (SELECT r.*, u.username
      FROM survey_responses r
      JOIN users u ON r.user_id = u.id
      WHERE r.survey_id = ?)
     ORDER BY combination_id`,
        [surveyId, surveyId]
    );

    return Object.groupBy(rows, (res) => {
        if (res.user_id) {
            return 'u_' + res.user_id;
        } else if (res.guest_id) {
            return 'g_' + res.guest_id;
        }
    });
}

module.exports = {
    getSurveyById,
    getCombinationsBySurveyId,
    createSurvey,
    addCombination,
    getSurveysByUserId,
    deleteSurvey,

    saveResponseGuest,
    saveResponseUser,
    deleteResponsesByGuestId,
    deleteResponsesByUserId,
    getResponsesByGuestId,
    getSurveyByGuestId,
    getResponsesSorted
};
