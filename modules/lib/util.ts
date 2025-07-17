// @ts-expect-error TS(2580): Cannot find name 'require'. Do you need to install... Remove this comment to see the full error message
const {v4: uuidv4} = require('uuid');
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'crypto'.
const crypto = require('crypto');
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'APIError'.
const {APIError} = require("./errors");

// Funktion zur Generierung eines einzigartigen Tokens
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'generateUn... Remove this comment to see the full error message
function generateUniqueToken() {
    // @ts-expect-error TS(2339): Property 'randomBytes' does not exist on type 'Cry... Remove this comment to see the full error message
    return crypto.randomBytes(32).toString('hex');
}

// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'generateUn... Remove this comment to see the full error message
function generateUniqueId() {
    return uuidv4();
}

// Returns 'YYYY-MM-DD' in the server's local time zone
function toLocalISO(dateObj: any) {
    const y = dateObj.getUTCFullYear();
    // @ts-expect-error TS(2550): Property 'padStart' does not exist on type 'string... Remove this comment to see the full error message
    const m = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
    // @ts-expect-error TS(2550): Property 'padStart' does not exist on type 'string... Remove this comment to see the full error message
    const d = String(dateObj.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'fromISOtoL... Remove this comment to see the full error message
function fromISOtoLocal(isoDate: any) {
    const [y, m, day] = isoDate.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, day));
}

// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'performAPI... Remove this comment to see the full error message
async function performAPIAction(req: any, {
    actionUser,
    actionGuest
}: any) {
    const userId = req.session.user?.id;
    const guestId = req.session.guest?.id;
    if (userId) await actionUser(req.body, userId);
    else if (guestId) await actionGuest(req.body, guestId);
    else throw new APIError('Unknown user', {}, 401);
}

// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'getResourc... Remove this comment to see the full error message
function getResource(req: any, entityName: any) {
    return req.resource[entityName];
}

// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'getAdditio... Remove this comment to see the full error message
function getAdditional(req: any, entityName: any, appendList = []) {
    // @ts-expect-error TS(2345): Argument of type 'any' is not assignable to parame... Remove this comment to see the full error message
    appendList.push(req.resource[entityName]);
    return appendList;
}

// @ts-expect-error TS(2552): Cannot find name 'module'. Did you mean 'modules'?
module.exports = {
    generateUniqueToken,
    generateUniqueId,
    toLocalISO,
    fromISOtoLocal,
    performAPIAction,
    getResource,
    getAdditional,
}