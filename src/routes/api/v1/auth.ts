import {Router, type Request, type Response} from 'express';
import * as userController from '../../../controller/userController';
import {readPackingGuestEntry} from '../../../controller/packingController';
import {readDriversGuestEntry} from '../../../controller/driversController';
import {readSurveyGuestEntry} from '../../../controller/surveyController';
import {readEventGuestEntry} from '../../../controller/eventController';
import {ApiProblem} from '../../../modules/api/problem';
import {committedSessionView, prepareAccountRegistrationReplies, prepareGuestIdentityReplies, prepareIdentityReply, requireApiContext} from '../../../modules/api/session';
import {prepareValidatedJson, sendPreparedJson, sendValidatedJson, validateOperationRequest} from '../../../modules/api/transport';
import {asyncHandler} from '../../../modules/lib/asyncHandler';
import settings from '../../../modules/settings';
import type {ApiOperationId, PreparedApiJsonResponse} from '../../../types/ApiTransportTypes';
import type {RegistrationEmailDelivery} from '../../../types/IdentityTypes';
import type {components} from '../../../types/api/v1';

const router = Router();

/** Warm Vue entry shares native account/guest admission without executing a command. */
router.get('/profiles/workflow-entry', asyncHandler(async function getProfileWorkflowEntry(req, res) {
    await admit(req, res, 'getProfileWorkflowEntry');
    sendValidatedJson(req, res, 'getProfileWorkflowEntry', 200,
        userController.getProfileWorkflowEntry(req.apiActor!, req.query.kind as 'token' | 'entry' | 'deactivate' | 'delete-account', req.query.returnTo));
}));

/** Explicit issuance is a non-replayed command; no query refresh calls this owner. */
router.post('/profiles/migration/token', asyncHandler(async function requestProfileMigrationToken(req, res) {
    await admit(req, res, 'requestProfileMigrationToken');
    const result = await userController.requestProfileMigrationToken(req.apiActor!);
    sendValidatedJson(req, res, 'requestProfileMigrationToken', 200, result);
}));

/** Retain the native transfer operation and return only its own scalar completion evidence. */
router.post('/profiles/migration/execute', asyncHandler(async function executeIdentityProfileMigration(req, res) {
    await admit(req, res, 'executeIdentityProfileMigration');
    const result = await userController.executeIdentityProfileMigration(req, req.body.token);
    sendPreparedJson(req, res, prepareValidatedJson(req, 'executeIdentityProfileMigration', 200, result, result.resultingContext));
}));

/** A late native selection failure remains uncertain after an entered deactivation. */
router.post('/profiles/current/deactivate', asyncHandler(async function deactivateIdentityProfile(req, res) {
    await admit(req, res, 'deactivateIdentityProfile');
    const result = await userController.deactivateIdentityProfile(req, req.body);
    sendPreparedJson(req, res, prepareValidatedJson(req, 'deactivateIdentityProfile', 200, result, result.resultingContext));
}));

/** Account deletion keeps provider handoff distinct from ordinary in-application navigation. */
router.delete('/account', asyncHandler(async function deleteIdentityAccount(req, res) {
    await admit(req, res, 'deleteIdentityAccount');
    const result = await userController.deleteIdentityAccount(req, req.body);
    sendPreparedJson(req, res, prepareValidatedJson(req, 'deleteIdentityAccount', 200, result, result.resultingContext));
}));

function requireLocalLogin(): void {
    if (!settings.value.localLoginEnabled) throw new ApiProblem('LOCAL_LOGIN_DISABLED');
}

/** Every command is admitted against the old context before any controller changes identity. */
async function admit(req: Request, res: Response, operation: ApiOperationId): Promise<void> {
    await requireApiContext(req, res);
    validateOperationRequest(req, operation);
}

/** Reply from the completed transition's own evidence, without reloading a later tab's actor. */
async function sendIdentity(req: Request, res: Response, operation: 'logoutIdentity',
    personalLink: string | null = null, redirect: string | null = null): Promise<void> {
    // Provider logout currently persists its authoritative transition before its
    // receipt. A later store read belongs to another actor and cannot replace it.
    const session = committedSessionView(req);
    const result: components['schemas']['IdentityResult'] = {session, personalLink, redirect};
    req.apiActor = {context: session.context, auth: req.session.auth, profile: req.session.profile};
    sendValidatedJson(req, res, operation, 200, result);
}

/** Confirm validated account login only after its prepared public receipt and stored identity commit together. */
router.post('/auth/login', asyncHandler(async function loginIdentity(req, res) {
    await admit(req, res, 'loginIdentity');
    requireLocalLogin();
    // Credential validation and result preparation finish before the locked
    // identity write. Adopt only its committed detached receipt for delivery.
    function prepareLoginReply(staged: Request['session']) {
        return prepareIdentityReply(req, staged, 'loginIdentity');
    }
    const committed = await userController.loginUserWithSession(req.body, req,
        {frontend: true, next: req.body.next, context: req.apiActor!.context, prepareResult: prepareLoginReply});
    req.session = committed.session;
    sendPreparedJson(req, res, committed.result);
}));

/** Ordinary logout prepares its anonymous receipt before commit; provider sessions retain their existing owner. */
router.post('/auth/logout', asyncHandler(async function logoutIdentity(req, res) {
    await admit(req, res, 'logoutIdentity');
    // Classification follows the existing logout owner, including truthy empty
    // token objects. Account/guest kind never selects a provider workflow.
    if (!req.session.tokens) {
        /** Validate and serialize anonymous confirmation before clearing stored authority becomes final. */
        function prepareLogoutReply(staged: Request['session']) {
            return prepareIdentityReply(req, staged, 'logoutIdentity');
        }
        const committed = await userController.logoutUserWithSession(req,
            {context: req.apiActor!.context, prepareResult: prepareLogoutReply});
        req.session = committed.session;
        sendPreparedJson(req, res, committed.result);
        return;
    }

    // Provider preparation/failure and its completed receipt keep their existing
    // ordering until the separate behavior decision is resolved.
    const redirect = await userController.logoutUserOidc(req.session);
    // Local logout completes in the SPA. Only the provider's authoritative end-session URL
    // requires a full navigation; oidc.logout otherwise returns the application's own root.
    await sendIdentity(req, res, 'logoutIdentity', null, redirect === settings.value.rootUrl ? null : redirect);
}));

router.post('/auth/register', asyncHandler(async function registerAccount(req, res) {
    await admit(req, res, 'registerAccount');
    requireLocalLogin();

    /** Bind the request's transport metadata to precommit signup confirmation only. */
    function prepareSignupReply() {
        return prepareAccountRegistrationReplies(req);
    }
    const committed = await userController.registerUserWithSession(req.body, req,
        {frontend: true, next: req.body.next, context: req.apiActor!.context, prepareResult: prepareSignupReply});

    // Signup does not log in or mutate the active session. Its prevalidated
    // receipt excludes tokens and cannot reload/reject another tab's identity.
    sendPreparedJson(req, res, committed.result);
}));

router.post('/auth/forgot-password', asyncHandler(async function requestPasswordReset(req, res) {
    await admit(req, res, 'requestPasswordReset');
    requireLocalLogin();
    /** Prepare identical generic confirmation for known and unknown account requests. */
    function prepareRecoveryReply() {
        return prepareValidatedJson(req, 'requestPasswordReset', 200, {changed: true});
    }
    const committed = await userController.requestPasswordResetWithSession(req.body.username, req,
        {frontend: true, next: req.body.next, context: req.apiActor!.context, prepareResult: prepareRecoveryReply});
    sendPreparedJson(req, res, committed.result);
}));

router.get('/auth/reset-password', asyncHandler(async function checkPasswordReset(req, res) {
    await admit(req, res, 'checkPasswordReset');
    requireLocalLogin();
    // The native reset GET admits the form only after this same controller check. This
    // read neither consumes the token nor guarantees it will still be valid at submission.
    await userController.checkPasswordForgotToken(String(req.query.token));
    sendValidatedJson(req, res, 'checkPasswordReset', 200, {valid: true});
}));

router.post('/auth/reset-password', asyncHandler(async function resetAccountPassword(req, res) {
    await admit(req, res, 'resetAccountPassword');
    requireLocalLogin();
    /** Prepare confirmation before password/token consumption becomes final. */
    function prepareResetReply() {
        return prepareValidatedJson(req, 'resetAccountPassword', 200, {changed: true});
    }
    const committed = await userController.resetPasswordWithSession(req.body.token, req.body, req,
        {context: req.apiActor!.context, prepareResult: prepareResetReply});
    // Reset does not change the active actor or need unchanged Session JSON.
    sendPreparedJson(req, res, committed.result);
}));

router.post('/auth/activate', asyncHandler(async function activateIdentity(req, res) {
    await admit(req, res, 'activateIdentity');
    requireLocalLogin();
    /** Validate and serialize completion before consuming this one-time token. */
    function prepareActivationReply() {
        return prepareValidatedJson(req, 'activateIdentity', 200, {changed: true});
    }
    const committed = await userController.activateAccountWithSession(req.body.token, req,
        {context: req.apiActor!.context, prepareResult: prepareActivationReply});

    // Activation preserves the actor and needs no session JSON write/adoption.
    // Only its prepared receipt is delivered after token consumption commits.
    sendPreparedJson(req, res, committed.result);
}));

/** Bind guest-token login to the admitted context and deliver its prevalidated identity receipt after commit. */
router.post('/auth/guest-login', asyncHandler(async function loginGuestIdentity(req, res) {
    await admit(req, res, 'loginGuestIdentity');
    // Reuse token admission on the locked connection; output failure cannot
    // rotate the original request or leak authority into Express autosave.
    function prepareGuestLoginReply(staged: Request['session']) {
        return prepareIdentityReply(req, staged, 'loginGuestIdentity');
    }
    const committed = await userController.loginGuestWithSession(req.body.guestId, req.body.token, req,
        {context: req.apiActor!.context, prepareResult: prepareGuestLoginReply});
    req.session = committed.session;
    sendPreparedJson(req, res, committed.result);
}));

router.post('/auth/guest-recovery', asyncHandler(async function recoverGuestIdentity(req, res) {
    await admit(req, res, 'recoverGuestIdentity');
    await userController.recoverGuestAccount(req.body.email.trim().toLowerCase(), {frontend: true, next: req.body.next});
    sendValidatedJson(req, res, 'recoverGuestIdentity', 200, {changed: true});
}));

router.post('/auth/guest-email-exists', asyncHandler(async function findGuestEmail(req, res) {
    await admit(req, res, 'findGuestEmail');
    sendValidatedJson(req, res, 'findGuestEmail', 200, {exists: await userController.hasGuestAccountForEmail(req.body.email.trim().toLowerCase())});
}));

/** Shared profile ownership rules and prepared presentation complete before the stored actor rotates. */
router.put('/auth/profile', asyncHandler(async function switchIdentityProfile(req, res) {
    await admit(req, res, 'switchIdentityProfile');
    // Profile ownership, public projection and the stored rotation share one
    // completion; there is no postcommit mutable-actor read or second save.
    function prepareProfileReply(staged: Request['session']) {
        return prepareIdentityReply(req, staged, 'switchIdentityProfile');
    }
    const committed = await userController.changeActiveProfileWithSession(req.body.profileId, req,
        {context: req.apiActor!.context, prepareResult: prepareProfileReply});
    req.session = committed.session;
    sendPreparedJson(req, res, committed.result);
}));

/** Account-only navigation redirects a valid guest without treating it as lost identity. */
router.get('/profiles/entry', asyncHandler(async function getProfileAdministrationEntry(req, res) {
    await admit(req, res, 'getProfileAdministrationEntry');
    const view = req.query.view as 'edit' | 'manage' | 'create';
    sendValidatedJson(req, res, 'getProfileAdministrationEntry', 200,
        userController.getProfileAdministrationEntry(req.apiActor!, view, req.query.returnTo));
}));

/** Resolve an explicit private capability preview without changing the admitted identity or profile. */
router.post('/profiles/migration/preview', asyncHandler(async function previewIdentityProfileMigration(req, res) {
    await admit(req, res, 'previewIdentityProfileMigration');
    // Pure preview uses its generated read projection. The separate explicit JSON
    // execution command retains the existing shared transfer and cleanup sequence.
    sendValidatedJson(req, res, 'previewIdentityProfileMigration', 200,
        await userController.getProfileMigrationPreview(req.apiActor!, req.body.token));
}));

/** Read settings through the business owner's current profile ownership check. */
router.get('/profiles/current', asyncHandler(async function getIdentityProfile(req, res) {
    await admit(req, res, 'getIdentityProfile');
    sendValidatedJson(req, res, 'getIdentityProfile', 200, await userController.getIdentityProfile(req.apiActor!));
}));

/** Only full accounts have a managed roster; guest editing remains a separate current-profile view. */
router.get('/profiles', asyncHandler(async function getIdentityProfiles(req, res) {
    await admit(req, res, 'getIdentityProfiles');
    sendValidatedJson(req, res, 'getIdentityProfiles', 200, await userController.getIdentityProfiles(req.apiActor!));
}));

/** Adapt native field editing without changing its persistence or session-save boundary. */
router.patch('/profiles/current', asyncHandler(async function updateIdentityProfile(req, res) {
    await admit(req, res, 'updateIdentityProfile');
    // Admission captures current ownership. Profile selection remains server-owned;
    // no submitted ID or later mutable-context read can change the acting profile.
    if (!req.apiActor!.profile) throw new ApiProblem('AUTH_REQUIRED');
    const reply = prepareValidatedJson(req, 'updateIdentityProfile', 200, {changed: true});
    await userController.updateProfile(req.body, req.session);
    // Only delivery follows the unchanged shared operation. The client refreshes
    // display data separately after this simple acknowledgement is confirmed.
    sendPreparedJson(req, res, reply);
}));

/** Add a profile through the existing account operation without selecting it. */
router.post('/profiles', asyncHandler(async function createIdentityProfile(req, res) {
    await admit(req, res, 'createIdentityProfile');
    // Mirror native account admission using the captured actor. Neither the
    // request body nor response preparation introduces another business owner.
    const user = req.apiActor!.auth?.user;
    if (!user) throw new ApiProblem(req.apiActor!.auth?.guest ? 'FORBIDDEN' : 'AUTH_REQUIRED');
    const reply = prepareValidatedJson(req, 'createIdentityProfile', 200, {changed: true});
    await userController.createProfile(req.body, user.id);
    sendPreparedJson(req, res, reply);
}));

router.get('/packing-lists/:listId/guest', asyncHandler(async function getPackingGuestEntry(req, res) {
    await admit(req, res, 'getPackingGuestEntry');
    sendValidatedJson(req, res, 'getPackingGuestEntry', 200, await readPackingGuestEntry(String(req.params.listId)));
}));

router.post('/packing-lists/:listId/guest', asyncHandler(async function registerPackingGuest(req, res) {
    await admit(req, res, 'registerPackingGuest');
    const list = await readPackingGuestEntry(String(req.params.listId));
    await registerGuestForEntry(req, res, `/frontend-pilot/packing/${list.id}`, 'registerPackingGuest');

}));

router.get('/drivers-lists/:listId/guest', asyncHandler(async function getDriversGuestEntry(req, res) {
    await admit(req, res, 'getDriversGuestEntry');
    sendValidatedJson(req, res, 'getDriversGuestEntry', 200, await readDriversGuestEntry(String(req.params.listId)));
}));

router.post('/drivers-lists/:listId/guest', asyncHandler(async function registerDriversGuest(req, res) {
    await admit(req, res, 'registerDriversGuest');
    const list = await readDriversGuestEntry(String(req.params.listId));
    await registerGuestForEntry(req, res, `/frontend-pilot/drivers/${list.id}`, 'registerDriversGuest');

}));

router.get('/surveys/:surveyId/guest', asyncHandler(async function getSurveyGuestEntry(req, res) {
    await admit(req, res, 'getSurveyGuestEntry');
    sendValidatedJson(req, res, 'getSurveyGuestEntry', 200, await readSurveyGuestEntry(String(req.params.surveyId)));
}));

/** Survey entry adopts the existing guest identity completion without adding
 * event membership or a second session/registration owner. */
router.post('/surveys/:surveyId/guest', asyncHandler(async function registerSurveyGuest(req, res) {
    await admit(req, res, 'registerSurveyGuest');
    const survey = await readSurveyGuestEntry(String(req.params.surveyId));
    await registerGuestForEntry(req, res, `/frontend-pilot/survey/${survey.id}`, 'registerSurveyGuest');
}));

router.get('/events/:eventId/guest', asyncHandler(async function getEventGuestEntry(req, res) {
    await admit(req, res, 'getEventGuestEntry');
    sendValidatedJson(req, res, 'getEventGuestEntry', 200, await readEventGuestEntry(String(req.params.eventId)));
}));

router.post('/events/:eventId/guest', asyncHandler(async function registerEventGuest(req, res) {
    await admit(req, res, 'registerEventGuest');
    const event = await readEventGuestEntry(String(req.params.eventId));
    // The opaque registration token remains only a return destination until a
    // later explicit attendance submission; guest creation never consumes it.
    const token = typeof req.query.regToken === 'string' ? `?${new URLSearchParams({regToken: req.query.regToken})}` : '';
    await registerGuestForEntry(req, res, `/frontend-pilot/event/${event.id}${token}`, 'registerEventGuest');
}));

/**
 * Share identity registration completion across actual feature guest consumers.
 * Each caller already validated its operation and resolved its public entry;
 * this owner prepares delivery outcomes and adopts only the committed Session.
 */
async function registerGuestForEntry(req: Request, res: Response, next: string,
    operation: 'registerPackingGuest' | 'registerEventGuest' | 'registerDriversGuest' | 'registerSurveyGuest'): Promise<void> {
    const body = req.body as components['schemas']['GuestRegistrationInput'];
    /** Prepare both SMTP outcomes before identity/session persistence commits. */
    function prepareGuestReply(staged: Request['session'], personalLink: string): Record<RegistrationEmailDelivery, PreparedApiJsonResponse> {
        return prepareGuestIdentityReplies(req, staged, personalLink, operation);
    }
    // The existing controller owns guest identity, durable context and delivery.
    const committed = await userController.registerGuestWithSession(body.username, body.email ?? undefined, req,
        {frontend: true, next, context: req.apiActor!.context, prepareResult: prepareGuestReply});
    req.session = committed.session;
    sendPreparedJson(req, res, committed.result);
}

export default router;
