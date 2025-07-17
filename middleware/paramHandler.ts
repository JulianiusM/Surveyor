// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'APIError'.
const {APIError, ExpectedError} = require("../modules/lib/errors");
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'asyncParam... Remove this comment to see the full error message
const {asyncParamHandler} = require("../modules/lib/asyncHandler");

// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'paramHandl... Remove this comment to see the full error message
function paramHandler(param: any, router: any, getById: any, entityType: any) {
    handleParam(param, router, getById, entityType, new ExpectedError(`${entityType} not found`, 'error', 404));
}

// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'apiParamHa... Remove this comment to see the full error message
function apiParamHandler(param: any, router: any, getById: any, entityType: any) {
    handleParam(param, router, getById, entityType, new APIError(`${entityType} not found`, {}, 404));
}

function handleParam(param: any, router: any, getById: any, entityName: any, error: any) {
    router.param(param, asyncParamHandler(async (req: any, res: any, next: any, id: any) => {
        const entity = await getById(id);
        if (!entity) {
            throw error;
        }
        req.resource = req.resource || {};
        req.resource[entityName] = entity;
        next();
    }));
}

// @ts-expect-error TS(2552): Cannot find name 'module'. Did you mean 'modules'?
module.exports = {apiParamHandler, paramHandler}