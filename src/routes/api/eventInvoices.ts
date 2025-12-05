import express, {Request} from "express";
import fs from "fs";
import path from "path";
import multer from "multer";
import {v4 as uuidv4} from "uuid";
import {asyncHandler} from "../../modules/lib/asyncHandler";
import renderer from "../../modules/renderer";
import eventPoolController from "../../controller/eventPoolController";
import {requireEventParticipantAPI, requirePermissionApi,} from "../../middleware/permissionMiddleware";
import {PERM} from "../../modules/lib/permissions";

// Storage setup for invoice proofs. Files are placed in /uploads/invoices and referenced by relative path.
const proofDir = path.join(process.cwd(), "uploads", "invoices");
const proofStorage = multer.diskStorage({
    destination: (_req, _file, cb) => {
        fs.mkdirSync(proofDir, {recursive: true});
        cb(null, proofDir);
    },
    filename: (_req, file, cb) => {
        const allowedExts = ['.jpg', '.jpeg', '.png', '.gif', '.pdf'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (!allowedExts.includes(ext)) {
            return cb(new Error('Invalid file extension'), '');
        }
        cb(null, `${Date.now()}-${uuidv4()}${ext}`);
    },
});

const proofUpload = multer({
    storage: proofStorage,
    limits: {fileSize: 10 * 1024 * 1024},
    fileFilter: (_req, file, cb) => {
        const ok = file.mimetype === "application/pdf" || file.mimetype.startsWith("image/");
        if (ok) {
            cb(null, true);
        } else {
            cb(new Error("Only images or PDFs allowed"));
        }
    },
});

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
