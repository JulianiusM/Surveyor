import {generateUniqueId} from '../../../lib/util';
import {db, init} from '../pool';
import {ResultSetHeader, RowDataPacket} from "mysql2";

// Surveys
export async function getSurveyById(id: any) {
    init();
    const [rows] = await db().execute(
        `SELECT *
         FROM surveys
         WHERE id = ?`,
        [id]
    );
    return (rows as RowDataPacket[])[0] || null;
}

export async function getCombinationsBySurveyId(surveyId: any) {
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

export async function createSurvey(userId: any, title: any, desc: any, combinations: any) {
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

export async function addCombination(surveyId: any, weekday: any, nthWeek: any) {
    init();
    const [res] = await db().execute(
        `INSERT INTO survey_combinations (survey_id, weekday, nth_week)
         VALUES (?, ?, ?)`,
        [surveyId, weekday, nthWeek]
    );
    return (res as ResultSetHeader).insertId;
}

export async function getSurveysByUserId(userId: any) {
    init();
    const [rows] = await db().execute(
        `SELECT *
         FROM surveys
         WHERE owner_id = ?`,
        [userId]
    );
    return rows;
}

export async function deleteSurvey(id: any) {
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

export async function saveResponseGuest(surveyId: any, guestId: any, combinationId: any, answer: any) {
    init();
    await db().execute(`INSERT INTO survey_responses (survey_id, guest_id, combination_id, answer)
                        VALUES (?, ?, ?, ?)`, [surveyId, guestId, combinationId, answer || 'no']);
}

// 5. Speichere eine Antwort für einen Gast
export async function saveResponseUser(surveyId: any, userId: any, combinationId: any, answer: any) {
    init();
    await db().execute(`INSERT INTO survey_responses (survey_id, user_id, combination_id, answer)
                        VALUES (?, ?, ?, ?)`, [surveyId, userId, combinationId, answer || 'no']);
}

export async function deleteResponsesByGuestId(guestId: any, surveyId: any) {
    init();
    await db().execute(
        `DELETE
         FROM survey_responses
         WHERE guest_id = ?
           AND survey_id = ?`,
        [guestId, surveyId]
    );
}

export async function deleteResponsesByUserId(userId: any, surveyId: any) {
    init();
    await db().execute(
        `DELETE
         FROM survey_responses
         WHERE user_id = ?
           AND survey_id = ?`,
        [userId, surveyId]
    );
}

export async function getResponsesByGuestId(guestId: any) {
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

export async function getSurveyByGuestId(guestId: any) {
    init();
    const [rows] = await db().execute(
        `SELECT s.*
         FROM guest_links g
                  JOIN surveys s ON (g.entity_type = 'survey' AND s.id = g.entity_id)
         WHERE g.guest_id = ?`,
        [guestId]
    );
    return (rows as RowDataPacket[])[0] || null;
}

export async function getResponsesSorted(surveyId: any) {
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

    return Object.groupBy(rows as RowDataPacket[], (res: any) => {
        if (res.user_id) {
            return 'u_' + res.user_id;
        } else if (res.guest_id) {
            return 'g_' + res.guest_id;
        }
        return ''
    });
}
