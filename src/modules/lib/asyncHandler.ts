/*
 * lib/asyncHandler.js
 */

export function asyncHandler(fn: any) {
    return (req: any, res: any, next: any) =>
        Promise.resolve(fn(req, res, next)).catch(next);
}

export function asyncParamHandler(fn: any) {
    return (req: any, res: any, next: any, id: any) =>
        Promise.resolve(fn(req, res, next, id)).catch(next);
}