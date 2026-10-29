import {getLockedListAssignment} from '../../src/backend/modules/database/services/ListService';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {EntityManager, Logger} from 'typeorm';
import * as packingController from '../../src/backend/controller/packingController';

import {AppDataSource} from '../../src/backend/modules/database/dataSource';
import {PackingAssignment} from '../../src/backend/modules/database/entities/packing/PackingAssignment';
import {PackingList} from '../../src/backend/modules/database/entities/packing/PackingList';
import * as packingService from '../../src/backend/modules/database/services/PackingService';
import * as lifecycleService from '../../src/backend/modules/database/services/EntityLifecycleService';
import {Profile} from '../../src/backend/modules/database/entities/user/Profile';
import type {SessionLike} from '../../src/types/PermissionTypes';
import {createPackingListWithItem, persistIntegrationProfile} from '../keywords/coreDomainKeywords';
import {closeIntegrationDatabase, initializeIntegrationDatabase} from '../support/database';

let owner: Profile;
let participant: Profile;

/** Explicit lock milestones make the competing transactions independent of sleeps. */
function milestone() {
    let release!: () => void;
    const promise = new Promise<void>(function captureRelease(resolve) { release = resolve; });
    return {promise, release};
}

/** Bound a failed scheduling assertion without replacing any database operation. */
async function waitForMilestone(signal: ReturnType<typeof milestone>, description: string): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    function wait(resolve: () => void, reject: (reason: Error) => void) {
        // Fail before Vitest's ordinary five-second test deadline so finally can
        // release fixture locks and await all real transactions before teardown.
        timeout = setTimeout(function missingMilestone() { reject(new Error(`Missing lock milestone: ${description}`)); }, 3000);
        signal.promise.then(resolve, reject);
    }
    try {
        await new Promise<void>(wait);
    } finally {
        if (timeout !== undefined) clearTimeout(timeout);
    }
}

/**
 * Observe real SQL dispatch only. All queries, locks, FK checks and commits still
 * execute through TypeORM; forwarding/restoring the logger leaves other suites intact.
 */
function observePackingQueries(onQuery: (query: string, parameters: unknown[] | undefined) => void) {
    const original = AppDataSource.logger;
    const observer: Logger = {
        logQuery(query, parameters, runner) {
            // TypeORM also permits named parameter objects. Only its positional
            // INSERT values identify our milestones; the original logger receives
            // every original argument regardless of parameter representation.
            onQuery(query, Array.isArray(parameters) ? parameters : undefined);
            original.logQuery(query, parameters, runner);
        },
        logQueryError(error, query, parameters, runner) { original.logQueryError(error, query, parameters, runner); },
        logQuerySlow(time, query, parameters, runner) { original.logQuerySlow(time, query, parameters, runner); },
        logSchemaBuild(message, runner) { original.logSchemaBuild(message, runner); },
        logMigration(message, runner) { original.logMigration(message, runner); },
        log(level, message, runner) { original.log(level, message, runner); },
    };
    AppDataSource.logger = observer;
    return function restoreLogger() { AppDataSource.logger = original; };
}

function isRootLock(query: string, mode: 'read' | 'write'): boolean {
    return query.includes('`packing_lists`') && query.includes(mode === 'read' ? 'LOCK IN SHARE MODE' : 'FOR UPDATE');
}

function isAssignmentInsert(query: string, parameters: unknown[] | undefined, itemId: string): boolean {
    return query.startsWith('INSERT INTO') && query.includes('`packing_assignments`') && Boolean(parameters?.includes(itemId));
}

function sessionFor(profile: Profile): SessionLike {
    return {profile, auth: {user: profile.user!}};
}

/** A real profile-X fixture delays the assignment FK insertion after both native locks. */
function holdParticipantLock(acquired: ReturnType<typeof milestone>, release: ReturnType<typeof milestone>): Promise<void> {
    async function holdProfile(manager: EntityManager) {
        const row = await manager.getRepository(Profile).findOne({where: {id: participant.id}, lock: {mode: 'pessimistic_write'}});
        expect(row).not.toBeNull();
        acquired.release();
        await release.promise;
    }
    return AppDataSource.transaction('READ COMMITTED', holdProfile);
}

beforeAll(async function preparePackingCoexistence() {
    await initializeIntegrationDatabase();
    owner = await persistIntegrationProfile({name: 'Packing coexistence owner'});
    participant = await persistIntegrationProfile({name: 'Packing coexistence participant'});
}, 120_000);
afterAll(closeIntegrationDatabase);

describe('native and versioned Packing lock coexistence', function packingCoexistence() {
    it('commits a native assignment before an overlapping versioned root/item command without a deadlock', async function nativeFirst() {
        const [id, item] = await createPackingListWithItem(owner.id);
        const baseline = await packingController.readPackingItemEditBaseline(id, item.id, sessionFor(owner));
        const profileLocked = milestone();
        const releaseProfile = milestone();
        const nativeInsertDispatched = milestone();
        const versionedRootDispatched = milestone();
        const pending: Promise<unknown>[] = [];

        function observeNativeFirst(query: string, parameters: unknown[] | undefined) {
            if (isAssignmentInsert(query, parameters, item.id)) nativeInsertDispatched.release();
            if (isRootLock(query, 'write')) versionedRootDispatched.release();
        }
        const restoreLogger = observePackingQueries(observeNativeFirst);

        try {
            pending.push(holdParticipantLock(profileLocked, releaseProfile));
            await waitForMilestone(profileLocked, 'fixture profile lock');
            const native = packingController.getAssignmentAccessMapping().assign({itemId: item.id}, participant.id);
            pending.push(native);
            await waitForMilestone(nativeInsertDispatched, 'native FK insertion after root/item locks');

            // Native is held at its actual FK insertion. V1 reaches root X while
            // native retains root S/item X, then proceeds only after native commits.
            const versioned = packingController.updatePackingItem(id, item.id, {description: 'Native-first update'}, baseline.editToken, sessionFor(owner));
            pending.push(versioned);
            await waitForMilestone(versionedRootDispatched, 'versioned root write lock');
            releaseProfile.release();
            await Promise.all(pending);

            expect(await packingService.getPackingAssignmentCounts(id)).toEqual({[item.id]: 1});
            expect(await packingService.getPackingItemById(item.id)).toMatchObject({description: 'Native-first update'});
        } finally {
            releaseProfile.release();
            await Promise.allSettled(pending);
            restoreLogger();
        }
    });

    it('holds native assignment before its item lock until the versioned root/item command commits', async function versionedFirst() {
        const [id, item] = await createPackingListWithItem(owner.id);
        const baseline = await packingController.readPackingItemEditBaseline(id, item.id, sessionFor(owner));
        const fixtureItemLocked = milestone();
        const releaseItem = milestone();
        const versionedItemDispatched = milestone();
        const nativeRootDispatched = milestone();
        const pending: Promise<unknown>[] = [];

        async function holdItem(manager: EntityManager) {
            await getLockedListAssignment('packing', manager, item.id, owner.id);
            fixtureItemLocked.release();
            await releaseItem.promise;
        }
        let versionedStarted = false;
        function observeVersionedFirst(query: string) {
            if (versionedStarted && query.includes('`packing_items`') && query.includes('FOR UPDATE')) versionedItemDispatched.release();
            if (isRootLock(query, 'read')) nativeRootDispatched.release();
        }
        const restoreLogger = observePackingQueries(observeVersionedFirst);
        try {
            pending.push(AppDataSource.transaction('READ COMMITTED', holdItem));
            await waitForMilestone(fixtureItemLocked, 'fixture item lock');

            // The real v1 controller holds root X while its item query waits on
            // the fixture. Native must queue at root S, leaving the item available.
            versionedStarted = true;
            const versioned = packingController.updatePackingItem(id, item.id, {description: 'Versioned-first update'}, baseline.editToken, sessionFor(owner));
            pending.push(versioned);
            await waitForMilestone(versionedItemDispatched, 'versioned item lock after root lock');
            const native = packingController.getAssignmentAccessMapping().assign({itemId: item.id}, participant.id);
            pending.push(native);
            await waitForMilestone(nativeRootDispatched, 'native shared root lock before item');
            releaseItem.release();
            await Promise.all(pending);

            expect(await packingService.getPackingAssignmentCounts(id)).toEqual({[item.id]: 1});
            expect(await packingService.getPackingItemById(item.id)).toMatchObject({description: 'Versioned-first update'});
        } finally {
            releaseItem.release();
            await Promise.allSettled(pending);
            restoreLogger();
        }
    });

    it('retains concurrent native assignments on different items of the same list', async function concurrentNativeItems() {
        const [id, first] = await createPackingListWithItem(owner.id);
        const secondId = randomUUID();
        await packingService.createPackingItem(id, {id: secondId, title: 'Second parallel item', maxAssignees: 1}, owner.id);
        const profileLocked = milestone();
        const releaseProfile = milestone();
        const firstInsertDispatched = milestone();
        const secondInsertDispatched = milestone();
        const pending: Promise<unknown>[] = [];

        function observeParallelAssignments(query: string, parameters: unknown[] | undefined) {
            if (isAssignmentInsert(query, parameters, first.id)) firstInsertDispatched.release();
            if (isAssignmentInsert(query, parameters, secondId)) secondInsertDispatched.release();
        }
        const restoreLogger = observePackingQueries(observeParallelAssignments);
        try {
            pending.push(holdParticipantLock(profileLocked, releaseProfile));
            await waitForMilestone(profileLocked, 'fixture profile lock');
            pending.push(packingController.getAssignmentAccessMapping().assign({itemId: first.id}, participant.id));
            await waitForMilestone(firstInsertDispatched, 'first native insertion');
            pending.push(packingController.getAssignmentAccessMapping().assign({itemId: secondId}, participant.id));

            // Both insertions reach the real shared profile FK before release.
            // An exclusive list lock would prevent the second milestone entirely.
            await waitForMilestone(secondInsertDispatched, 'second insertion while first still holds root/item locks');
            releaseProfile.release();
            await Promise.all(pending);
            expect(await packingService.getPackingAssignmentCounts(id)).toEqual({[first.id]: 1, [secondId]: 1});
        } finally {
            releaseProfile.release();
            await Promise.allSettled(pending);
            restoreLogger();
        }
    });

    it('keeps the controller-owned missing-item outcome for an absent assignment target', async function missingItem() {
        await expect(packingController.getAssignmentAccessMapping().assign({itemId: randomUUID()}, participant.id))
            .rejects.toMatchObject({message: 'Packing item not found', status: 404});
    });

    for (const target of ['item', 'list'] as const) {
        it(`keeps the missing-item outcome when the ${target} is deleted after root discovery`, async function deletionDuringDiscovery() {
            const [id, item] = await createPackingListWithItem(owner.id);
            const rootLocked = milestone();
            const nativeRootDispatched = milestone();
            const permitDeletion = milestone();
            const pending: Promise<unknown>[] = [];

            async function deleteLockedTarget(manager: EntityManager) {
                await manager.getRepository(PackingList).findOne({where: {id}, lock: {mode: 'pessimistic_write'}});
                rootLocked.release();
                await permitDeletion.promise;
                if (target === 'item') await packingService.deletePackingItem(item.id, manager);
                else await packingService.deletePackingList(id, manager);
            }
            function observeDiscoveredRoot(query: string) {
                if (isRootLock(query, 'read')) nativeRootDispatched.release();
            }
            const restoreLogger = observePackingQueries(observeDiscoveredRoot);
            try {
                pending.push(AppDataSource.transaction('READ COMMITTED', deleteLockedTarget));
                await waitForMilestone(rootLocked, 'fixture root lock');
                const native = packingController.getAssignmentAccessMapping().assign({itemId: item.id}, participant.id);
                // Handle the expected rejection immediately while the fixture still
                // holds its root. Otherwise a fast controller rejection could become
                // unhandled before the orchestrator reaches its final assertion.
                const outcome = native.then(
                    function assignmentSucceeded() { return {status: 'fulfilled'} as const; },
                    function assignmentRejected(error: unknown) { return {status: 'rejected', error} as const; },
                );
                pending.push(outcome);
                await waitForMilestone(nativeRootDispatched, 'native root read after item discovery');
                permitDeletion.release();
                await Promise.all(pending);
                expect(await outcome).toMatchObject({status: 'rejected', error: {message: 'Packing item not found', status: 404}});
                expect(await packingService.getPackingItemById(item.id)).toBeNull();
                expect(await packingService.getPackingAssignmentCounts(id)).toEqual({});
            } finally {
                permitDeletion.release();
                await Promise.allSettled(pending);
                restoreLogger();
            }
        });
    }

    it('retains native unlocked self-removal and administrator removal while a versioned item snapshot is held', async function retainRemovalSchedule() {
        const [id, item] = await createPackingListWithItem(owner.id);
        await AppDataSource.getRepository(PackingAssignment).save([
            {entity: {id}, item: {id: item.id}, profile: {id: participant.id}},
            {entity: {id}, item: {id: item.id}, profile: {id: owner.id}},
        ]);
        const ownerAssignment = (await packingService.getPackingAssignmentCounts(id))[item.id];
        expect(ownerAssignment).toBe(2);

        await lifecycleService.withLockedArchiveTarget({type: 'packing', id}, async function observeRemoval(manager) {
            const snapshot = await getLockedListAssignment('packing', manager, item.id, participant.id);
            expect(snapshot.count).toBe(2);
            await packingController.getAssignmentAccessMapping().unassign({itemId: item.id}, participant.id);
            const remaining = await packingService.getPackingAssignmentById(
                (await manager.getRepository(PackingAssignment).findOneByOrFail({profile: {id: owner.id}, item: {id: item.id}})).id,
                manager);
            await packingController.deleteAssignment(String(remaining!.id));
            expect(await manager.getRepository(PackingAssignment).countBy({item: {id: item.id}})).toBe(0);
        });
        expect(await packingService.getPackingAssignmentCounts(id)).toEqual({});
    });

    it('keeps a native item overwrite after the versioned item transaction without deleting assignments', async function serializeNativeItemWrite() {
        const [id, item] = await createPackingListWithItem(owner.id);
        await packingController.getAssignmentAccessMapping().assign({itemId: item.id}, participant.id);
        const itemLocked = milestone();
        const releaseVersioned = milestone();
        const versioned = lifecycleService.withLockedArchiveTarget({type: 'packing', id}, async function saveVersionedItem(manager) {
            await getLockedListAssignment('packing', manager, item.id, owner.id);
            itemLocked.release();
            await releaseVersioned.promise;
            await packingService.updatePackingItem(item.id, {title: 'Versioned item'}, manager);
        });
        await itemLocked.promise;
        const native = packingController.updateItemAttr(item.id, {field: 'title', value: 'Native last writer'});
        releaseVersioned.release();
        await Promise.all([native, versioned]);
        expect(await packingService.getPackingItemById(item.id)).toMatchObject({title: 'Native last writer'});
        expect(await packingService.getPackingAssignmentCounts(id)).toEqual({[item.id]: 1});
    });
});
