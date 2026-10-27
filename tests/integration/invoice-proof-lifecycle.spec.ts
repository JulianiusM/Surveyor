import 'reflect-metadata';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import http from 'node:http';
import express from 'express';
import type {Request} from 'express';
import type {EntitySubscriberInterface, InsertEvent} from 'typeorm';
import {afterAll, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';
import {AppDataSource} from '../../src/backend/modules/database/dataSource';
import {InvoiceProofFile} from '../../src/backend/modules/database/entities/event/InvoiceProofFile';
import {EventInvoice} from '../../src/backend/modules/database/entities/event/EventInvoice';
import type {Profile} from '../../src/backend/modules/database/entities/user/Profile';
import {AddInvoiceProofFiles1793059200000} from '../../src/backend/migrations/1793059200000-AddInvoiceProofFiles';
import * as invoiceService from '../../src/backend/modules/database/services/EventInvoiceService';
import * as eventService from '../../src/backend/modules/database/services/EventService';
import * as invoiceOperations from '../../src/backend/modules/invoice/invoiceOperations';
import {allocateInvoiceProofUpload, cleanupInvoiceProofs, createInvoiceProofManifest, finishInvoiceProofRequest,
    reconcileInvoiceProofs, rememberInvoiceProofs} from '../../src/backend/modules/invoice/proofs';
import {purgeExpiredInvoices} from '../../src/backend/modules/invoice/retention';
import {prepareFileUploader} from '../../src/backend/modules/lib/fileCommons';
import eventPoolController from '../../src/backend/controller/eventPoolController';
import settings from '../../src/backend/modules/settings';
import {closeIntegrationDatabase, initializeIntegrationDatabase} from '../support/database';
import {createIntegrationEvent, persistIntegrationProfile, registerEventAttendance} from '../keywords/coreDomainKeywords';

let owner: Profile;
let participant: Profile;
let temporary: string;
let directory: string;
let originalDirectory: string;

/** This fixture owns only its guarded temporary tree and the disposable integration schema. */
beforeAll(async () => {
    await initializeIntegrationDatabase();
    owner = await persistIntegrationProfile({name: 'Proof organizer'});
    participant = await persistIntegrationProfile({name: 'Proof participant'});
    originalDirectory = settings.value.invoiceDir;
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'surveyor-proof-ledger-'));
}, 120_000);

beforeEach(async () => {
    // No other suite owns this serialized schema. Remove prior fixture references
    // so each test can assert exact ownership counts without hiding a production read.
    await AppDataSource.getRepository(EventInvoice).clear();
    await AppDataSource.getRepository(InvoiceProofFile).clear();
    directory = await fs.promises.mkdtemp(path.join(temporary, 'case-'));
    // The established uploader accepts application-relative storage settings.
    // Keep its real configuration form while targeting only this owned temp tree.
    settings.value.invoiceDir = path.relative(process.cwd(), directory);
});

afterAll(async () => {
    if (originalDirectory !== undefined) settings.value.invoiceDir = originalDirectory;
    await closeIntegrationDatabase();
    if (!temporary) return;
    const resolved = path.resolve(temporary);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('surveyor-proof-ledger-')) {
        throw new Error('Refusing unsafe proof-fixture cleanup');
    }
    await fs.promises.rm(resolved, {recursive: true, force: true});
});

/** Create actual business data; no repository or feature service is replaced. */
async function context(title = 'Proof ownership') {
    const eventId = await createIntegrationEvent(owner.id, title);
    const event = (await eventService.getEventById(eventId))!;
    const poolId = await eventPoolController.createInvoicePool(event, {
        name: title, description: 'Proof lifecycle', distribution: 'EQUAL', assignAll: 'on',
    });
    return {event, poolId};
}

/** Reserve before writing, as the production disk-storage callback does. */
async function stagedProof() {
    const request = {aborted: false} as Request;
    const file = path.join(directory, `proof-${randomUUID()}.pdf`);
    await allocateInvoiceProofUpload(request, file);
    await fs.promises.writeFile(file, '%PDF-1.4 proof lifecycle', {flag: 'wx'});
    return {request, file, proof: {path: path.relative(process.cwd(), file), originalName: 'receipt.pdf', mimeType: 'application/pdf'}};
}

/** Commit an organizer invoice through the actual locked operation and release request ownership. */
async function savedProof(title = 'Saved proof') {
    const data = await context(title);
    const upload = await stagedProof();
    let invoiceId: number;
    try { invoiceId = await invoiceOperations.persistOrganizerInvoice(data.poolId, owner.id, 10, title, upload.proof); }
    finally { await finishInvoiceProofRequest(upload.request); }
    return {...data, ...upload, invoiceId};
}

/** A barrier subscriber delays only the real ORM acknowledgement after its INSERT.
 * It does not replace repositories, metadata, SQL or the production lifecycle. */
function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return {promise, resolve};
}

describe('durable invoice proof ownership', () => {
    it('keeps reservation active while its real insert acknowledgement is delayed', async () => {
        const inserted = deferred();
        const continueAllocation = deferred();
        const file = path.join(directory, `before-bytes-${randomUUID()}.pdf`);
        const request = {aborted: false} as Request;
        let insertObserved = false;
        const subscriber: EntitySubscriberInterface<InvoiceProofFile> = {
            listenTo: () => InvoiceProofFile,
            async afterInsert(event: InsertEvent<InvoiceProofFile>) {
                if (event.entity?.path === path.relative(process.cwd(), file)) {
                    insertObserved = true;
                    inserted.resolve();
                    await continueAllocation.promise;
                }
            },
        };
        AppDataSource.subscribers.push(subscriber);
        const allocation = allocateInvoiceProofUpload(request, file);
        try {
            await Promise.race([inserted.promise, allocation]);
            expect(insertObserved).toBe(true);
            await cleanupInvoiceProofs();
            expect(await AppDataSource.getRepository(InvoiceProofFile).count()).toBe(1);
            await expect(fs.promises.access(file)).rejects.toThrow();
            continueAllocation.resolve();
            await allocation;
            await fs.promises.writeFile(file, 'reserved before bytes', {flag: 'wx'});
        } finally {
            continueAllocation.resolve();
            try { await allocation; }
            finally {
                const index = AppDataSource.subscribers.indexOf(subscriber);
                if (index >= 0) AppDataSource.subscribers.splice(index, 1);
                await finishInvoiceProofRequest(request);
            }
        }
        await expect(fs.promises.access(file)).rejects.toThrow();
        expect(await AppDataSource.getRepository(InvoiceProofFile).count()).toBe(0);
    });

    it('uses real multipart prewrite ownership for success, structural rejection and client abort', async () => {
        const data = await context('Multipart proof');
        const abortAllocated = deferred();
        const abortFinished = deferred();
        let prewriteChecks = 0;
        let uploadError: unknown;
        /** Observe allocation at the actual generic-storage callback, before disk bytes. */
        async function allocate(request: Request, file: string): Promise<void> {
            await allocateInvoiceProofUpload(request, file);
            await expect(fs.promises.access(file)).rejects.toThrow();
            prewriteChecks++;
            if (request.url.includes('abort')) abortAllocated.resolve();
        }
        const upload = prepareFileUploader(settings.value.invoiceDir, true, true, allocate).single('proof');
        const app = express();
        app.post('/upload', async function receiveProof(request, response) {
            let status = 201;
            uploadError = undefined;
            try {
                await new Promise<void>((resolve, reject) => upload(request, response, error => error ? reject(error) : resolve()));
                if (request.url.includes('reject')) throw new Error('Synthetic structural rejection');
                if (!request.file) throw new Error('Missing fixture upload');
                await invoiceOperations.persistOrganizerInvoice(data.poolId, owner.id, 10, 'Multipart proof', {
                    path: path.relative(process.cwd(), request.file.path), originalName: request.file.originalname, mimeType: request.file.mimetype,
                });
            } catch (error) { uploadError = error; status = 400; }
            finally {
                await finishInvoiceProofRequest(request);
                if (request.url.includes('abort')) abortFinished.resolve();
            }
            if (!response.destroyed) response.status(status).end();
        });
        const server = http.createServer(app);
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Fixture has no listening port');
        const origin = `http://127.0.0.1:${address.port}`;
        try {
            for (const rejected of [true, false]) {
                const body = new FormData();
                body.append('proof', new Blob(['%PDF-1.4 multipart'], {type: 'application/pdf'}), 'receipt.pdf');
                const response = await fetch(`${origin}/upload${rejected ? '?reject=1' : ''}`, {method: 'POST', body});
                if (!rejected && response.status !== 201) throw uploadError;
                expect(response.status).toBe(rejected ? 400 : 201);
                await response.arrayBuffer();
                expect(await AppDataSource.getRepository(InvoiceProofFile).count()).toBe(rejected ? 0 : 1);
            }
            const boundary = 'proof-abort-boundary';
            const outgoing = http.request(`${origin}/upload?abort=1`, {method: 'POST', headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
            }});
            outgoing.on('error', () => undefined);
            outgoing.write(`--${boundary}\r\nContent-Disposition: form-data; name="proof"; filename="receipt.pdf"\r\nContent-Type: application/pdf\r\n\r\npartial proof`);
            await abortAllocated.promise;
            outgoing.destroy();
            await abortFinished.promise;
            expect(prewriteChecks).toBe(3);
            expect(await AppDataSource.getRepository(InvoiceProofFile).count()).toBe(1);
            expect((await fs.promises.readdir(directory)).length).toBe(1);
        } finally {
            const closing = new Promise<void>(resolve => server.close(() => resolve()));
            server.closeAllConnections();
            await closing;
        }
    });

    it('attaches once and preserves bytes through request cleanup, remember and migration backfill', async () => {
        const saved = await savedProof();
        await rememberInvoiceProofs([{proofPath: saved.proof.path}]);
        const runner = AppDataSource.createQueryRunner();
        try { await new AddInvoiceProofFiles1793059200000().up(runner); }
        finally { await runner.release(); }
        const rows = await AppDataSource.getRepository(InvoiceProofFile).find();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({path: saved.proof.path, state: 'ATTACHED', ownerToken: null});
        await cleanupInvoiceProofs();
        await expect(fs.promises.readFile(saved.file, 'utf8')).resolves.toContain('proof lifecycle');
    });

    it('preserves an absolute direct-domain proof spelling without creating another ownership row', async () => {
        const data = await context();
        const file = path.join(directory, `absolute-${randomUUID()}.pdf`);
        await fs.promises.writeFile(file, 'absolute direct-domain upload', {flag: 'wx'});
        await invoiceOperations.persistOrganizerInvoice(data.poolId, owner.id, 10, 'Absolute proof', {
            path: file, originalName: 'receipt.pdf', mimeType: 'application/pdf',
        });
        await rememberInvoiceProofs([{proofPath: file}]);
        const rows = await AppDataSource.getRepository(InvoiceProofFile).find();
        expect(rows).toHaveLength(1);
        expect(rows[0].path).toBe(file);
        expect((await AppDataSource.getRepository(EventInvoice).findOneByOrFail({proofPath: file})).proofPath).toBe(file);
    });

    it('cleans structural/business rejection and refuses a late allocation after request completion', async () => {
        const data = await context();
        const upload = await stagedProof();
        try {
            await expect(invoiceOperations.persistOrganizerInvoice(data.poolId, owner.id, 10, 'Rejected actor', upload.proof, -1))
                .rejects.toMatchObject({status: 400});
        } finally { await finishInvoiceProofRequest(upload.request); }
        await expect(fs.promises.access(upload.file)).rejects.toThrow();
        expect(await AppDataSource.getRepository(InvoiceProofFile).count()).toBe(0);

        const request = {aborted: false} as Request;
        await finishInvoiceProofRequest(request);
        const late = path.join(directory, `late-${randomUUID()}.pdf`);
        await expect(allocateInvoiceProofUpload(request, late)).rejects.toThrow('ended');
        await cleanupInvoiceProofs();
        expect(await AppDataSource.getRepository(InvoiceProofFile).count()).toBe(0);
    });

    it('protects committed bytes through Event deletion and shared legacy references', async () => {
        const first = await savedProof();
        const second = await context('Shared legacy proof');
        await AppDataSource.getRepository(EventInvoice).save({pool: {id: second.poolId}, amount: '10.00', status: 'NEW', proofPath: first.proof.path});
        await eventService.deleteEvent(first.event.id);
        await cleanupInvoiceProofs();
        await expect(fs.promises.access(first.file)).resolves.toBeUndefined();
        await eventService.deleteEvent(second.event.id);
        await cleanupInvoiceProofs();
        await expect(fs.promises.access(first.file)).rejects.toThrow();
        expect(await AppDataSource.getRepository(InvoiceProofFile).count()).toBe(0);
    });

    it.each(['self', 'organizer'] as const)('retains cleanup evidence through %s registration cascade', async action => {
        const data = await context();
        await registerEventAttendance(data.event.id, participant, {arrivalDate: '2027-06-01', departureDate: '2027-06-03'});
        const registration = (await eventService.getRegistrationFor(participant.id, data.event.id))!;
        const upload = await stagedProof();
        try { await invoiceOperations.persistSubmittedInvoice(data.poolId, registration.id, 10, 'Participant proof', upload.proof); }
        finally { await finishInvoiceProofRequest(upload.request); }
        if (action === 'self') await eventService.deleteRegistrationFor(data.event.id, participant.id);
        else await eventService.deleteRegistration(data.event.id, registration.id);
        await cleanupInvoiceProofs();
        await expect(fs.promises.access(upload.file)).rejects.toThrow();
        expect(await AppDataSource.getRepository(EventInvoice).count()).toBe(0);
    });

    it('keeps the live invoice and proof when retention database deletion rolls back', async () => {
        const saved = await savedProof('Retention rollback');
        await eventService.updateEventDates(saved.event.id, '2020-01-01', '2020-01-02');
        const runner = AppDataSource.createQueryRunner();
        await runner.query("CREATE TRIGGER test_proof_retention_rollback BEFORE DELETE ON event_invoices FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Synthetic retention rollback'");
        try {
            await expect(purgeExpiredInvoices(0, new Date('2026-10-27T00:00:00Z'))).rejects.toThrow('Synthetic retention rollback');
            expect(await AppDataSource.getRepository(EventInvoice).count()).toBe(1);
            await expect(fs.promises.access(saved.file)).resolves.toBeUndefined();
            expect((await AppDataSource.getRepository(InvoiceProofFile).findOneByOrFail({path: saved.proof.path})).state).toBe('ATTACHED');
        } finally {
            await runner.query('DROP TRIGGER IF EXISTS test_proof_retention_rollback');
            await runner.release();
        }
        await purgeExpiredInvoices(0, new Date('2026-10-27T00:00:00Z'));
        await expect(fs.promises.access(saved.file)).rejects.toThrow();
    });

    it('retries an external unlink failure and retains ownership while the root is unavailable', async () => {
        const caseDirectory = directory;
        const saved = await savedProof();
        await eventService.deleteEvent(saved.event.id);
        const unlink = vi.spyOn(fs.promises, 'unlink').mockRejectedValueOnce(Object.assign(new Error('Synthetic busy file'), {code: 'EACCES'}));
        try { await cleanupInvoiceProofs(); }
        finally { unlink.mockRestore(); }
        const row = await AppDataSource.getRepository(InvoiceProofFile).findOneByOrFail({path: saved.proof.path});
        expect(row).toMatchObject({state: 'DELETING', attempts: 1});
        expect(row.retryAt).toBeInstanceOf(Date);
        const moved = caseDirectory + '-offline';
        await fs.promises.rename(caseDirectory, moved);
        try {
            await cleanupInvoiceProofs(100, new Date(Date.now() + 60_000));
            expect(await AppDataSource.getRepository(InvoiceProofFile).count()).toBe(1);
        } finally { await fs.promises.rename(moved, caseDirectory); }
        await cleanupInvoiceProofs(100, new Date(Date.now() + 3_600_000));
        expect(await AppDataSource.getRepository(InvoiceProofFile).count()).toBe(0);
        await expect(fs.promises.access(saved.file)).rejects.toThrow();
    });

    it('recovers an abandoned earlier-process upload without touching active uploads', async () => {
        const active = await stagedProof();
        const abandoned = path.join(directory, `abandoned-${randomUUID()}.pdf`);
        await fs.promises.writeFile(abandoned, 'old process upload', {flag: 'wx'});
        const reference = path.relative(process.cwd(), abandoned);
        await invoiceService.insertProofFile({id: createHash('sha256').update(reference).digest('hex'), path: reference,
            state: 'STAGED', ownerToken: randomUUID()});
        try {
            await cleanupInvoiceProofs();
            await expect(fs.promises.access(abandoned)).rejects.toThrow();
            await expect(fs.promises.access(active.file)).resolves.toBeUndefined();
        } finally { await finishInvoiceProofRequest(active.request); }
    });

    it('backfills byte-distinct legacy paths and refuses destructive metadata rollback', async () => {
        const data = await context();
        await AppDataSource.getRepository(EventInvoice).save(['Case.pdf', 'case.pdf'].map(name => ({
            pool: {id: data.poolId}, amount: '10.00', status: 'NEW' as const, proofPath: path.join(directory, name),
        })));
        const runner = AppDataSource.createQueryRunner();
        const migration = new AddInvoiceProofFiles1793059200000();
        try {
            await migration.up(runner);
            await migration.up(runner);
            expect((await AppDataSource.getRepository(InvoiceProofFile).find()).map(row => path.basename(row.path)).sort()).toEqual(['Case.pdf', 'case.pdf']);
            await expect(migration.down(runner)).rejects.toThrow('tracked files');
            await AppDataSource.getRepository(EventInvoice).clear();
            await AppDataSource.getRepository(InvoiceProofFile).clear();
            await migration.down(runner);
            await migration.up(runner);
            expect(await runner.hasTable('invoice_proof_files')).toBe(true);
        } finally { await runner.release(); }
    });
});

describe('offline historical proof reconciliation', () => {
    it('inventories only unowned files and supports idempotent quarantine and restore', async () => {
        const live = await savedProof();
        const orphan = path.join(directory, 'historical-orphan.pdf');
        await fs.promises.writeFile(orphan, 'historical orphan', {flag: 'wx'});
        await fs.promises.writeFile(path.join(directory, 'inspect-me.txt'), 'unfamiliar file', {flag: 'wx'});
        const manifest = await createInvoiceProofManifest(7);
        expect(manifest.files.map(entry => entry.path)).toEqual(['historical-orphan.pdf']);
        expect(manifest.ignored).toContain('inspect-me.txt');
        await expect(reconcileInvoiceProofs(manifest, 'quarantine')).resolves.toEqual({processed: 1, skipped: 0});
        await expect(reconcileInvoiceProofs(manifest, 'quarantine')).resolves.toEqual({processed: 0, skipped: 1});
        await expect(fs.promises.access(orphan)).rejects.toThrow();
        await expect(fs.promises.access(live.file)).resolves.toBeUndefined();
        await expect(reconcileInvoiceProofs(manifest, 'restore')).resolves.toEqual({processed: 1, skipped: 0});
        await cleanupInvoiceProofs();
        await expect(fs.promises.readFile(orphan, 'utf8')).resolves.toBe('historical orphan');
        await expect(reconcileInvoiceProofs(manifest, 'restore')).resolves.toEqual({processed: 0, skipped: 1});
        await expect(reconcileInvoiceProofs(manifest, 'quarantine')).resolves.toEqual({processed: 1, skipped: 0});
    });

    it('rejects stale bytes, changed targets and live references acquired after inventory', async () => {
        const orphan = path.join(directory, 'stale-orphan.pdf');
        await fs.promises.writeFile(orphan, 'original', {flag: 'wx'});
        const stale = await createInvoiceProofManifest(1);
        await fs.promises.writeFile(orphan, 'rewritten');
        await expect(reconcileInvoiceProofs(stale, 'quarantine')).rejects.toThrow('changed');
        const manifest = await createInvoiceProofManifest(1);
        await expect(reconcileInvoiceProofs({...manifest, database: 'wrong target'}, 'quarantine')).rejects.toThrow('does not match');
        const data = await context();
        await AppDataSource.getRepository(EventInvoice).save({pool: {id: data.poolId}, amount: '10.00', status: 'NEW', proofPath: orphan});
        await expect(reconcileInvoiceProofs(manifest, 'quarantine')).rejects.toThrow('live invoice');
        await expect(fs.promises.readFile(orphan, 'utf8')).resolves.toBe('rewritten');
    });

    it('requires the recovery window and completes an interrupted purge after bytes are already gone', async () => {
        const orphan = path.join(directory, 'purge-orphan.pdf');
        await fs.promises.writeFile(orphan, 'recoverable proof', {flag: 'wx'});
        const manifest = await createInvoiceProofManifest(1);
        const now = new Date();
        await reconcileInvoiceProofs(manifest, 'quarantine', now);
        await expect(reconcileInvoiceProofs(manifest, 'purge', now)).rejects.toThrow('window');
        const row = await AppDataSource.getRepository(InvoiceProofFile).findOneByOrFail({manifestId: manifest.id});
        // Reproduce a crash after authorized unlink but before deleting durable evidence.
        row.state = 'DELETING';
        await AppDataSource.getRepository(InvoiceProofFile).save(row);
        await fs.promises.unlink(path.resolve(row.quarantinePath!));
        const afterWindow = new Date(now.getTime() + 2 * 86_400_000);
        await expect(reconcileInvoiceProofs(manifest, 'purge', afterWindow)).resolves.toEqual({processed: 1, skipped: 0});
        await expect(reconcileInvoiceProofs(manifest, 'purge', afterWindow)).resolves.toEqual({processed: 0, skipped: 1});
        expect(await AppDataSource.getRepository(InvoiceProofFile).count()).toBe(0);
    });
});
