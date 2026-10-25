import createClient from 'openapi-fetch';
import type {components, paths} from '../../types/api/v1';
import type {FrontendPlainMessageKey, FrontendRead, FrontendRequestScope} from '../../types/FrontendUiTypes';
import {validateProblem} from '../../../.generated/api/v1/browser/validateProblem.mjs';
import {validateSafeProblemDetails} from '../../../.generated/api/v1/browser/validateSafeProblemDetails.mjs';
import {validateComparisonToken} from '../../../.generated/api/v1/browser/validateComparisonToken.mjs';
import {apiCompatibility, operationPolicies} from '../../../.generated/api/v1/policy.mjs';
import type {ApiOperationId} from '../../types/ApiTransportTypes';
import type {ErrorObject} from 'ajv';
import type {FrontendInputField} from '../../types/FrontendFeedbackTypes';
import type {InputDiagnostic} from '../../types/InputValidationTypes';
import {fieldDiagnostic, fieldDiagnosticInput} from '../../modules/localization/inputValidation';

type Validator<T> = (value: unknown) => value is T;
type Problem = components['schemas']['Problem'];

/** Intentional disposal is distinct from a failed network read and must not produce an error toast. */
export class ObsoleteRequestError extends Error {
    constructor() { super('The request belongs to an obsolete view context.'); }
}

/** Only a validated error representation confirms a rejection. A newer Problem can use
 * the generated common-details contract, while unusable responses retain uncertainty. */
export class ApiFailure extends Error {
    readonly retryAt: number | null;
    readonly confirmedRejection: boolean;
    // Presentation can expose validated future text without granting it known-code
    // behavior or claiming that a temporary server error definitively rejected a write.
    readonly safeDetail: string | null;
    constructor(readonly status: number, readonly problem: Problem | null, readonly retryAfter: number | null = null,
                detail?: string, validatedDetails = false) {
        super(problem?.detail ?? detail ?? problem?.title ?? `HTTP ${status}`);
        this.retryAt = retryAfter === null ? null : Date.now() + retryAfter;
        this.safeDetail = problem?.detail ?? (validatedDetails ? detail ?? null : null);
        // HTTP status alone does not establish which operation produced a proxy/HTML
        // response. Keep safe future errors compatible without trusting arbitrary text;
        // an internal server error remains uncertain even when its envelope is valid.
        this.confirmedRejection = status < 500 && (problem !== null || validatedDetails);
    }
}

/** Only a validated rejection can retire a read's protected projection or editor.
 * A proxy/HTML response or mismatched Problem may carry the same HTTP status, but
 * it does not establish lost access or disappearance. Keep the admitted content
 * and local draft available for ordinary recovery in that case. Feature callers
 * still select the affected resources; known codes alone own actor transitions. */
export function isReadDenial(error: unknown): error is ApiFailure {
    return error instanceof ApiFailure && error.confirmedRejection && [401, 403, 404].includes(error.status);
}

/** A validated ordinary client rejection has no automatic read retry. Explicit
 * recovery remains available, while an authored server deadline keeps its own policy. */
export function isTerminalReadFailure(error: unknown): error is ApiFailure {
    return error instanceof ApiFailure && error.confirmedRejection && error.retryAt === null
        && error.status < 500 && error.status !== 429;
}

export class UnconfirmedResponseError extends Error {
    constructor() { super('The server response did not confirm the requested operation.'); }
}

/** The shared validator rejected input before any network side effect was attempted.
 * Features may identify the invalid field with a typed catalog key; private
 * diagnostic text never becomes user feedback or implies a dispatched command. */
export class InvalidInputError extends Error {
    constructor(message?: string, readonly messageKey?: FrontendPlainMessageKey,
                readonly diagnostic?: InputDiagnostic) { super(message); }
}

/** Project a generated rejection onto a feature's visible field without copying
 * constraints or exposing validator messages, payloads or schema locations.
 * Call immediately after validation: generated validators reuse their errors. */
export function generatedInputError(errors: readonly ErrorObject[] | null | undefined,
                                    field: (path: string, error: ErrorObject) => FrontendInputField | FrontendPlainMessageKey | undefined): InvalidInputError {
    // Prefer feature-specific fields and their actual row/day identities. Keep
    // a generated generic field only as a fallback, without publishing raw paths.
    let fallback: InputDiagnostic | undefined;
    for (const error of errors ?? []) {
        const path = error.keyword === 'required'
            ? error.instancePath + '/' + String(error.params.missingProperty) : error.instancePath;
        const identity = field(path, error);
        if (!identity) {
            const generated = fieldDiagnostic(error);
            if (!fallback && generated) fallback = fieldDiagnosticInput(generated);
            continue;
        }
        // Some features already have clearer task-specific wording (for example
        // the Survey's required recurring choices). Keep that catalog identity.
        if (typeof identity === 'string') return new InvalidInputError(undefined, identity);
        const limit = typeof error.params.limit === 'number' ? error.params.limit : undefined;
        const type = typeof error.params.type === 'string' ? error.params.type
            : Array.isArray(error.params.type) && error.params.type.includes('integer') ? 'integer' : undefined;
        const rule = error.keyword === 'pattern' && error.params.pattern === '\\S' ? 'nonBlank' : error.keyword;
        return new InvalidInputError(undefined, undefined, {field: identity, rule, limit, type});
    }
    return new InvalidInputError(undefined, undefined, fallback);
}

/** Matching generated image/proof operations use one multipart envelope.
 * Features validate/select their own wire shape and endpoint before calling;
 * this serializer owns only JSON-part encoding and the original selected bytes. */
export function createMultipartForm(data: object | null, file: File | null, binaryPart: 'image' | 'proof' = 'image'): FormData {
    const form = new FormData();

    // Header-only operations omit metadata. Each feature retains its generated
    // required/optional file contract; this owner preserves the selected bytes
    // under the declared part without creating another draft or upload policy.
    if (data !== null) form.append('data', JSON.stringify(data));
    if (file !== null) form.append(binaryPart, file);
    return form;
}

/**
 * The generated client owns request shapes. This finite adapter adds runtime checking and identity
 * boundaries without introducing a second schema, a response cache, or any automatic command replay.
 */
export class FrontendTransport {
    readonly client;
    private nextAllowedRead = new Map<string, number>();

    constructor(protected isCurrent: (scope: FrontendRequestScope, checkLocale?: boolean) => boolean,
                protected identityLost: () => void, requestFetch: typeof fetch = globalThis.fetch,
                private mayRead?: (scope: FrontendRequestScope) => boolean) {
        this.client = createClient<paths>({baseUrl: `${globalThis.location?.origin ?? 'http://localhost'}/api/v1`, fetch: requestFetch});
    }

    /** Sessionless public reads/actions carry no fabricated identity evidence.
     * The server still selects the actor from its actual session and decides
     * which protections that operation requires; omitted headers grant nothing. */
    headers(scope: FrontendRequestScope, etag?: string | null) {
        // Bootstrap validates this pair together. Reject a malformed internal
        // caller too, rather than submit half a stored session's evidence.
        if ((scope.context === null) !== (scope.csrfToken === null)) throw new InvalidInputError(undefined, 'state.sessionChanged');
        return {
            ...(scope.context !== null ? {'X-Surveyor-Context': scope.context, 'X-CSRF-Token': scope.csrfToken!} : {}),
            'X-Surveyor-Locale': scope.locale,
            'X-Surveyor-Api-Compatibility': apiCompatibility,
            ...(etag ? {'If-None-Match': etag} : {}),
        };
    }

    /** Check the captured actor before processing even an error from an obsolete request. */
    checkScope(response: Response, scope?: FrontendRequestScope, checkLocale = false): void {
        if (!scope) return;
        if (!this.isCurrent(scope, checkLocale)) throw new ObsoleteRequestError();
        const admitted = response.headers.get('X-Surveyor-Context');
        if (admitted && admitted !== scope.context) {
            this.identityLost();
            throw new ObsoleteRequestError();
        }
        // A sessionless response deliberately has no context header. An existing
        // stored scope still needs positive confirmation before a successful body
        // or conditional snapshot can enter its actor's cache.
        if (scope.context !== null && !admitted && (response.ok || response.status === 304)) throw new UnconfirmedResponseError();
    }

    /** JSON and binary operations share this error boundary. Check actor/locale before
     * granting known machine-code behavior or retaining a safe future explanation;
     * the generated client's decoded error stays unknown until these checks pass. */
    reject(response: Response, error: unknown, scope?: FrontendRequestScope, checkLocale = false): never {
        this.checkScope(response, scope, checkLocale);
        const problem = validateProblem(error) && error.status === response.status ? error : null;
        const validatedDetails = validateSafeProblemDetails(error) && error.status === response.status;
        const detail = validatedDetails ? error.detail : undefined;
        // Known codes own identity transitions. A malformed or future error may
        // describe a rejection, but it cannot expire an otherwise current actor.
        if (problem?.code === 'AUTH_REQUIRED' || problem?.code === 'SESSION_CONTEXT_CHANGED') this.identityLost();
        const rawDelay = response.headers.get('Retry-After');
        const parsedDelay = rawDelay && /^\d+$/u.test(rawDelay) ? Number(rawDelay) * 1000
            : rawDelay ? Math.max(0, Date.parse(rawDelay) - Date.now()) : null;
        throw new ApiFailure(response.status, problem, Number.isFinite(parsedDelay) ? parsedDelay : null,
            detail, validatedDetails);
    }

    /** Admit one decoded response against the authored operation and captured
     * scope. A 304 can reuse only the caller's supplied snapshot after positive
     * context checks; malformed/empty success never confirms a command or read. */
    read<T>(operationId: ApiOperationId, result: {data?: unknown; error?: unknown; response: Response; signal?: AbortSignal}, validate: Validator<T>,
                     scope?: FrontendRequestScope, previous?: FrontendRead<T>, checkLocale = false): FrontendRead<T> {
        const {response, data, error, signal} = result;
        // A transport adapter can finish headers/body decoding after cancellation.
        // Retire that read before any success, identity change or error policy is
        // published outside the query cache; actor scope alone does not retire a
        // same-actor read canceled by typing, disclosure or explicit replacement.
        this.checkReadCancellation(signal);

        // A conditional read has no error body. Its retained snapshot still requires
        // positive actor confirmation before it can bypass ordinary success validation.
        if (response.status === 304 && previous) {
            this.checkScope(response, scope, checkLocale);
            return previous;
        }
        if (!response.ok) this.reject(response, error, scope, checkLocale);
        this.checkScope(response, scope, checkLocale);

        // A 204 is a valid empty HTTP response, but no frontend read/write declares an empty success body.
        // Never turn that absence (or redirected login HTML) into a successful typed command.
        if (!operationPolicies[operationId].successStatuses.includes(response.status) || response.status === 204
            || !response.headers.get('content-type')?.includes('application/json') || !validate(data)) {
            throw new UnconfirmedResponseError();
        }
        return {data, etag: response.headers.get('ETag')};
    }

    /** Send one proof upload with native transfer progress and the same generated
     * response, actor and rejection checks as fetch. Transfer completion is never
     * save confirmation; timeout, abort and unusable delivery remain uncertain.
     * The feature retains its form, draft and explicit recovery decisions. */
    async uploadJson<T>(operationId: ApiOperationId, path: string, form: FormData, validate: Validator<T>,
                        scope: FrontendRequestScope, progress: (loaded: number, total: number | null, complete?: boolean) => void): Promise<T> {
        if (!this.isCurrent(scope)) throw new ObsoleteRequestError();
        if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\'))
            throw new InvalidInputError(undefined, 'state.uploadDestinationInvalid');
        const headers = this.headers(scope);

        // XHR supplies upload progress which fetch does not expose. Do not set
        // Content-Type: the browser must retain its multipart boundary and bytes.
        const request = new XMLHttpRequest();
        request.open('POST', '/api/v1' + path);
        request.timeout = 180000;
        for (const [name, value] of Object.entries(headers)) request.setRequestHeader(name, value);

        await new Promise<void>(function send(resolve, reject) {
            request.upload.onprogress = reportProgress;
            request.upload.onload = uploaded;
            request.onload = completed;
            request.onerror = uncertain;
            request.ontimeout = uncertain;
            request.onabort = uncertain;

            /** Report bytes only; the feature separately waits for confirmation. */
            function reportProgress(event: ProgressEvent): void {
                progress(event.loaded, event.lengthComputable ? event.total : null);
            }
            /** Transfer end is known even when the browser could not measure its total bytes. */
            function uploaded(event: ProgressEvent): void {
                progress(event.loaded, event.lengthComputable ? event.total : null, true);
            }
            function completed(): void { resolve(); }
            function uncertain(): void { reject(new UnconfirmedResponseError()); }

            // A synchronous send failure still cannot establish server rejection.
            request.send(form);
        });

        // Reconstruct the ordinary response boundary without trusting XHR's body.
        // HTML redirects, malformed JSON and foreign context cannot confirm a write.
        const responseHeaders = new Headers();
        for (const line of request.getAllResponseHeaders().trim().split(/[\r\n]+/u)) {
            const separator = line.indexOf(':');
            if (separator > 0) responseHeaders.append(line.slice(0, separator), line.slice(separator + 1).trim());
        }
        if (request.status < 200) throw new UnconfirmedResponseError();
        const response = new Response(request.responseText || null, {status: request.status, headers: responseHeaders});
        let body: unknown;
        try { body = JSON.parse(request.responseText); } catch { /* Existing read/reject owns malformed delivery. */ }
        return this.read(operationId, {response, ...(response.ok ? {data: body} : {error: body})}, validate, scope).data;
    }

    /** Admit a header image through the same captured-scope/error policy as JSON
     * reads. Features supply generated HTTP operations and retain their read key;
     * binary decoding never introduces another actor or retry owner. */
    headerImage(result: {data?: unknown; error?: unknown; response: Response}, scope: FrontendRequestScope,
                signal?: AbortSignal): Blob {
        // Cancel before classifying errors so an obsolete response cannot publish
        // identity loss or a Retry-After lease into a newer image visit.
        this.checkReadCancellation(signal);
        if (!result.response.ok) this.reject(result.response, result.error, scope);
        this.checkScope(result.response, scope);
        // Preserve the existing image boundary, including octet-stream delivery.
        // HTML redirects and malformed success remain unconfirmed responses.
        if (result.response.status !== 200 || !(result.data instanceof Blob)
            || !['application/octet-stream', 'image/jpeg', 'image/png', 'image/gif'].includes(result.data.type))
            throw new UnconfirmedResponseError();
        return result.data;
    }

    /** A readable metadata response needs its opaque strong comparison header
     * before any feature editor can write. The generated bound is shared with
     * command bodies; the browser never decodes the token into authority. */
    requireComparison(etag: string | null | undefined): asserts etag is string {
        // Missing, malformed and oversized evidence cannot make a form writable.
        if (!validateComparisonToken(etag) || typeof etag !== 'string' || !/^"[^"\r\n]+"$/u.test(etag))
            throw new UnconfirmedResponseError();
    }

    /** Every read entry point shares one deadline: focus/manual callers cannot bypass Retry-After.
     * No delayed requests are queued; the caller's ordinary query timer may retry after the deadline. */
    async allowedRead<T>(resource: string, scope: FrontendRequestScope | undefined, operation: () => Promise<T>,
                         signal?: AbortSignal): Promise<T> {
        this.checkReadCancellation(signal);
        // Observer enabled state cannot protect explicit refetches or image reads.
        // Enforce the same session dispatch barrier here without expiring admitted commands.
        if (scope && (!this.isCurrent(scope) || this.mayRead?.(scope) === false)) throw new ObsoleteRequestError();
        const key = scope ? `${scope.context}:${scope.epoch}:${resource}` : resource;
        const now = Date.now();
        for (const [stored, deadline] of this.nextAllowedRead) if (deadline <= now) this.nextAllowedRead.delete(stored);
        const deadline = this.nextAllowedRead.get(key);
        if (deadline && deadline > now) throw new ApiFailure(429, null, deadline - now);
        try {
            const result = await operation();
            this.checkReadCancellation(signal);
            return result;
        } catch (failure) {
            // Cancellation can also occur between decoding and this promise's
            // rejection continuation. An obsolete failure owns no retry lease.
            this.checkReadCancellation(signal);
            if (failure instanceof ApiFailure && failure.retryAt !== null && (!scope || this.isCurrent(scope))) {
                this.nextAllowedRead.set(key, failure.retryAt);
            }
            throw failure;
        }
    }

    /** Read disposal changes presentation authority only; command responses never
     * receive this optional signal and retain their confirmed/unknown contract. */
    private checkReadCancellation(signal?: AbortSignal): void {
        if (signal?.aborted) throw new ObsoleteRequestError();
    }

}
