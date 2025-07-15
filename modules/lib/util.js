const {v4: uuidv4} = require('uuid');
const crypto = require('crypto');
const {APIError} = require("./errors");

// Funktion zur Generierung eines einzigartigen Tokens
function generateUniqueToken() {
    return crypto.randomBytes(32).toString('hex');
}

function generateUniqueId() {
    return uuidv4();
}

// Returns 'YYYY-MM-DD' in the server's local time zone
function toLocalISO(dateObj) {
    const y = dateObj.getUTCFullYear();
    const m = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function fromISOtoLocal(isoDate) {
    const [y, m, day] = isoDate.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, day));
}

async function performAPIAction(req, {actionUser, actionGuest}) {
    const userId = req.session.user?.id;
    const guestId = req.session.guest?.id;
    if (userId) await actionUser(req.body, userId);
    else if (guestId) await actionGuest(req.body, guestId);
    else throw new APIError('Unknown user', {}, 401);
}

function getResource(req, entityName) {
    return req.resource[entityName];
}

function getAdditional(req, entityName, appendList = []) {
    appendList.push(req.resource[entityName]);
    return appendList;
}

module.exports = {
    generateUniqueToken,
    generateUniqueId,
    toLocalISO,
    fromISOtoLocal,
    performAPIAction,
    getResource,
    getAdditional,
}