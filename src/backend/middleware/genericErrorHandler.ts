import type {NextFunction, Request, Response} from 'express';
import {createTranslator} from '../../common/localization/translator';
import {APIError, ExpectedError, ValidationError} from '../modules/lib/errors';
import {requestLocale} from '../modules/lib/http';

// Last-resort HTTP wording uses the existing shared catalog, independently of
// any API version's problem schema, parameter validation or wire serialization.
const statusMessages = {
    400: 'api:errors.VALIDATION_FAILED', 401: 'api:errors.AUTH_REQUIRED', 403: 'api:errors.FORBIDDEN',
    404: 'api:errors.NOT_FOUND', 413: 'api:errors.PAYLOAD_TOO_LARGE',
    415: 'api:errors.UNSUPPORTED_MEDIA_TYPE', 429: 'api:errors.RATE_LIMITED',
} as const;

/** Preserve owned HTTP statuses and the existing bounded parser categories. */
function fallbackStatus(error: unknown): number {
    // Application errors own their status; a validation document retains its
    // historical 500 even when a separate API adapter would classify its cause.
    if (error instanceof ExpectedError || error instanceof APIError) return error.status;
    if (error instanceof ValidationError) return 500;
    if (error instanceof URIError && 'status' in error && error.status === 400) return 400;

    // Body-parser failures are transport categories. Arbitrary status-shaped
    // exceptions do not gain authority to select another HTTP outcome.
    if (error && typeof error === 'object' && 'type' in error) {
        if (error.type === 'entity.parse.failed') return 400;
        if (error.type === 'entity.too.large') return 413;
    }
    return 500;
}

/** Keep the final response usable even if the usual error projection or localization fails. */
function fallbackMessage(req: Request, status: number): string {
    try {
        // Status selects generic wording only; submitted values, controller prose
        // and exception details never enter this independent delivery boundary.
        const key = statusMessages[status as keyof typeof statusMessages]
            ?? (status >= 500 ? 'common.internalError' : 'common.error');
        return createTranslator(requestLocale(req)).t(key);
    } catch {
        // A broken catalog cannot recurse through the failing error renderer.
        return 'Request failed';
    }
}

/** Last-resort delivery when parsing, session admission or SSR itself fails.
 * Ordinary page errors are rendered by the frontend router; this independent
 * response needs neither a working renderer nor a database session. */
export function handleGenericError(error: unknown, req: Request, res: Response, next: NextFunction): void {
    if (res.headersSent) return next(error);
    // Preserve recognized document statuses, including the established validation
    // document outcome. Never trust arbitrary status-shaped exception objects.
    const status = fallbackStatus(error);
    if (status >= 500) console.error('[frontend]', {method: req.method, status, category: 'DeliveryFailure'});
    if (status === 503 && error instanceof APIError && 'retryAfter' in error.data) {
        res.set('Retry-After', String((error.data as {retryAfter: number}).retryAfter));
    }
    // Plain text is intentionally independent of application assets and never
    // exposes stack traces, database details or submitted credentials.
    res.status(status).set('Cache-Control', 'private, no-store').type('text/plain').send(fallbackMessage(req, status));
}
