import {Router} from 'express';
import fs from 'node:fs/promises';
import invoiceController, {
    admitEventInvoiceSubmission, closeEventInvoice, readEventFinance, readEventFinanceBreakdown,
    readEventInvoiceProof, retractEventInvoice,
} from '../../../controller/eventPoolController';
import {requireApiContext} from '../../../modules/api/session';
import {ApiProblem, requestLocale} from '../../../modules/api/problem';
import {
    decodeApiMultipartData, prepareValidatedJson, receiveApiUpload, sendPreparedJson,
    sendStoredApiBinary, sendValidatedJson, validateOperationRequest,
} from '../../../modules/api/transport';
import {asyncHandler} from '../../../modules/lib/asyncHandler';
import {prepareFileUploader} from '../../../modules/lib/fileCommons';
import {APIError} from '../../../modules/lib/errors';
import settings from '../../../modules/settings';
import type {components} from '../../../types/api/v1';

const router = Router({mergeParams: true});
const uploadProof = prepareFileUploader(settings.value.invoiceDir, true, true).single('proof');

router.get('/', asyncHandler(async function getEventFinance(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'getEventFinance');
    const result = await readEventFinance(String(req.params.eventId), actor, 'participant', requestLocale(req));
    res.vary('Accept-Language');
    sendValidatedJson(req, res, 'getEventFinance', 200, result);
}));

router.get('/organizer', asyncHandler(async function getEventOrganizerFinance(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'getEventOrganizerFinance');
    const result = await readEventFinance(String(req.params.eventId), actor, 'organizer', requestLocale(req));
    res.vary('Accept-Language');
    sendValidatedJson(req, res, 'getEventOrganizerFinance', 200, result);
}));

router.get('/pools/:poolId/shares/:shareId', asyncHandler(async function getEventFinanceBreakdown(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'getEventFinanceBreakdown');
    const result = await readEventFinanceBreakdown(String(req.params.eventId), String(req.params.poolId),
        String(req.params.shareId), actor, req.query.audience as components['schemas']['FinanceView']['audience'], requestLocale(req));
    res.vary('Accept-Language');
    sendValidatedJson(req, res, 'getEventFinanceBreakdown', 200, result);
}));

/** Accept proof bytes only after authenticated participant admission, then invoke the unchanged submission owner once. */
router.post('/pools/:poolId/invoices', asyncHandler(async function submitEventInvoice(req, res) {
    const actor = await requireApiContext(req, res, true);
    const event = await admitEventInvoiceSubmission(String(req.params.eventId), actor);
    let enteredOperation = false;
    try {
        // The generated multipart schema validates the data object and actual uploaded proof descriptor together.
        await receiveApiUpload(req, res, uploadProof);
        validateOperationRequest(req, 'submitEventInvoice', body => decodeApiMultipartData(body, req.file, 'proof'));
        const reply = prepareValidatedJson(req, 'submitEventInvoice', 200, {changed: true});
        // The existing business operation repeats pool state/assignment checks and owns its recorded legacy behavior.
        enteredOperation = true;
        try {
            await invoiceController.submitInvoice(event, String(req.params.poolId), req.body.data, actor, req.file);
        } catch (error) {
            // Its exposed conflicts are locked precommit rejections, so retain a definite result instead of unknown delivery.
            if (error instanceof APIError && error.status === 409) throw new ApiProblem('RESOURCE_CONFLICT');
            throw error;
        }
        sendPreparedJson(req, res, reply);
    } finally {
        // Structural rejection cannot retain this request's upload. Once the shared operation starts, its outcome owns retention.
        if (!enteredOperation && req.file) await fs.unlink(req.file.path).catch(() => undefined);
    }
}));

router.post('/pools/:poolId/invoices/:invoiceId/retract', asyncHandler(async function retractInvoice(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'retractEventInvoice');
    const reply = prepareValidatedJson(req, 'retractEventInvoice', 200, {changed: true});
    await retractEventInvoice(String(req.params.eventId), String(req.params.poolId), String(req.params.invoiceId), req.body, actor);
    sendPreparedJson(req, res, reply);
}));

router.post('/pools/:poolId/invoices/:invoiceId/close', asyncHandler(async function closeInvoice(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'closeEventInvoice');
    const reply = prepareValidatedJson(req, 'closeEventInvoice', 200, {changed: true});
    await closeEventInvoice(String(req.params.eventId), String(req.params.poolId), String(req.params.invoiceId), actor);
    sendPreparedJson(req, res, reply);
}));

router.get('/pools/:poolId/invoices/:invoiceId/proof', asyncHandler(async function getEventInvoiceProof(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'getEventInvoiceProof');
    const proofPath = await readEventInvoiceProof(String(req.params.eventId), String(req.params.poolId), String(req.params.invoiceId), actor);
    await sendStoredApiBinary(req, res, 'getEventInvoiceProof', 200, settings.value.invoiceDir, proofPath);
}));

export default router;
