import {Router, type Request, type Response} from 'express';
import * as userController from '../../../controller/userController';
import * as packingService from '../../../modules/database/services/PackingService';
import {ApiProblem} from '../../../modules/api/problem';
import {identityTransitionGuard, requireApiContext, sessionView} from '../../../modules/api/session';
import {sendValidatedJson, validateOperationRequest} from '../../../modules/api/transport';
import {asyncHandler} from '../../../modules/lib/asyncHandler';
import settings from '../../../modules/settings';
import type {ApiOperationId} from '../../../types/ApiTransportTypes';
import type {components} from '../../../types/api/v1';

const router = Router();

function requireLocalLogin(): void {
    if (!settings.value.localLoginEnabled) throw new ApiProblem('LOCAL_LOGIN_DISABLED');
}

/** Every command is admitted against the old context before any controller changes identity. */
async function admit(req: Request, res: Response, operation: ApiOperationId): Promise<void> {
    await requireApiContext(req, res);
    validateOperationRequest(req, operation);
}

/** Rehydrate after the controller persisted the transition; bind the reply to its NEW context. */
async function sendIdentity(req: Request, res: Response, operation: 'loginIdentity' | 'logoutIdentity'
    | 'loginGuestIdentity' | 'switchIdentityProfile' | 'registerPackingGuest',
    personalLink: string | null = null, redirect: string | null = null): Promise<void> {
    const committedContext = req.session.frontendContext;
    req.apiActor = undefined;
    const session = await sessionView(req);
    // An intervening tab may already have replaced the just-written identity. Never attach
    // its session projection to a private guest link belonging to this command's actor.
    if (session.context !== committedContext) throw new ApiProblem('SESSION_CONTEXT_CHANGED');
    const result: components['schemas']['IdentityResult'] = {session, personalLink, redirect};
    sendValidatedJson(req, res, operation, 200, result);
}

router.post('/auth/login', asyncHandler(async function loginIdentity(req, res) {
    await admit(req, res, 'loginIdentity');
    requireLocalLogin();
    await userController.loginUser(req.body, req.session, {frontend: true, next: req.body.next, beforeTransition: identityTransitionGuard(req)});
    await sendIdentity(req, res, 'loginIdentity');
}));

router.post('/auth/logout', asyncHandler(async function logoutIdentity(req, res) {
    await admit(req, res, 'logoutIdentity');
    const redirect = await userController.logoutUserOidc(req.session);
    // Local logout completes in the SPA. Only the provider's authoritative end-session URL
    // requires a full navigation; oidc.logout otherwise returns the application's own root.
    await sendIdentity(req, res, 'logoutIdentity', null, redirect === settings.value.rootUrl ? null : redirect);
}));

router.post('/auth/register', asyncHandler(async function registerAccount(req, res) {
    await admit(req, res, 'registerAccount');
    requireLocalLogin();
    await userController.registerUser(req.body, undefined, {frontend: true, next: req.body.next});
    sendValidatedJson(req, res, 'registerAccount', 200, {changed: true});
}));

router.post('/auth/forgot-password', asyncHandler(async function requestPasswordReset(req, res) {
    await admit(req, res, 'requestPasswordReset');
    requireLocalLogin();
    await userController.sendPasswordForgotMail(req.body.username, {frontend: true, next: req.body.next});
    // Account discovery remains private: an unknown address has exactly the same response.
    sendValidatedJson(req, res, 'requestPasswordReset', 200, {changed: true});
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
    await userController.resetPassword(req.body.token, req.body);
    sendValidatedJson(req, res, 'resetAccountPassword', 200, {changed: true});
}));

router.post('/auth/activate', asyncHandler(async function activateIdentity(req, res) {
    await admit(req, res, 'activateIdentity');
    requireLocalLogin();
    await userController.activateAccount(req.body.token);
    sendValidatedJson(req, res, 'activateIdentity', 200, {changed: true});
}));

router.post('/auth/guest-login', asyncHandler(async function loginGuestIdentity(req, res) {
    await admit(req, res, 'loginGuestIdentity');
    await userController.loginGuest(req.body.guestId, req.body.token, req.session, {beforeTransition: identityTransitionGuard(req)});
    await sendIdentity(req, res, 'loginGuestIdentity');
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

router.put('/auth/profile', asyncHandler(async function switchIdentityProfile(req, res) {
    await admit(req, res, 'switchIdentityProfile');
    await userController.changeActiveProfile(req.session, req.body.profileId, identityTransitionGuard(req));
    await sendIdentity(req, res, 'switchIdentityProfile');
}));

async function packingGuestEntry(listId: string): Promise<components['schemas']['GuestEntry']> {
    const list = await packingService.getPackingListById(listId);
    if (!list) throw new ApiProblem('NOT_FOUND');
    // Native guest entry deliberately discloses this title before view admission. No items,
    // assignments, parent event or permissions are included in this public entry projection.
    return {id: list.id, title: list.title};
}

router.get('/packing-lists/:listId/guest', asyncHandler(async function getPackingGuestEntry(req, res) {
    await admit(req, res, 'getPackingGuestEntry');
    sendValidatedJson(req, res, 'getPackingGuestEntry', 200, await packingGuestEntry(String(req.params.listId)));
}));

router.post('/packing-lists/:listId/guest', asyncHandler(async function registerPackingGuest(req, res) {
    await admit(req, res, 'registerPackingGuest');
    const list = await packingGuestEntry(String(req.params.listId));
    const body = req.body as components['schemas']['GuestRegistrationInput'];
    const personalLink = await userController.registerGuest(body.username, body.email ?? undefined, req.session,
        {frontend: true, next: `/frontend-pilot/packing/${list.id}`, beforeTransition: identityTransitionGuard(req)});
    await sendIdentity(req, res, 'registerPackingGuest', personalLink);
}));

export default router;
