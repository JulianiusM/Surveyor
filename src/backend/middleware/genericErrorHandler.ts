import type {NextFunction, Request, Response} from 'express';
import {classifyApiError, requestLocale, validatedProblemBody} from '../modules/api/problem';
import {APIError, ExpectedError, ValidationError} from '../modules/lib/errors';

/** Last-resort delivery when parsing, session admission or SSR itself fails.
 * Ordinary page errors are rendered by the frontend router; this independent
 * response needs neither a working renderer nor a database session. */
export function handleGenericError(error: unknown, req: Request, res: Response, next: NextFunction): void {
    if (res.headersSent) return next(error);
    const problem = classifyApiError(error);
    const body = validatedProblemBody(problem, requestLocale(req));
    // Preserve recognized document statuses, including the established validation
    // document outcome. Never trust arbitrary status-shaped exception objects.
    const status = error instanceof ExpectedError || error instanceof APIError ? error.status
        : error instanceof ValidationError ? 500
            : error instanceof URIError && 'status' in error && error.status === 400 ? 400 : body.status;
    if (status >= 500) console.error('[frontend]', {method: req.method, status, category: 'DeliveryFailure'});
    if (status === 503 && error instanceof APIError && 'retryAfter' in error.data) {
        res.set('Retry-After', String((error.data as {retryAfter: number}).retryAfter));
    }
    // Plain text is intentionally independent of application assets and never
    // exposes stack traces, database details or submitted credentials.
    res.status(status).set('Cache-Control', 'private, no-store').type('text/plain').send(body.detail);
}
