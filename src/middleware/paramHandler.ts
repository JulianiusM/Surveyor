import {APIError, ExpectedError} from "../modules/lib/errors";
import {asyncParamHandler} from "../modules/lib/asyncHandler";

export function paramHandler(param: any, router: any, getById: any, entityType: any) {
    handleParam(param, router, getById, entityType, new ExpectedError(`${entityType} not found`, 'error', 404));
}

export function apiParamHandler(param: any, router: any, getById: any, entityType: any) {
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