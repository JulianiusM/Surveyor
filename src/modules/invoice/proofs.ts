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

import {invoiceText} from './wording';
import fs from 'node:fs';
import path from 'node:path';
import settings from '../settings';
import type {EventInvoice} from '../database/entities/event/EventInvoice';
import {APIError} from '../lib/errors';

/** Files stay outside the DBAL and retain the existing configured-directory deletion boundary. */
export async function deleteInvoiceProof(proofPath?: string | null): Promise<void> {
    if (!proofPath) return;
    // Resolve both paths in one filesystem context before allowing a proof to be deleted.
    const invoiceRoot = path.resolve(process.cwd(), settings.value.invoiceDir);
    const normalized = path.resolve(process.cwd(), proofPath);
    const relativePath = path.relative(invoiceRoot, normalized);
    // Reject paths outside the configured directory, including absolute relative-path results.
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        console.warn(invoiceText('archivedProofSkipped', {path: proofPath}));
        return;
    }
    // Missing or already removed files retain the established best-effort cleanup behavior.
    try { await fs.promises.unlink(normalized); } catch { /* Retention still removes the selected business record. */ }
}

/** Authorize the saved proof and resolve a readable file inside the configured invoice directory. */
export async function getInvoiceProofPath(invoice: EventInvoice | null, actorRegId: number | undefined, hasManagePermission: boolean): Promise<string> {
    if (!invoice?.proofPath) {
        throw new APIError(invoiceText('invoiceProofNotFound'), {}, 404);
    }

    // Route context supplies the authenticated actor and effective organizer permission.
    const isSubmitter = actorRegId !== undefined && actorRegId === invoice.registrationId;

    if (!hasManagePermission && !isSubmitter) {
        throw new APIError(invoiceText('youDoNotHavePermissionToViewThisProof'), {}, 403);
    }

    // Sanitize and validate the proof path to prevent directory traversal
    const uploadsDir = path.resolve(process.cwd(), settings.value.invoiceDir);
    const fullPath = path.resolve(process.cwd(), invoice.proofPath);

    // Use path.relative to ensure the resolved path is within uploads directory
    const relativePath = path.relative(uploadsDir, fullPath);
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        throw new APIError(invoiceText('invalidProofPath'), {}, 400);
    }

    // Check if file exists (async)
    try {
        await fs.promises.access(fullPath, fs.constants.R_OK);
    } catch {
        throw new APIError(invoiceText('proofFileNotFound'), {}, 404);
    }

    return fullPath;
}
