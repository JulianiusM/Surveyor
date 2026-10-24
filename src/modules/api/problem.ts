import {randomUUID} from 'node:crypto';
import type {ErrorRequestHandler, Request} from 'express';
import type {components} from '../../types/api/v1';
import type {ApiProblemCode, ApiProblemParameters, ApiProblemArguments} from '../../types/ApiTypes';
import {APIError, ExpectedError, ValidationError} from '../lib/errors';
import {createTranslator, resolveLocale, resolvePreferredLocale} from '../localization/translator';
import {apiContract, contractValidator, problemContract} from './contracts';
import {formatFieldDiagnostic} from '../localization/inputValidation';

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

/** Resolve response language through the shared catalog policy: explicit header,
 * then cookie, then quality-ordered accepted languages. Negotiation never changes
 * the captured actor or grants authority to any localized presentation. */
export function requestLocale(req: Request): string {
    const explicitLocale = req.get('X-Surveyor-Locale') ?? req.cookies?.surveyor_locale;
    if (explicitLocale !== undefined && explicitLocale !== null) return resolveLocale(explicitLocale);

    // Express orders accepted ranges by quality. Preserve that order and skip unsupported/invalid
    // hints before choosing the application fallback; explicit header/cookie choices stay authoritative.
    const languages = req.acceptsLanguages();
    return resolvePreferredLocale(languages || []);
}

/** Mounted routers see a shortened req.path. Keep the protocol boundary owned
 * here and inspect the original path, excluding its optional query string. */
export function isVersionedApiRequest(req: Request): boolean {
    const requestPath = req.originalUrl?.split('?', 1)[0] || req.path;
    return requestPath === '/api/v1' || requestPath.startsWith('/api/v1/');
}

/** Preserve an explicitly annotated native rejection through the authored API
 * contract. A trusted application error, exact status and closed empty parameter
 * declaration are all required; arbitrary causes, native prose and renderer data
 * never become public messages. The manifest remains the sole code/key mapping. */
export function declaredApiProblem(error: unknown): ApiProblem | null {
    if (!(error instanceof APIError || error instanceof ExpectedError || error instanceof ValidationError)
        || typeof error.cause !== 'string') return null;

    // Domain owners annotate only stable, parameter-free causes. Verify those
    // identities against the generated contract before constructing any reply.
    // Native form ValidationError has no HTTP status; its existing API fallback
    // is 400. Higher-status identity causes retain their explicit mapping below.
    const status = error instanceof ValidationError ? 400 : error.status;
    const declaration = apiContract.problems.find(candidate => candidate.code === error.cause && candidate.status === status);
    const parameters = declaration?.paramsSchema as {type?: unknown; additionalProperties?: unknown; maxProperties?: unknown} | undefined;
    if (!declaration || parameters?.type !== 'object' || parameters.additionalProperties !== false || parameters.maxProperties !== 0) return null;

    return new ApiProblem(...[declaration.code, {}] as ApiProblemArguments);
}

/** Map only recognized controller outcomes and bounded transport failures.
 * Native prose/renderer data, arbitrary causes and untrusted status-shaped objects
 * never become versioned response data; unknown failures use the internal problem.
 */
export function classifyApiError(error: unknown): ApiProblem {
    if (error instanceof ApiProblem) return error;

    // Feature adapters use this same projection before their legacy conflict
    // fallback, so a meaningful annotated rejection is not collapsed a second time.
    const declared = declaredApiProblem(error);
    if (declared) return declared;

    // Event business owners annotate only recognized rejection identities. Keep
    // native prose/data private and preserve the original action-specific status;
    // a string-shaped external exception never enters this trusted cause mapping.
    if (error instanceof APIError) {
        switch (error.cause) {
            case 'EVENT_FULL': return new ApiProblem('EVENT_FULL');
            case 'EVENT_DATE_UPDATES_CLOSED': return new ApiProblem('EVENT_DATE_UPDATES_CLOSED');
            case 'EVENT_DIET_UPDATES_CLOSED': return new ApiProblem('EVENT_DIET_UPDATES_CLOSED');
            case 'EVENT_DEADLINE_PASSED': return new ApiProblem('EVENT_DEADLINE_PASSED');
            case 'EVENT_DATES_INVALID': return new ApiProblem('EVENT_DATES_INVALID');
            case 'EVENT_TOKEN_USED': return new ApiProblem('EVENT_TOKEN_USED');
            case 'EVENT_ALLERGY_INFO_REQUIRED': return new ApiProblem('EVENT_ALLERGY_INFO_REQUIRED');
            case 'EVENT_COMMENT_REQUIRED': return new ApiProblem('EVENT_COMMENT_REQUIRED');
            case 'EVENT_MEAL_REQUIRED': return new ApiProblem('EVENT_MEAL_REQUIRED');
            case 'EVENT_VEGETARIAN_CONFLICT': return new ApiProblem('EVENT_VEGETARIAN_CONFLICT');
            case 'EVENT_VEGAN_CONFLICT': return new ApiProblem('EVENT_VEGAN_CONFLICT');
            case 'EVENT_CANCELLATION_CLOSED': return new ApiProblem('EVENT_CANCELLATION_CLOSED');
            case 'EVENT_TIMEZONE_INVALID': return new ApiProblem('EVENT_TIMEZONE_INVALID');
            case 'EVENT_START_AFTER_END': return new ApiProblem('EVENT_START_AFTER_END');
            case 'EVENT_DEADLINE_INVALID': return new ApiProblem('EVENT_DEADLINE_INVALID');
            case 'EVENT_LINK_ACCOUNT_REQUIRED': return new ApiProblem('EVENT_LINK_ACCOUNT_REQUIRED');
        }
    }

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

    // Recognized application errors preserve status distinctions without borrowing
    // their text. This includes the shared native search limiter's bounded 429.
    if (error instanceof APIError || error instanceof ExpectedError) {
        if (error.status === 401) return new ApiProblem('AUTH_REQUIRED');
        if (error.status === 403) return new ApiProblem('FORBIDDEN');
        if (error.status === 404) return new ApiProblem('NOT_FOUND');
        if (error.status === 400) return new ApiProblem('VALIDATION_FAILED');
        if (error.status === 429) return new ApiProblem('RATE_LIMITED');
    }

    // These body-parser categories are transport-owned; do not infer a business
    // problem from an arbitrary exception's message or numeric status.
    if (error && typeof error === 'object' && 'type' in error && error.type === 'entity.parse.failed') return new ApiProblem('INVALID_JSON');
    if (error && typeof error === 'object' && 'type' in error && error.type === 'entity.too.large') return new ApiProblem('PAYLOAD_TOO_LARGE');
    return new ApiProblem('INTERNAL_ERROR');
}

/** The same projection/validator protects both ordinary errors and the safe internal-error fallback. */
export function validatedProblemBody(problem: ApiProblem, locale: string, requestId: string = randomUUID()): components['schemas']['Problem'] {
    const contract = problemContract(problem.code);
    const diagnostic = problem.code === 'VALIDATION_FAILED'
        ? problem.fieldErrors?.find(error => error.diagnostic)?.diagnostic : undefined;
    const detail = diagnostic ? formatFieldDiagnostic(createTranslator(locale), diagnostic)
        : translateProblem(contract.messageKey, problem.params, locale);
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

/** Emit the validated localized Problem envelope through the existing API error
 * boundary. Broken translation/parameters fall back to a clean internal problem;
 * diagnostic correlation excludes request data and preserves the admitted context. */
export const handleApiProblem: ErrorRequestHandler = function handleApiProblem(error, req, res, _next) {
    const locale = requestLocale(req);
    const requestId = randomUUID();
    let body: components['schemas']['Problem'];

    // Classification, translation and the generated union validator form one
    // output boundary, including for its safe internal-error replacement.
    try {
        body = validatedProblemBody(classifyApiError(error), locale, requestId);
    } catch {
        // Invalid parameters can fail during translation or schema validation. Replace that broken
        // projection entirely: neither its parameters nor field errors belong in the generic reply.
        body = validatedProblemBody(new ApiProblem('INTERNAL_ERROR'), locale, requestId);
    }

    if (body.status >= 500) {
        // Arbitrary exception messages/stacks can contain SQL parameters, email addresses or tokens.
        // Keep correlation and a bounded exception category, never the request body/cookies/URL.
        const category = error instanceof Error && /^[A-Za-z][A-Za-z0-9]{0,63}$/u.test(error.name)
            ? error.name : 'UnexpectedError';
        console.error('[api]', {requestId, method: req.method, code: body.code, category});
    }

    // Report the already captured context, including on early method/rate errors;
    // this response does not reload a mutable session or publish exception data.
    if (req.apiActor?.context) res.set('X-Surveyor-Context', req.apiActor.context);
    res.status(body.status).type('application/problem+json').set('Cache-Control', 'private, no-store')
        .set('Content-Language', locale).json(body);
};
