/*
 * lib/asyncHandler.js
 */
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'asyncHandl... Remove this comment to see the full error message
const asyncHandler = (fn: any) => (req: any, res: any, next: any) =>
    Promise.resolve(fn(req, res, next)).catch(next);

// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'asyncParam... Remove this comment to see the full error message
const asyncParamHandler = (fn: any) => (req: any, res: any, next: any, id: any) =>
    Promise.resolve(fn(req, res, next, id)).catch(next);

// @ts-expect-error TS(2552): Cannot find name 'module'. Did you mean 'modules'?
module.exports = {asyncHandler, asyncParamHandler};