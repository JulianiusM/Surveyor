/*
 * Copyright 2026 Julian Malovanij
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */

import type {FairAssignmentContext} from '../../../types/ActivityTypes';


import {parentPort} from 'node:worker_threads';
import {generateFairRecommendations} from './fairAssignment';

interface RecommendationWorkerRequest {
    requestId: number;
    context: FairAssignmentContext;
}

if (!parentPort) {
    throw new Error("Recommendation worker must run in a worker thread");
}

/** Calculate one posted snapshot and correlate either result with its request ID.
 * The worker performs no persistence; the coordinator retains admission, stale
 * context checks and final job-state ownership. */
parentPort.on("message", (request: RecommendationWorkerRequest) => {
    // Keep CPU work isolated from the main thread and return only its plain result.
    try {
        const recommendations = generateFairRecommendations(request.context);
        parentPort!.postMessage({requestId: request.requestId, recommendations});
    } catch (error) {
        // Report the existing error envelope to this same pending caller.
        parentPort!.postMessage({
            requestId: request.requestId,
            error: error instanceof Error ? error.message : String(error),
        });
    }
});
