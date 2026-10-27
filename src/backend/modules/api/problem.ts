import {randomUUID} from 'node:crypto';
import type {ErrorRequestHandler} from 'express';
import type {components} from '../../../types/api/v1';
import type {ApiProblemCode, ApiProblemParameters, ApiProblemArguments} from '../../../types/ApiTypes';
import {APIError, ExpectedError, ValidationError} from '../lib/errors';
import {createTranslator} from '../../../common/localization/translator';
import {requestLocale} from '../lib/http';
import {apiContract, contractValidator, problemContract} from './contracts';
import {formatFieldDiagnostic} from '../../../common/localization/inputValidation';

/** Stable machine errors classify shared controller errors at the API boundary. */
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

/** Preserve an explicitly annotated controller rejection through the authored API
 * contract. A trusted application error, admitted status and closed empty parameter
 * declaration are all required; arbitrary causes, controller prose and renderer data
 * never become public messages. The manifest remains the sole code/key mapping. */
export function declaredApiProblem(error: unknown, allowControllerStatusOverride = false): ApiProblem | null {
    if (!(error instanceof APIError || error instanceof ExpectedError || error instanceof ValidationError)
        || typeof error.cause !== 'string') return null;

    // Domain owners annotate only stable, parameter-free causes. Verify those
    // identities against the generated contract before constructing any reply.
    // Ordinary direct callers retain exact-status matching. The final classifier
    // alone opts into authored Event compatibility for trusted APIError causes;
    // arbitrary objects and other error classes cannot borrow that override.
    // ValidationError still has the existing 400 fallback before identity mapping.
    const status = error instanceof ValidationError ? 400 : error.status;
    const declaration = apiContract.problems.find(candidate => candidate.code === error.cause
        && (candidate.status === status || allowControllerStatusOverride && error instanceof APIError
            && candidate.controllerStatusOverride === true));
    const parameters = declaration?.paramsSchema as {type?: unknown; additionalProperties?: unknown; maxProperties?: unknown} | undefined;
    if (!declaration || parameters?.type !== 'object' || parameters.additionalProperties !== false || parameters.maxProperties !== 0) return null;

    return new ApiProblem(...[declaration.code, {}] as ApiProblemArguments);
}

/** Map only recognized controller outcomes and bounded transport failures.
 * Controller prose/renderer data, arbitrary causes and untrusted status-shaped objects
 * never become versioned response data; unknown failures use the internal problem.
 */
export function classifyApiError(error: unknown): ApiProblem {
    if (error instanceof ApiProblem) return error;

    // Feature adapters use this same projection before their legacy conflict
    // fallback, so a meaningful annotated rejection is not collapsed a second time.
    const declared = declaredApiProblem(error, true);
    if (declared) return declared;

    // Controllers retain their operation-specific errors, but explicitly annotate stable identity
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
    // their text. This includes the shared search limiter's bounded 429.
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
    // Prefer the existing safe field diagnostic for structural failures; every
    // other detail comes from the declared localized Problem contract.
    const contract = problemContract(problem.code);
    const diagnostic = problem.code === 'VALIDATION_FAILED'
        ? problem.fieldErrors?.find(error => error.diagnostic)?.diagnostic : undefined;
    const detail = diagnostic ? formatFieldDiagnostic(createTranslator(locale), diagnostic)
        : translateProblem(contract.messageKey, problem.params, locale);
    // Form only the closed public envelope, then verify it before delivery can
    // expose malformed parameters or an undeclared error projection.
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
