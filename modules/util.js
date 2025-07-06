const {v4: uuidv4} = require('uuid');
const crypto = require('crypto');

// Middleware für Authentifizierung
function isAuthenticated(req, res, next) {
    if (req.session.user) {
        return next();
    }
    req.flash('info', 'You must be logged in to access this site.');
    res.redirect('/users/login');
}

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

module.exports = {
    isAuthenticated,
    generateUniqueToken,
    generateUniqueId,
    toLocalISO,
    fromISOtoLocal,
}