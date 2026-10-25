import {Router} from 'express';
import type {Request, Response} from 'express';
import eventController, {eventMethodPermission, readEventCreateEntry, readEventDuplicate,
    readEventResourceEntry, readEventHeaderPath} from '../controller/eventController';
import invoiceController, {readEventInvoiceProof} from '../controller/eventPoolController';
import {paramHandler} from '../middleware/paramHandler';
import {isLoggedIn, requirePermission} from '../middleware/permissionMiddleware';
import * as eventService from '../modules/database/services/EventService';
import {createParticipantsPdf} from '../modules/lib/pdf';
import {createInvoiceSharesPdf} from '../modules/invoice/exports';
import {getResource} from '../modules/lib/util';
import type {EntityDescriptor} from '../types/PermissionTypes';
import {asyncHandler} from '../modules/lib/asyncHandler';
import {captureApiActor} from '../modules/api/session';
import {handleApiProblem} from '../modules/api/problem';
import {renderFrontend} from '../modules/frontendRenderer';
import {bootstrap, applyPageEntry} from './frontend';
import {createHeaderHandler} from './outputs';

const router = Router();

// Export parameters have their own loader; page and header reads retain their
// controller-owned admission without an extra parent lookup.
paramHandler('id', router, eventService.getEventById, 'event');

router.get('/create', asyncHandler(renderCreation));
router.get('/:eventId/duplicate', asyncHandler(renderDuplicate));
for (const [path, view] of [['/:eventId', 'detail'], ['/:eventId/guest', 'guest'], ['/:eventId/admin', 'admin']] as const) {
    /** Detail, guest and administration retain their registered intent even
     * when Express accepts a different case or trailing-slash spelling. */
    router.get(path, asyncHandler(async function renderEvent(req, res) {
        const state = await bootstrap(req);
        // Controller admission remains independent for every view. Query
        // capabilities are forwarded unchanged and never select the view.
        const token = typeof req.query.regToken === 'string' ? req.query.regToken : undefined;
        const entry = await readEventResourceEntry(String(req.params.eventId), view, await captureApiActor(req), token);
        state.eventEntry = entry;
        if (await applyPageEntry(req, res, state, entry.entry)) return;
        await renderFrontend(res, req.originalUrl, state);
    }));
}

/** Existing account-only creation carries its exact return URL through login. */
async function renderCreation(req: Request, res: Response): Promise<void> {
    const state = await bootstrap(req);
    const form = readEventCreateEntry(await captureApiActor(req), req.originalUrl);
    if (await applyPageEntry(req, res, state, form.entry)) return;
    if (form.context) state.eventCreateContext = form.context;
    await renderFrontend(res, req.originalUrl, state);
}

/** Duplication reads only source form values under its independent grant. */
async function renderDuplicate(req: Request, res: Response): Promise<void> {
    const state = await bootstrap(req);
    state.eventDuplicate = await readEventDuplicate(String(req.params.eventId), await captureApiActor(req));
    state.pageEntry = {kind: 'render'};
    await renderFrontend(res, req.originalUrl, state);
}

router.get('/:headerId/header', createHeaderHandler(readEventHeaderPath));

/** Open saved proofs as ordinary document links. The controller owns current
 * actor, pool and invoice admission before resolving the confined stored file. */
router.get('/:eventId/invoice-pools/:poolId/invoices/:invoiceId/proof',
    asyncHandler(async function downloadInvoiceProof(req, res) {
        const actor = await captureApiActor(req);
        const file = await readEventInvoiceProof(String(req.params.eventId), String(req.params.poolId), String(req.params.invoiceId), actor);
        // Proof contents remain private and are never retained by shared caches.
        res.set('Cache-Control', 'private, no-store').sendFile(file);
    }), handleApiProblem);

// Event outputs retain document guest admission before their method grants.
router.use('/:id/export', function admitEventOutput(req, res, next) {
    if (req.session.profile) return next();
    res.redirect(`/event/${encodeURIComponent(String(req.params.id))}/guest`);
});

/** Resolve output permission from the same loaded resource as the original
 * document adapter. Permission middleware remains the grant owner. */
function eventPermission(req: Request): EntityDescriptor {
    const resource = getResource(req, 'event');
    return {entityType: 'event', entityId: resource.id, ownerId: resource.ownerId, eventId: resource.id};
}

router.get('/:id/export/participants', requirePermission(eventPermission, eventMethodPermission('exportParticipants')),
    asyncHandler(async function exportParticipants(req, res) {
        // Read the existing projection; exporting never changes registrations.
        const data = await eventController.getParticipantsExtended(getResource(req, 'event'));
        res.contentType('application/pdf').send(await createParticipantsPdf(data).getBuffer());
    }));

router.get('/:id/export/invoice-pools/:poolId/shares', isLoggedIn,
    requirePermission(eventPermission, eventMethodPermission('manageAssignments')),
    asyncHandler(async function exportInvoiceShares(req, res) {
        // Reuse the complete saved ledger regardless of browser display filters.
        const data = await invoiceController.getInvoiceSharesPdfData(getResource(req, 'event'), String(req.params.poolId), req.query);
        const pdf = createInvoiceSharesPdf(data, data.pdfOptions);
        res.set('Cache-Control', 'no-store').attachment(`invoice-pool-${data.pool.id}-shares.pdf`);
        res.send(await pdf.getBuffer());
    }));

export default router;
