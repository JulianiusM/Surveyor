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

import {invoiceText, invoiceRejectionCause} from './wording';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import type {Request} from 'express';
import type {EntityManager} from 'typeorm';
import settings from '../settings';
import type {EventInvoice} from '../database/entities/event/EventInvoice';
import type {InvoiceProofFile} from '../database/entities/event/InvoiceProofFile';
import type {InvoiceProof} from '../../../types/InvoicePoolTypes';
import type {InvoiceProofReconciliationAction, InvoiceProofReconciliationEntry,
    InvoiceProofReconciliationManifest, InvoiceProofReconciliationResult} from '../../../types/InvoiceProofTypes';
import {APIError} from '../lib/errors';
import {resolveStoredFile} from '../lib/fileCommons';
import * as invoiceService from '../database/services/EventInvoiceService';
import {uploadFileMedia} from '../../../common/lib/fileMedia';
import {invoiceProofReconciliationActions, prepareProofReconciliationManifest, prepareProofRecoveryDays} from './requests';
import {generateUniqueId} from '../lib/util';

// One process owns uploads and maintenance in the recorded deployment model.
// A boot identity distinguishes abandoned work after a crash without an unsafe
// age-based guess about a currently slow upload or invoice transaction.
const processOwner = generateUniqueId();
const activeUploads = new Set<string>();
const requestUploads = new WeakMap<Request, Set<string>>();
const completedRequests = new WeakSet<Request>();
let cleanupCursor: string | undefined;

/** Keep storage references portable while matching uploader and invoice spellings. */
function portableProofPath(reference: string): string {
    return path.relative(process.cwd(), path.resolve(process.cwd(), reference));
}

/** Hash the exact persisted spelling; existing legacy spellings remain tracked independently. */
function proofKey(reference: string): string {
    return createHash('sha256').update(reference).digest('hex');
}

/** Compare paths according to the actual platform, without changing stored references. */
function filesystemKey(reference: string): string {
    const absolute = path.resolve(process.cwd(), reference);
    return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
}

/** Reserve one admitted upload before bytes are written. Repeated controller admission
 * may reuse the same active reservation, but cannot revive completed/deleting evidence. */
export async function registerInvoiceProofUpload(filePath: string, existingUpload = false,
    storedReference = portableProofPath(filePath)): Promise<void> {
    const reference = storedReference;
    const resolved = resolveStoredFile(settings.value.invoiceDir, reference);
    if (!resolved || filesystemKey(resolved) !== filesystemKey(filePath)
        || path.dirname(resolved) !== path.resolve(settings.value.invoiceDir) || reference.length > 255) {
        throw new APIError(invoiceText('invalidProofPath'), {}, 400, {cause: invoiceRejectionCause('invalidProofPath')});
    }

    // The server-generated filename is selected by the uploader; persistence must
    // finish before its callback can allow the storage engine to open the file.
    const id = proofKey(reference);
    const alreadyActive = activeUploads.has(id);
    // Publish process ownership before the first persistence yield. A periodic
    // sweep must not claim a newly inserted row between insert and fenced admission.
    activeUploads.add(id);
    /** Publish active ownership under the same fence used by cleanup selection. */
    async function ownAllocation(_manager: EntityManager, row: InvoiceProofFile | null): Promise<void> {
        if (!row || row.state !== 'STAGED' || row.ownerToken !== processOwner) {
            throw new APIError(invoiceText('invalidProofPath'), {}, 409, {cause: invoiceRejectionCause('invalidProofPath')});
        }
        // The allocation callback cannot open a stream until this fence commits.
        activeUploads.add(id);
    }
    try {
        if (!existingUpload) {
            // A server-generated name still must not overwrite bytes belonging to
            // an old installation or another filesystem alias on a case-folding volume.
            try {
                await fs.promises.lstat(resolved);
                throw new APIError(invoiceText('invalidProofPath'), {}, 409, {cause: invoiceRejectionCause('invalidProofPath')});
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
            }
        }
        await invoiceService.insertProofFile({id, path: reference, state: 'STAGED', ownerToken: processOwner});
        await invoiceService.withProofFileTransaction(id, ownAllocation);
    } catch (error) {
        if (!alreadyActive) activeUploads.delete(id);
        throw error;
    }
}

/** The generic uploader calls this feature hook before opening its disk stream. */
export async function allocateInvoiceProofUpload(request: Request, filePath: string): Promise<void> {
    await registerInvoiceProofUpload(filePath);
    const id = proofKey(portableProofPath(filePath));
    // Abort can finish admission while persistence is still returning. Refuse a
    // late filename callback rather than creating unowned bytes after finalization.
    if (completedRequests.has(request) || request.aborted) {
        activeUploads.delete(id);
        throw new Error('Proof upload ended before storage allocation completed');
    }
    const ids = requestUploads.get(request) ?? new Set<string>();
    ids.add(id);
    requestUploads.set(request, ids);
}

/** Mark proof attachment on the invoice's own transaction while retaining its
 * row fence. A cleanup claim cannot race an uncertain or still-pending commit. */
export async function attachInvoiceProof(proof: InvoiceProof, manager: EntityManager): Promise<void> {
    if (!proof) return;
    const id = proofKey(proof.path);
    const row = await invoiceService.getProofFile(id, manager, true);
    if (!row || row.state !== 'STAGED' || row.ownerToken !== processOwner || !activeUploads.has(id)) {
        throw new APIError(invoiceText('invalidProofPath'), {}, 409, {cause: invoiceRejectionCause('invalidProofPath')});
    }
    // This write rolls back with the invoice. Request finalization still consults
    // live references, so a lost commit acknowledgement never triggers blind unlink.
    row.state = 'ATTACHED';
    row.ownerToken = null;
    row.retryAt = null;
    await invoiceService.saveProofFile(row, manager);
}

/** Give direct controller callers the same lifecycle as multipart adapters.
 * This also admits production-shaped filesystem fixtures without repository mocks. */
export async function withInvoiceProofUpload<Result>(file: {path: string} | null | undefined,
    operation: () => Promise<Result>, storedReference?: string): Promise<Result> {
    if (!file) return operation();
    const reference = storedReference ?? portableProofPath(file.path);
    const id = proofKey(reference);
    // The request allocator or an outer controller already owns this exact file.
    // Nested business operations reuse it instead of registering/cleaning twice.
    if (activeUploads.has(id)) return operation();
    await registerInvoiceProofUpload(file.path, true, reference);
    try {
        return await operation();
    } finally {
        // Cleanup errors cannot reject a committed invoice. Ownership evidence
        // remains durable until a later successful sweep, even during a DB outage.
        activeUploads.delete(id);
        await cleanupProofFile(id);
    }
}

/** Release every allocation, including partial uploads for which Multer produced
 * no req.file. Late asynchronous allocations detect the completed request above. */
export async function finishInvoiceProofRequest(request: Request): Promise<void> {
    completedRequests.add(request);
    const ids = requestUploads.get(request) ?? [];
    requestUploads.delete(request);
    for (const id of ids) {
        activeUploads.delete(id);
        await cleanupProofFile(id);
    }
}

/** Preserve references before a feature deliberately removes their invoice rows.
 * Existing deployment migrations backfill normally; this also protects imported rows. */
export async function rememberInvoiceProofs(invoices: readonly Pick<EventInvoice, 'proofPath'>[]): Promise<void> {
    for (const invoice of invoices) {
        if (invoice.proofPath) {
            await invoiceService.insertProofFile({id: proofKey(invoice.proofPath), path: invoice.proofPath, state: 'ATTACHED', ownerToken: null});
        }
    }
}

/** Resolve only regular, physically confined files. The configured root may be
 * a deployment alias; child symlinks and redirected intermediate directories fail closed. */
async function resolveManagedProof(reference: string, allowMissingLeaf = false): Promise<string | null> {
    const lexicalRoot = path.resolve(settings.value.invoiceDir);
    const lexicalFile = resolveStoredFile(settings.value.invoiceDir, reference);
    if (!lexicalFile) throw new Error('Proof cleanup candidate is outside its configured root');
    const relative = path.relative(lexicalRoot, lexicalFile);
    if (!relative || relative.split(path.sep).some(part => !part || part === '..')) throw new Error('Invalid proof cleanup reference');

    // Work through the canonical directory, not through a mutable root alias.
    let canonicalRoot: string;
    try { canonicalRoot = await fs.promises.realpath(lexicalRoot); }
    catch { throw new Error('Proof storage root is unavailable; ownership must be retained'); }
    let current = canonicalRoot;
    const parts = relative.split(path.sep);
    for (let index = 0; index < parts.length; index++) {
        current = path.join(current, parts[index]);
        let info: fs.Stats;
        try { info = await fs.promises.lstat(current); }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return allowMissingLeaf && index === parts.length - 1 ? current : null;
            throw error;
        }
        if (info.isSymbolicLink() || (index === parts.length - 1 ? !info.isFile() : !info.isDirectory())) {
            throw new Error('Proof cleanup requires a regular file without redirected child paths');
        }
    }
    return current;
}

/** All surviving invoice references protect a file, including legacy relative,
 * absolute and symlink spellings. Operational uncertainty never proves absence. */
async function hasLiveProofReference(reference: string, manager?: EntityManager): Promise<boolean> {
    const key = filesystemKey(reference);
    // Normal attachment uses one of these exact spellings. Keep its postcommit
    // protection independent of the total number of invoices in the installation.
    if (await invoiceService.hasInvoiceProofReference([reference, path.resolve(reference), portableProofPath(reference)], manager)) return true;
    let actual: string;
    try { actual = await fs.promises.realpath(path.resolve(reference)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
    let afterId = 0;
    let references: {id: number; path: string}[];
    do {
        // Fresh bounded pages retain legacy alias protection without hydrating
        // every invoice or caching authority across another attachment/commit.
        references = await invoiceService.getInvoiceProofReferencePage(afterId, manager);
        for (const value of references) {
            if (filesystemKey(value.path) === key) return true;
            try {
                if (filesystemKey(await fs.promises.realpath(path.resolve(value.path))) === filesystemKey(actual)) return true;
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
            }
        }
        afterId = references.at(-1)?.id ?? afterId;
    } while (references.length === 1000);
    return false;
}

/** Protect recovery/preservation records and active alias uploads during automatic
 * deletion. Reconciliation additionally respects every other durable ledger owner. */
async function hasOtherProofOwnership(reference: string, exceptId: string, mode: 'automatic' | 'reconciliation',
    manager?: EntityManager): Promise<boolean> {
    const key = filesystemKey(reference);
    const actual = await fs.promises.realpath(path.resolve(reference)).catch(function absent(error: NodeJS.ErrnoException) {
        if (error.code === 'ENOENT') return null;
        throw error;
    });
    let after: string | undefined;
    let rows: InvoiceProofFile[];
    do {
        rows = await invoiceService.getProofFilesPage(after, 100, manager);
        for (const row of rows) {
            if (row.id === exceptId) continue;
            if (mode === 'automatic' && !['QUARANTINING', 'QUARANTINED', 'RESTORING', 'PRESERVED'].includes(row.state)
                && !(row.ownerToken === processOwner && activeUploads.has(row.id))) continue;
            for (const owned of [row.path, row.quarantinePath].filter((value): value is string => !!value)) {
                if (filesystemKey(owned) === key) return true;
                if (!actual) continue;
                try {
                    if (filesystemKey(await fs.promises.realpath(path.resolve(owned))) === filesystemKey(actual)) return true;
                } catch (error) {
                    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
                }
            }
        }
        after = rows.at(-1)?.id;
    } while (rows.length === 100);
    return false;
}

/** Persist the destructive claim, then unlink outside the database transaction.
 * New attachment is fenced by DELETING; failed or interrupted removal stays retryable. */
async function cleanupProofFile(id: string, now = new Date()): Promise<boolean> {
    try {
        /** Decide from current locked ownership and committed invoice references. */
        async function claim(manager: EntityManager, row: InvoiceProofFile | null): Promise<string | null> {
            if (!row || !['STAGED', 'ATTACHED', 'DELETING'].includes(row.state)) return null;
            if (row.ownerToken === processOwner && activeUploads.has(row.id)) return null;
            if (row.retryAt && row.retryAt > now) return null;
            if (await hasLiveProofReference(row.path, manager)
                || row.quarantinePath && await hasLiveProofReference(row.quarantinePath, manager)) return null;
            if (await hasOtherProofOwnership(row.quarantinePath ?? row.path, row.id, 'automatic', manager)) return null;
            // Retain evidence before any filesystem mutation. A crash here simply
            // retries the same idempotent deletion after the next process starts.
            row.state = 'DELETING';
            row.ownerToken = null;
            await invoiceService.saveProofFile(row, manager);
            return row.quarantinePath ?? row.path;
        }
        const reference = await invoiceService.withProofFileTransaction(id, claim);
        if (!reference) return false;
        const file = await resolveManagedProof(reference);
        if (file) await fs.promises.unlink(file).catch(function absentIsComplete(error: NodeJS.ErrnoException) {
            if (error.code !== 'ENOENT') throw error;
        });
        /** Discard evidence only after physical removal (or confirmed absence). */
        async function complete(manager: EntityManager, row: InvoiceProofFile | null): Promise<void> {
            if (row?.state === 'DELETING') await invoiceService.deleteProofFile(id, manager);
        }
        await invoiceService.withProofFileTransaction(id, complete);
        return true;
    } catch {
        // Persist backoff when possible. A failed database acknowledgement leaves
        // the original ownership row intact; neither exception path assumes rollback.
        try {
            async function defer(manager: EntityManager, row: InvoiceProofFile | null): Promise<void> {
                if (!row || row.state !== 'DELETING') return;
                row.attempts++;
                row.retryAt = new Date(now.getTime() + Math.min(3_600_000, 1000 * 2 ** Math.min(row.attempts, 12)));
                await invoiceService.saveProofFile(row, manager);
            }
            await invoiceService.withProofFileTransaction(id, defer);
        } catch { /* Durable ownership survives an unavailable database. */ }
        console.warn('[invoice-proofs] Cleanup deferred', {id});
        return false;
    }
}

/** Attempt one selected postcommit cleanup through the single lifecycle owner. */
export async function deleteInvoiceProof(proofPath?: string | null): Promise<void> {
    if (!proofPath) return;
    // Callers may already have committed their record deletion. Failure to read
    // or acknowledge cleanup must leave its preexisting ledger evidence intact.
    try {
        await rememberInvoiceProofs([{proofPath}]);
        await cleanupProofFile(proofKey(proofPath));
    } catch { console.warn('[invoice-proofs] Selected cleanup deferred'); }
}

/** Bound each maintenance pass and carry the cursor across passes so live files
 * cannot starve later abandoned/cascaded ownership records indefinitely. */
export async function cleanupInvoiceProofs(limit = 100, now = new Date()): Promise<number> {
    let removed = 0;
    const boundedLimit = Number.isSafeInteger(limit) ? Math.min(1000, Math.max(1, limit)) : 100;
    try {
        const rows = await invoiceService.getProofFilesPage(cleanupCursor, boundedLimit);
        for (const row of rows) if (await cleanupProofFile(row.id, now)) removed++;
        cleanupCursor = rows.length === boundedLimit ? rows.at(-1)!.id : undefined;
    } catch { console.warn('[invoice-proofs] Ownership scan deferred'); }
    return removed;
}

/** Bind manifests to the configured effective target, without recording credentials. */
export function invoiceProofDatabaseTarget(): string {
    return `${settings.value.dbType}://${settings.value.dbHost}:${settings.value.dbPort}/${settings.value.dbName}`;
}

/** Only deterministic target, window and selected byte identities grant reconciliation scope. */
function reconciliationId(manifest: Pick<InvoiceProofReconciliationManifest, 'root' | 'database' | 'recoveryDays' | 'files'>): string {
    return createHash('sha256').update(JSON.stringify({root: manifest.root, database: manifest.database,
        recoveryDays: manifest.recoveryDays, files: manifest.files})).digest('hex');
}

/** Stream bytes under a stable regular-file identity, retaining bounded memory. */
async function inspectProof(reference: string, basename: string): Promise<InvoiceProofReconciliationEntry | null> {
    const file = await resolveManagedProof(reference);
    if (!file) return null;
    const before = await fs.promises.lstat(file, {bigint: true});
    const hash = createHash('sha256');
    // A concurrent rewrite must not create a manifest combining old identity with new bytes.
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
    const after = await fs.promises.lstat(file, {bigint: true});
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeNs !== after.mtimeNs) {
        throw new Error('Proof changed during reconciliation inspection');
    }
    return {path: basename, size: Number(after.size), mtimeMs: Number(after.mtimeMs),
        device: String(after.dev), inode: String(after.ino), sha256: hash.digest('hex')};
}

/** Match both bytes and filesystem identity rather than trusting a filename or age. */
function sameProofEntry(expected: InvoiceProofReconciliationEntry, actual: InvoiceProofReconciliationEntry | null): boolean {
    return !!actual && expected.size === actual.size && expected.mtimeMs === actual.mtimeMs
        && expected.device === actual.device && expected.inode === actual.inode && expected.sha256 === actual.sha256;
}

/** Inventory regular top-level proof files only while the installation is offline.
 * All live invoice and ledger references protect files; unfamiliar entries are reported, not purged. */
export async function createInvoiceProofManifest(recoveryDays: number, now = new Date()): Promise<InvoiceProofReconciliationManifest> {
    if (activeUploads.size) throw new Error('Proof reconciliation requires an offline application');
    const recoveryWindow = prepareProofRecoveryDays(recoveryDays);
    const root = await fs.promises.realpath(path.resolve(settings.value.invoiceDir));
    const protectedPaths = new Set((await invoiceService.getInvoiceProofReferences()).map(filesystemKey));
    let after: string | undefined;
    let page: InvoiceProofFile[];
    do {
        // Preserve every ledger state, including interrupted quarantine/restore and explicit preservation.
        page = await invoiceService.getProofFilesPage(after);
        for (const row of page) {
            for (const owned of [row.path, row.quarantinePath].filter((value): value is string => !!value)) {
                protectedPaths.add(filesystemKey(owned));
                try { protectedPaths.add(filesystemKey(await fs.promises.realpath(path.resolve(owned)))); }
                catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
            }
        }
        after = page.at(-1)?.id;
    } while (page.length === 100);

    const files: InvoiceProofReconciliationEntry[] = [];
    const ignored: string[] = [];
    const extensions = uploadFileMedia(true, true).extensions;
    const entries = (await fs.promises.readdir(root, {withFileTypes: true})).sort((left, right) => left.name.localeCompare(right.name, 'en'));
    for (const entry of entries) {
        const reference = path.join(path.resolve(settings.value.invoiceDir), entry.name);
        if (!entry.isFile() || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(entry.name)
            || !extensions.includes(path.extname(entry.name).toLowerCase())) {
            ignored.push(entry.name);
            continue;
        }
        // Resolve aliases through the shared live-reference check as well as the
        // cheap inventory set; a legacy link must not turn a valid proof into a candidate.
        if (protectedPaths.has(filesystemKey(reference))
            || protectedPaths.has(filesystemKey(await fs.promises.realpath(reference))) || await hasLiveProofReference(reference)) continue;
        const inspected = await inspectProof(reference, entry.name);
        if (inspected) files.push(inspected);
    }
    const manifest = {version: 1 as const, id: '', createdAt: now.toISOString(), root,
        database: invoiceProofDatabaseTarget(), recoveryDays: recoveryWindow, files, ignored};
    manifest.id = reconciliationId(manifest);
    return manifest;
}

/** Admit a selected manifest against this installation and its original byte inventory. */
async function admitProofManifest(input: unknown): Promise<InvoiceProofReconciliationManifest> {
    const manifest = prepareProofReconciliationManifest(input);
    if (activeUploads.size || manifest.database !== invoiceProofDatabaseTarget()
        || manifest.root !== await fs.promises.realpath(path.resolve(settings.value.invoiceDir))
        || manifest.id !== reconciliationId(manifest)) {
        throw new Error('Proof manifest does not match the offline installation and selected inventory');
    }
    return manifest;
}

/** Create only the two known quarantine directories without following a child symlink. */
async function quarantineDirectory(manifest: InvoiceProofReconciliationManifest): Promise<string> {
    let directory = manifest.root;
    for (const segment of ['.proof-quarantine', manifest.id]) {
        directory = path.join(directory, segment);
        try { await fs.promises.mkdir(directory); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
        const information = await fs.promises.lstat(directory);
        if (!information.isDirectory() || information.isSymbolicLink()
            || await fs.promises.realpath(directory) !== directory) throw new Error('Redirected proof quarantine directory');
    }
    return directory;
}

/** Preserve bytes without overwriting an existing target. A hard link makes
 * interrupted transfer recoverable even if both names exist after a crash. */
async function transferProof(source: string, destination: string, expected: InvoiceProofReconciliationEntry): Promise<void> {
    const original = await inspectProof(source, expected.path);
    const target = await inspectProof(destination, expected.path);
    if (target && !sameProofEntry(expected, target) || original && !sameProofEntry(expected, original)) {
        throw new Error('Proof identity changed since the selected manifest');
    }
    if (!original && !target) throw new Error('Selected proof and its recovery copy are both missing');
    // Link refuses to replace an existing file. Only after a matching recovery
    // name exists may the old name be removed; both outcomes remain idempotent.
    const actualSource = await resolveManagedProof(source);
    const actualDestination = await resolveManagedProof(destination, true);
    if (original && !target) {
        if (!actualSource || !actualDestination) throw new Error('Proof transfer directory changed');
        await fs.promises.link(actualSource, actualDestination);
    }
    // Recheck the linked bytes and the source immediately before removing a name.
    // Unexpected replacement remains recoverable rather than being overwritten/deleted.
    if (!sameProofEntry(expected, await inspectProof(destination, expected.path))) throw new Error('Proof recovery copy changed during transfer');
    if (original && actualSource) {
        if (!sameProofEntry(expected, await inspectProof(source, expected.path))) throw new Error('Proof source changed during transfer');
        await fs.promises.unlink(actualSource);
    }
}

/** Retire one selected orphan into recoverable storage, preserving intent before I/O. */
async function quarantineProof(manifest: InvoiceProofReconciliationManifest, entry: InvoiceProofReconciliationEntry,
    now: Date): Promise<boolean> {
    const reference = portableProofPath(path.join(path.resolve(settings.value.invoiceDir), entry.path));
    const id = proofKey(reference);
    await quarantineDirectory(manifest);
    const quarantinePath = portableProofPath(path.join(path.resolve(settings.value.invoiceDir), '.proof-quarantine', manifest.id, entry.path));
    if (quarantinePath.length > 255) throw new Error('Proof recovery path exceeds supported storage length');
    if (await hasOtherProofOwnership(reference, id, 'reconciliation')) throw new Error('Another ledger record owns this proof');
    // Refuse stale inventories before creating ownership for bytes that changed.
    const existing = await invoiceService.getProofFile(id);
    if (!existing && !sameProofEntry(entry, await inspectProof(reference, entry.path))) throw new Error('Selected orphan changed or disappeared');
    await invoiceService.insertProofFile({id, path: reference, state: 'QUARANTINING', ownerToken: null,
        manifestId: manifest.id, quarantinePath});
    /** Fence the selected recovery operation against any intervening reference. */
    async function claim(manager: EntityManager, row: InvoiceProofFile | null): Promise<boolean> {
        if (!row || row.manifestId !== manifest.id || !['QUARANTINING', 'QUARANTINED', 'PRESERVED'].includes(row.state)) {
            throw new Error('Selected orphan acquired different ownership');
        }
        if (await hasLiveProofReference(row.path, manager)) throw new Error('A live invoice now references the selected proof');
        if (row.state === 'PRESERVED') {
            // Only another explicit selection of this same manifest can retire a
            // restored file again. Automatic maintenance never clears preservation.
            if (!sameProofEntry(entry, await inspectProof(row.path, entry.path))) throw new Error('Restored proof identity changed');
            row.state = 'QUARANTINING';
            row.quarantinePath = quarantinePath;
            row.quarantinedAt = null;
            await invoiceService.saveProofFile(row, manager);
        }
        if (row.state === 'QUARANTINED' && (!row.quarantinePath
            || !sameProofEntry(entry, await inspectProof(row.quarantinePath, entry.path)))) throw new Error('Quarantined proof identity changed');
        return row.state !== 'QUARANTINED';
    }
    if (!await invoiceService.withProofFileTransaction(id, claim)) return false;
    await transferProof(reference, quarantinePath, entry);
    /** Start the full recovery window only after quarantine transfer completes. */
    async function complete(manager: EntityManager, row: InvoiceProofFile | null): Promise<void> {
        if (row?.state !== 'QUARANTINING' || row.manifestId !== manifest.id) throw new Error('Proof quarantine ownership changed');
        row.state = 'QUARANTINED';
        row.quarantinedAt = now;
        await invoiceService.saveProofFile(row, manager);
    }
    await invoiceService.withProofFileTransaction(id, complete);
    return true;
}

/** Restore selected bytes without overwriting a newer file, and protect the restored
 * orphan from automatic cleanup until an operator deliberately reclassifies it. */
async function restoreProof(manifest: InvoiceProofReconciliationManifest, entry: InvoiceProofReconciliationEntry): Promise<boolean> {
    const reference = portableProofPath(path.join(path.resolve(settings.value.invoiceDir), entry.path));
    const id = proofKey(reference);
    /** Persist recovery intent so a crash between link/unlink can be resumed. */
    async function claim(manager: EntityManager, row: InvoiceProofFile | null): Promise<string | null> {
        if (row?.manifestId === manifest.id && row.state === 'PRESERVED') {
            if (!sameProofEntry(entry, await inspectProof(row.path, entry.path))) throw new Error('Restored proof identity changed');
            return null;
        }
        if (!row || row.manifestId !== manifest.id || !row.quarantinePath || !['QUARANTINED', 'RESTORING'].includes(row.state)) {
            throw new Error('Selected proof is not in this manifest quarantine');
        }
        row.state = 'RESTORING';
        await invoiceService.saveProofFile(row, manager);
        return row.quarantinePath;
    }
    const source = await invoiceService.withProofFileTransaction(id, claim);
    if (!source) return false;
    await transferProof(path.resolve(source), path.resolve(reference), entry);
    /** Keep an explicit preservation record instead of feeding restored bytes back to deletion. */
    async function complete(manager: EntityManager, row: InvoiceProofFile | null): Promise<void> {
        if (!row || row.state !== 'RESTORING' || row.manifestId !== manifest.id) throw new Error('Proof restore ownership changed');
        row.state = 'PRESERVED';
        row.quarantinePath = null;
        await invoiceService.saveProofFile(row, manager);
    }
    await invoiceService.withProofFileTransaction(id, complete);
    return true;
}

/** Explicit final removal requires an elapsed recovery window and the same selected bytes. */
async function purgeQuarantinedProof(manifest: InvoiceProofReconciliationManifest, entry: InvoiceProofReconciliationEntry,
    now: Date): Promise<boolean> {
    const id = proofKey(portableProofPath(path.join(path.resolve(settings.value.invoiceDir), entry.path)));
    /** Keep final purge evidence durable so an interrupted unlink can be retried. */
    async function claim(manager: EntityManager, row: InvoiceProofFile | null): Promise<string | null> {
        if (!row) return null;
        if (row.manifestId !== manifest.id || !row.quarantinePath || !['QUARANTINED', 'DELETING'].includes(row.state)) {
            throw new Error('Selected proof is not in this manifest quarantine');
        }
        if (!row.quarantinedAt || now.getTime() < row.quarantinedAt.getTime() + manifest.recoveryDays * 86_400_000) {
            throw new Error('The selected proof recovery window has not elapsed');
        }
        if (await hasLiveProofReference(row.path, manager) || await hasLiveProofReference(row.quarantinePath, manager)) {
            throw new Error('A live invoice references this proof');
        }
        const actual = await inspectProof(row.quarantinePath, entry.path);
        if (actual ? !sameProofEntry(entry, actual) : row.state !== 'DELETING') throw new Error('Quarantined proof identity changed');
        row.state = 'DELETING';
        row.retryAt = null;
        await invoiceService.saveProofFile(row, manager);
        return row.quarantinePath;
    }
    if (!await invoiceService.withProofFileTransaction(id, claim)) return false;
    const removed = await cleanupProofFile(id, now);
    if (!removed && await invoiceService.getProofFile(id)) throw new Error('Proof purge is deferred; durable recovery evidence remains');
    return removed;
}

/** Apply only one explicit offline action to the selected manifest, serializing
 * maintenance commands and sharing the normal lifecycle's fences and deletion policy. */
export async function reconcileInvoiceProofs(input: unknown, action: InvoiceProofReconciliationAction,
    now = new Date()): Promise<InvoiceProofReconciliationResult> {
    const manifest = await admitProofManifest(input);
    if (!invoiceProofReconciliationActions.includes(action)) throw new Error('Unknown proof reconciliation action');
    /** Process each selected entry without granting authority over neighboring files. */
    async function reconcileSelected(): Promise<InvoiceProofReconciliationResult> {
        const result = {processed: 0, skipped: 0};
        for (const entry of manifest.files) {
            const changed = action === 'quarantine' ? await quarantineProof(manifest, entry, now)
                : action === 'restore' ? await restoreProof(manifest, entry) : await purgeQuarantinedProof(manifest, entry, now);
            if (changed) result.processed++; else result.skipped++;
        }
        return result;
    }
    const locked = await invoiceService.withProofMaintenanceLock(reconcileSelected);
    if (!locked) throw new Error('Another proof reconciliation command is running');
    return locked.result;
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
    const fullPath = resolveStoredFile(settings.value.invoiceDir, invoice.proofPath);
    if (!fullPath) {
        throw new APIError(invoiceText('invalidProofPath'), {}, 400, {cause: invoiceRejectionCause('invalidProofPath')});
    }

    // Check if file exists (async)
    try {
        await fs.promises.access(fullPath, fs.constants.R_OK);
    } catch {
        throw new APIError(invoiceText('proofFileNotFound'), {}, 404);
    }

    return fullPath;
}
