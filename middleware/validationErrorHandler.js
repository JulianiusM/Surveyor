/*
 * middlewares/validationErrorHandler.js
 */
const {validationResult} = require('express-validator');
const renderer = require('../modules/renderer');

module.exports = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return renderer.respondWithErrorJson(res, errors.array().map(e => e.msg).join(', '));
    }
    next();
};