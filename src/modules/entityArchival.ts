/*
 * Copyright 2026 Julian Malovanij
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import {validateArchiveAfterDays} from './archive/policy';
import {archiveExpiredEntities} from '../controller/entityAdminController';
import settings from './settings';

const ARCHIVE_INTERVAL_MS = 60 * 60 * 1000;
// These guards are local to this application process. Database eligibility checks
// remain necessary because another process may run the same sweep concurrently.
let archivalTimer: NodeJS.Timeout | undefined;
let running: Promise<number> | undefined;

/** Run one metadata-only sweep with the initialized settings and a single captured time. */
export async function runEntityArchival(now: Date = new Date()): Promise<number> {
    // A disabled job still rejects invalid configuration consistently at startup.
    // The switch stops automatic writes only; manual archival is a separate API path.
    validateArchiveAfterDays(settings.value.autoArchiveAfterDays, now);
    if (!settings.value.autoArchiveEnabled) {
        return 0;
    }

    // Startup and timer calls share the same in-flight sweep. SQL eligibility
    // rechecks additionally protect against another application process's job.
    if (running) {
        return running;
    }
    running = archiveExpiredEntities(settings.value.autoArchiveAfterDays, now);
    try {
        const archived = await running;
        if (archived > 0) {
            console.log(`[entity-archival] Archived ${archived} entit${archived === 1 ? 'y' : 'ies'}.`);
        }
        return archived;
    } finally {
        // Release the guard after both success and failure. A rejected sweep must not
        // leave the hourly job permanently attached to the same rejected promise.
        running = undefined;
    }
}

async function runScheduledArchival(): Promise<void> {
    try {
        await runEntityArchival();
    } catch (error) {
        // Timer failures are logged without terminating the server; the next tick can
        // retry. The initial startup sweep deliberately propagates errors instead.
        console.error('[entity-archival] Archival failed:', error);
    }
}

/** Catch up after downtime, then follow the app's immediate/hourly job convention. */
export async function startEntityArchivalJob(): Promise<void> {
    // Complete the first sweep before serving requests, including periods that ended
    // while the application was offline. Startup must not silently skip schema errors.
    await runEntityArchival();
    if (archivalTimer) {
        // Repeated initialization may request another catch-up sweep, but must never
        // register a second hourly timer in this process.
        return;
    }
    archivalTimer = setInterval(runScheduledArchival, ARCHIVE_INTERVAL_MS);
    // The maintenance timer should not keep an otherwise stopped process alive.
    archivalTimer.unref();
}
