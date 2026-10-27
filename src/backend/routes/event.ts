
import {eventMethodPermission} from '../modules/permissionEngine';
import type {Request} from 'express';
import eventController from '../controller/eventController';
import invoiceController, {readEventInvoiceProof} from '../controller/eventPoolController';
import {paramHandler} from '../middleware/paramHandler';
import {isLoggedIn, requirePermission} from '../middleware/permissionMiddleware';
import * as eventService from '../modules/database/services/EventService';
import {createParticipantsPdf} from '../controller/eventController';
import {createInvoiceSharesPdf} from '../modules/invoice/exports';
import {getResource} from '../modules/lib/util';
import type {EntityDescriptor} from '../../types/PermissionTypes';
import {asyncHandler} from '../modules/lib/asyncHandler';
import {captureApiActor} from '../modules/api/session';
import {handleApiProblem} from '../modules/api/problem';
import {createGuestFlowHeaderRouter, createGuestFlowRouter} from '../middleware/guestFlowFactory';
import {eventFlow} from './eventFlow';

const router = createGuestFlowRouter(eventFlow);

// Export parameters have their own loader; page and header reads retain their
// controller-owned admission without an extra parent lookup.
paramHandler('id', router, eventService.getEventById, 'event');

router.use(createGuestFlowHeaderRouter(eventFlow));

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
router.use('/:id/export', asyncHandler(async function admitEventOutput(req, res, next) {
    // Use the same hydrated actor as the independent output grant middleware.
    if ((await captureApiActor(req)).profile) return next();
    res.redirect(`/event/${encodeURIComponent(String(req.params.id))}/guest`);
}));

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
