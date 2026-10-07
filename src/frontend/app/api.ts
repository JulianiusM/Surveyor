import createClient from 'openapi-fetch';
import type {components, paths} from '../../types/api/v1';
import type {PilotRead, PilotRequestScope} from '../../types/FrontendPilotUiTypes';
import {
    validateHelpPageData, validatePackingAssignmentResult, validatePackingListView,
    validatePackingMetadata, validatePackingMetadataPatch, validateProblem, validateSafeProblemDetails, validateSessionView,
    validatePackingSettings, validatePackingCreateContext, validatePackingCreateInput, validatePackingCreated,
    validatePackingNewItem, validatePackingItemPatch, validateMutationResult, validatePackingEventChanged,
    validatePackingEventOptions, validatePackingProfileOptions, validatePackingDuplicate,
    validateIdentityResult, validateGuestEntry, validateGuestEmailExists, validatePasswordResetCheck,
    validatePackingOverviewRegion, validatePackingVisibilityResult,
} from '../../../.generated/api/v1/browser.mjs';

type Validator<T> = (value: unknown) => value is T;
type Session = components['schemas']['SessionView'];
type List = components['schemas']['PackingListView'];
type Metadata = components['schemas']['PackingMetadata'];
type Assignment = components['schemas']['PackingAssignmentResult'];
type Help = components['schemas']['HelpPageData'];
type Problem = components['schemas']['Problem'];

/** Intentional disposal is distinct from a failed network read and must not produce an error toast. */
export class ObsoleteRequestError extends Error {
    constructor() { super('The request belongs to an obsolete view context.'); }
}

/** A validated API problem is a confirmed rejection; an invalid/absent mutation response is not. */
export class ApiFailure extends Error {
    readonly retryAt: number | null;
    constructor(readonly status: number, readonly problem: Problem | null, readonly retryAfter: number | null = null,
                detail?: string) {
        super(problem?.detail ?? detail ?? problem?.title ?? `HTTP ${status}`);
        this.retryAt = retryAfter === null ? null : Date.now() + retryAfter;
    }
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
export class PilotApi {
    private client;
    private nextAllowedRead = new Map<string, number>();

    constructor(private isCurrent: (scope: PilotRequestScope, checkLocale?: boolean) => boolean,
                private identityLost: () => void, requestFetch: typeof fetch = globalThis.fetch) {
        this.client = createClient<paths>({baseUrl: `${globalThis.location?.origin ?? 'http://localhost'}/api/v1`, fetch: requestFetch});
    }

    private headers(scope: PilotRequestScope, etag?: string | null) {
        return {
            'X-Surveyor-Context': scope.context,
            'X-Surveyor-Locale': scope.locale,
            'X-CSRF-Token': scope.csrfToken,
            ...(etag ? {'If-None-Match': etag} : {}),
        };
    }

    /** Check the captured actor before processing even an error from an obsolete request. */
    private checkScope(response: Response, scope?: PilotRequestScope, checkLocale = false): void {
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

    private read<T>(result: {data?: unknown; error?: unknown; response: Response}, validate: Validator<T>,
                    scope?: PilotRequestScope, previous?: PilotRead<T>, checkLocale = false): PilotRead<T> {
        const {response, data, error} = result;
        this.checkScope(response, scope, checkLocale);
        if (response.status === 304 && previous) return previous;
        if (!response.ok) {
            const problem = validateProblem(error) && error.status === response.status ? error : null;
            const detail = validateSafeProblemDetails(error) && error.status === response.status ? error.detail : undefined;
            if (response.status === 401 && (!problem || problem.code === 'AUTH_REQUIRED')
                || problem?.code === 'SESSION_CONTEXT_CHANGED') this.identityLost();
            const rawDelay = response.headers.get('Retry-After');
            const parsedDelay = rawDelay && /^\d+$/u.test(rawDelay) ? Number(rawDelay) * 1000
                : rawDelay ? Math.max(0, Date.parse(rawDelay) - Date.now()) : null;
            throw new ApiFailure(response.status, problem, Number.isFinite(parsedDelay) ? parsedDelay : null, detail);
        }
        // A 204 is a valid empty HTTP response, but no pilot read/write declares an empty success body.
        // Never turn that absence (or redirected login HTML) into a successful typed command.
        if (response.status === 204 || !response.headers.get('content-type')?.includes('application/json') || !validate(data)) {
            throw new UnconfirmedResponseError();
        }
        return {data, etag: response.headers.get('ETag')};
    }

    /** Every read entry point shares one deadline: focus/manual callers cannot bypass Retry-After.
     * No delayed requests are queued; the caller's ordinary query timer may retry after the deadline. */
    private async allowedRead<T>(resource: string, scope: PilotRequestScope | undefined, operation: () => Promise<T>): Promise<T> {
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

    async bootstrap(signal?: AbortSignal): Promise<Session> {
        return this.allowedRead('session', undefined, async () =>
            this.read(await this.client.GET('/session', {signal, cache: 'no-store'}), validateSessionView).data);
    }

    async packing(listId: string, scope: PilotRequestScope, signal?: AbortSignal,
                  previous?: PilotRead<List>): Promise<PilotRead<List>> {
        return this.allowedRead(`packing/${listId}`, scope, async () => this.read(await this.client.GET('/packing-lists/{listId}', {
            params: {path: {listId}, header: this.headers(scope, previous?.etag)}, signal, cache: 'no-store',
        }), validatePackingListView, scope, previous));
    }

    async metadata(listId: string, scope: PilotRequestScope, signal?: AbortSignal,
                   previous?: PilotRead<Metadata>): Promise<PilotRead<Metadata>> {
        const result = await this.allowedRead(`packing/${listId}/metadata`, scope, async () => this.read(await this.client.GET('/packing-lists/{listId}/metadata', {
            params: {path: {listId}, header: this.headers(scope, previous?.etag)}, signal, cache: 'no-store',
        }), validatePackingMetadata, scope, previous));
        if (!result.etag || !/^"[^"\r\n]+"$/u.test(result.etag)) throw new UnconfirmedResponseError();
        return result;
    }

    async saveMetadata(listId: string, patch: components['schemas']['PackingMetadataPatch'], etag: string,
                       scope: PilotRequestScope): Promise<PilotRead<Metadata>> {
        if (!validatePackingMetadataPatch(patch)) throw new InvalidInputError('Invalid metadata patch.');
        const result = this.read(await this.client.PATCH('/packing-lists/{listId}/metadata', {
            params: {path: {listId}, header: {...this.headers(scope), 'If-Match': etag}}, body: patch, cache: 'no-store',
        }), validatePackingMetadata, scope);
        if (!result.etag || !/^"[^"\r\n]+"$/u.test(result.etag)) throw new UnconfirmedResponseError();
        return result;
    }

    async assign(listId: string, itemId: string, assigned: boolean, scope: PilotRequestScope): Promise<Assignment> {
        const options = {params: {path: {listId, itemId}, header: this.headers(scope)}, cache: 'no-store' as const};
        const result = assigned
            ? await this.client.PUT('/packing-lists/{listId}/items/{itemId}/self-assignment', options)
            : await this.client.DELETE('/packing-lists/{listId}/items/{itemId}/self-assignment', options);
        return this.read(result, validatePackingAssignmentResult, scope).data;
    }

    async help(query: {q?: string; doc?: string}, scope: PilotRequestScope, signal?: AbortSignal): Promise<Help> {
        return this.allowedRead(`help/${JSON.stringify(query)}`, scope, async () => this.read(await this.client.GET('/help', {
            params: {query, header: this.headers(scope)}, signal, cache: 'no-store',
        }), validateHelpPageData, scope, undefined, true).data);
    }

    async setLocale(locale: string, scope: PilotRequestScope): Promise<Session> {
        return this.read(await this.client.PUT('/locale', {
            body: {locale}, params: {header: this.headers(scope)}, cache: 'no-store',
        }), validateSessionView, scope).data;
    }

    async checkPasswordReset(token: string, scope: PilotRequestScope, signal?: AbortSignal): Promise<components['schemas']['PasswordResetCheck']> {
        return this.allowedRead(`identity/reset/${token}`, scope, async () => this.read(await this.client.GET('/auth/reset-password', {
            params: {query: {token}, header: this.headers(scope)}, signal, cache: 'no-store',
        }), validatePasswordResetCheck, scope).data);
    }

    async settings(listId: string, scope: PilotRequestScope, signal?: AbortSignal): Promise<components['schemas']['PackingSettings']> {
        return this.allowedRead(`packing/${listId}/settings`, scope, async () => this.read(await this.client.GET('/packing-lists/{listId}/settings', {
            params: {path: {listId}, header: this.headers(scope)}, signal, cache: 'no-store',
        }), validatePackingSettings, scope).data);
    }

    async createContext(scope: PilotRequestScope, signal?: AbortSignal): Promise<components['schemas']['PackingCreateContext']> {
        return this.allowedRead('packing/create-context', scope, async () => this.read(await this.client.GET('/packing-lists/create-context', {
            params: {header: this.headers(scope)}, signal, cache: 'no-store',
        }), validatePackingCreateContext, scope).data);
    }

    async duplicate(listId: string, scope: PilotRequestScope, signal?: AbortSignal): Promise<components['schemas']['PackingDuplicate']> {
        return this.allowedRead(`packing/${listId}/duplicate`, scope, async () => this.read(await this.client.GET('/packing-lists/{listId}/duplicate', {
            params: {path: {listId}, header: this.headers(scope)}, signal, cache: 'no-store',
        }), validatePackingDuplicate, scope).data);
    }

    async createPacking(input: components['schemas']['PackingCreateInput'], image: File | null,
                        scope: PilotRequestScope): Promise<components['schemas']['PackingCreated']> {
        if (!validatePackingCreateInput(input)) throw new InvalidInputError('Invalid packing creation.');
        const form = new FormData();
        form.append('data', JSON.stringify(input));
        if (image) form.append('image', image);
        return this.read(await this.client.POST('/packing-lists', {
            params: {header: this.headers(scope)}, body: {data: input}, bodySerializer: () => form, cache: 'no-store',
        }), validatePackingCreated, scope).data;
    }

    async addItem(listId: string, input: components['schemas']['PackingNewItem'], scope: PilotRequestScope) {
        if (!validatePackingNewItem(input)) throw new InvalidInputError('Invalid packing item.');
        return this.read(await this.client.POST('/packing-lists/{listId}/items', {
            params: {path: {listId}, header: this.headers(scope)}, body: input, cache: 'no-store',
        }), validatePackingCreated, scope).data;
    }

    async updateItem(listId: string, itemId: string, patch: components['schemas']['PackingItemPatch'], token: string,
                     scope: PilotRequestScope) {
        if (!validatePackingItemPatch(patch)) throw new InvalidInputError('Invalid packing item patch.');
        return this.read(await this.client.PATCH('/packing-lists/{listId}/items/{itemId}', {
            params: {path: {listId, itemId}, header: {...this.headers(scope), 'If-Match': token}}, body: patch, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    async deleteItem(listId: string, itemId: string, scope: PilotRequestScope) {
        return this.read(await this.client.DELETE('/packing-lists/{listId}/items/{itemId}', {
            params: {path: {listId, itemId}, header: this.headers(scope)}, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    async reorder(listId: string, itemIds: string[], token: string, scope: PilotRequestScope) {
        return this.read(await this.client.PUT('/packing-lists/{listId}/item-order', {
            params: {path: {listId}, header: {...this.headers(scope), 'If-Match': token}}, body: {itemIds}, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    async removeAssignment(listId: string, assignmentId: number, scope: PilotRequestScope) {
        return this.read(await this.client.DELETE('/packing-lists/{listId}/assignments/{assignmentId}', {
            params: {path: {listId, assignmentId: String(assignmentId)}, header: this.headers(scope)}, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    async events(query: NonNullable<paths['/packing-lists/events']['get']['parameters']['query']>,
                 scope: PilotRequestScope, signal?: AbortSignal) {
        return this.allowedRead(`packing/events/${JSON.stringify(query)}`, scope, async () => this.read(await this.client.GET('/packing-lists/events', {
            params: {query, header: this.headers(scope)}, signal, cache: 'no-store',
        }), validatePackingEventOptions, scope).data);
    }

    async linkEvent(listId: string, input: components['schemas']['PackingEventChange'], token: string, scope: PilotRequestScope) {
        return this.read(await this.client.PUT('/packing-lists/{listId}/event', {
            params: {path: {listId}, header: {...this.headers(scope), 'If-Match': token}}, body: input, cache: 'no-store',
        }), validatePackingEventChanged, scope).data;
    }

    async setDefaults(listId: string, defaults: components['schemas']['PermissionDefaults'], token: string, scope: PilotRequestScope) {
        return this.read(await this.client.PUT('/packing-lists/{listId}/default-permissions', {
            params: {path: {listId}, header: {...this.headers(scope), 'If-Match': token}}, body: defaults, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    async profiles(listId: string, q: string, scope: PilotRequestScope, signal?: AbortSignal) {
        return this.allowedRead(`packing/${listId}/profiles/${q}`, scope, async () => this.read(await this.client.GET('/packing-lists/{listId}/profiles', {
            params: {path: {listId}, query: {q}, header: this.headers(scope)}, signal, cache: 'no-store',
        }), validatePackingProfileOptions, scope).data);
    }

    async addAdmin(listId: string, input: components['schemas']['PackingAdminInput'], token: string, scope: PilotRequestScope) {
        return this.read(await this.client.POST('/packing-lists/{listId}/admins', {
            params: {path: {listId}, header: {...this.headers(scope), 'If-Match': token}}, body: input, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    async updateAdmin(listId: string, profileId: string, mask: number, token: string, scope: PilotRequestScope) {
        return this.read(await this.client.PATCH('/packing-lists/{listId}/admins/{profileId}', {
            params: {path: {listId, profileId}, header: {...this.headers(scope), 'If-Match': token}}, body: {mask}, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    async removeAdmin(listId: string, profileId: string, token: string, scope: PilotRequestScope) {
        return this.read(await this.client.DELETE('/packing-lists/{listId}/admins/{profileId}', {
            params: {path: {listId, profileId}, header: {...this.headers(scope), 'If-Match': token}}, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    async header(listId: string, scope: PilotRequestScope, signal?: AbortSignal): Promise<Blob> {
        const result = await this.client.GET('/packing-lists/{listId}/header', {
            params: {path: {listId}, header: this.headers(scope)}, signal, cache: 'no-store', parseAs: 'blob',
        });
        this.checkScope(result.response, scope);
        if (!result.response.ok) this.read(result, validatePackingSettings, scope);
        if (!(result.data instanceof Blob) || !['application/octet-stream', 'image/jpeg', 'image/png', 'image/gif'].includes(result.data.type)) throw new UnconfirmedResponseError();
        return result.data;
    }

    async uploadHeader(listId: string, image: File, token: string, scope: PilotRequestScope) {
        const form = new FormData(); form.append('image', image);
        return this.read(await this.client.PUT('/packing-lists/{listId}/header', {
            params: {path: {listId}, header: {...this.headers(scope), 'If-Match': token}}, body: {image: image.name}, bodySerializer: () => form, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    async removeHeader(listId: string, token: string, scope: PilotRequestScope) {
        return this.read(await this.client.DELETE('/packing-lists/{listId}/header', {
            params: {path: {listId}, header: {...this.headers(scope), 'If-Match': token}}, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    async archive(listId: string, restore: boolean, scope: PilotRequestScope) {
        const options = {params: {path: {listId}, header: this.headers(scope)}, cache: 'no-store' as const};
        return this.read(restore ? await this.client.POST('/packing-lists/{listId}/restore', options)
            : await this.client.POST('/packing-lists/{listId}/archive', options), validateMutationResult, scope).data;
    }

    async deletePacking(listId: string, scope: PilotRequestScope) {
        return this.read(await this.client.DELETE('/packing-lists/{listId}', {
            params: {path: {listId}, header: this.headers(scope)}, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    /** Identity commands bind success to their NEW context. Checking the old context in the
     * usual reader would reject the transition we requested; stale callers are still discarded. */
    private identity(result: {data?: unknown; error?: unknown; response: Response}, scope: PilotRequestScope) {
        if (!this.isCurrent(scope)) throw new ObsoleteRequestError();
        const value = this.read(result, validateIdentityResult).data;
        if (result.response.headers.get('X-Surveyor-Context') !== value.session.context) throw new UnconfirmedResponseError();
        return value;
    }

    async login(input: components['schemas']['LoginInput'], scope: PilotRequestScope) {
        return this.identity(await this.client.POST('/auth/login', {params: {header: this.headers(scope)}, body: input, cache: 'no-store'}), scope);
    }
    async logout(scope: PilotRequestScope) {
        return this.identity(await this.client.POST('/auth/logout', {params: {header: this.headers(scope)}, cache: 'no-store'}), scope);
    }
    async guestLogin(input: components['schemas']['GuestLoginInput'], scope: PilotRequestScope) {
        return this.identity(await this.client.POST('/auth/guest-login', {params: {header: this.headers(scope)}, body: input, cache: 'no-store'}), scope);
    }
    async switchProfile(profileId: string, scope: PilotRequestScope) {
        return this.identity(await this.client.PUT('/auth/profile', {params: {header: this.headers(scope)}, body: {profileId}, cache: 'no-store'}), scope);
    }
    async register(input: components['schemas']['RegistrationInput'], scope: PilotRequestScope) {
        return this.read(await this.client.POST('/auth/register', {params: {header: this.headers(scope)}, body: input, cache: 'no-store'}), validateMutationResult, scope).data;
    }
    async forgotPassword(input: components['schemas']['UsernameInput'], scope: PilotRequestScope) {
        return this.read(await this.client.POST('/auth/forgot-password', {params: {header: this.headers(scope)}, body: input, cache: 'no-store'}), validateMutationResult, scope).data;
    }
    async resetPassword(input: components['schemas']['ResetInput'], scope: PilotRequestScope) {
        return this.read(await this.client.POST('/auth/reset-password', {params: {header: this.headers(scope)}, body: input, cache: 'no-store'}), validateMutationResult, scope).data;
    }
    async activate(input: components['schemas']['TokenInput'], scope: PilotRequestScope) {
        return this.read(await this.client.POST('/auth/activate', {params: {header: this.headers(scope)}, body: input, cache: 'no-store'}), validateMutationResult, scope).data;
    }
    async recoverGuest(input: components['schemas']['EmailInput'], scope: PilotRequestScope) {
        return this.read(await this.client.POST('/auth/guest-recovery', {params: {header: this.headers(scope)}, body: input, cache: 'no-store'}), validateMutationResult, scope).data;
    }
    async guestEmailExists(input: components['schemas']['EmailInput'], scope: PilotRequestScope) {
        return this.read(await this.client.POST('/auth/guest-email-exists', {params: {header: this.headers(scope)}, body: input, cache: 'no-store'}), validateGuestEmailExists, scope).data;
    }
    async guestEntry(listId: string, scope: PilotRequestScope, signal?: AbortSignal) {
        return this.allowedRead('packing/' + listId + '/guest', scope, async () => this.read(await this.client.GET('/packing-lists/{listId}/guest', {
            params: {path: {listId}, header: this.headers(scope)}, signal, cache: 'no-store',
        }), validateGuestEntry, scope).data);
    }
    async registerGuest(listId: string, input: components['schemas']['GuestRegistrationInput'], scope: PilotRequestScope) {
        return this.identity(await this.client.POST('/packing-lists/{listId}/guest', {
            params: {path: {listId}, header: this.headers(scope)}, body: input, cache: 'no-store',
        }), scope);
    }

    async overview(query: NonNullable<paths['/packing-lists/overview']['get']['parameters']['query']>, scope: PilotRequestScope, signal?: AbortSignal) {
        return this.allowedRead('packing/overview/' + JSON.stringify(query), scope, async () => this.read(await this.client.GET('/packing-lists/overview', {
            params: {query, header: this.headers(scope)}, signal, cache: 'no-store',
        }), validatePackingOverviewRegion, scope).data);
    }
    async visibility(type: components['schemas']['PackingOverviewCard']['type'], entityId: string, visibility: components['schemas']['PackingVisibilityInput']['visibility'], scope: PilotRequestScope) {
        return this.read(await this.client.PUT('/packing-lists/overview/{entityType}/{entityId}/visibility', {
            params: {path: {entityType: type, entityId}, header: this.headers(scope)}, body: {visibility}, cache: 'no-store',
        }), validatePackingVisibilityResult, scope).data;
    }
}
