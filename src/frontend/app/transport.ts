import {isImageMimeType} from '../../common/lib/fileMedia';
import createClient, {defaultBodySerializer} from 'openapi-fetch';
import type {components, paths} from '../../types/api/v1';
import type {FrontendDecodedResponse, FrontendDispatchOptions, FrontendPlainMessageKey, FrontendRead, FrontendRequestScope} from '../../types/FrontendUiTypes';
import {validateProblem} from '../../../.generated/api/v1/browser/validateProblem.mjs';
import {validateSafeProblemDetails} from '../../../.generated/api/v1/browser/validateSafeProblemDetails.mjs';
import {validateComparisonToken} from '../../../.generated/api/v1/browser/validateComparisonToken.mjs';
import {apiCompatibility, loadInputValidator, operationInputs, operationPolicies} from '../../../.generated/api/v1/policy.mjs';
import type {ApiOperationId} from '../../types/ApiTransportTypes';
import type {ErrorObject} from 'ajv';
import type {FrontendInputField} from '../../types/FrontendFeedbackTypes';
import type {InputDiagnostic} from '../../types/InputValidationTypes';
import {decodeScalarParameter, fieldDiagnostic, fieldDiagnosticInput} from '../../common/localization/inputValidation';

type Validator<T> = (value: unknown) => value is T;
type Problem = components['schemas']['Problem'];
const dispatchScope = Symbol('captured request scope');
const dispatchRequest = Symbol('constructed request');

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

/** Input admission failed before any network side effect was attempted.
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

    /** Keep the generated client's public API while routing every HTTP method
     * through the same pre-dispatch runtime admission boundary. */
    constructor(protected isCurrent: (scope: FrontendRequestScope, checkLocale?: boolean) => boolean,
                protected identityLost: () => void, requestFetch: typeof fetch = globalThis.fetch,
                private mayRead?: (scope: FrontendRequestScope) => boolean) {
        const client = createClient<paths>({baseUrl: `${globalThis.location?.origin ?? 'http://localhost'}/api/v1`, fetch: requestFetch});
        const transport = this;
        // Capture the original serialized Request before caller middleware runs.
        // Its per-dispatch marker never enters headers, URLs or retained state.
        client.use({onRequest({request, params}) {
            const capture = (params as {[dispatchRequest]?: {request?: Request}})[dispatchRequest];
            if (capture) capture.request = request;
        }});
        // Binding happens when a method is read, without loading a feature or
        // replacing the generated client's request/serialization implementation.
        this.client = new Proxy(client, {
            /** Intercept only dispatch methods; middleware registration and all
             * other client members retain their original identity and behavior. */
            get(target, name, receiver) {
                const method = Reflect.get(target, name, receiver);
                if (typeof name !== 'string' || typeof method !== 'function'
                    || !['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD', 'TRACE', 'request'].includes(name)) return method;
                // Generic request has a separate method argument; both surfaces
                // delegate their untouched payload through one admission path.
                return async function dispatch(...args: unknown[]) {
                    const generic = name === 'request';
                    const httpMethod = generic ? String(args[0]).toUpperCase() : name;
                    const path = String(args[generic ? 1 : 0]);
                    const options = args[generic ? 2 : 1] as FrontendDispatchOptions | undefined;
                    const guarded = await transport.prepareDispatch(httpMethod, path, options ?? {});
                    return Reflect.apply(method, target, generic ? [args[0], path, guarded] : [path, guarded]);
                };
            },
        });
    }

    /** Admit the actual serialized request once, before fetch can have a side
     * effect. Feature guards retain their more specific field/row diagnostics;
     * every other client entry uses the same authored operation validators. */
    private async prepareDispatch(method: string, path: string, options: FrontendDispatchOptions): Promise<FrontendDispatchOptions> {
        const contract = operationInputs.find(input => input.method === method && input.path === path);
        if (!contract) throw new InvalidInputError();
        // A replacement constructor could change bytes after serialization.
        // All application requests use the transport's native Request owner.
        if (Object.hasOwn(options, 'Request')) throw new InvalidInputError();
        const scope = (options.params?.header as {[dispatchScope]?: FrontendRequestScope} | undefined)?.[dispatchScope];
        const check = () => {
            this.checkReadCancellation(options.signal ?? undefined);
            if (scope && !this.isCurrent(scope)) throw new ObsoleteRequestError();
        };
        check();
        const [parameters, body, headers] = await this.loadDispatchValidators(contract, check);
        check();
        if (options.body === undefined && body && !body(undefined)) throw generatedInputError(body.errors, () => undefined);
        if (!body && options.body !== undefined) throw new InvalidInputError();
        const serialize = options.bodySerializer ?? defaultBodySerializer;
        const capture: {request?: Request} = {};
        const params = {...options.params, [dispatchRequest]: capture};
        return {...options,
            params,
            bodySerializer: (value, headers) => {
                check();
                const serialized = serialize(value, headers);
                this.validateSerializedBody(contract, serialized, body);
                return serialized;
            },
            middleware: [...(options.middleware ?? []), {onRequest: ({request}) => {
                check();
                // Request bodies are streams. Require the original serializer's
                // object rather than clone/read uploaded proof bytes to revalidate.
                if (capture.request !== request) throw new InvalidInputError();
                this.validateDispatchParameters(contract, request, parameters, headers);
            }}],
        };
    }

    /** A failed lazy validator load is definite local nondelivery. Fetch and
     * XHR share this classification while retaining actor/cancellation priority. */
    private async loadDispatchValidators(contract: typeof operationInputs[number], check: () => void): Promise<[
        Awaited<ReturnType<typeof loadInputValidator>>, Awaited<ReturnType<typeof loadInputValidator>> | null,
        Awaited<ReturnType<typeof loadInputValidator>>]> {
        check();
        try {
            const validators = await Promise.all([loadInputValidator(contract.parametersValidator),
                contract.bodyValidator ? loadInputValidator(contract.bodyValidator) : Promise.resolve(null),
                loadInputValidator(contract.headersValidator)]);
            check();
            return validators;
        } catch {
            // A retired chunk has not dispatched a command. Keep its draft and
            // report a definite local failure, with obsolete scope taking priority.
            check();
            throw new InvalidInputError(undefined, 'state.loadFailed');
        }
    }

    /** Validate multipart metadata and presence without reading, cloning or
     * retaining file bytes. The original FormData is sent by its existing owner. */
    private validateSerializedBody(contract: typeof operationInputs[number], serialized: unknown,
                                   validate: Awaited<ReturnType<typeof loadInputValidator>> | null): void {
        if (!validate) return;
        let value: unknown;
        if (contract.mediaType === 'multipart/form-data') {
            if (!(serialized instanceof FormData)) throw new InvalidInputError();
            // Project only names and JSON metadata. Repeated parts and claimed
            // filenames cannot stand in for the original binary upload object.
            // Preserve special JavaScript names as submitted own properties so
            // the closed schema can reject every unexpected part consistently.
            const fields: Record<string, unknown> = Object.create(null);
            for (const [name, part] of serialized.entries()) {
                if (Object.hasOwn(fields, name)) throw new InvalidInputError();
                if (contract.binaryParts.includes(name) && typeof part === 'string') throw new InvalidInputError();
                if (typeof part !== 'string') fields[name] = part.name;
                else if (name === 'data') {
                    try { fields[name] = JSON.parse(part); } catch { throw new InvalidInputError(); }
                } else fields[name] = part;
            }
            value = fields;
        } else {
            // Validate exactly what the existing JSON serializer will send,
            // including omitted undefined fields, without changing its output.
            if (typeof serialized !== 'string') throw new InvalidInputError();
            try { value = JSON.parse(serialized); } catch { throw new InvalidInputError(); }
        }
        if (!validate(value)) throw generatedInputError(validate.errors, () => undefined);
    }

    /** Decode the URL and declared headers exactly as the server's scalar
     * binding does. Unknown query fields remain visible to the closed schema;
     * infrastructure and policy headers retain their separate admission owner. */
    private validateDispatchParameters(contract: typeof operationInputs[number], request: Request,
                                       validate: Awaited<ReturnType<typeof loadInputValidator>>,
                                       validateHeaders: Awaited<ReturnType<typeof loadInputValidator>>): void {
        const url = new URL(request.url);
        const origin = globalThis.location?.origin ?? 'http://localhost';
        if (url.origin !== origin || request.method !== contract.method || !url.pathname.startsWith('/api/v1/')) throw new InvalidInputError();
        // Submitted query names remain ordinary data keys, including names
        // which have inherited setters on a normal JavaScript object.
        const value: Record<string, Record<string, unknown>> = {
            path: Object.create(null), query: Object.create(null), header: Object.create(null),
        };
        // Select the exact route before decoding its path/query occurrences;
        // repeated query values retain their multiplicity for scalar rejection.
        const names: string[] = [];
        const pattern = contract.path.split(/(\{[^{}]+\})/u).map(part => part.startsWith('{')
            ? (names.push(part.slice(1, -1)), '([^/]+)') : part.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('');
        const match = new RegExp('^/api/v1' + pattern + '$', 'u').exec(url.pathname);
        if (!match) throw new InvalidInputError();
        for (const [index, name] of names.entries()) {
            try { value.path![name] = decodeURIComponent(match[index + 1]!); } catch { throw new InvalidInputError(); }
        }
        for (const name of new Set(url.searchParams.keys())) {
            const values = url.searchParams.getAll(name);
            value.query![name] = values.length === 1 ? values[0] : values;
        }
        for (const parameter of contract.parameters) {
            // Header lookup is case-insensitive. Ordinary parameters use the
            // same scalar syntax decoder as the backend before schema checks.
            if (parameter.in === 'header' && request.headers.has(parameter.name)) value.header![parameter.name] = request.headers.get(parameter.name);
            const raw = value[parameter.in]![parameter.name];
            if (raw === undefined) continue;
            const decoded = decodeScalarParameter(raw, parameter.type);
            if (!decoded.valid) throw generatedInputError([{instancePath: '/' + parameter.in + '/' + parameter.name,
                schemaPath: '', keyword: 'type', params: {type: parameter.type}}], () => undefined);
            value[parameter.in]![parameter.name] = decoded.value;
        }
        if (!validate(value)) throw generatedInputError(validate.errors, () => undefined);
        // Structural policy-header validation grants no authority. Conditional
        // Event headers retain their authored optional/unbounded string shape.
        const policy = Object.fromEntries(contract.policyHeaders.filter(name => request.headers.has(name))
            .map(name => [name, request.headers.get(name)]));
        if (!validateHeaders(policy)) throw generatedInputError(validateHeaders.errors, () => undefined);
    }

    /** Sessionless public reads/actions carry no fabricated identity evidence.
     * The server still selects the actor from its actual session and decides
     * which protections that operation requires; omitted headers grant nothing. */
    headers(scope: FrontendRequestScope, etag?: string | null) {
        // Bootstrap validates this pair together. Reject a malformed internal
        // caller too, rather than submit half a stored session's evidence.
        if ((scope.context === null) !== (scope.csrfToken === null)) throw new InvalidInputError(undefined, 'state.sessionChanged');
        return {
            // Enumerable symbols survive feature header spreads while the HTTP
            // serializer only emits string names. This capture is never authority.
            [dispatchScope]: scope,
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
    read<T>(operationId: ApiOperationId, result: FrontendDecodedResponse, validate: Validator<T>,
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

    /** Compose an admitted feature read with its existing generated decoder.
     * Callers retain typed endpoint/headers/query selection and their exact cooldown
     * key. This owner neither caches snapshots nor retries or dispatches a command. */
    async readJson<T>(resource: string, scope: FrontendRequestScope | undefined,
                      request: () => Promise<FrontendDecodedResponse>,
                      operationId: ApiOperationId, validate: Validator<T>, signal?: AbortSignal,
                      previous?: FrontendRead<T>, checkLocale = false): Promise<FrontendRead<T>> {
        const transport = this;
        // Admission runs before the supplied request. Delivery still passes through
        // the same cancellation, actor, conditional-read and generated-shape checks.
        return this.allowedRead(resource, scope, readResponse, signal);
        async function readResponse(): Promise<FrontendRead<T>> {
            const response = await request();
            return transport.read(operationId, {...response, signal}, validate, scope, previous, checkLocale);
        }
    }

    /** Header requests share read admission and binary decoding without another
     * response parser, actor owner or Retry-After deadline. */
    async readHeaderImage(resource: string, scope: FrontendRequestScope,
                          request: () => Promise<FrontendDecodedResponse>,
                          signal?: AbortSignal): Promise<Blob> {
        const transport = this;
        // The feature selects its authorized endpoint. Binary success and failure
        // keep the established headerImage boundary after that single dispatch.
        return this.allowedRead(resource, scope, readImage, signal);
        async function readImage(): Promise<Blob> {
            return transport.headerImage(await request(), scope, signal);
        }
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

        // XHR bypasses the generated fetch client, so admit its same multipart
        // envelope and concrete URL before constructing the transfer object.
        const contract = operationInputs.find(input => input.operationId === operationId && input.method === 'POST');
        if (!contract || contract.mediaType !== 'multipart/form-data' || !contract.bodyValidator) throw new InvalidInputError();
        const [parameters, bodyValidator, headerValidator] = await this.loadDispatchValidators(contract, () => {
            if (!this.isCurrent(scope)) throw new ObsoleteRequestError();
        });
        this.validateSerializedBody(contract, form, bodyValidator);
        this.validateDispatchParameters(contract, new Request(`${globalThis.location?.origin ?? 'http://localhost'}/api/v1${path}`,
            {method: 'POST', headers: Object.fromEntries(Object.entries(headers))}), parameters, headerValidator);

        // XHR supplies upload progress which fetch does not expose. Do not set
        // Content-Type: the browser must retain its multipart boundary and bytes.
        const request = new XMLHttpRequest();
        request.open('POST', '/api/v1' + path);
        request.timeout = 180000;
        for (const [name, value] of Object.entries(headers)) request.setRequestHeader(name, value);

        await new Promise<void>(
        /** Send the same form once and settle only transport delivery. Byte
         * progress cannot confirm persistence; network/timeout/abort and a thrown
         * send remain unconfirmed until the separate HTTP response boundary. */
        function send(resolve, reject) {
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
    headerImage(result: FrontendDecodedResponse, scope: FrontendRequestScope,
                signal?: AbortSignal): Blob {
        // Cancel before classifying errors so an obsolete response cannot publish
        // identity loss or a Retry-After lease into a newer image visit.
        this.checkReadCancellation(signal);
        if (!result.response.ok) this.reject(result.response, result.error, scope);
        this.checkScope(result.response, scope);
        // Preserve the existing image boundary, including octet-stream delivery.
        // HTML redirects and malformed success remain unconfirmed responses.
        if (result.response.status !== 200 || !(result.data instanceof Blob)
            || (result.data.type !== 'application/octet-stream' && !isImageMimeType(result.data.type)))
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
