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

    /** Apply the same draft/command protection to automatic and deliberate recovery.
     * Only automatic attempts require a persisted marker: deliberate recovery is
     * a new user action, never permission to bypass another owner's live guard. */
    function reloadWhenAllowed(deliberate: boolean): boolean {
        // Startup can register a DOM-draft guard before the component tree exists.
        // Mounted guards and admitted commands keep their existing lifetime too.
        if (!browser || disposed || reloading || !deliberate && !available.value || commands > 0
            || [...guards].some(guard => !guard())) return false;

        // A failed chunk can have another cause, including an offline browser. An
        // automatic attempt must prove its cross-document loop protection works;
        // an unavailable getter/read/write therefore leaves explicit recovery only.
        const marker = `surveyor:reload:${initial.buildId}:${nextBuild}`;
        try {
            if (!deliberate && sessionStorage.getItem(marker)) return false;
            sessionStorage.setItem(marker, '1');
        } catch {
            if (!deliberate) return false;
            // The user can deliberately retry even when no marker can be stored.
            // Guards were checked above; no automatic attempt is queued here.
        }

        // Limit both paths to one dispatch in this instance. Only an automatic
        // attempt is also limited across replacement documents by its marker.
        reloading = true;
        reload();
        return true;
    }

    /** Automatic recovery requires an available update and a working attempt marker. */
    function requestReload(): boolean {
        return reloadWhenAllowed(false);
    }

    /** A deliberate retry can recover an initial loading failure or an exhausted
     * automatic attempt, while every draft/pending/unknown guard still applies. */
    function requestRecoveryReload(): boolean {
        return reloadWhenAllowed(true);
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
        available, incompatible, observe, requestReload, requestRecoveryReload, registerGuard, commandStarted,
        chunkFailed() { available.value = true; queueMicrotask(requestReload); },
        dispose() { disposed = true; guards.clear(); },
    };
}
