import {Router} from 'express';
import fs from 'node:fs/promises';
import invoiceController, {
    admitEventInvoiceSubmission, closeEventInvoice, readEventFinance, readEventFinanceBreakdown,
    readEventInvoiceProof, retractEventInvoice,
    admitEventFinanceOrganizer, createEventFinancePool, updateEventFinanceSettings,
    changeEventFinanceSubmissionState, recordEventOrganizerInvoice, reviewEventFinanceInvoice,
    updateEventFinanceAssignments, addEventFinanceAdjustment, removeEventFinanceAdjustment, updateEventFinanceTakeovers,
    previewEventFinancePool, calculateEventFinancePool, rollbackEventFinancePool, notifyEventFinancePool, settleEventFinanceShare,
} from '../../../controller/eventPoolController';
import {requireApiContext} from '../../../modules/api/session';
import {ApiProblem, declaredApiProblem, requestLocale} from '../../../modules/api/problem';
import {
    decodeApiMultipartData, prepareValidatedJson, receiveApiUpload, sendPreparedJson,
    sendStoredApiBinary, sendValidatedJson, validateOperationRequest,
} from '../../../modules/api/transport';
import {asyncHandler} from '../../../modules/lib/asyncHandler';
import {prepareFileUploader} from '../../../modules/lib/fileCommons';
import {APIError} from '../../../modules/lib/errors';
import settings from '../../../modules/settings';
import type {components} from '../../../../types/api/v1';

const router = Router({mergeParams: true});
const uploadProof = prepareFileUploader(settings.value.invoiceDir, true, true).single('proof');

router.post('/pools', asyncHandler(async function createPool(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'createEventFinancePool');
    const reply = prepareValidatedJson(req, 'createEventFinancePool', 200, {changed: true});
    await createEventFinancePool(String(req.params.eventId), req.body, actor);
    sendPreparedJson(req, res, reply);
}));

router.post('/pools/:poolId/settings', asyncHandler(async function saveSettings(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'updateEventFinanceSettings');
    const reply = prepareValidatedJson(req, 'updateEventFinanceSettings', 200, {changed: true});
    await updateEventFinanceSettings(String(req.params.eventId), String(req.params.poolId), req.body, actor);
    sendPreparedJson(req, res, reply);
}));

router.post('/pools/:poolId/submission-state', asyncHandler(async function saveSubmissionAccess(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'changeEventFinanceSubmissionState');
    const reply = prepareValidatedJson(req, 'changeEventFinanceSubmissionState', 200, {changed: true});
    await changeEventFinanceSubmissionState(String(req.params.eventId), String(req.params.poolId), req.body, actor);
    sendPreparedJson(req, res, reply);
}));

/** Admit the organizer before accepting optional bytes, and retain the existing cost owner's cleanup policy. */
router.post('/pools/:poolId/invoices/organizer', asyncHandler(async function recordOrganizerCost(req, res) {
    const actor = await requireApiContext(req, res, true);
    const event = await admitEventFinanceOrganizer(String(req.params.eventId), actor, true);
    let enteredOperation = false;
    try {
        // The closed multipart schema distinguishes optional bytes from client-supplied filenames and unknown parts.
        await receiveApiUpload(req, res, uploadProof);
        validateOperationRequest(req, 'recordEventOrganizerInvoice', body => decodeApiMultipartData(body, req.file, 'proof'));
        const reply = prepareValidatedJson(req, 'recordEventOrganizerInvoice', 200, {changed: true});
        enteredOperation = true;
        await recordEventOrganizerInvoice(event, String(req.params.poolId), req.body.data, actor, req.file);
        sendPreparedJson(req, res, reply);
    } finally {
        // Once entered, the shared business owner controls retention; structural rejections discard this request's upload.
        if (!enteredOperation && req.file) await fs.unlink(req.file.path).catch(() => undefined);
    }
}));

/** Keep the shared JSON review transport uniform while explicit operation IDs retain their distinct generated contracts. */
function registerInvoiceReview(path: string, operation: 'approveEventFinanceInvoice' | 'declineEventFinanceInvoice'
    | 'closeEventOrganizerInvoice' | 'reviseEventFinanceInvoice' | 'rejectAcceptedEventFinanceInvoice',
    action: Parameters<typeof reviewEventFinanceInvoice>[3]): void {
    router.post(`/pools/:poolId/invoices/:invoiceId/${path}`, asyncHandler(async function reviewInvoice(req, res) {
        // Only retroactive review requires an invoice actor; existing initial review accepts the independent method grant.
        const actor = await requireApiContext(req, res, action === 'revise' || action === 'reject');
        validateOperationRequest(req, operation);
        // Prepare the fixed receipt before any shared operation writes; sending cannot introduce a new admission failure.
        const reply = prepareValidatedJson(req, operation, 200, {changed: true});
        await reviewEventFinanceInvoice(String(req.params.eventId), String(req.params.poolId), String(req.params.invoiceId), action, req.body, actor);
        sendPreparedJson(req, res, reply);
    }));
}

registerInvoiceReview('approve', 'approveEventFinanceInvoice', 'approve');
registerInvoiceReview('decline', 'declineEventFinanceInvoice', 'decline');
registerInvoiceReview('organizer-close', 'closeEventOrganizerInvoice', 'close');
registerInvoiceReview('revise', 'reviseEventFinanceInvoice', 'revise');
registerInvoiceReview('reject-accepted', 'rejectAcceptedEventFinanceInvoice', 'reject');

router.post('/pools/:poolId/assignments', asyncHandler(async function saveAssignments(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'updateEventFinanceAssignments');
    const reply = prepareValidatedJson(req, 'updateEventFinanceAssignments', 200, {changed: true});
    await updateEventFinanceAssignments(String(req.params.eventId), String(req.params.poolId), req.body, actor);
    sendPreparedJson(req, res, reply);
}));

router.post('/pools/:poolId/adjustments', asyncHandler(async function addAdjustment(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'addEventFinanceAdjustment');
    const reply = prepareValidatedJson(req, 'addEventFinanceAdjustment', 200, {changed: true});
    await addEventFinanceAdjustment(String(req.params.eventId), String(req.params.poolId), req.body, actor);
    sendPreparedJson(req, res, reply);
}));

router.post('/pools/:poolId/adjustments/:surchargeId/remove', asyncHandler(async function removeAdjustment(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'removeEventFinanceAdjustment');
    const reply = prepareValidatedJson(req, 'removeEventFinanceAdjustment', 200, {changed: true});
    await removeEventFinanceAdjustment(String(req.params.eventId), String(req.params.poolId), String(req.params.surchargeId), actor);
    sendPreparedJson(req, res, reply);
}));

/** Preserve two explicit coverage contracts and admissions while sharing their identical transport lifecycle. */
function registerTakeoverCommand(organizer: boolean): void {
    const operation = organizer ? 'updateEventOrganizerFinanceTakeovers' : 'updateEventParticipantFinanceTakeovers';
    router.post(`/pools/:poolId/takeovers${organizer ? '/manage' : ''}`, asyncHandler(async function saveCoverage(req, res) {
        const actor = await requireApiContext(req, res, !organizer);
        validateOperationRequest(req, operation);
        // Both commands retain a fixed prevalidated receipt and invoke the shared operation exactly once.
        const reply = prepareValidatedJson(req, operation, 200, {changed: true});
        await updateEventFinanceTakeovers(String(req.params.eventId), String(req.params.poolId), req.body, actor, organizer);
        sendPreparedJson(req, res, reply);
    }));
}

registerTakeoverCommand(false);
registerTakeoverCommand(true);

/** Retain the independent preview method grant while returning a localized, read-only reviewed revision. */
router.get('/pools/:poolId/preview', asyncHandler(async function previewCalculation(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'previewEventFinancePool');
    const result = await previewEventFinancePool(String(req.params.eventId), String(req.params.poolId), actor, requestLocale(req));
    res.vary('Accept-Language');
    sendValidatedJson(req, res, 'previewEventFinancePool', 200, result);
}));

/** Share command transport while leaving first closure and recalculation as distinct generated operations. */
function registerCalculationCommand(recalculate: boolean): void {
    const operation = recalculate ? 'recalculateEventFinancePool' : 'closeEventFinancePool';
    router.post(`/pools/:poolId/${recalculate ? 'recalculate' : 'close'}`, asyncHandler(async function calculatePool(req, res) {
        const actor = await requireApiContext(req, res);
        validateOperationRequest(req, operation);
        // Prepare the fixed receipt before entering shared persistence and its postcommit notification behavior.
        const reply = prepareValidatedJson(req, operation, 200, {changed: true});
        await calculateEventFinancePool(String(req.params.eventId), String(req.params.poolId), req.body, actor, recalculate);
        sendPreparedJson(req, res, reply);
    }));
}

registerCalculationCommand(false);
registerCalculationCommand(true);

router.post('/pools/:poolId/rollback', asyncHandler(async function restoreCalculationInputs(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'rollbackEventFinancePool');
    const result = await rollbackEventFinancePool(String(req.params.eventId), String(req.params.poolId), req.body ?? {}, actor);
    sendValidatedJson(req, res, 'rollbackEventFinancePool', 200, result);
}));

router.post('/pools/:poolId/notify', asyncHandler(async function requestSettlementEmails(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'notifyEventFinancePool');
    const result = await notifyEventFinancePool(String(req.params.eventId), String(req.params.poolId), req.body ?? {}, actor);
    sendValidatedJson(req, res, 'notifyEventFinancePool', 200, result);
}));

router.post('/pools/:poolId/shares/:shareId/settlement', asyncHandler(async function recordSettlement(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'settleEventFinanceShare');
    const reply = prepareValidatedJson(req, 'settleEventFinanceShare', 200, {changed: true});
    await settleEventFinanceShare(String(req.params.eventId), String(req.params.poolId), String(req.params.shareId), req.body.isPaid, actor);
    sendPreparedJson(req, res, reply);
}));

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
        // The existing business operation repeats pool state/assignment checks and owns its recorded behavior.
        enteredOperation = true;
        try {
            await invoiceController.submitInvoice(event, String(req.params.poolId), req.body.data, actor, req.file);
        } catch (error) {
            // Its exposed conflicts are locked precommit rejections, so retain a definite result instead of unknown delivery.
            if (error instanceof APIError && error.status === 409) throw declaredApiProblem(error) ?? new ApiProblem('RESOURCE_CONFLICT');
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
