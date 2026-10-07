import {randomUUID} from 'node:crypto';
import type {ErrorRequestHandler, Request} from 'express';
import type {components} from '../../types/api/v1';
import type {ApiProblemCode, ApiProblemParameters, ApiProblemArguments} from '../../types/ApiTypes';
import {APIError, ExpectedError, ValidationError} from '../lib/errors';
import {createTranslator, resolveLocale, resolvePreferredLocale} from '../localization/translator';
import {contractValidator, problemContract} from './contracts';

/** Stable machine errors remain compatible with the legacy APIError transport during coexistence. */
export class ApiProblem extends APIError {
    readonly code: ApiProblemCode;
    readonly params: ApiProblemParameters<ApiProblemCode>;
    fieldErrors?: components['schemas']['FieldError'][];

    constructor(...args: ApiProblemArguments) {
        const [code, params = {}] = args;
        const contract = problemContract(code);
        super(translateProblem(contract.messageKey, params, 'en'), {}, contract.status);
        this.code = code;
        this.params = params;
    }
}

/** Only contract-owned keys/parameters reach the translator; response validation verifies their exact union. */
function translateProblem(key: string, params: unknown, locale: string): string {
    const translator = createTranslator(locale).t as (messageKey: string, values: unknown) => string;
    return translator(key, params);
}

export function requestLocale(req: Request): string {
    const explicitLocale = req.get('X-Surveyor-Locale') ?? req.cookies?.surveyor_locale;
    if (explicitLocale !== undefined && explicitLocale !== null) return resolveLocale(explicitLocale);
    // Express orders accepted ranges by quality. Preserve that order and skip unsupported/invalid
    // hints before choosing the application fallback; explicit header/cookie choices stay authoritative.
    const languages = req.acceptsLanguages();
    return resolvePreferredLocale(languages || []);
}

/** Never leak legacy text or unexpected exception details into a v1 response. */
export function classifyApiError(error: unknown): ApiProblem {
    if (error instanceof ApiProblem) return error;
    // Controllers retain their native renderer errors, but explicitly annotate stable identity
    // outcomes. Never interpret prose, arbitrary exception causes, or database error details.
    if (error instanceof ValidationError || error instanceof ExpectedError) {
        switch (error.cause) {
            case 'INVALID_CREDENTIALS': return new ApiProblem('INVALID_CREDENTIALS');
            case 'ACCOUNT_INACTIVE': return new ApiProblem('ACCOUNT_INACTIVE');
            case 'ACTIVATION_RESENT': return new ApiProblem('ACTIVATION_RESENT');
            case 'USERNAME_TAKEN': return new ApiProblem('USERNAME_TAKEN');
            case 'PASSWORD_MISMATCH': return new ApiProblem('PASSWORD_MISMATCH');
            case 'TOKEN_INVALID': return new ApiProblem('TOKEN_INVALID');
        }
        if (error instanceof ValidationError) return new ApiProblem('VALIDATION_FAILED');
    }
    if (error instanceof APIError || error instanceof ExpectedError) {
        if (error.status === 401) return new ApiProblem('AUTH_REQUIRED');
        if (error.status === 403) return new ApiProblem('FORBIDDEN');
        if (error.status === 404) return new ApiProblem('NOT_FOUND');
        if (error.status === 400) return new ApiProblem('VALIDATION_FAILED');
    }
    if (error && typeof error === 'object' && 'type' in error && error.type === 'entity.parse.failed') return new ApiProblem('INVALID_JSON');
    if (error && typeof error === 'object' && 'type' in error && error.type === 'entity.too.large') return new ApiProblem('PAYLOAD_TOO_LARGE');
    return new ApiProblem('INTERNAL_ERROR');
}

/** The same projection/validator protects both ordinary errors and the safe internal-error fallback. */
export function validatedProblemBody(problem: ApiProblem, locale: string, requestId: string = randomUUID()): components['schemas']['Problem'] {
    const contract = problemContract(problem.code);
    const detail = translateProblem(contract.messageKey, problem.params, locale);
    const body: components['schemas']['Problem'] = {
        type: `urn:surveyor:problem:${problem.code.toLowerCase().replaceAll('_', '-')}`,
        title: detail,
        status: contract.status,
        detail,
        requestId,
        code: problem.code,
        messageKey: contract.messageKey,
        params: problem.params,
        ...(problem.fieldErrors ? {fieldErrors: problem.fieldErrors} : {}),
    } as components['schemas']['Problem'];
    if (!contractValidator('Problem')(body)) {
        throw new Error('Invalid API problem projection');
    }
    return body;
}

export const handleApiProblem: ErrorRequestHandler = function handleApiProblem(error, req, res, _next) {
    const locale = requestLocale(req);
    const requestId = randomUUID();
    let body: components['schemas']['Problem'];
    try {
        body = validatedProblemBody(classifyApiError(error), locale, requestId);
    } catch {
        // Invalid parameters can fail during translation or schema validation. Replace that broken
        // projection entirely: neither its parameters nor field errors belong in the generic reply.
        body = validatedProblemBody(new ApiProblem('INTERNAL_ERROR'), locale, requestId);
    }
    if (req.apiActor?.context) res.set('X-Surveyor-Context', req.apiActor.context);
    res.status(body.status).type('application/problem+json').set('Cache-Control', 'private, no-store')
        .set('Content-Language', locale).json(body);
};
