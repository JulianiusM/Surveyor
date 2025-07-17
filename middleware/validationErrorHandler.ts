/*
 * middlewares/validationErrorHandler.js
 */
// @ts-expect-error TS(2580): Cannot find name 'require'. Do you need to install... Remove this comment to see the full error message
const {validationResult} = require('express-validator');
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'renderer'.
const renderer = require('../modules/renderer');

// @ts-expect-error TS(2552): Cannot find name 'module'. Did you mean 'modules'?
module.exports = (req: any, res: any, next: any) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return renderer.respondWithErrorJson(res, errors.array().map((e: any) => e.msg).join(', '));
    }
    next();
};