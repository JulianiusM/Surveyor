/*
 * middlewares/validationErrorHandler.js
 */
import {validationResult} from 'express-validator';
import renderer from '../modules/renderer';
import {NextFunction, Request, Response} from "express";

export function handleValidationError(req: Request, res: Response, next: NextFunction) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return renderer.respondWithErrorJson(res, errors.array().map((e: any) => e.msg).join(', '));
    }
    next();
}