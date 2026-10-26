/*
 * Copyright 2026 Julian Malovanij
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */

import {parentPort} from "node:worker_threads";
import {FairAssignmentContext, generateFairRecommendations} from "./fairAssignment";

interface RecommendationWorkerRequest {
    requestId: number;
    context: FairAssignmentContext;
}

if (!parentPort) {
    throw new Error("Recommendation worker must run in a worker thread");
}

parentPort.on("message", (request: RecommendationWorkerRequest) => {
    try {
        const recommendations = generateFairRecommendations(request.context);
        parentPort!.postMessage({requestId: request.requestId, recommendations});
    } catch (error) {
        parentPort!.postMessage({
            requestId: request.requestId,
            error: error instanceof Error ? error.message : String(error),
        });
    }
});
