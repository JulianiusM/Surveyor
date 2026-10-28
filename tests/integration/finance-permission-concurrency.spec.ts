import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest';
import {AppDataSource} from '../../src/backend/modules/database/dataSource';
import * as adminService from '../../src/backend/modules/database/services/EntityAdminService';
import * as eventService from '../../src/backend/modules/database/services/EventService';
import * as invoiceService from '../../src/backend/modules/database/services/EventInvoiceService';
import * as invoiceOperations from '../../src/backend/modules/invoice/invoiceOperations';
import {withInvoiceManagementEvent} from '../../src/backend/modules/invoice/state';
import eventPoolController, {createEventFinancePool, updateEventFinanceSettings, updateEventFinanceTakeovers,
    closeEventInvoice} from '../../src/backend/controller/eventPoolController';
import {PERM} from '../../src/backend/modules/lib/permissions';
import mailer from '../../src/backend/modules/email';
import type {Profile} from '../../src/backend/modules/database/entities/user/Profile';
import type {SessionLike} from '../../src/types/PermissionTypes';
import {createIntegrationEvent, persistIntegrationProfile, registerEventAttendance} from '../keywords/coreDomainKeywords';
import {closeIntegrationDatabase, initializeIntegrationDatabase} from '../support/database';

beforeAll(initializeIntegrationDatabase);
afterAll(closeIntegrationDatabase);

function actor(profile: Profile): SessionLike { return {profile, auth: {user: profile.user!}}; }

/** Real grants, Event rows and pool rows establish the same production ownership
 * as an admitted management command; only external SMTP is replaced in its test. */
async function fixture() {
    const owner = await persistIntegrationProfile({name: 'Finance owner'});
    const administrator = await persistIntegrationProfile({name: 'Finance administrator'});
    const eventId = await createIntegrationEvent(owner.id, 'Finance grant serialization');
    const event = (await eventService.getEventById(eventId))!;
    await adminService.updatePerms('event', eventId, {public: 0, authenticated: 0, guest: 0, participant: 0});
    await adminService.addAdmin('event', eventId, administrator.id, PERM.MANAGE_ASSIGNMENTS);
    const poolId = await eventPoolController.createInvoicePool(event, {name: 'Original pool', distribution: 'EQUAL', assignAll: true});
    return {eventId, event, poolId, owner, administrator};
}

/** Observe actual SQL without replacing a query, result, repository or service.
 * Named lock attempts let tests coordinate opposing real transactions without
 * sleeps or claims based on a request merely having started. */
function observeLocks(eventId: string, poolId: string) {
    let eventAttempts = 0;
    let poolAttempt = false;
    const listeners = new Set<() => void>();
    const original = AppDataSource.logger.logQuery.bind(AppDataSource.logger);
    const observer = vi.spyOn(AppDataSource.logger, 'logQuery').mockImplementation((query, parameters, runner) => {
        if (query.includes('FOR UPDATE')) {
            if (query.includes('FROM `events`') && parameters?.includes(eventId)) eventAttempts++;
            if (query.includes('FROM `event_invoice_pools`') && parameters?.includes(poolId)) poolAttempt = true;
            for (const listener of listeners) listener();
        }
        original(query, parameters, runner);
    });

    /** Stop waiting on a missed milestone with a specific bounded diagnostic. */
    async function waitFor(ready: () => boolean, description: string): Promise<void> {
        if (ready()) return;
        const reached = Promise.withResolvers<void>();
        const timeout = setTimeout(() => reached.reject(new Error(`Missing Finance lock milestone: ${description}`)), 3000);
        function changed(): void { if (ready()) reached.resolve(); }
        listeners.add(changed);
        try { await reached.promise; }
        finally { clearTimeout(timeout); listeners.delete(changed); }
    }
    return {event: (count: number) => waitFor(() => eventAttempts >= count, `Event attempt ${count}`),
        pool: () => waitFor(() => poolAttempt, 'pool attempt'), stop: () => observer.mockRestore()};
}

describe('Finance management authorization under the Event fence', () => {
    it('rejects a previously admitted write when revocation commits before its Event lock', async () => {
        const {eventId, poolId, administrator} = await fixture();
        const blocker = AppDataSource.createQueryRunner();
        await blocker.connect();
        await blocker.startTransaction('READ COMMITTED');
        await eventService.lockEvent(blocker.manager, eventId);
        const observed = observeLocks(eventId, poolId);
        const pending = updateEventFinanceSettings(eventId, poolId, {distribution: 'EQUAL', description: 'Must not persist'}, actor(administrator));
        const outcome = pending.then(value => ({value}), error => ({error}));
        try {
            await observed.event(1);
            // The pending command has passed initial admission and is now waiting
            // for this real Event fence. Revoke on its owning transaction first.
            await adminService.updateAdminPerms('event', eventId, administrator.id, 0, blocker.manager);
            await blocker.commitTransaction();
            expect(await outcome).toMatchObject({error: {code: 'FORBIDDEN', status: 403}});
            expect((await invoiceService.getPoolWithInvoices(poolId))!.description).not.toBe('Must not persist');
        } finally {
            if (blocker.isTransactionActive) await blocker.rollbackTransaction();
            await outcome;
            observed.stop();
            await blocker.release();
        }
    });

    it.each(['standalone', 'active manager'] as const)('holds an authorized write before a later %s revocation', async mode => {
        const {eventId, poolId, administrator} = await fixture();
        const blocker = AppDataSource.createQueryRunner();
        await blocker.connect();
        await blocker.startTransaction('READ COMMITTED');
        await blocker.manager.query('SELECT id FROM event_invoice_pools WHERE id = ? FOR UPDATE', [poolId]);
        const observed = observeLocks(eventId, poolId);
        const pending = updateEventFinanceSettings(eventId, poolId, {distribution: 'EQUAL', description: 'Authorized result'}, actor(administrator));
        const write = pending.then(value => ({value}), error => ({error}));
        let revocation: Promise<void> | undefined;
        try {
            await observed.pool();
            // Finance owns Event and now waits for pool. A matching grant writer
            // must wait for that Event even when it already owns a transaction.
            revocation = mode === 'standalone' ? adminService.removeAdmin('event', eventId, administrator.id)
                : AppDataSource.transaction(manager => adminService.removeAdmin('event', eventId, administrator.id, manager));
            await observed.event(2);
            expect(await adminService.getProfilePerms('event', eventId, administrator.id)).toBe(PERM.MANAGE_ASSIGNMENTS);
            await blocker.commitTransaction();
            expect(await write).not.toHaveProperty('error');
            await revocation;
            expect((await invoiceService.getPoolWithInvoices(poolId))!.description).toBe('Authorized result');
            expect(await adminService.getProfilePerms('event', eventId, administrator.id)).toBe(0);
        } finally {
            if (blocker.isTransactionActive) await blocker.rollbackTransaction();
            await write;
            await revocation;
            observed.stop();
            await blocker.release();
        }
    });

    it.each(['add', 'upsert', 'remove', 'update', 'defaults'] as const)('coordinates the %s writer on its supplied active manager', async action => {
        const {eventId, poolId, administrator} = await fixture();
        const additional = await persistIntegrationProfile({name: 'Additional Finance administrator'});
        await adminService.updatePerms('event', eventId, {public: PERM.MANAGE_ASSIGNMENTS});
        const entered = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        const held = withInvoiceManagementEvent({eventId, actor: actor(administrator)}, async function holdAuthorizedOperation() {
            entered.resolve();
            await release.promise;
        });
        await entered.promise;
        const observed = observeLocks(eventId, poolId);
        const written = AppDataSource.transaction(async function writeGrant(manager) {
            switch (action) {
                case 'add': return adminService.addAdmin('event', eventId, additional.id, 0, undefined, manager);
                case 'upsert': return adminService.upsertAdmin('event', eventId, administrator.id, 0, manager);
                case 'remove': return adminService.removeAdmin('event', eventId, administrator.id, manager);
                case 'update': return adminService.updateAdminPerms('event', eventId, administrator.id, 0, manager);
                case 'defaults': return adminService.updatePerms('event', eventId, {public: 0}, manager);
            }
        });
        try {
            await observed.event(1);
            expect(await adminService.getAdminGrant('event', eventId, additional.id)).toBeNull();
            expect(await adminService.getProfilePerms('event', eventId, administrator.id)).toBe(PERM.MANAGE_ASSIGNMENTS);
            expect((await adminService.getDefaultPerms('event', eventId)).public).toBe(PERM.MANAGE_ASSIGNMENTS);
            release.resolve();
            await held;
            await written;
            if (action === 'add') expect(await adminService.getAdminGrant('event', eventId, additional.id)).not.toBeNull();
            else if (action === 'defaults') expect((await adminService.getDefaultPerms('event', eventId)).public).toBe(0);
            else expect(await adminService.getProfilePerms('event', eventId, administrator.id)).toBe(0);
        } finally {
            release.resolve();
            await held;
            await written;
            observed.stop();
        }
    });

    it('preserves public management and participant-owned operations as distinct grants', async () => {
        const {eventId, event, poolId, owner, administrator} = await fixture();
        await adminService.updatePerms('event', eventId, {public: PERM.MANAGE_ASSIGNMENTS});
        const publicPool = await createEventFinancePool(eventId, {name: 'Public method pool', distribution: 'EQUAL'}, {});
        expect((await invoiceService.getPoolWithInvoices(publicPool))!.name).toBe('Public method pool');
        await adminService.updatePerms('event', eventId, {public: 0});
        await adminService.removeAdmin('event', eventId, administrator.id);
        await registerEventAttendance(event.id, owner, {arrivalDate: '2027-06-01', departureDate: '2027-06-03'});
        await registerEventAttendance(event.id, administrator, {arrivalDate: '2027-06-01', departureDate: '2027-06-03'});
        const registration = (await eventService.getRegistrationFor(administrator.id, eventId))!;
        const beneficiary = (await eventService.getRegistrationFor(owner.id, eventId))!;
        const delivery = vi.spyOn(mailer, 'sendEmail').mockResolvedValue();
        try {
            await updateEventFinanceTakeovers(eventId, poolId, {beneficiaries: [beneficiary.id]}, actor(administrator), false);
            const invoiceId = await invoiceOperations.persistSubmittedInvoice(poolId, registration.id, 5, 'Participant expense');
            await invoiceOperations.acceptSavedInvoice(poolId, invoiceId);
            await closeEventInvoice(eventId, poolId, String(invoiceId), actor(administrator));
            expect((await invoiceService.getInvoiceWithRegistration(poolId, invoiceId))!.status).toBe('CLOSED');
            expect((await invoiceService.getPoolWithInvoices(poolId))!.takeovers).toHaveLength(1);
        } finally { delivery.mockRestore(); }
    });
});
