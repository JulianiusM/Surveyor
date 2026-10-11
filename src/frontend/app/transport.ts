import createClient from 'openapi-fetch';
import type {components, paths} from '../../types/api/v1';
import type {PilotRead, PilotRequestScope} from '../../types/FrontendPilotUiTypes';
import {validateProblem} from '../../../.generated/api/v1/browser/validateProblem.mjs';
import {validateSafeProblemDetails} from '../../../.generated/api/v1/browser/validateSafeProblemDetails.mjs';
import {apiCompatibility, operationPolicies} from '../../../.generated/api/v1/policy.mjs';
import type {ApiOperationId} from '../../types/ApiTransportTypes';

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

export class UnconfirmedResponseError extends Error {
    constructor() { super('The server response did not confirm the requested operation.'); }
}

/** The shared validator rejected input before any network side effect was attempted. */
export class InvalidInputError extends Error {}

/**
 * The generated client owns request shapes. This finite adapter adds runtime checking and identity
 * boundaries without introducing a second schema, a response cache, or any automatic command replay.
 */
export class PilotTransport {
    readonly client;
    private nextAllowedRead = new Map<string, number>();

    constructor(protected isCurrent: (scope: PilotRequestScope, checkLocale?: boolean) => boolean,
                protected identityLost: () => void, requestFetch: typeof fetch = globalThis.fetch) {
        this.client = createClient<paths>({baseUrl: `${globalThis.location?.origin ?? 'http://localhost'}/api/v1`, fetch: requestFetch});
    }

    headers(scope: PilotRequestScope, etag?: string | null) {
        return {
            'X-Surveyor-Context': scope.context,
            'X-Surveyor-Locale': scope.locale,
            'X-CSRF-Token': scope.csrfToken,
            'X-Surveyor-Api-Compatibility': apiCompatibility,
            ...(etag ? {'If-None-Match': etag} : {}),
        };
    }

    /** Check the captured actor before processing even an error from an obsolete request. */
    checkScope(response: Response, scope?: PilotRequestScope, checkLocale = false): void {
        if (!scope) return;
        if (!this.isCurrent(scope, checkLocale)) throw new ObsoleteRequestError();
        const admitted = response.headers.get('X-Surveyor-Context');
        if (admitted && admitted !== scope.context) {
            this.identityLost();
            throw new ObsoleteRequestError();
        }
        // Failures before actor admission can omit this header (notably expired authentication).
        // A private success or 304 must positively bind its body/snapshot to the captured actor.
        if (!admitted && (response.ok || response.status === 304)) throw new UnconfirmedResponseError();
    }

    /** JSON and binary operations share this error boundary. Check actor/locale before
     * granting known machine-code behavior or retaining a safe future explanation;
     * the generated client's decoded error stays unknown until these checks pass. */
    reject(response: Response, error: unknown, scope?: PilotRequestScope, checkLocale = false): never {
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

    read<T>(operationId: ApiOperationId, result: {data?: unknown; error?: unknown; response: Response}, validate: Validator<T>,
                    scope?: PilotRequestScope, previous?: PilotRead<T>, checkLocale = false): PilotRead<T> {
        const {response, data, error} = result;
        // A conditional read has no error body. Its retained snapshot still requires
        // positive actor confirmation before it can bypass ordinary success validation.
        if (response.status === 304 && previous) {
            this.checkScope(response, scope, checkLocale);
            return previous;
        }
        if (!response.ok) this.reject(response, error, scope, checkLocale);
        this.checkScope(response, scope, checkLocale);
        // A 204 is a valid empty HTTP response, but no pilot read/write declares an empty success body.
        // Never turn that absence (or redirected login HTML) into a successful typed command.
        if (!operationPolicies[operationId].successStatuses.includes(response.status) || response.status === 204 || !response.headers.get('content-type')?.includes('application/json') || !validate(data)) {
            throw new UnconfirmedResponseError();
        }
        return {data, etag: response.headers.get('ETag')};
    }

    /** Every read entry point shares one deadline: focus/manual callers cannot bypass Retry-After.
     * No delayed requests are queued; the caller's ordinary query timer may retry after the deadline. */
    async allowedRead<T>(resource: string, scope: PilotRequestScope | undefined, operation: () => Promise<T>): Promise<T> {
        if (scope && !this.isCurrent(scope)) throw new ObsoleteRequestError();
        const key = scope ? `${scope.context}:${scope.epoch}:${resource}` : resource;
        const now = Date.now();
        for (const [stored, deadline] of this.nextAllowedRead) if (deadline <= now) this.nextAllowedRead.delete(stored);
        const deadline = this.nextAllowedRead.get(key);
        if (deadline && deadline > now) throw new ApiFailure(429, null, deadline - now);
        try { return await operation(); }
        catch (failure) {
            if (failure instanceof ApiFailure && failure.retryAt !== null && (!scope || this.isCurrent(scope))) {
                this.nextAllowedRead.set(key, failure.retryAt);
            }
            throw failure;
        }
    }

}
