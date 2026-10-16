import {Router} from 'express';
import type {Request, Response} from 'express';
import path from 'node:path';
import type {components} from '../types/api/v1';
import type {FrontendEventDocumentHooks} from '../types/FrontendEventDocumentTypes';
import {asyncHandler} from '../modules/lib/asyncHandler';
import {captureApiActor, requireFrontendFormContext} from '../modules/api/session';
import {renderFrontendPilot} from '../modules/frontendPilotRenderer';
import {checkNewImage, prepareFileUploader, removeImage} from '../modules/lib/fileCommons';
import {ValidationError} from '../modules/lib/errors';
import settings from '../modules/settings';
import {PERM, toMaskFromBodyValue} from '../modules/lib/permissions';
import {createTranslator} from '../modules/localization/translator';
import eventController, {eventFormContext, readEventCreateEntry, readEventDuplicate,
    readEventResourceEntry, requireEventCreation} from '../controller/eventController';

/**
 * Keep Event document transport with its feature while the shared pilot router
 * supplies the ordinary request Session, shell and one-time feedback. Deliberate
 * creation preserves the native multi-step operation rather than promising an
 * atomic replacement or replaying it through a read.
 */
export function createEventPilotRouter(hooks: FrontendEventDocumentHooks): Router {
    const router = Router();
    const upload = prepareFileUploader(settings.value.headerImgDir).single('headerImg');
    router.get('/create', asyncHandler(renderCreation));
    router.get('/:eventId/duplicate', asyncHandler(renderDuplicate));
    router.post(['/create', '/:eventId/duplicate'], asyncHandler(async function admitCreation(req, res, next) {
        // Match native account admission before accepting upload bytes. Form
        // context proof remains independently checked after multipart decoding.
        const state = await hooks.bootstrap(req);
        const entry = readEventCreateEntry(await captureApiActor(req), req.originalUrl);
        if (await hooks.applyPageEntry(req, res, state, entry.entry)) return;
        next();
    }), upload, asyncHandler(submitCreation));
    router.get('/:eventId/register', function registerAlias(req, res) {
        const query = typeof req.query.regToken === 'string' ? `?${new URLSearchParams({regToken: req.query.regToken})}` : '';
        res.redirect(`/frontend-pilot/event/${encodeURIComponent(String(req.params.eventId))}${query}`);
    });
    router.get(['/:eventId', '/:eventId/guest', '/:eventId/admin'], asyncHandler(renderEvent));

    /** Native account-only creation carries its exact return URL through login. */
    async function renderCreation(req: Request, res: Response): Promise<void> {
        const state = await hooks.bootstrap(req);
        const form = readEventCreateEntry(await captureApiActor(req), req.originalUrl);
        if (await hooks.applyPageEntry(req, res, state, form.entry)) return;
        if (form.context) state.eventCreateContext = form.context;
        await renderFrontendPilot(res, req.originalUrl, state);
    }

    /** Duplication reads only source form values under its independent grant. */
    async function renderDuplicate(req: Request, res: Response): Promise<void> {
        const state = await hooks.bootstrap(req);
        state.eventDuplicate = await readEventDuplicate(String(req.params.eventId), await captureApiActor(req));
        state.pageEntry = {kind: 'render'};
        await renderFrontendPilot(res, req.originalUrl, state);
    }

    /** Detail, guest and administration have separate server-owned admission. */
    async function renderEvent(req: Request, res: Response): Promise<void> {
        const state = await hooks.bootstrap(req);
        const view = req.path.endsWith('/guest') ? 'guest' : req.path.endsWith('/admin') ? 'admin' : 'detail';
        const token = typeof req.query.regToken === 'string' ? req.query.regToken : undefined;
        const entry = await readEventResourceEntry(String(req.params.eventId), view, await captureApiActor(req), token);
        state.eventEntry = entry;
        if (await hooks.applyPageEntry(req, res, state, entry.entry)) return;
        await renderFrontendPilot(res, req.originalUrl, state);
    }

    /**
     * Reuse native validation, image assignment, Event creation and permission
     * initialization in that order. A late native failure keeps its existing
     * outcome; no adapter rollback, automatic replay or stronger guarantee is added.
     */
    async function submitCreation(req: Request, res: Response): Promise<void> {
        let retainImage = false;
        try {
            // Multipart parsing supplies proof fields; server admission reconstructs
            // the actor and rejects forged context before any domain operation.
            const actor = await requireFrontendFormContext(req, res);
            requireEventCreation(actor);
            checkNewImage(req.file);
            const fields = creationFields(req.body);
            let parsed: ReturnType<typeof eventController.preprocessCreate>;
            try {
                parsed = eventController.preprocessCreate(req.body);
            } catch (error) {
                if (!(error instanceof ValidationError)) throw error;
                const state = await hooks.bootstrap(req);
                state.pageEntry = {kind: 'render'};
                state.eventCreateContext = eventFormContext();
                state.eventCreationSubmission = {fields, error: error.message};
                res.status(500);
                await renderFrontendPilot(res, req.originalUrl, state);
                return;
            }

            // The native factory stores the uploaded relative path in its root
            // creation input, then invokes the existing permissions hook.
            const data = {...parsed, ...(req.file ? {headerImg: path.relative(process.cwd(), req.file.path)} : {}), _body: req.body};
            // Once the inherited creation owner starts, delivery uncertainty
            // cannot prove rollback. Never delete a potentially committed image.
            retainImage = true;
            let id: string;
            try {
                id = await eventController.createEntity(actor.profile!.id, data);
                await eventController.afterCreateItems(id, data);
            } catch {
                // Native failures redisplay the submitted form at 500. Keep
                // that boundary without exposing SQL or claiming no Event exists.
                const state = await hooks.bootstrap(req);
                state.pageEntry = {kind: 'render'};
                state.eventCreateContext = eventFormContext();
                state.eventCreationSubmission = {fields, error: createTranslator(state.session.locale).t('state.unknownOutcome')};
                res.status(500);
                await renderFrontendPilot(res, req.originalUrl, state);
                return;
            }
            // Feedback follows completion through the shared owner. Its delivery
            // cannot reject an already created Event or cause another submission.
            try {
                hooks.flashNotice(req, {kind: 'success', messageKey: 'event.created'});
                await hooks.persistFeedback(req);
            } catch {
                console.error('[frontend-pilot]', {code: 'WORKFLOW_FEEDBACK_UNAVAILABLE'});
            }
            res.redirect(`/frontend-pilot/event/${encodeURIComponent(id)}`);
        } finally {
            if (req.file && !retainImage) removeImage(req.file.path);
        }
    }

    return router;
}

/**
 * Redisplay submitted scalar values even when they fail business validation.
 * This projection carries no upload, hidden Session, or arbitrary body fields.
 */
function creationFields(body: Record<string, unknown>): components['schemas']['EventCreationFields'] {
    const text = (key: string): string => typeof body[key] === 'string' ? body[key] as string : '';
    const defaults = body.defaultPerms && typeof body.defaultPerms === 'object' ? body.defaultPerms as Record<string, unknown> : {};
    // The same named-key decoder owns native submission and validation redisplay.
    function mask(key: string): number {
        return toMaskFromBodyValue(defaults[key], PERM) ?? 0;
    }
    return {title: text('title'), startDate: text('startDate'), endDate: text('endDate'), description: text('description'),
        location: text('location'), bindingDeadline: text('bindingDeadline'), deadlineTz: text('deadlineTz'), maxParticipants: text('maxParticipants'),
        requireDietaryInfo: body.requireDietaryInfo === 'on', allowDietComment: body.allowDietComment === 'on',
        allowRegDateUpdatesAfterDeadline: body.allowRegDateUpdatesAfterDeadline === 'on',
        allowRegCancelationAfterDeadline: body.allowRegCancelationAfterDeadline === 'on',
        allowRegDietUpdateAfterDeadline: body.allowRegDietUpdateAfterDeadline === 'on',
        defaultPermissions: {public: mask('public'), guest: mask('guest'), authenticated: mask('authenticated'), participant: mask('participant')}};
}
