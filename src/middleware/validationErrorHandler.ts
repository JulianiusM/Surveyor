/*
 * middlewares/validationErrorHandler.js
 */
import {validationResult} from 'express-validator';
import renderer from '../modules/renderer';

export function handleValidationError(req: any, res: any, next: any) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return renderer.respondWithErrorJson(res, errors.array().map((e: any) => e.msg).join(', '));
    }
    next();
}