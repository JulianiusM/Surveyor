import {v4 as uuidv4} from 'uuid';
import crypto from 'crypto';
import {APIError} from "./errors";

// Funktion zur Generierung eines einzigartigen Tokens
export function generateUniqueToken() {
    return crypto.randomBytes(32).toString('hex');
}

export function generateUniqueId() {
    return uuidv4();
}

// Returns 'YYYY-MM-DD' in the server's local time zone
export function toLocalISO(dateObj: any) {
    const y = dateObj.getUTCFullYear();
    const m = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

export function fromISOtoLocal(isoDate: any) {
    const [y, m, day] = isoDate.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, day));
}

export async function performAPIAction(req: any, {
    actionUser,
    actionGuest
}: any) {
    const userId = req.session.user?.id;
    const guestId = req.session.guest?.id;
    if (userId) await actionUser(req.body, userId);
    else if (guestId) await actionGuest(req.body, guestId);
    else throw new APIError('Unknown user', {}, 401);
}

export function getResource(req: any, entityName: any) {
    return req.resource[entityName];
}

export function getAdditional(req: any, entityName: any, appendList: any[] = []) {
    appendList.push(req.resource[entityName]);
    return appendList;
}