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

    return {
        available, incompatible, observe, requestReload,
        registerGuard(guard) { guards.add(guard); return () => { guards.delete(guard); }; },
        commandStarted() {
            commands++;
            let finished = false;
            return () => {
                if (finished) return;
                finished = true;
                commands--;
                if (available.value) queueMicrotask(requestReload);
            };
        },
        chunkFailed() { available.value = true; queueMicrotask(requestReload); },
        dispose() { disposed = true; guards.clear(); },
    };
}
