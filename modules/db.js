const mysql = require('mysql2');
const bcrypt = require('bcryptjs');
const {generateUniqueToken, generateUniqueId} = require("./util");  // Zum Verschlüsseln von Passwörtern
const settings = require('./settings');

// Verbindung zur MySQL-Datenbank herstellen
let db = undefined;

function init() {
    if (db) {
        return;
    }

    let pool = mysql.createPool({
        host: settings.mysqlHost,
        user: settings.mysqlUser,
        password: settings.mysqlPassword,
        database: settings.mysqlDatabase,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
    });
    db = pool.promise();
}

// 1. Benutzer registrieren (mit verschlüsseltem Passwort)
async function registerUser(username, password, email) {
    init();
    const hashedPassword = await bcrypt.hash(password, 10);  // Passwort verschlüsseln
    const [result] = await db.execute('INSERT INTO users (username, password, email, is_active) VALUES (?, ?, ?, ?)', [username, hashedPassword, email, false]);
    return result.insertId;
}

// 2. Benutzer anhand des Benutzernamens abrufen
async function getUserByUsername(username) {
    init();
    const [rows] = await db.execute('SELECT username, email, id, is_active FROM users WHERE username = ?', [username]);
    return rows[0];
}

// 3. Überprüfen, ob das eingegebene Passwort korrekt ist
async function verifyPassword(userId, password) {
    init();
    const [rows] = await db.execute('SELECT password FROM users WHERE id = ?', [userId]);
    const user = rows[0];
    return bcrypt.compare(password, user.password);  // Passwort verifizieren
}

// 1. Erstelle einen Aktivierungs-Token und speichere ihn in der Datenbank
async function generateActivationToken(username) {
    init();
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
    init();
    const [rows] = await db.execute(
        'SELECT * FROM users WHERE activation_token = ? AND activation_token_expiration > ?',
        [token, new Date()]
    );
    return rows[0];  // Gibt den Benutzer zurück, wenn der Token gültig ist
}

// 3. Aktiviere den Benutzer
async function activateUser(username) {
    init();
    await db.execute(
        'UPDATE users SET is_active = TRUE, activation_token = NULL, activation_token_expiration = NULL WHERE username = ?',
        [username]
    );
}

// 1. Generiere einen Passwort-Zurücksetzungs-Token und speichere ihn in der Datenbank
async function generatePasswordResetToken(username) {
    init();
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
    init();
    const [rows] = await db.execute(
        'SELECT * FROM users WHERE reset_token = ? AND reset_token_expiration > ?',
        [token, new Date()]
    );
    return rows[0];  // Gibt den Benutzer zurück, wenn der Token gültig ist
}

// 3. Setze das Passwort des Benutzers zurück
async function resetPassword(username, newPassword) {
    init();
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await db.execute(
        'UPDATE users SET password = ?, reset_token = NULL, reset_token_expiration = NULL WHERE username = ?',
        [hashedPassword, username]
    );
}

// 1. Hole eine Umfrage anhand der ID
async function getSurveyById(surveyId) {
    init();
    const [rows] = await db.execute('SELECT * FROM surveys WHERE id = ?', [surveyId]);
    return rows[0];
}

// 2. Hole Kombinationen für eine Umfrage
async function getCombinationsBySurveyId(surveyId) {
    init();
    const [rows] = await db.execute('SELECT * FROM survey_combinations WHERE survey_id = ? ORDER BY weekday ASC, nth_week ASC', [surveyId]);
    return rows;
}

/* 1 ────────────────────────── Stammdatensatz anlegen ────────────────────
   Legt **immer** einen neuen Gast an, ohne vorher zu suchen.
   Name & E-Mail dienen nur der Anzeige / optionaler Mailzustellung.      */
async function createGuest(username, email = null) {
    init();
    const [res] = await db.execute(
        'INSERT INTO guests (username, email) VALUES (?, ?)',
        [username, email]
    );
    return res.insertId;              // immer neuer Datensatz
}

/* 2 ────────────────────────── Link + Token anlegen ───────────────────── */
async function createGuestLink(entityType, entityId, guestId) {
    init();
    const token = generateUniqueToken();
    await db.execute(
        'INSERT INTO guest_links (guest_id, entity_type, entity_id, token) VALUES (?, ?, ?, ?)',
        [guestId, entityType, entityId, token]
    );
    return token;
}

/* 3 ───────────────────── High-Level-Factory für alle Module ────────────
   Gibt immer *neuen* Token zurück. Keine Suche nach bestehendem Link.    */
async function registerGuest(entityType, entityId, username, email) {
    const guestId = await createGuest(username, email);
    const token = await createGuestLink(entityType, entityId, guestId);
    return {guestId, token};        // isNew entfällt → immer neu
}

/* 4 ───────────────────── Gast über Token laden (einziger Lookup) ─────── */
async function getGuestByToken(token) {
    init();
    const [rows] = await db.execute(
        `SELECT g.id,
                g.username,
                g.email,
                gl.entity_type,
                gl.entity_id
         FROM guest_links gl
                  JOIN guests g ON g.id = gl.guest_id
         WHERE gl.token = ? LIMIT 1`,
        [token]
    );
    return rows[0] || null;
}

/* 5 ───────────────────── Interne Stammdaten (by ID) ─────────────────────
   Wird nur serverseitig verwendet – niemals durch externen Input.        */
async function getGuestInternal(guestId) {
    init();
    const [rows] = await db.execute(
        'SELECT id, username, email FROM guests WHERE id = ?',
        [guestId]
    );
    return rows[0] || null;
}

async function getGuestLinkToken(entityType, entityId, guestId) {
    init();  // stellt sicher, dass die DB-Verbindung initialisiert ist

    const [rows] = await db.execute(
        `SELECT token
         FROM guest_links
         WHERE guest_id = ?
           AND entity_type = ?
           AND entity_id = ? LIMIT 1`,
        [guestId, entityType, entityId]
    );

    return rows.length ? rows[0].token : null;  // null → noch kein Link
}


// 5. Speichere eine Antwort für einen Gast
async function saveResponse(surveyId, guestId, combinationId, answer) {
    init();
    await db.execute('INSERT INTO survey_responses (survey_id, guest_id, combination_id, answer) VALUES (?, ?, ?, ?)', [surveyId, guestId, combinationId, answer || 'no']);
}

// 5. Speichere eine Antwort für einen Gast
async function saveResponseUser(surveyId, userId, combinationId, answer) {
    init();
    await db.execute('INSERT INTO survey_responses (survey_id, user_id, combination_id, answer) VALUES (?, ?, ?, ?)', [surveyId, userId, combinationId, answer || 'no']);
}

// 6. Lösche alle bisherigen Antworten eines Gastes
async function deleteResponsesByGuestId(guestId, surveyId) {
    init();
    await db.execute('DELETE FROM survey_responses WHERE guest_id = ? AND survey_id = ?', [guestId, surveyId]);
}

async function deleteResponsesByUserId(userId, surveyId) {
    init();
    await db.execute('DELETE FROM survey_responses WHERE guest_id = ? AND survey_id = ?', [userId, surveyId]);
}

// 7. Hole alle Antworten eines Gastes
async function getResponsesByGuestId(guestId) {
    init();
    const [rows] = await db.execute('SELECT * FROM survey_responses WHERE guest_id = ? ORDER BY combination_id ASC', [guestId]);
    return rows;
}

async function getSurveyByGuestId(guestId) {
    init();
    const [rows] = await db.execute('SELECT s.* FROM guests g JOIN surveys s ON (g.survey_id = s.id) WHERE g.id = ?', [guestId]);
    return rows[0];
}

async function addCombination(surveyId, weekday, week) {
    init();
    const [result] = await db.execute('INSERT INTO survey_combinations (survey_id, weekday, nth_week) VALUES (?, ?, ?)', [surveyId, weekday, week]);
    return result.insertId;
}

async function getSurveysByUserId(userId) {
    init();
    const [rows] = await db.execute('SELECT * FROM surveys WHERE creator_id = ?', [userId]);
    return rows;
}

async function getResponsesSorted(surveyId) {
    init();
    const [rows] = await db.execute('(SELECT r.*, g.username FROM survey_responses r JOIN guests g ON r.guest_id = g.id WHERE r.survey_id = ?) ' +
        'UNION (SELECT r.*, u.username FROM survey_responses r JOIN users u ON r.user_id = u.id WHERE r.survey_id = ?)' +
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
    init();
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
                'INSERT INTO survey_combinations (survey_id, weekday, nth_week) VALUES (?, ?, ?)',
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

/* ─── CRUD‑Methoden für Pack‑Listen ─────────────────────────────── */
async function createPackingList(listId, ownerId, title, allowGuestAdd, guestManage) {
    init();
    await db.execute(
        'INSERT INTO packing_lists (id, owner_id, title, allow_guest_add, guest_manage) VALUES (?,?,?,?, ?)',
        [listId, ownerId, title, allowGuestAdd ? 1 : 0, guestManage ? 1 : 0]
    );
}

/*  atomic Packing-Creation  ----------------------------------------- */
async function createPackingListTx(ownerId, title, allowGuestAdd, guestManage, items) {
    init();
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        const listId = generateUniqueId();
        await conn.execute(
            'INSERT INTO packing_lists (id, owner_id, title, allow_guest_add, guest_manage) VALUES (?,?,?,?, ?)',
            [listId, ownerId, title, allowGuestAdd ? 1 : 0, guestManage ? 1 : 0]
        );

        if (items.length) {
            const values = items.map(it => [
                it.id, listId, it.title, it.description, it.maxAssignees, it.position,
            ]);
            await conn.query(
                'INSERT INTO packing_items (id, list_id, title, description, max_assignees, position) VALUES ?',
                [values]
            );
        }

        await conn.commit();
        return listId;
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

async function updatePackingListTitle(listId, title) {
    init();
    await db.execute('UPDATE packing_lists SET title = ? WHERE id = ?', [title, listId]);
}

async function deletePackingList(listId) {
    init();
    await db.execute('DELETE FROM packing_lists WHERE id = ?', [listId]);
}

async function getPackingListById(listId) {
    init();
    const [r] = await db.execute('SELECT * FROM packing_lists WHERE id = ?', [listId]);
    return r[0] || null;
}

async function getPackingListByUserId(userId) {
    init();
    const [r] = await db.execute('SELECT * FROM packing_lists WHERE owner_id = ?', [userId]);
    return r || null;
}

/* Flag nachträglich ändern (Owner-Toggle) ------------------------------*/
async function updatePackingListAllow(listId, allow) {
    init();
    await db.execute(
        'UPDATE packing_lists SET allow_guest_add = ? WHERE id = ?',
        [allow ? 1 : 0, listId]
    );
}

async function updatePackingListGuestManage(listId, flag) {
    init();
    await db.execute(
        'UPDATE packing_lists SET guest_manage = ? WHERE id = ?',
        [flag ? 1 : 0, listId]
    );
}

/* ─── CRUD‑Methoden für Pack‑Items ──────────────────────────────── */
async function addPackingItems(listId, items) {
    init();
    if (!items.length) return;
    const values = items.map(it => [it.id, listId, it.title, it.description, it.maxAssignees, it.position]);
    await db.query('INSERT INTO packing_items (id, list_id, title, description, max_assignees, position) VALUES ?', [values]);
}

async function createPackingItem(listId, item) {
    init();
    await db.execute('INSERT INTO packing_items (id, list_id, title, description, max_assignees, position) VALUES (?, ?, ?, ?, ?, ?)', [item.id, listId, item.title, item.description, item.maxAssignees, item.position]);
}

async function updatePackingItem(itemId, fields) {
    init();
    const cols = [];
    const vals = [];
    if (fields.title !== undefined) {
        cols.push('title = ?');
        vals.push(fields.title);
    }
    if (fields.description !== undefined) {
        cols.push('description = ?');
        vals.push(fields.description);
    }
    if (fields.maxAssignees !== undefined) {
        cols.push('max_assignees = ?');
        vals.push(fields.maxAssignees);
    }
    if (fields.position !== undefined) {
        cols.push('position = ?');
        vals.push(fields.position);
    }
    if (!cols.length) return;
    vals.push(itemId);
    await db.execute(`UPDATE packing_items
                      SET ${cols.join(', ')}
                      WHERE id = ?`, vals);
}

async function deletePackingItem(itemId) {
    init();
    await db.execute('DELETE FROM packing_items WHERE id = ?', [itemId]);
}

/* Aggregierte Belegung pro Item einer Pack-Liste
   ------------------------------------------------------------- */
async function getAssignmentCounts(listId) {
    init();
    const [rows] = await db.execute(
        `SELECT item_id, COUNT(*) AS cnt
         FROM packing_assignments
         WHERE list_id = ?
         GROUP BY item_id`,
        [listId]
    );
    const map = {};
    rows.forEach(r => {
        map[r.item_id] = r.cnt;
    });
    return map;             // { itemId: count, … }
}

async function getPackingItems(listId) {
    init();
    const [rows] = await db.execute(
        `SELECT pi.*,
                COALESCE(ac.cnt, 0) AS assigned_count
         FROM packing_items pi
                  LEFT JOIN (SELECT item_id, COUNT(*) AS cnt
                             FROM packing_assignments
                             WHERE list_id = ?
                             GROUP BY item_id) ac ON ac.item_id = pi.id
         WHERE pi.list_id = ?
         ORDER BY pi.position`,
        [listId, listId]
    );
    return rows;                      // jedes Row-Objekt enthält assigned_count
}

async function reorderPackingItems(listId, orders) {
    init();
    const q = orders.map(o => db.execute('UPDATE packing_items SET position = ? WHERE id = ? AND list_id = ?', [o.position, o.itemId, listId]));
    await Promise.all(q);
}


/* ─── Assignment-Helper für User / Gäste ─────────────────────────────── */

async function assignItemToUser(itemId, userId) {
    init();
    await db.execute(
        `INSERT
        IGNORE INTO packing_assignments (item_id, user_id, list_id)
        SELECT ?, ?, list_id
        FROM packing_items
        WHERE id = ?`,
        [itemId, userId, itemId]
    );
}

async function unassignItemUser(itemId, userId) {
    init();
    await db.execute(
        'DELETE FROM packing_assignments WHERE item_id = ? AND user_id = ?',
        [itemId, userId]
    );
}

async function assignItemToGuest(itemId, guestId) {
    init();
    await db.execute(
        `INSERT
        IGNORE INTO packing_assignments (item_id, guest_id, list_id)
        SELECT ?, ?, list_id
        FROM packing_items
        WHERE id = ?`,
        [itemId, guestId, itemId]
    );
}

async function unassignItemGuest(itemId, guestId) {
    init();
    await db.execute(
        'DELETE FROM packing_assignments WHERE item_id = ? AND guest_id = ?',
        [itemId, guestId]
    );
}

async function getAssignmentsForUser(listId, userId) {
    init();
    const [r] = await db.execute(
        'SELECT item_id FROM packing_assignments WHERE list_id = ? AND user_id = ?',
        [listId, userId]
    );
    return r.map(x => x.item_id);
}

async function getAssignmentsForGuest(listId, guestId) {
    init();
    const [r] = await db.execute(
        'SELECT item_id FROM packing_assignments WHERE list_id = ? AND guest_id = ?',
        [listId, guestId]
    );
    return r.map(x => x.item_id);
}

/* Zuordnungen mit Namen ------------------------------------------------ */
async function getItemAssignees(listId) {
    init();
    const [rows] = await db.execute(
        `SELECT pa.id      AS assign_id,
                pa.item_id,
                u.username AS uname,
                g.username AS gname
         FROM packing_assignments pa
                  LEFT JOIN users u ON u.id = pa.user_id
                  LEFT JOIN guests g ON g.id = pa.guest_id
         WHERE pa.list_id = ?`,
        [listId]
    );
    // nach item gruppieren
    const map = {};
    rows.forEach(r => {
        const arr = map[r.item_id] ||= [];
        arr.push({
            id: r.assign_id,
            name: r.uname || r.gname || '—',
        });
    });
    return map;          // { itemId: [ {id,name}, … ], … }
}

/* Löschung durch Owner ----------------------------------------------- */
async function deleteAssignment(assignId) {
    init();
    await db.execute('DELETE FROM packing_assignments WHERE id = ?', [assignId]);
}

/* ─── Export ergänzen ───────────────────────────────────────────────── */

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
    registerGuest,
    getGuestInternal,
    createGuest,
    createGuestLink,
    getGuestByToken,
    getGuestLinkToken,
    saveResponse,
    deleteResponsesByGuestId,
    getResponsesByGuestId,
    getSurveyByGuestId,
    addCombination,
    createSurvey,
    saveResponseUser,
    deleteResponsesByUserId,
    getResponsesSorted,
    getSurveysByUserId,
    assignItemToUser,
    unassignItemUser,
    assignItemToGuest,
    unassignItemGuest,
    getAssignmentsForUser,
    getAssignmentsForGuest,
    createPackingList,
    createPackingListTx,
    updatePackingListTitle,
    deletePackingList,
    getPackingListById,
    updatePackingListAllow,
    updatePackingListGuestManage,
    createPackingItem,
    updatePackingItem,
    deletePackingItem,
    getAssignmentCounts,
    addPackingItems,
    getPackingItems,
    reorderPackingItems,
    getItemAssignees,
    deleteAssignment,
    getPackingListByUserId,
};