import {ref} from 'vue';
import type {components} from '../../types/api/v1';
import type {PilotUpdateCoordinator} from '../../types/FrontendPilotUiTypes';

/**
 * A folder replacement can retire a lazy chunk while this document is still open. Loaded compatible
 * forms remain usable: a build change is presentation information, never a mutation rejection.
 * Existing session refreshes call observe; this owner adds no polling or command replay.
 */
export function createUpdateCoordinator(initial: components['schemas']['DeploymentView'], browser: boolean,
    reload: () => void = () => globalThis.location.reload()): PilotUpdateCoordinator {
    const available = ref(false);
    const incompatible = ref(false);
    const guards = new Set<() => boolean>();
    let commands = 0;
    let reloading = false;
    let disposed = false;
    let nextBuild = initial.buildId;

    /** Reload only when every mounted draft/command permits departure. The build
     * marker limits retries across this document's replacement recovery; it is
     * neither a command receipt nor permission to discard unresolved work. */
    function requestReload(): boolean {
        if (!browser || disposed || reloading || !available.value || commands > 0
            || [...guards].some(guard => !guard())) return false;

        // A failed chunk on an unchanged build may have another cause (offline, corrupt cache).
        // Remember only the attempted build, so repeated errors cannot cause a reload loop.
        const marker = `surveyor:reload:${initial.buildId}:${nextBuild}`;
        try {
            if (sessionStorage.getItem(marker)) return false;
            sessionStorage.setItem(marker, '1');
        } catch { /* Restricted storage still permits one attempt in this mounted application. */ }
        reloading = true;
        reload();
        return true;
    }

    function observe(deployment: components['schemas']['DeploymentView']): void {
        nextBuild = deployment.buildId;
        incompatible.value = deployment.apiCompatibility !== initial.apiCompatibility;
        available.value = nextBuild !== initial.buildId || incompatible.value;
        // The last command may still be rendering its result. Queue a clean reload after that turn.
        if (available.value) queueMicrotask(requestReload);
    }

    /** Register one mounted owner's departure decision and return its cleanup.
     * Removing that owner never implies consent from any remaining draft guard. */
    function registerGuard(guard: () => boolean): () => void {
        // Retain the live decision, not a captured clean/dirty result, until its
        // owner retires. Set removal makes repeated cleanup harmless.
        guards.add(guard);
        return function unregisterGuard(): void {
            guards.delete(guard);
        };
    }

    /** Hold automatic release reloads for one admitted command until its owner
     * finishes delivery. The returned completion releases this lease only once. */
    function commandStarted(): () => void {
        // Count the operation before dispatch so a detected release cannot replace
        // the document while the command or its confirmed-result delivery is pending.
        commands++;
        let finished = false;

        return function finishCommand(): void {
            // Recovery/finally paths can share this completion. Duplicate calls
            // must not release another command's outstanding protection.
            if (finished) return;
            finished = true;
            commands--;

            // Let the command owner finish publishing its result before evaluating
            // every remaining draft guard through the existing reload boundary.
            if (available.value) queueMicrotask(requestReload);
        };
    }

    return {
        available, incompatible, observe, requestReload, registerGuard, commandStarted,
        chunkFailed() { available.value = true; queueMicrotask(requestReload); },
        dispose() { disposed = true; guards.clear(); },
    };
}
