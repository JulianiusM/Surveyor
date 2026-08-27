import {describe, expect, it} from 'vitest';
import type {AutoAssignmentContext} from '../../src/modules/activity/autoAssignment';
import {
    RecommendationJobCoordinator,
    RecommendationJobView,
} from '../../src/modules/activity/recommendationJobs';
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
});
