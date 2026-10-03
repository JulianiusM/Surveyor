import {describe, expect, it} from 'vitest';
import type {AutoAssignmentContext} from '../../src/modules/activity/autoAssignment';
import {
    RecommendationJobCoordinator,
    RecommendationJobView,
    fingerprintRecommendationContext,
} from '../../src/modules/activity/recommendationJobs';
import {APIError} from '../../src/modules/lib/errors';
import {createAutoAssignmentContext} from '../factories/activityAutoAssignmentFactory';

function createJobContext(): AutoAssignmentContext {
    return createAutoAssignmentContext() as unknown as AutoAssignmentContext;
}

async function waitForTerminalJob(
    coordinator: RecommendationJobCoordinator,
    jobId: string,
): Promise<RecommendationJobView> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
        const job = coordinator.get(jobId);
        if (job && ['COMPLETE', 'FAILED', 'STALE'].includes(job.status)) return job;
        await new Promise<void>((resolve) => setTimeout(resolve, 1));
    }
    throw new Error('Recommendation job did not finish');
}

describe('activity recommendation job coordination', () => {
    it('distinguishes event identity even when every scheduling input is otherwise unchanged', () => {
        const original = createJobContext();
        original.plan.eventId = 'event-a';
        const moved = {...original, plan: {...original.plan, eventId: 'event-b'}};
        expect(fingerprintRecommendationContext(original)).not.toBe(fingerprintRecommendationContext(moved));
    });

    it('coalesces a plan, serializes different plans, and reuses a matching cached result', async () => {
        // Protects limited webspaces from duplicate CPU work during bursts of concurrent requests.
        let activeExecutions = 0;
        let maximumActiveExecutions = 0;
        let executionCount = 0;
        const persistedPlans: string[] = [];
        const coordinator = new RecommendationJobCoordinator({
            loadContext: async () => createJobContext(),
            execute: async () => {
                executionCount += 1;
                activeExecutions += 1;
                maximumActiveExecutions = Math.max(maximumActiveExecutions, activeExecutions);
                await new Promise<void>((resolve) => setTimeout(resolve, 2));
                activeExecutions -= 1;
                return [{itemId: 'slot-a', profileId: '00000000-0000-4000-8000-000000000001'}];
            },
            persist: async (planId) => {
                persistedPlans.push(planId);
            },
        });

        const first = coordinator.enqueue('plan-a');
        const duplicate = coordinator.enqueue('plan-a');
        const other = coordinator.enqueue('plan-b');
        expect(duplicate).toMatchObject({coalesced: true, job: {id: first.job.id}});

        await Promise.all([
            waitForTerminalJob(coordinator, first.job.id),
            waitForTerminalJob(coordinator, other.job.id),
        ]);
        const cached = coordinator.enqueue('plan-a');
        await waitForTerminalJob(coordinator, cached.job.id);

        expect(maximumActiveExecutions).toBe(1);
        expect(executionCount).toBe(1);
        expect(persistedPlans).toEqual(['plan-a', 'plan-b', 'plan-a']);
    });

    it('marks changed input stale and does not overwrite pending recommendations', async () => {
        // Protects administrator edits made while a worker is calculating recommendations.
        let loadCount = 0;
        let persisted = false;
        const coordinator = new RecommendationJobCoordinator({
            loadContext: async () => {
                loadCount += 1;
                const context = createJobContext();
                if (loadCount > 1) context.plan.allowOverfillAfterFull = true;
                return context;
            },
            execute: async () => [],
            persist: async () => {
                persisted = true;
            },
        });

        const queued = coordinator.enqueue('changing-plan');
        const result = await waitForTerminalJob(coordinator, queued.job.id);

        expect(result.status).toBe('STALE');
        expect(persisted).toBe(false);
    });

    it('invalidates running work and lets its replacement complete without clearing the new job', async () => {
        let releaseCalculation!: () => void;
        let startedCalculation!: () => void;
        const started = new Promise<void>(function captureStarted(resolve) { startedCalculation = resolve; });
        const release = new Promise<void>(function captureRelease(resolve) { releaseCalculation = resolve; });
        let executions = 0;
        let writes = 0;
        const coordinator = new RecommendationJobCoordinator({
            loadContext: async function loadContext() { return createJobContext(); },
            execute: async function execute() {
                executions += 1;
                if (executions === 1) {
                    startedCalculation();
                    await release;
                }
                return [];
            },
            persist: async function persist() { writes += 1; },
        });
        const first = coordinator.enqueue('moved-plan');
        await started;
        coordinator.invalidate('moved-plan');
        const replacement = coordinator.enqueue('moved-plan');
        expect(replacement.coalesced).toBe(false);
        expect(coordinator.get(first.job.id)?.status).toBe('STALE');
        releaseCalculation();
        expect((await waitForTerminalJob(coordinator, replacement.job.id)).status).toBe('COMPLETE');
        expect(writes).toBe(1);
    });

    it('sends the calculation relationship to persistence and reports a locked-context conflict as stale', async () => {
        const context = createJobContext();
        context.plan.eventId = 'old-event';
        const coordinator = new RecommendationJobCoordinator({
            loadContext: async function loadContext() { return context; },
            execute: async function execute() { return []; },
            persist: async function persist(_planId, _recommendations, expected) {
                expect(expected).toMatchObject({eventId: 'old-event', startDate: context.plan.startDate, endDate: context.plan.endDate});
                expect(expected.isCurrent?.()).toBe(true);
                throw new APIError('Activity plan context changed', {reason: 'activity-context-changed'}, 409);
            },
        });
        const queued = coordinator.enqueue('concurrently-moved-plan');
        expect((await waitForTerminalJob(coordinator, queued.job.id)).status).toBe('STALE');
    });

    it('revokes the persistence guard when a job is invalidated while waiting for its plan lock', async () => {
        let reportWaiting!: () => void;
        let releaseWrite!: () => void;
        const waiting = new Promise<void>(function captureWaiting(resolve) { reportWaiting = resolve; });
        const release = new Promise<void>(function captureRelease(resolve) { releaseWrite = resolve; });
        let checkedGuard = false;
        const coordinator = new RecommendationJobCoordinator({
            loadContext: async function loadContext() { return createJobContext(); },
            execute: async function execute() { return []; },
            persist: async function persist(_planId, _recommendations, expected) {
                reportWaiting();
                await release;
                expect(expected.isCurrent?.()).toBe(false);
                checkedGuard = true;
                throw new APIError('Activity plan context changed', {reason: 'activity-context-changed'}, 409);
            },
        });
        const queued = coordinator.enqueue('waiting-plan');
        await waiting;
        coordinator.invalidate('waiting-plan');
        releaseWrite();
        // The stored status is already STALE; await the persistence continuation separately.
        await release;
        await Promise.resolve();
        expect(checkedGuard).toBe(true);
        expect(coordinator.get(queued.job.id)?.status).toBe('STALE');
    });
});
