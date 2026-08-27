/*
 * Copyright 2026 Julian Malovanij
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {Worker} from "node:worker_threads";
import {buildPlanRecommendationContext, AutoAssignmentContext} from "./autoAssignment";
import {generateFairRecommendations} from "./fairAssignment";
import * as recommendationService from "../database/services/ActivityRecommendationService";
import type {RecommendationInput} from "../database/services/ActivityRecommendationService";

export type RecommendationJobStatus = "QUEUED" | "RUNNING" | "COMPLETE" | "FAILED" | "STALE";

export interface RecommendationJobView {
    id: string;
    planId: string;
    status: RecommendationJobStatus;
    createdAt: string;
    updatedAt: string;
    recommendationCount?: number;
    error?: string;
}

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

function canonicalize(value: unknown): unknown {
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

export function fingerprintRecommendationContext(context: AutoAssignmentContext): string {
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
                    })).sort((a, b) => a.id.localeCompare(b.id)),
                ]),
        ),
        // Pending rows are replaceable output, not plan input. Reviewed decisions
        // remain part of the revision and rejection memory.
        existingRecommendations: (context.existingRecommendations ?? [])
            .filter((recommendation) => recommendation.status !== "PENDING")
            .sort((a, b) => `${a.itemId}:${a.profileId}:${a.status}`.localeCompare(`${b.itemId}:${b.profileId}:${b.status}`)),
    };
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

    private getWorker(): Worker | undefined {
        if (this.worker) return this.worker;
        const workerPath = path.join(__dirname, "recommendationWorker.js");
        if (!fs.existsSync(workerPath)) return undefined;

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
        const rejectPending = (error: Error) => {
            for (const request of this.pending.values()) request.reject(error);
            this.pending.clear();
            this.worker = undefined;
        };
        this.worker.on("error", rejectPending);
        this.worker.on("exit", (code) => {
            if (code !== 0 || this.pending.size > 0) {
                rejectPending(new Error(`Recommendation worker exited with code ${code}`));
            } else {
                this.worker = undefined;
            }
        });
        return this.worker;
    }

    async execute(context: AutoAssignmentContext): Promise<RecommendationInput[]> {
        const worker = this.getWorker();
        if (!worker) {
            // Source-mode development and unit tests have no adjacent compiled worker.
            // Yield first; production builds always use the worker thread above.
            await new Promise<void>((resolve) => setImmediate(resolve));
            return generateFairRecommendations(context);
        }

        const requestId = ++this.requestId;
        return await new Promise<RecommendationInput[]>((resolve, reject) => {
            this.pending.set(requestId, {resolve, reject});
            worker.postMessage({requestId, context: JSON.parse(JSON.stringify(context))});
        });
    }
}

export interface RecommendationJobCoordinatorOptions {
    loadContext?: (planId: string) => Promise<AutoAssignmentContext>;
    execute?: (context: AutoAssignmentContext) => Promise<RecommendationInput[]>;
    persist?: (planId: string, recommendations: RecommendationInput[]) => Promise<void>;
    maxQueueSize?: number;
    maxCachedJobs?: number;
    cacheTtlMs?: number;
}

export class RecommendationJobCoordinator {
    private readonly jobs = new Map<string, RecommendationJobRecord>();
    private readonly activeByPlan = new Map<string, string>();
    private readonly queue: string[] = [];
    private readonly resultCache = new Map<string, CachedRecommendationResult>();
    private readonly executor: RecommendationWorkerExecutor;
    private readonly loadContext: (planId: string) => Promise<AutoAssignmentContext>;
    private readonly executeContext: (context: AutoAssignmentContext) => Promise<RecommendationInput[]>;
    private readonly persistRecommendations: (planId: string, recommendations: RecommendationInput[]) => Promise<void>;
    private readonly maxQueueSize: number;
    private readonly maxCachedJobs: number;
    private readonly cacheTtlMs: number;
    private running = false;

    constructor(options: RecommendationJobCoordinatorOptions = {}) {
        this.executor = new RecommendationWorkerExecutor();
        this.loadContext = options.loadContext ?? buildPlanRecommendationContext;
        this.executeContext = options.execute ?? ((context) => this.executor.execute(context));
        this.persistRecommendations = options.persist ?? recommendationService.replacePendingRecommendations;
        this.maxQueueSize = options.maxQueueSize ?? MAX_QUEUE_SIZE;
        this.maxCachedJobs = options.maxCachedJobs ?? MAX_CACHED_JOBS;
        this.cacheTtlMs = options.cacheTtlMs ?? CACHE_TTL_MS;
    }

    enqueue(planId: string): {job: RecommendationJobView; coalesced: boolean} {
        this.prune();
        const activeId = this.activeByPlan.get(planId);
        if (activeId) {
            const active = this.jobs.get(activeId);
            if (active) return {job: this.toView(active), coalesced: true};
        }
        if (this.queue.length >= this.maxQueueSize) throw new RecommendationQueueFullError();

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

    private async drain(): Promise<void> {
        if (this.running) return;
        this.running = true;
        try {
            while (this.queue.length > 0) {
                const jobId = this.queue.shift()!;
                const job = this.jobs.get(jobId);
                if (!job) continue;
                await this.run(job);
            }
        } finally {
            this.running = false;
        }
    }

    private async run(job: RecommendationJobRecord): Promise<void> {
        this.update(job, "RUNNING");
        try {
            const context = await this.loadContext(job.planId);
            if (context.plan.assignmentMode === "FREE") {
                throw new Error("Automatic recommendations are disabled in free assignment mode");
            }
            const fingerprint = fingerprintRecommendationContext(context);
            const cached = this.resultCache.get(fingerprint);
            const recommendations = cached && cached.expiresAt > Date.now()
                ? cached.recommendations
                : await this.executeContext(context);

            const freshContext = await this.loadContext(job.planId);
            if (fingerprintRecommendationContext(freshContext) !== fingerprint) {
                this.update(job, "STALE", {error: "Plan inputs changed while recommendations were being calculated"});
                return;
            }

            await this.persistRecommendations(job.planId, recommendations);
            this.resultCache.delete(fingerprint);
            this.resultCache.set(fingerprint, {
                recommendations,
                expiresAt: Date.now() + this.cacheTtlMs,
            });
            this.update(job, "COMPLETE", {recommendationCount: recommendations.length});
        } catch (error) {
            this.update(job, "FAILED", {error: error instanceof Error ? error.message : String(error)});
        } finally {
            this.activeByPlan.delete(job.planId);
            this.prune();
        }
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

    private prune(): void {
        const now = Date.now();
        for (const [fingerprint, cached] of this.resultCache) {
            if (cached.expiresAt <= now) this.resultCache.delete(fingerprint);
        }
        while (this.resultCache.size > this.maxCachedJobs) {
            this.resultCache.delete(this.resultCache.keys().next().value!);
        }

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

export const recommendationJobCoordinator = new RecommendationJobCoordinator();
