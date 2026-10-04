/*
 * Copyright 2026 Julian Malovanij
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {invoiceText} from '../../modules/invoice/wording';
import express, {Request} from "express";
import eventPoolController from "../../controller/eventPoolController";
import {requireEventParticipantAPI, requirePermissionApi,} from "../../middleware/permissionMiddleware";
import {asyncHandler} from "../../modules/lib/asyncHandler";
import {APIError} from "../../modules/lib/errors";
import {prepareFileUploader} from "../../modules/lib/fileCommons";
import {PERM} from "../../modules/lib/permissions";
import renderer from "../../modules/renderer";
import settings from "../../modules/settings";

const proofUpload = prepareFileUploader(settings.value.invoiceDir, true, true);
const requireInvoiceActor = asyncHandler((req, _res, next) => {
    if (!req.session.profile?.id) throw new APIError(invoiceText("logInToChangeAnInvoice"), {}, 401);
    next();
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
            renderer.respondWithSuccessDataJson(res, invoiceText('apiPoolCreated'), {id: poolId});
        })
    );

    router.post(
        '/:poolId',
        requirePermissionApi(permFct, PERM.MANAGE_ASSIGNMENTS),
        asyncHandler(async (req, res) => {
            await eventPoolController.updatePoolSettings(resFct(req), req.params.poolId as string, req.body);
            renderer.respondWithSuccessJson(res, invoiceText('apiPoolSettingsUpdated'));
        })
    )

    router.post(
        '/:poolId/assignments',
        requirePermissionApi(permFct, PERM.MANAGE_ASSIGNMENTS),
        asyncHandler(async (req, res) => {
            await eventPoolController.updatePoolAssignments(resFct(req), req.params.poolId as string, req.body);
            renderer.respondWithSuccessJson(res, invoiceText('apiAssignmentsUpdated'));
        })
    );

    // Submission access has its own lifecycle command; calculating and closing remains a separate reviewed operation.
    router.post(
        '/:poolId/submission-state',
        requirePermissionApi(permFct, PERM.MANAGE_ASSIGNMENTS),
        asyncHandler(async (req, res) => {
            await eventPoolController.changePoolSubmissionState(resFct(req), req.params.poolId as string, req.body);
            renderer.respondWithSuccessJson(res, invoiceText('participantInvoiceAccessChanged'));
        })
    );

    router.post(
        '/:poolId/takeovers',
        requireEventParticipantAPI(resFct),
        asyncHandler(async (req, res) => {
            await eventPoolController.updateTakeovers(resFct(req), req.params.poolId as string, req.body, req.session, false);
            renderer.respondWithSuccessJson(res, invoiceText('apiTakeoversUpdated'));
        })
    );

    router.post(
        '/:poolId/takeovers/manage',
        requirePermissionApi(permFct, PERM.MANAGE_ASSIGNMENTS),
        asyncHandler(async (req, res) => {
            await eventPoolController.updateTakeovers(resFct(req), req.params.poolId as string, req.body, req.session, true);
            renderer.respondWithSuccessJson(res, invoiceText('apiTakeoversUpdated'));
        })
    );

    router.post(
        '/:poolId/surcharges',
        requirePermissionApi(permFct, PERM.MANAGE_ASSIGNMENTS),
        asyncHandler(async (req, res) => {
            await eventPoolController.addPoolSurcharge(resFct(req), req.params.poolId as string, req.body);
            renderer.respondWithSuccessJson(res, invoiceText('apiSurchargeAdded'));
        })
    );

    router.post(
        '/:poolId/surcharges/:surchargeId/delete',
        requirePermissionApi(permFct, PERM.MANAGE_ASSIGNMENTS),
        asyncHandler(async (req, res) => {
            await eventPoolController.removePoolSurcharge(resFct(req), req.params.poolId as string, req.params.surchargeId as string);
            renderer.respondWithSuccessJson(res, invoiceText('apiSurchargeRemoved'));
        })
    );

    router.post(
        '/:poolId/submit',
        requireEventParticipantAPI(resFct),
        proofUpload.single("proof"),
        asyncHandler(async (req, res) => {
            await eventPoolController.submitInvoice(resFct(req), req.params.poolId as string, req.body, req.session, req.file);
            renderer.respondWithSuccessJson(res, invoiceText('apiInvoiceSubmitted'));
        })
    );

    router.post(
        '/:poolId/invoices/organizer',
        asyncHandler((req, _res, next) => {
            if (!req.session.profile?.id) throw new APIError(invoiceText("logInToRecordAPoolCost"), {}, 401);
            next();
        }),
        requirePermissionApi(permFct, PERM.MANAGE_ASSIGNMENTS),
        proofUpload.single("proof"),
        asyncHandler(async (req, res) => {
            const invoiceId = await eventPoolController.addOrganizerInvoice(resFct(req), req.params.poolId as string, req.body, req.session, req.file);
            renderer.respondWithSuccessDataJson(res, invoiceText("poolCostRecordedCalculateThePoolToIncludeThis"), {id: invoiceId});
        })
    );

    router.post(
        '/:poolId/invoices/:invoiceId/approve',
        requirePermissionApi(permFct, PERM.MANAGE_ASSIGNMENTS),
        asyncHandler(async (req, res) => {
            await eventPoolController.approveInvoice(
                resFct(req),
                req.params.poolId as string,
                req.params.invoiceId as string,
                req.body,
                req.session,
            );
            renderer.respondWithSuccessJson(res, invoiceText('apiInvoiceAccepted'));
        })
    );

    router.post(
        '/:poolId/invoices/:invoiceId/close',
        requirePermissionApi(permFct, PERM.MANAGE_ASSIGNMENTS),
        asyncHandler(async (req, res) => {
            await eventPoolController.closeInvoice(resFct(req), req.params.poolId as string, req.params.invoiceId as string, req.session, res.locals.permData);
            renderer.respondWithSuccessJson(res, invoiceText('apiInvoiceClosed'));
        })
    );

    router.post(
        '/:poolId/invoices/:invoiceId/close-self',
        requireEventParticipantAPI(resFct),
        asyncHandler(async (req, res) => {
            await eventPoolController.closeInvoice(resFct(req), req.params.poolId as string, req.params.invoiceId as string, req.session, res.locals.permData, false);
            renderer.respondWithSuccessJson(res, invoiceText('apiInvoiceClosed'));
        })
    );

    router.post(
        '/:poolId/invoices/:invoiceId/decline',
        requirePermissionApi(permFct, PERM.MANAGE_ASSIGNMENTS),
        asyncHandler(async (req, res) => {
            await eventPoolController.declineInvoice(
                resFct(req),
                req.params.poolId as string,
                req.params.invoiceId as string,
                req.body,
                req.session,
            );
            renderer.respondWithSuccessJson(res, invoiceText('apiInvoiceRejected'));
        })
    );

    router.post(
        '/:poolId/invoices/:invoiceId/revise',
        requireInvoiceActor,
        requirePermissionApi(permFct, PERM.MANAGE_ASSIGNMENTS),
        asyncHandler(async (req, res) => {
            await eventPoolController.reviseInvoice(resFct(req), req.params.poolId as string, req.params.invoiceId as string, req.body, req.session);
            renderer.respondWithSuccessJson(res, invoiceText("invoiceCorrectedRecalculateClosedPoolsToUpdateSharesRecorded"));
        })
    );

    router.post(
        '/:poolId/invoices/:invoiceId/reject-accepted',
        requireInvoiceActor,
        requirePermissionApi(permFct, PERM.MANAGE_ASSIGNMENTS),
        asyncHandler(async (req, res) => {
            await eventPoolController.rejectAcceptedInvoice(resFct(req), req.params.poolId as string, req.params.invoiceId as string, req.body, req.session);
            renderer.respondWithSuccessJson(res, invoiceText("invoiceRejectedAndKeptInHistoryRecalculateClosedPools"));
        })
    );

    router.post(
        '/:poolId/invoices/:invoiceId/retract',
        requireInvoiceActor,
        asyncHandler(async (req, res) => {
            await eventPoolController.retractInvoice(resFct(req), req.params.poolId as string, req.params.invoiceId as string, req.body, req.session);
            renderer.respondWithSuccessJson(res, invoiceText("invoiceRetractedItRemainsInYourHistoryAndWas"));
        })
    );

    router.post(
        '/:poolId/close',
        requirePermissionApi(permFct, PERM.MANAGE_ASSIGNMENTS),
        asyncHandler(async (req, res) => {
            await eventPoolController.closePool(resFct(req), req.params.poolId as string, req.body, req.session);
            renderer.respondWithSuccessJson(res, invoiceText('apiPoolClosed'));
        })
    );

    router.post(
        '/:poolId/recalculate',
        requirePermissionApi(permFct, PERM.MANAGE_ASSIGNMENTS),
        asyncHandler(async (req, res) => {
            await eventPoolController.recalculatePool(resFct(req), req.params.poolId as string, req.body, req.session);
            renderer.respondWithSuccessJson(res, invoiceText('apiPoolRecalculated'));
        })
    );

    router.get(
        '/:poolId/preview',
        requirePermissionApi(permFct, PERM.MANAGE_ASSIGNMENTS),
        asyncHandler(async (req, res) => {
            const preview = await eventPoolController.previewPool(resFct(req), req.params.poolId as string);
            res.set("Cache-Control", 'no-store');
            renderer.respondWithSuccessDataJson(res, invoiceText('apiCalculationPreview'), preview);
        })
    );

    router.post(
        '/:poolId/rollback',
        requirePermissionApi(permFct, PERM.MANAGE_ASSIGNMENTS),
        asyncHandler(async (req, res) => {
            const result = await eventPoolController.rollbackPoolChanges(resFct(req), req.params.poolId as string, req.body);
            renderer.respondWithSuccessDataJson(res, result.needsRecalculation
                ? invoiceText("poolSettingsRestoredANewCalculationIsStillRequired")
                : invoiceText("poolChangesRolledBackExistingSharesAndPaymentsHave"), result);
        })
    );

    router.post(
        '/:poolId/notify',
        requirePermissionApi(permFct, PERM.MANAGE_ASSIGNMENTS),
        asyncHandler(async (req, res) => {
            const result = await eventPoolController.notifyPoolShares(resFct(req), req.params.poolId as string, req.body, req.session);
            renderer.respondWithSuccessDataJson(res, invoiceText("settlementEmailDeliveryRequestedForPayerS", {count: result.count}), result);
        })
    );

    router.post(
        '/:poolId/shares/:shareId/pay',
        requirePermissionApi(permFct, PERM.MANAGE_ASSIGNMENTS),
        asyncHandler(async (req, res) => {
            const isPaid = req.body.isPaid === true || req.body.isPaid === 'true' || req.body.isPaid === 'on';
            await eventPoolController.markSharePaid(resFct(req), req.params.poolId as string, req.params.shareId as string, isPaid, req.session);
            renderer.respondWithSuccessJson(res, invoiceText('apiShareUpdated'));
        })
    );

    // Serve invoice proof files securely with authentication
    router.get(
        '/:poolId/invoices/:invoiceId/proof',
        asyncHandler(async (req, res) => {
            const filePath = await eventPoolController.serveInvoiceProof(resFct(req), req.params.poolId as string, req.params.invoiceId as string, req.session, res.locals.permData);
            res.sendFile(filePath);
        })
    );

    return router;
}

export default buildInvoiceRouter;
