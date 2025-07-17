// @ts-expect-error TS(2580): Cannot find name 'require'. Do you need to install... Remove this comment to see the full error message
const bcrypt = require('bcryptjs');
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'generateUn... Remove this comment to see the full error message
const {generateUniqueToken} = require('../../lib/util');
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'init'.
const {init, db} = require('../pool');

async function registerUser(username: any, password: any, email: any) {
    init();
    const hashed = await bcrypt.hash(password, 10);
    const [res] = await db().execute(
        `INSERT INTO users (username, password, email, is_active)
         VALUES (?, ?, ?, ?)`,
        [username, hashed, email, false]
    );
    return res.insertId;
}

async function getUserByUsername(username: any) {
    init();
    const [rows] = await db().execute(
        `SELECT id, username, email, is_active
         FROM users
         WHERE username = ?`,
        [username]
    );
    return rows[0];
}

// @ts-expect-error TS(2393): Duplicate function implementation.
async function verifyPassword(userId: any, plain: any) {
    init();
    const [rows] = await db().execute(
        `SELECT password
         FROM users
         WHERE id = ?`,
        [userId]
    );
    return bcrypt.compare(plain, rows[0].password);
}

async function generateActivationToken(username: any) {
    init();
    const token = generateUniqueToken();
    const exp = new Date(Date.now() + 3600_000);
    await db().execute(
        `UPDATE users
         SET activation_token            = ?,
             activation_token_expiration = ?
         WHERE username = ?`,
        [token, exp, username]
    );
    return token;
}

async function verifyActivationToken(token: any) {
    init();
    const [rows] = await db().execute(
        `SELECT id, username, email, is_active
         FROM users
         WHERE activation_token = ?
           AND activation_token_expiration > ?`,
        [token, new Date()]
    );
    return rows[0] || null;
}

async function activateUser(username: any) {
    init();
    await db().execute(
        `UPDATE users
         SET is_active                   = TRUE,
             activation_token            = NULL,
             activation_token_expiration = NULL
         WHERE username = ?`,
        [username]
    );
}

async function generatePasswordResetToken(username: any) {
    init();
    const token = generateUniqueToken();
    const exp = new Date(Date.now() + 3600_000);
    await db().execute(
        `UPDATE users
         SET reset_token            = ?,
             reset_token_expiration = ?
         WHERE username = ?`,
        [token, exp, username]
    );
    return token;
}

async function verifyPasswordResetToken(token: any) {
    init();
    const [rows] = await db().execute(
        `SELECT id, username, email, is_active
         FROM users
         WHERE reset_token = ?
           AND reset_token_expiration > ?`,
        [token, new Date()]
    );
    return rows[0] || null;
}

async function resetPassword(username: any, newPass: any) {
    init();
    const hashed = await bcrypt.hash(newPass, 10);
    await db().execute(
        `UPDATE users
         SET password               = ?,
             reset_token            = NULL,
             reset_token_expiration = NULL
         WHERE username = ?`,
        [hashed, username]
    );
}

// Guests
async function createGuest(username: any, email = null) {
    init();
    const [res] = await db().execute(
        `INSERT INTO guests (username, email)
         VALUES (?, ?)`,
        [username, email]
    );
    return res.insertId;
}

async function createGuestLink(entityType: any, entityId: any, guestId: any) {
    init();
    const token = generateUniqueToken();
    await db().execute(
        `INSERT INTO guest_links (guest_id, entity_type, entity_id, token)
         VALUES (?, ?, ?, ?)`,
        [guestId, entityType, entityId, token]
    );
    return token;
}

async function registerGuest(entityType: any, entityId: any, username: any, email: any) {
    const guestId = await createGuest(username, email);
    const token = await createGuestLink(entityType, entityId, guestId);
    return {guestId, token};
}

async function getGuestByToken(token: any) {
    init();
    const [rows] = await db().execute(
        `SELECT g.id,
                g.username,
                g.email,
                gl.entity_type,
                gl.entity_id
         FROM guest_links gl
                  JOIN guests g ON g.id = gl.guest_id
         WHERE gl.token = ?
         LIMIT 1`,
        [token]
    );
    return rows[0] || null;
}

async function getGuestInternal(guestId: any) {
    init();
    const [rows] = await db().execute(
        `SELECT id, username, email
         FROM guests
         WHERE id = ?`,
        [guestId]
    );
    return rows[0] || null;
}

async function getGuestLinkToken(entityType: any, entityId: any, guestId: any) {
    init();
    const [rows] = await db().execute(
        `SELECT token
         FROM guest_links
         WHERE guest_id = ?
           AND entity_type = ?
           AND entity_id = ?
         LIMIT 1`,
        [guestId, entityType, entityId]
    );
    return rows[0]?.token || null;
}

async function getAllRoles() {
    init();
    const [rows] = await db().execute(
        `SELECT *
         FROM roles`
    );
    return rows;
}

// @ts-expect-error TS(2552): Cannot find name 'module'. Did you mean 'modules'?
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

    createGuest,
    createGuestLink,
    registerGuest,
    getGuestByToken,
    getGuestInternal,
    getGuestLinkToken,

    getAllRoles,
};
