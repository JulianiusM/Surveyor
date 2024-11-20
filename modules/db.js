const mysql = require('mysql2');
const bcrypt = require('bcryptjs');
const {generateUniqueToken, generateUniqueId} = require("./util");  // Zum Verschlüsseln von Passwörtern

// Verbindung zur MySQL-Datenbank herstellen
const pool = mysql.createPool({
    host: 'localhost',
    user: 'testUser',
    password: 'testPassword',
    database: 'surveyor',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

const db = pool.promise();

// 1. Benutzer registrieren (mit verschlüsseltem Passwort)
async function registerUser(username, password, email) {
    const hashedPassword = await bcrypt.hash(password, 10);  // Passwort verschlüsseln
    const [result] = await db.execute('INSERT INTO users (username, password, email, is_active) VALUES (?, ?, ?, ?)', [username, hashedPassword, email, false]);
    return result.insertId;
}

// 2. Benutzer anhand des Benutzernamens abrufen
async function getUserByUsername(username) {
    const [rows] = await db.execute('SELECT username, email, id, is_active FROM users WHERE username = ?', [username]);
    return rows[0];
}

// 3. Überprüfen, ob das eingegebene Passwort korrekt ist
async function verifyPassword(userId, password) {
    const [rows] = await db.execute('SELECT password FROM users WHERE id = ?', [userId]);
    const user = rows[0];
    return bcrypt.compare(password, user.password);  // Passwort verifizieren
}

// 1. Erstelle einen Aktivierungs-Token und speichere ihn in der Datenbank
async function generateActivationToken(username) {
    const token = generateUniqueToken();  // Zufälliger Token
    const expiration = new Date(Date.now() + 3600000);  // Token läuft in 1 Stunde ab

    await db.execute(
        'UPDATE users SET activation_token = ?, activation_token_expiration = ? WHERE username = ?',
        [token, expiration, username]
    );

    return token;
}

// 2. Überprüfe, ob der Aktivierungs-Token gültig ist
async function verifyActivationToken(token) {
    const [rows] = await db.execute(
        'SELECT * FROM users WHERE activation_token = ? AND activation_token_expiration > ?',
        [token, new Date()]
    );
    return rows[0];  // Gibt den Benutzer zurück, wenn der Token gültig ist
}

// 3. Aktiviere den Benutzer
async function activateUser(username) {
    await db.execute(
        'UPDATE users SET is_active = TRUE, activation_token = NULL, activation_token_expiration = NULL WHERE username = ?',
        [username]
    );
}

// 1. Generiere einen Passwort-Zurücksetzungs-Token und speichere ihn in der Datenbank
async function generatePasswordResetToken(username) {
    const token = generateUniqueToken()  // Zufälliger Token
    const expiration = new Date(Date.now() + 3600000);  // Token läuft in 1 Stunde ab

    await db.execute(
        'UPDATE users SET reset_token = ?, reset_token_expiration = ? WHERE username = ?',
        [token, expiration, username]
    );

    return token;
}

// 2. Überprüfe, ob der Zurücksetzungs-Token gültig ist
async function verifyPasswordResetToken(token) {
    const [rows] = await db.execute(
        'SELECT * FROM users WHERE reset_token = ? AND reset_token_expiration > ?',
        [token, new Date()]
    );
    return rows[0];  // Gibt den Benutzer zurück, wenn der Token gültig ist
}

// 3. Setze das Passwort des Benutzers zurück
async function resetPassword(username, newPassword) {
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await db.execute(
        'UPDATE users SET password = ?, reset_token = NULL, reset_token_expiration = NULL WHERE username = ?',
        [hashedPassword, username]
    );
}

// 1. Hole eine Umfrage anhand der ID
async function getSurveyById(surveyId) {
    const [rows] = await db.execute('SELECT * FROM surveys WHERE id = ?', [surveyId]);
    return rows[0];
}

// 2. Hole Kombinationen für eine Umfrage
async function getCombinationsBySurveyId(surveyId) {
    const [rows] = await db.execute('SELECT * FROM combinations WHERE survey_id = ? ORDER BY weekday ASC, nth_week ASC', [surveyId]);
    return rows;
}

// 3. Füge einen Gast in die Datenbank ein
async function addGuest(surveyId, username, email, token) {
    const [result] = await db.execute('INSERT INTO guests (username, email, token, survey_id) VALUES (?, ?, ?, ?)', [username, email || null, token, surveyId]);
    return result.insertId;  // Gibt die ID des eingefügten Gastes zurück
}

async function getGuest(guestId) {
    const [rows] = await db.execute('SELECT id, email, username FROM guests WHERE id = ?', [guestId]);
    return rows[0];
}

// 4. Hole einen Gast anhand des Tokens
async function getGuestByToken(token) {
    const [rows] = await db.execute('SELECT * FROM guests WHERE token = ?', [token]);
    return rows[0];
}

// 5. Speichere eine Antwort für einen Gast
async function saveResponse(surveyId, guestId, combinationId, answer) {
    await db.execute('INSERT INTO responses (survey_id, guest_id, combination_id, answer) VALUES (?, ?, ?, ?)', [surveyId, guestId, combinationId, answer || 'no']);
}

// 5. Speichere eine Antwort für einen Gast
async function saveResponseUser(surveyId, userId, combinationId, answer) {
    await db.execute('INSERT INTO responses (survey_id, user_id, combination_id, answer) VALUES (?, ?, ?, ?)', [surveyId, userId, combinationId, answer || 'no']);
}

// 6. Lösche alle bisherigen Antworten eines Gastes
async function deleteResponsesByGuestId(guestId, surveyId) {
    await db.execute('DELETE FROM responses WHERE guest_id = ? AND survey_id = ?', [guestId, surveyId]);
}

async function deleteResponsesByUserId(userId, surveyId) {
    await db.execute('DELETE FROM responses WHERE guest_id = ? AND survey_id = ?', [userId, surveyId]);
}

// 7. Hole alle Antworten eines Gastes
async function getResponsesByGuestId(guestId) {
    const [rows] = await db.execute('SELECT * FROM responses WHERE guest_id = ? ORDER BY combination_id ASC', [guestId]);
    return rows;
}

async function getSurveyByGuestId(guestId) {
    const [rows] = await db.execute('SELECT s.* FROM guests g JOIN surveys s ON (g.survey_id = s.id) WHERE g.id = ?', [guestId]);
    return rows[0];
}

async function addCombination(surveyId, weekday, week) {
    const [result] = await db.execute('INSERT INTO combinations (survey_id, weekday, nth_week) VALUES (?, ?, ?)', [surveyId, weekday, week]);
    return result.insertId;
}

async function getSurveysByUserId(userId) {
    const [rows] = await db.execute('SELECT * FROM surveys WHERE creator_id = ?', [userId]);
    return rows;
}

async function getResponsesSorted(surveyId) {
    const [rows] = await db.execute('(SELECT r.*, g.username FROM responses r JOIN guests g ON r.guest_id = g.id WHERE r.survey_id = ?) ' +
        'UNION (SELECT r.*, u.username FROM responses r JOIN users u ON r.user_id = u.id WHERE r.survey_id = ?)' +
        'ORDER BY combination_id ASC', [surveyId, surveyId]);

    return Object.groupBy(rows, (res) => {
        if (res.user_id) {
            return 'u_' + res.user_id;
        } else if (res.guest_id) {
            return 'g_' + res.guest_id;
        }
    });
}

async function createSurvey(userId, title, combinations) {
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        // Umfrage erstellen
        const surveyId = generateUniqueId();
        await connection.query(
            'INSERT INTO surveys (id, creator_id, title) VALUES (?, ?, ?)',
            [surveyId, userId || null, title]
        );

        // Kombinationen speichern
        for (const combination of combinations) {
            await connection.query(
                'INSERT INTO combinations (survey_id, weekday, nth_week) VALUES (?, ?, ?)',
                [surveyId, combination.weekday, combination.week]
            );
        }

        await connection.commit();
        return surveyId;
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

module.exports = {
    registerUser,
    getUserByUsername,
    verifyPassword,
    generateActivationToken,
    verifyActivationToken,
    activateUser,
    generatePasswordResetToken,
    verifyPasswordResetToken,
    resetPassword,
    getSurveyById,
    getCombinationsBySurveyId,
    addGuest,
    getGuestByToken,
    saveResponse,
    deleteResponsesByGuestId,
    getResponsesByGuestId,
    getSurveyByGuestId,
    addCombination,
    createSurvey,
    getGuest,
    saveResponseUser,
    deleteResponsesByUserId,
    getResponsesSorted,
    getSurveysByUserId
};