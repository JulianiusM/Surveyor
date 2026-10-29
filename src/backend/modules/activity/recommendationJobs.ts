/*
 * Copyright 2026 Julian Malovanij
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */

import type {
    AutoAssignmentContext, RecommendationInput, RecommendationJobStatus, RecommendationJobView,
    RecommendationJobCoordinatorOptions, ActivityRecommendationPersistenceContext,
} from '../../../types/ActivityTypes';


import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {Worker} from 'node:worker_threads';

import {generateFairRecommendations} from './fairAssignment';

import {APIError} from '../lib/errors';

interface RecommendationJobRecord extends RecommendationJobView {
    createdAtMs: number;
    updatedAtMs: number;
}

interface CachedRecommendationResult {
    recommendations: RecommendationInput[];
    expiresAt: number;
}

const MAX_QUEUE_SIZE = 500;
const MAX_CACHED_JOBS = 256;
const CACHE_TTL_MS = 10 * 60 * 1_000;

export class RecommendationQueueFullError extends Error {
    constructor() {
        super("The recommendation queue is full; retry later");
        this.name = "RecommendationQueueFullError";
    }
}

/** Recursively sort object keys while retaining array order and scalar values.
 * The resulting plain structure makes equivalent captured inputs hash alike. */
function canonicalize(value: unknown): unknown {
    // Arrays retain their caller-selected order; object members acquire a stable
    // order before their nested values are normalized by this same operation.
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([key, entry]) => [key, canonicalize(entry)]),
        );
    }
    return value;
}

/** Normalize sibling commitments with straightforward loops; display labels do not affect allocation. */
function summarizeLinkedPlans(context: AutoAssignmentContext): unknown {
    // Select allocation/provenance facts only, then order each participant's
    // commitments before the containing context receives its canonical hash.
    const linked = context.linkedPlans;
    const commitments: Record<string, unknown[]> = {};
    for (const key of Object.keys(linked?.commitments ?? {}).sort()) {
        const normalized: unknown[] = [];
        for (const assignment of linked!.commitments[key]) {
            normalized.push({
                id: assignment.id, planId: assignment.planId, assignmentMode: assignment.assignmentMode,
                day: assignment.day, startTime: assignment.startTime, endTime: assignment.endTime,
                recommendationId: assignment.recommendationId, recommendationStatus: assignment.recommendationStatus,
                operation: assignment.operation, sourceItemId: assignment.sourceItemId,
            });
        }
        normalized.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
        commitments[key] = normalized;
    }
    return {plans: [...(linked?.plans ?? [])].sort((a, b) => a.id.localeCompare(b.id)), commitments};
}

/** Hash the captured allocation inputs and reviewed recommendation decisions.
 * Stable ordering excludes presentation-only fields while retaining sibling
 * commitments that can invalidate cached or running recommendation work. */
export function fingerprintRecommendationContext(context: AutoAssignmentContext): string {
    // Project each input family and sort only its existing unordered collections.
    const stableContext = {
        plan: context.plan,
        slots: context.slots.map((slot) => ({
            id: slot.id,
            day: slot.day,
            startTime: slot.startTime,
            endTime: slot.endTime,
            pos: slot.pos,
            maxAssignees: slot.maxAssignees,
            assignedCount: slot.assignedCount,
            isArrivalEvening: slot.isArrivalEvening,
            isDepartureMorning: slot.isDepartureMorning,
        })).sort((a, b) => a.id.localeCompare(b.id)),
        participants: context.participants.map((participant) => ({
            profileId: participant.profileId,
            arrivalDate: participant.arrivalDate,
            departureDate: participant.departureDate,
            roleIds: [...(participant.roleIds ?? [])].sort((a, b) => a - b),
        })).sort((a, b) => String(a.profileId).localeCompare(String(b.profileId))),
        roleRequirements: context.roleRequirements.map((requirement) => ({
            roleId: Number(requirement.roleId),
            requiredShifts: requirement.requiredShifts,
        })).sort((a, b) => a.roleId - b.roleId),
        overrides: context.overrides.map((override) => ({
            profileId: override.profile?.id ?? override.profileId,
            roleId: override.roleId == null ? null : Number(override.roleId),
            requiredShifts: override.requiredShifts,
        })).sort((a, b) => `${a.profileId}:${a.roleId}`.localeCompare(`${b.profileId}:${b.roleId}`)),
        stayRequirements: context.stayRequirements.map((requirement) => ({
            stayDays: requirement.stayDays,
            requiredShifts: requirement.requiredShifts,
        })).sort((a, b) => a.stayDays - b.stayDays),
        existingAssignments: Object.fromEntries(
            Object.entries(context.existingAssignments)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([participantKey, assignments]) => [
                    participantKey,
                    assignments.map((assignment) => ({
                        id: assignment.id,
                        day: assignment.day,
                        startTime: assignment.startTime,
                        endTime: assignment.endTime,
                        pos: assignment.pos,
                        hasNamedRole: assignment.hasNamedRole,
                    })).sort((a, b) => a.id.localeCompare(b.id)),
                ]),
        ),
        // Pending rows are replaceable output, not plan input. Reviewed decisions
        // remain part of the revision and rejection memory.
        existingRecommendations: (context.existingRecommendations ?? [])
            .filter((recommendation) => recommendation.status !== "PENDING" || recommendation.manual)
            .sort((a, b) =>
                `${a.operation ?? "ASSIGN"}:${a.sourceItemId ?? ""}:${a.itemId}:${a.profileId}:${a.status}`
                    .localeCompare(
                        `${b.operation ?? "ASSIGN"}:${b.sourceItemId ?? ""}:${b.itemId}:${b.profileId}:${b.status}`,
                    )),
        // Sibling pending proposals are input here, although this plan's generated pending
        // rows remain replaceable output above. Include provenance and operation state so
        // changed priority, a reassignment, or a proposal deletion revokes cached work.
        linkedPlans: summarizeLinkedPlans(context),
    };
    // Canonical object-key order and SHA-256 supply the existing revision identity.
    return crypto
        .createHash("sha256")
        .update(JSON.stringify(canonicalize(stableContext)))
        .digest("hex");
}

class RecommendationWorkerExecutor {
    private worker?: Worker;
    private requestId = 0;
    private pending = new Map<number, {
        resolve: (recommendations: RecommendationInput[]) => void;
        reject: (error: Error) => void;
    }>();

    /** Reuse or lazily start the adjacent compiled allocation worker.
     * Source mode returns undefined; worker replies/failures settle only the
     * registered request promises and release the worker reference on failure. */
    private getWorker(): Worker | undefined {
        // A source checkout can lack the compiled sibling; execute owns its
        // established yielded fallback rather than starting another file path.
        if (this.worker) return this.worker;
        const workerPath = path.join(__dirname, "recommendationWorker.js");
        if (!fs.existsSync(workerPath)) return undefined;

        // Correlate replies with their pending caller and consume each entry once.
        this.worker = new Worker(workerPath);
        this.worker.on("message", (message: {
            requestId: number;
            recommendations?: RecommendationInput[];
            error?: string;
        }) => {
            const request = this.pending.get(message.requestId);
            if (!request) return;
            this.pending.delete(message.requestId);
            if (message.error) request.reject(new Error(message.error));
            else request.resolve(message.recommendations ?? []);
        });
        /** Reject every outstanding caller before allowing a later worker start. */
        const rejectPending = (error: Error) => {
            // Keep the original rejection/clear/reference-release order.
            for (const request of this.pending.values()) request.reject(error);
            this.pending.clear();
            this.worker = undefined;
        };
        this.worker.on("error", rejectPending);
        /** Preserve failed-exit rejection and ordinary idle-worker retirement. */
        this.worker.on("exit", (code) => {
            // Pending work makes even an otherwise clean exit a failed delivery.
            if (code !== 0 || this.pending.size > 0) {
                rejectPending(new Error(`Recommendation worker exited with code ${code}`));
            } else {
                this.worker = undefined;
            }
        });
        return this.worker;
    }

    /** Calculate the supplied snapshot through the compiled worker when present.
     * Source fallback yields once; worker mode correlates one serialized request
     * with its existing pending promise, without persistence or replay. */
    async execute(context: AutoAssignmentContext): Promise<RecommendationInput[]> {
        // Select the existing worker or the established source-mode fallback.
        const worker = this.getWorker();
        if (!worker) {
            // Source-mode development and unit tests have no adjacent compiled worker.
            // Yield first; production builds always use the worker thread above.
            await new Promise<void>((resolve) => setImmediate(resolve));
            return generateFairRecommendations(context);
        }

        // Register before posting so an immediate reply has its receiving owner.
        const requestId = ++this.requestId;
        return await new Promise<RecommendationInput[]>((resolve, reject) => {
            this.pending.set(requestId, {resolve, reject});
            worker.postMessage({requestId, context: JSON.parse(JSON.stringify(context))});
        });
    }
}

export class RecommendationJobCoordinator {
    private readonly jobs = new Map<string, RecommendationJobRecord>();
    private readonly activeByPlan = new Map<string, string>();
    private readonly queue: string[] = [];
    private readonly resultCache = new Map<string, CachedRecommendationResult>();
    private readonly executor: RecommendationWorkerExecutor;
    private readonly loadContext: (planId: string) => Promise<AutoAssignmentContext>;
    private readonly executeContext: (context: AutoAssignmentContext) => Promise<RecommendationInput[]>;
    private readonly persistRecommendations: (planId: string, recommendations: RecommendationInput[], expected: ActivityRecommendationPersistenceContext) => Promise<void>;
    private readonly maxQueueSize: number;
    private readonly maxCachedJobs: number;
    private readonly cacheTtlMs: number;
    private running = false;

    /** Bind context loading, calculation and persistence to this coordinator.
     * Optional overrides retain the existing executor and cache/queue defaults. */
    constructor(options: RecommendationJobCoordinatorOptions) {
        // Keep supplied operation boundaries and default resource limits together
        // without creating another context snapshot or persistence implementation.
        this.executor = new RecommendationWorkerExecutor();
        this.loadContext = options.loadContext;
        this.executeContext = options.execute ?? ((context) => this.executor.execute(context));
        this.persistRecommendations = options.persist;
        this.maxQueueSize = options.maxQueueSize ?? MAX_QUEUE_SIZE;
        this.maxCachedJobs = options.maxCachedJobs ?? MAX_CACHED_JOBS;
        this.cacheTtlMs = options.cacheTtlMs ?? CACHE_TTL_MS;
    }

    /** Reuse an active plan job or enqueue one new bounded in-process record.
     * Return only its public view; scheduled draining retains the single runner. */
    enqueue(planId: string): {job: RecommendationJobView; coalesced: boolean} {
        // Retire expired terminal state before coalescing active plan work.
        this.prune();
        const activeId = this.activeByPlan.get(planId);
        if (activeId) {
            const active = this.jobs.get(activeId);
            if (active) return {job: this.toView(active), coalesced: true};
        }
        if (this.queue.length >= this.maxQueueSize) throw new RecommendationQueueFullError();

        // Publish the job, active-plan identity and queue entry before scheduling
        // the asynchronous drain; queue-full rejection still precedes publication.
        const now = Date.now();
        const record: RecommendationJobRecord = {
            id: crypto.randomUUID(),
            planId,
            status: "QUEUED",
            createdAt: new Date(now).toISOString(),
            updatedAt: new Date(now).toISOString(),
            createdAtMs: now,
            updatedAtMs: now,
        };
        this.jobs.set(record.id, record);
        this.activeByPlan.set(planId, record.id);
        this.queue.push(record.id);
        setImmediate(() => void this.drain());
        return {job: this.toView(record), coalesced: false};
    }

    get(jobId: string): RecommendationJobView | undefined {
        this.prune();
        const record = this.jobs.get(jobId);
        if (!record) return undefined;
        // Refresh LRU order without changing externally visible timestamps.
        this.jobs.delete(jobId);
        this.jobs.set(jobId, record);
        return this.toView(record);
    }

    /**
     * Called after validation while a relationship/date mutation holds the plan lock. Running
     * workers may finish calculating, but persistence checks this state under that same lock.
     * A rolled-back mutation can conservatively cancel work; it cannot change saved assignments.
     * Keep the old record so a polling browser receives an explicit stale result and can retry.
     */
    invalidate(planId: string): void {
        // Preserve the old polling record while releasing this plan's active slot.
        const activeId = this.activeByPlan.get(planId);
        const active = activeId ? this.jobs.get(activeId) : undefined;
        if (active) this.update(active, 'STALE', {error: 'Activity plan context changed; generate recommendations again'});
        this.activeByPlan.delete(planId);
    }

    /** Drain queued records sequentially under the existing in-process runner flag.
     * Skip missing/invalidated entries and release the runner even after failure. */
    private async drain(): Promise<void> {
        // Multiple scheduled drains coalesce at this guard; only this runner
        // removes queue entries and awaits their existing run operation.
        if (this.running) return;
        this.running = true;
        try {
            while (this.queue.length > 0) {
                const jobId = this.queue.shift()!;
                const job = this.jobs.get(jobId);
                if (!job || job.status === 'STALE') continue;
                await this.run(job);
            }
        } finally {
            this.running = false;
        }
    }

    /** Calculate or reuse one captured context, then recheck before persistence.
     * Existing lock-time checks arbitrate late invalidation; completion caches
     * results only after persistence, and failures retain polling-visible state. */
    private async run(job: RecommendationJobRecord): Promise<void> {
        // Capture inputs before consulting the bounded result cache or executor.
        this.update(job, "RUNNING");
        try {
            const context = await this.loadContext(job.planId);
            const fingerprint = fingerprintRecommendationContext(context);
            const cached = this.resultCache.get(fingerprint);
            const recommendations = cached && cached.expiresAt > Date.now()
                ? cached.recommendations
                : await this.executeContext(context);

            // A changed fingerprint or invalidated job cannot persist old work.
            const freshContext = await this.loadContext(job.planId);
            if (this.isInvalidated(job) || fingerprintRecommendationContext(freshContext) !== fingerprint) {
                this.update(job, "STALE", {error: "Plan inputs changed while recommendations were being calculated"});
                return;
            }

            // The controller rechecks these values under the same root lock used by relinking.
            // Retain the full fingerprint above: that lock does not stabilize every input.
            await this.persistRecommendations(job.planId, recommendations, {
                eventId: context.plan.eventId ?? null,
                startDate: context.plan.startDate,
                endDate: context.plan.endDate,
                inputFingerprint: fingerprint,
                // Recheck after acquiring the database lock, including an A→B→A relink
                // while this job was already waiting to persist its original context.
                isCurrent: this.isCurrentJob.bind(this, job),
            });
            if (this.isInvalidated(job)) return;
            // Successful persistence renews result-cache order and completion data.
            this.resultCache.delete(fingerprint);
            this.resultCache.set(fingerprint, {
                recommendations,
                expiresAt: Date.now() + this.cacheTtlMs,
            });
            this.update(job, "COMPLETE", {recommendationCount: recommendations.length});
        } catch (error) {
            const contextChanged = error instanceof APIError && error.status === 409
                && (error.data as {reason?: string}).reason === 'activity-context-changed';
            this.update(job, this.isInvalidated(job) || contextChanged ? 'STALE' : 'FAILED', {
                error: error instanceof Error ? error.message : String(error),
            });
        } finally {
            // Invalidating an executing job can already have queued its replacement.
            if (this.activeByPlan.get(job.planId) === job.id) this.activeByPlan.delete(job.planId);
            this.prune();
        }
    }

    private isInvalidated(job: RecommendationJobRecord): boolean {
        return job.status === 'STALE';
    }

    private isCurrentJob(job: RecommendationJobRecord): boolean {
        return !this.isInvalidated(job);
    }

    private update(
        job: RecommendationJobRecord,
        status: RecommendationJobStatus,
        patch: Partial<Pick<RecommendationJobRecord, "recommendationCount" | "error">> = {},
    ): void {
        const now = Date.now();
        Object.assign(job, patch, {
            status,
            updatedAtMs: now,
            updatedAt: new Date(now).toISOString(),
        });
    }

    /** Retire expired results and terminal jobs within the existing size limits.
     * Active jobs remain retained; encountering one at the oldest job position
     * stops size eviction rather than discarding work still owned by a caller. */
    private prune(): void {
        // Result-cache expiration and oldest-entry trimming are independent from
        // the job records that polling callers continue to observe.
        const now = Date.now();
        for (const [fingerprint, cached] of this.resultCache) {
            if (cached.expiresAt <= now) this.resultCache.delete(fingerprint);
        }
        while (this.resultCache.size > this.maxCachedJobs) {
            this.resultCache.delete(this.resultCache.keys().next().value!);
        }

        // Only terminal jobs expire, and oldest active jobs block size eviction.
        for (const [jobId, job] of this.jobs) {
            const terminal = ["COMPLETE", "FAILED", "STALE"].includes(job.status);
            if (terminal && now - job.updatedAtMs > this.cacheTtlMs) this.jobs.delete(jobId);
        }
        while (this.jobs.size > this.maxCachedJobs) {
            const oldest = this.jobs.entries().next().value as [string, RecommendationJobRecord] | undefined;
            if (!oldest || !["COMPLETE", "FAILED", "STALE"].includes(oldest[1].status)) break;
            this.jobs.delete(oldest[0]);
        }
    }

    private toView(job: RecommendationJobRecord): RecommendationJobView {
        return {
            id: job.id,
            planId: job.planId,
            status: job.status,
            createdAt: job.createdAt,
            updatedAt: job.updatedAt,
            recommendationCount: job.recommendationCount,
            error: job.error,
        };
    }
}
