/*
 * middlewares/validationErrorHandler.js
 */
import {NextFunction, Request, Response} from "express";
import {validationResult} from 'express-validator';
import {APIError} from "../modules/lib/errors";
import renderer from '../modules/renderer';

export function handleValidationError(req: Request, res: Response, next: NextFunction) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return renderer.respondWithErrorJson(res, errors.array().map((e: any) => e.msg).join(', '));
    }
    next();
}

export function wrapErrorApi(err: Error & {
    data?: object,
    status?: number
}, req: Request, res: Response, next: NextFunction) {
    throw new APIError(err.message, err.data ?? {data: err.cause}, err.status ?? 500, {cause: err});
}