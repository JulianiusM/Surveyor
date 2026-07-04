import express, {Request} from "express";
import eventPoolController from "../../controller/eventPoolController";
import {requireEventParticipantAPI, requirePermissionApi,} from "../../middleware/permissionMiddleware";
import {asyncHandler} from "../../modules/lib/asyncHandler";
import {prepareFileUploader} from "../../modules/lib/fileCommons";
import {PERM} from "../../modules/lib/permissions";
import renderer from "../../modules/renderer";
import settings from "../../modules/settings";

const proofUpload = prepareFileUploader(settings.value.invoiceDir, true, true);

// Split invoice routes out of the crowded event router to keep handlers focused
export function buildInvoiceRouter(permFct: (req: Request) => any, resFct: (req: Request) => any) {
    const router = express.Router({mergeParams: true});

    // Create a pool under an event
    router.post(
        '/',
        requirePermissionApi(permFct, PERM.MANAGE_ASSIGNMENTS),
        asyncHandler(async (req, res) => {
            const poolId = await eventPoolController.createInvoicePool(resFct(req), req.body);
            renderer.respondWithSuccessDataJson(res, "created", {id: poolId});
        })
    );

    router.post(
        '/:poolId/assignments',
        requirePermissionApi(permFct, PERM.MANAGE_ASSIGNMENTS),
        asyncHandler(async (req, res) => {
            await eventPoolController.updatePoolAssignments(resFct(req), req.params.poolId, req.body);
            renderer.respondWithSuccessJson(res, "assignments updated");
        })
    );

    router.post(
        '/:poolId/takeovers',
        requireEventParticipantAPI(resFct),
        asyncHandler(async (req, res) => {
            await eventPoolController.updateTakeovers(resFct(req), req.params.poolId, req.body, req.session, false);
            renderer.respondWithSuccessJson(res, "takeovers updated");
        })
    );

    router.post(
        '/:poolId/takeovers/manage',
        requirePermissionApi(permFct, PERM.MANAGE_ASSIGNMENTS),
        asyncHandler(async (req, res) => {
            await eventPoolController.updateTakeovers(resFct(req), req.params.poolId, req.body, req.session, true);
            renderer.respondWithSuccessJson(res, "takeovers updated");
        })
    );

    router.post(
        '/:poolId/surcharges',
        requirePermissionApi(permFct, PERM.MANAGE_ASSIGNMENTS),
        asyncHandler(async (req, res) => {
            await eventPoolController.addPoolSurcharge(resFct(req), req.params.poolId, req.body);
            renderer.respondWithSuccessJson(res, "surcharge added");
        })
    );

    router.post(
        '/:poolId/surcharges/:surchargeId/delete',
        requirePermissionApi(permFct, PERM.MANAGE_ASSIGNMENTS),
        asyncHandler(async (req, res) => {
            await eventPoolController.removePoolSurcharge(resFct(req), req.params.poolId, req.params.surchargeId);
            renderer.respondWithSuccessJson(res, "surcharge removed");
        })
    );

    router.post(
        '/:poolId/submit',
        requireEventParticipantAPI(resFct),
        proofUpload.single("proof"),
        asyncHandler(async (req, res) => {
            await eventPoolController.submitInvoice(resFct(req), req.params.poolId, req.body, req.session, req.file);
            renderer.respondWithSuccessJson(res, "invoice submitted");
        })
    );

    router.post(
        '/:poolId/invoices/:invoiceId/approve',
        requirePermissionApi(permFct, PERM.MANAGE_ASSIGNMENTS),
        asyncHandler(async (req, res) => {
            await eventPoolController.approveInvoice(resFct(req), req.params.poolId, req.params.invoiceId, req.session);
            renderer.respondWithSuccessJson(res, "approved");
        })
    );

    router.post(
        '/:poolId/invoices/:invoiceId/close',
        requirePermissionApi(permFct, PERM.MANAGE_ASSIGNMENTS),
        asyncHandler(async (req, res) => {
            await eventPoolController.closeInvoice(resFct(req), req.params.poolId, req.params.invoiceId, req.session, res.locals.permData);
            renderer.respondWithSuccessJson(res, "closed");
        })
    );

    router.post(
        '/:poolId/invoices/:invoiceId/close-self',
        requireEventParticipantAPI(resFct),
        asyncHandler(async (req, res) => {
            await eventPoolController.closeInvoice(resFct(req), req.params.poolId, req.params.invoiceId, req.session, res.locals.permData, false);
            renderer.respondWithSuccessJson(res, "closed");
        })
    );

    router.post(
        '/:poolId/invoices/:invoiceId/decline',
        requirePermissionApi(permFct, PERM.MANAGE_ASSIGNMENTS),
        asyncHandler(async (req, res) => {
            await eventPoolController.declineInvoice(resFct(req), req.params.poolId, req.params.invoiceId, req.session);
            renderer.respondWithSuccessJson(res, "declined");
        })
    );

    router.post(
        '/:poolId/close',
        requirePermissionApi(permFct, PERM.MANAGE_ASSIGNMENTS),
        asyncHandler(async (req, res) => {
            await eventPoolController.closePool(resFct(req), req.params.poolId, req.body, req.session);
            renderer.respondWithSuccessJson(res, "pool closed");
        })
    );

    router.post(
        '/:poolId/recalculate',
        requirePermissionApi(permFct, PERM.MANAGE_ASSIGNMENTS),
        asyncHandler(async (req, res) => {
            await eventPoolController.recalculatePool(resFct(req), req.params.poolId, req.body, req.session);
            renderer.respondWithSuccessJson(res, "pool recalculated");
        })
    );

    router.post(
        '/:poolId/shares/:shareId/pay',
        requirePermissionApi(permFct, PERM.MANAGE_ASSIGNMENTS),
        asyncHandler(async (req, res) => {
            const isPaid = req.body.isPaid === true || req.body.isPaid === 'true' || req.body.isPaid === 'on';
            await eventPoolController.markSharePaid(resFct(req), req.params.poolId, req.params.shareId, isPaid, req.session);
            renderer.respondWithSuccessJson(res, "share updated");
        })
    );

    // Serve invoice proof files securely with authentication
    router.get(
        '/:poolId/invoices/:invoiceId/proof',
        requireEventParticipantAPI(resFct),
        asyncHandler(async (req, res) => {
            await eventPoolController.serveInvoiceProof(resFct(req), req.params.poolId, req.params.invoiceId, req.session, res, res.locals.permData);
        })
    );

    return router;
}

export default buildInvoiceRouter;
