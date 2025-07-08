const {APIError, ExpectedError} = require("../modules/lib/errors");
const {asyncParamHandler} = require("../modules/lib/asyncHandler");

function paramHandler(param, router, getById, entityType) {
    handleParam(param, router, getById, new ExpectedError(`${entityType} not found`, 'error', 404));
}

function apiParamHandler(param, router, getById, entityType) {
    handleParam(param, router, getById, new APIError(`${entityType} not found`, {}, 404));
}

function handleParam(param, router, getById, error) {
    router.param(param, asyncParamHandler(async (req, res, next, id) => {
        const entity = await getById(id);
        if (!entity) {
            throw error;
        }
        req.entity = entity;
        next();
    }));
}

module.exports = {apiParamHandler, paramHandler}