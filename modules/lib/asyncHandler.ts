/*
 * lib/asyncHandler.js
 */
const asyncHandler = fn => (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

const asyncParamHandler = fn => (req, res, next, id) =>
    Promise.resolve(fn(req, res, next, id)).catch(next);

module.exports = {asyncHandler, asyncParamHandler};