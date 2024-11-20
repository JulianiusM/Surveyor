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

module.exports = {
    isAuthenticated,
    generateUniqueToken,
    generateUniqueId
}