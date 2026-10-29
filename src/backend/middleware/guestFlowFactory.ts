import {Router, type Request} from 'express';
import {getAccountPageEntry, registerGuestWithSession} from '../controller/userController';
import {safeFrontendReturn} from '../../common/lib/frontendIdentity';
import {captureApiActor, prepareGuestIdentityReplies, requireApiContext} from '../modules/api/session';
import {ApiProblem} from '../modules/api/problem';
import {decodeApiMultipartData, executePreparedJson, prepareValidatedJson, receiveApiUpload, sendPreparedJson,
    sendStoredApiBinary, sendValidatedJson, validateOperationRequest} from '../modules/api/transport';
import {asyncHandler} from '../modules/lib/asyncHandler';
import {prepareFileUploader, removeImage} from '../modules/lib/fileCommons';
import {getResource} from '../modules/lib/util';
import settings from '../modules/settings';
import {renderFrontend} from '../modules/frontendRenderer';
import {applyPageEntry, bootstrap} from './frontendDocuments';
import {createHeaderHandler} from './entityHeaderDownloadHandler';
import {paramHandler} from './paramHandler';
import {getIdentityAdmission} from './identityAdmission';
import type {ApiOperationId, ApiResponseBody, ApiSuccessStatus, PreparedApiJsonResponse} from '../../types/ApiTransportTypes';
import type {RegistrationEmailDelivery} from '../../types/IdentityTypes';
import type {GuestFlow, GuestFlowConfig, GuestFlowCreateEntry, GuestFlowResponse,
    GuestFlowResourceEntry, GuestFlowSchemas} from '../../types/GuestFlowTypes';
import type {SessionLike} from '../../types/PermissionTypes';
import type {EntityBase} from '../../types/UserTypes';
import type {EntityType} from '../../types/UtilTypes';
import type {components} from '../../types/api/v1';

/** Bind one generated operation to its exact result type for shared HTTP delivery. */
export function guestFlowResponse<Operation extends ApiOperationId, Status extends ApiSuccessStatus<NoInfer<Operation>>>(
    operation: Operation, status: Status): GuestFlowResponse<ApiResponseBody<Operation, Status>> {
    return {
        operation,
        prepare(request, result) { return prepareValidatedJson(request, operation, status, result); },
        send(request, response, result, etag) { sendValidatedJson(request, response, operation, status, result, etag); },
    };
}

/**
 * Bind shared creation/guest/detail entry to one feature's existing reads and authority.
 * This flow creates no identities, writes no rows and changes no transaction boundary;
 * document delivery and client navigation consume exactly the same page composition.
 */
export function createGuestFlow<Type extends EntityType, Root extends EntityBase>(
    config: GuestFlowConfig<Type, Root>): GuestFlow<Type, Root> {
    /** Account-only entry admits the exact requested return before reading Event labels. */
    async function readCreateEntry(actor: SessionLike, returnTo?: unknown,
        eventId?: unknown): Promise<GuestFlowCreateEntry<GuestFlowSchemas[Type]['context']>> {
        const target = safeFrontendReturn(returnTo ?? `/${config.entityType}/create`);
        const entry = getAccountPageEntry(actor, '/users/login', target);
        // Forbidden/absent contextual Events never become a disclosed form selection.
        const selected = entry.kind === 'render' && config.selectEvent ? await config.selectEvent(eventId, actor) : null;
        return {entry, context: entry.kind === 'render' ? config.formContext() : null,
            ...(config.selectEvent && eventId !== undefined
                ? {selectedEvent: selected ? {...selected, description: selected.description ?? null} : null} : {})};
    }

    /** Guest commands expose only the existing public identity and retain their ordinary read. */
    async function readGuestEntry(id: string): Promise<components['schemas']['GuestEntry']> {
        const root = await config.loadRoot(id);
        if (!root) throw new ApiProblem('NOT_FOUND');
        return {id: root.id, title: root.title};
    }

    /**
     * Preserve existence, public guest entry and protected page admission in that order.
     * Each feature retains its existing snapshot and controller authority; navigation
     * tokens are carried as opaque values and never consumed by a read.
     */
    async function readResourceEntry(id: string, view: 'detail' | 'guest' | 'admin', actor: SessionLike,
        regToken?: string): Promise<GuestFlowResourceEntry> {
        return config.withRoot(id, /** Project entry admission without exposing a
         * missing root. Guest entry precedes linked-event policy; ordinary and
         * administration views retain their independent feature checks. */
            async function readEntry(root, manager): Promise<GuestFlowResourceEntry> {
                // Missing roots do not reveal an owner, title, settings or related rows.
                if (!root) return {entry: {kind: 'denied', status: 404, messageKey: `${config.entityType}.notFound`}, guest: null};
                const resourceId = config.detailAddress === 'stored' ? root.id : id;
                const url = `/${config.entityType}/${encodeURIComponent(resourceId)}`;
                const query = config.entityType === 'event' && regToken ? `?${new URLSearchParams({regToken})}` : '';

                // Guest entry intentionally precedes linked-event admission. A current
                // profile returns to detail without registering or consuming a token.
                if (view === 'guest') {
                    return actor.profile ? {entry: {kind: 'redirect', url: `${url}${query}`, notice: null}, guest: null}
                        : {entry: {kind: 'render'}, guest: {id: config.guestAddress === 'stored' ? root.id : id, title: root.title}};
                }

                const admission = await config.pageAdmission(root, actor, manager);
                if (admission === 'guest') return {entry: {kind: 'redirect', url: `${url}/guest${query}`, notice: null}, guest: null};
                if (admission === 'event-registration-required') {
                    return {entry: {kind: 'denied', status: 400, messageKey: `${config.entityType}.eventRegistrationRequired`}, guest: null};
                }
                // Event administration retains its separate controller method grant.
                if (view === 'admin' && config.adminAdmission && !await config.adminAdmission(root, actor, manager)) {
                    return {entry: {kind: 'denied', status: 403, messageKey: 'api:errors.FORBIDDEN'}, guest: null};
                }
                return {entry: {kind: 'render'}, guest: null};
            });
    }

    return {config, readCreateEntry, readResourceEntry, readGuestEntry};
}

/**
 * Create the common document route surface for one configured entity. Feature
 * routers append only their own outputs/extensions; Vue remains the renderer.
 */
export function createGuestFlowRouter<Type extends EntityType, Root extends EntityBase>(flow: GuestFlow<Type, Root>): Router {
    const {config} = flow;
    const router = Router();
    if (config.document.preload) paramHandler(config.parameter, router, config.loadRoot, config.entityType);

    /** Packing retains its preloaded canonical ID; other documents retain requested addressing. */
    function documentResourceId(request: Request): string {
        return config.document.preload ? getResource(request, config.entityType).id : String(request.params[config.parameter]);
    }

    /** Admit the account before seeding feature form data in the shared Vue document. */
    router.get('/create', asyncHandler(async function renderCreation(request, response) {
        // Bootstrap owns locale/feedback; the flow owns login/context composition.
        const state = await bootstrap(request);
        const form = await flow.readCreateEntry(await captureApiActor(request), request.originalUrl, request.query.eventId);
        if (await applyPageEntry(request, response, state, form.entry)) return;
        config.document.seedCreate(state, form);
        await renderFrontend(response, request.originalUrl, state);
    }));

    /** Render a controller-authorized copy without creating an entity or identity. */
    router.get(`/:${config.parameter}/duplicate`, asyncHandler(/** Seed the document
     * from the feature's duplication grant and error adapter, without applying
     * account-only creation admission to this read. */
        async function renderDuplicate(request, response) {
            const state = await bootstrap(request);
            try {
                // Duplication has its own controller grant; it never inherits detail
                // admission or the account-only creation POST requirement.
                const result = await config.duplicate(documentResourceId(request), await captureApiActor(request), request.query.eventId);
                config.document.seedDuplicate(state, result);
            } catch (error) {
                throw config.document.duplicateError ? config.document.duplicateError(error) : error;
            }
            if (config.document.duplicatePageEntry) state.pageEntry = {kind: 'render'};
            await renderFrontend(response, request.originalUrl, state);
        }));

    const views: Array<'detail' | 'guest' | 'admin'> = config.document.admin ? ['detail', 'guest', 'admin'] : ['detail', 'guest'];
    for (const view of views) {
        const suffix = view === 'detail' ? '' : `/${view}`;
        /** Registered intent survives Express's equivalent case/slash spellings. */
        router.get(`/:${config.parameter}${suffix}`, asyncHandler(async function renderResource(request, response) {
            const state = await bootstrap(request);
            const token = typeof request.query.regToken === 'string' ? request.query.regToken : undefined;
            const result = await flow.readResourceEntry(documentResourceId(request), view, await captureApiActor(request), token);
            // Event seeds its entry envelope; other entities seed only guest data.
            if (config.document.seedResource) config.document.seedResource(state, result);
            if (await applyPageEntry(request, response, state, result.entry)) return;
            if (!config.document.seedResource) state.guestEntry = result.guest ?? undefined;
            await renderFrontend(response, request.originalUrl, state);
        }));
    }

    return router;
}

/** Append shared header delivery after a domain's own document error adapter. */
export function createGuestFlowHeaderRouter<Type extends EntityType, Root extends EntityBase>(flow: GuestFlow<Type, Root>): Router {
    const router = Router();
    router.get('/:headerId/header', createHeaderHandler(flow.config.header));
    return router;
}

/**
 * Create the common versioned surface from the same flow as ordinary documents.
 * Generated operation names remain feature-specific; shared handlers own request
 * stages while controller hooks retain authority and their original commit order.
 */
export function createGuestFlowApiRouter<Type extends EntityType, Root extends EntityBase>(flow: GuestFlow<Type, Root>): Router {
    const {config} = flow;
    const router = Router();
    const operations = config.operations;
    const resourcePath = `/:${config.parameter}`;
    const upload = prepareFileUploader(settings.value.headerImgDir).single('image');

    /** Return the same account/form admission used by the document adapter. */
    router.get('/create-entry', asyncHandler(async function getCreateEntry(request, response) {
        // Context protection precedes generated query validation and public projection.
        const actor = await requireApiContext(request, response);
        validateOperationRequest(request, operations.createEntry.operation);
        operations.createEntry.send(request, response, await flow.readCreateEntry(actor, request.query.returnTo, request.query.eventId));
    }));

    /** Return only page admission and the intentionally public guest envelope. */
    router.get(`${resourcePath}/entry`, asyncHandler(async function getResourceEntry(request, response) {
        // Generated validation fixes intent and address before the shared snapshot read.
        const actor = await requireApiContext(request, response);
        validateOperationRequest(request, operations.resourceEntry.operation);
        const view = request.query.view as 'detail' | 'guest' | 'admin';
        operations.resourceEntry.send(request, response, await flow.readResourceEntry(String(request.params[config.parameter]), view, actor,
            typeof request.query.regToken === 'string' ? request.query.regToken : undefined));
    }));

    if (operations.createContext && config.readCreateContext) {
        const context = operations.createContext;
        const readContext = config.readCreateContext;
        /** Expose initial form definitions only to the existing account workflow. */
        router.get('/create-context', asyncHandler(async function getCreateContext(request, response) {
            // Preserve profile-first transport diagnostics before account business admission.
            const actor = await requireApiContext(request, response, true);
            validateOperationRequest(request, context.operation);
            context.send(request, response, readContext(actor));
        }));
    }

    if (operations.events && config.searchEvents) {
        const events = operations.events;
        const search = config.searchEvents;
        /** Delegate Event discovery to the feature's already authorized picker operation. */
        router.get('/events', asyncHandler(async function searchEvents(request, response) {
            // The existing operation validates scope/labels; the factory only delivers it.
            const actor = await requireApiContext(request, response, true);
            validateOperationRequest(request, events.operation);
            events.send(request, response, await search(request.query, actor));
        }));
    }

    /** Preserve each controller's real image ownership and receipt/commit lifecycle. */
    router.post('/', asyncHandler(/** Admit creation before allocating uploads,
     * validate the complete multipart contract, and retain each feature's image
     * ownership and receipt stage through success or uncertain completion. */
        async function createResource(request, response) {
            // Reject nonaccounts before multipart processing allocates a temporary file.
            const actor = await requireApiContext(request, response, true);
            config.requireCreation(actor);
            let imageOwned = false;
            try {
                // Identity admission precedes disk writes. The generated operation
                // validates the entire multipart data object before domain parsing.
                await receiveApiUpload(request, response, upload);
                validateOperationRequest(request, operations.create.operation, body => decodeApiMultipartData(body, request.file));
                if (config.creation.imageOwnership === 'controller-entry') imageOwned = true;
                const input = (request.body as {data: GuestFlowSchemas[Type]['input']}).data;
                function retainImage(): void { imageOwned = true; }
                const {operationResult: result, prepared} = await executePreparedJson(
                    (data: GuestFlowSchemas[Type]['created']) => operations.create.prepare(request, data),
                    prepare => config.create(input, request.file, actor, {prepare, retainImage}));
                imageOwned = true;
                if (config.creation.location) response.location(`${config.apiPath}/${encodeURIComponent(result.id)}`);
                // Drivers/Activity prepare under their existing controller boundary.
                // Other features retain their established after-success serialization.
                if (config.creation.receipt === 'controller') sendPreparedJson(request, response, prepared!);
                else operations.create.send(request, response, result);
            } finally {
                // A committed or uncertain image must survive an interrupted response
                // or a later inherited defaults failure. Never infer rollback from I/O.
                if (!imageOwned && request.file) removeImage(request.file.path);
            }
        }));

    /** Read protected detail through the feature controller before conditional delivery. */
    router.get(resourcePath, asyncHandler(async function getResource(request, response) {
        // The method owner admits private fields before an ETag can produce a 304.
        const actor = await requireApiContext(request, response, true);
        validateOperationRequest(request, operations.detail.operation);
        const result = await config.detail(String(request.params[config.parameter]), actor,
            request.query.view as 'detail' | 'admin' | undefined, request.query);
        operations.detail.send(request, response, result.data, result.etag);
    }));

    /** Keep Survey profile admission and independently granted copies distinct. */
    router.get(`${resourcePath}/duplicate`, asyncHandler(async function getDuplicate(request, response) {
        // This transport prerequisite does not replace the controller's copy grant.
        const actor = await requireApiContext(request, response, config.profiles.duplicate);
        validateOperationRequest(request, operations.duplicate.operation);
        operations.duplicate.send(request, response, await config.duplicate(String(request.params[config.parameter]), actor, request.query.eventId));
    }));

    /** Serve only a controller-admitted stored image through the confined binary adapter. */
    router.get(`${resourcePath}/header`, asyncHandler(async function getHeader(request, response) {
        // Event's public method transport remains distinct from other profile-only reads.
        const actor = await requireApiContext(request, response, config.profiles.header);
        validateOperationRequest(request, operations.header);
        const storedPath = await config.header(String(request.params[config.parameter]), actor);
        await sendStoredApiBinary(request, response, operations.header, 200, settings.value.headerImgDir, storedPath);
    }));

    /** Delete through existing ownership/transaction operations and deliver their original receipt. */
    router.delete(resourcePath, asyncHandler(/** Delegate permanent deletion after
     * its own profile/input admission, preserving the feature-selected receipt
     * preparation stage instead of treating archival as deletion authority. */
        async function deleteResource(request, response) {
            // Desired lifecycle state and permanent deletion remain different operations.
            const actor = await requireApiContext(request, response, config.deletion.profile);
            validateOperationRequest(request, operations.remove.operation);
            // Existing Activity deletion prepares invariant bytes before business
            // admission; Drivers/Survey retain their controller-owned preparation.
            const {operationResult: result, prepared} = await executePreparedJson(
                (data: components['schemas']['MutationResult']) => operations.remove.prepare(request, data),
                function removeResource(prepare) {
                    if (config.deletion.receipt === 'before-command') prepare({changed: true});
                    return config.remove(String(request.params[config.parameter]), actor, prepare);
                });
            if (config.deletion.receipt === 'after-success') operations.remove.send(request, response, result);
            else sendPreparedJson(request, response, prepared!);
        }));

    return router;
}

/**
 * Register actual guest endpoints for one feature through the identity owner.
 * This is shared route creation and completion, not five copied wrappers in auth.
 */
export function createGuestFlowGuestRouter<Type extends EntityType, Root extends EntityBase>(flow: GuestFlow<Type, Root>): Router {
    const {config} = flow;
    const router = Router();
    const route = `/:${config.parameter}/guest`;
    /** Expose the public registration title after generated address/context validation. */
    router.get(route, asyncHandler(async function getGuestEntry(request, response) {
        // This read neither authenticates a guest nor creates a stored Session.
        await requireApiContext(request, response);
        validateOperationRequest(request, config.operations.guest.operation);
        config.operations.guest.send(request, response, await flow.readGuestEntry(String(request.params[config.parameter])));
    }));

    /** Complete the same guest identity transaction for every configured feature. */
    router.post(route, asyncHandler(/** Validate old-context evidence before public
     * title lookup, preserve the admitted destination/capability, and deliver the
     * identity owner's committed session and preprepared SMTP outcome. */
        async function registerGuest(request, response) {
            // Validate old-context evidence and the declared command before public title lookup.
            await requireApiContext(request, response);
            const operation = config.operations.registerGuest;
            validateOperationRequest(request, operation);
            const entry = await flow.readGuestEntry(String(request.params[config.parameter]));
            const body = request.body as components['schemas']['GuestRegistrationInput'];
            // All five entry flows share one client budget. Optional recovery mail
            // reserves its independent budget before identity/token writes begin.
            await getIdentityAdmission().guestCreation(request, response);
            if (body.email) await getIdentityAdmission().mail(request, response, body.email);
            const token = config.entityType === 'event' && typeof request.query.regToken === 'string'
                ? `?${new URLSearchParams({regToken: request.query.regToken})}` : '';
            const next = `/${config.entityType}/${entry.id}${token}`;

            /** Capture both SMTP outcomes before the existing identity transaction commits. */
            function prepareGuestReply(staged: Request['session'], personalLink: string): Record<RegistrationEmailDelivery, PreparedApiJsonResponse> {
                return prepareGuestIdentityReplies(request, staged, personalLink, operation);
            }
            // Only the existing identity operation creates/adopts Session state.
            // Returning to an Event never consumes a registration capability here.
            const committed = await registerGuestWithSession(body.username, body.email ?? undefined, request,
                {frontend: true, next, context: request.apiActor!.context, prepareResult: prepareGuestReply});
            request.session = committed.session;
            sendPreparedJson(request, response, committed.result);
        }));
    return router;
}
