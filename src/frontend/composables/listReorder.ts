import {ref} from 'vue';
import type {FrontendListReorderSource} from '../../types/FrontendListTypes';

/** Packing and Drivers share gesture lifetime, while each supplies its current
 * capability, row order and generated command. Polling never advances a gesture's
 * reviewed token or membership; one drop consumes it before starting a write. */
export function useListReorder(source: FrontendListReorderSource) {
    const dragged = ref<{id: string; token: string; ids: string[]} | null>(null);

    /** Capture this row's admitted order before the browser starts moving it. */
    function begin(id: string, event: DragEvent): void {
        const token = source.token();
        if (!source.available() || !token) {
            event.preventDefault();
            return;
        }

        // Keep one original membership/token even if a background read completes.
        dragged.value = {id, token, ids: source.ids()};
        event.dataTransfer?.setData('text/plain', id);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    }

    function reset(): void { dragged.value = null; }

    /** Submit the original membership and token after one native placement step.
     * Concurrent row changes remain a server comparison, never silently adopted. */
    async function drop(id: string, event: DragEvent): Promise<void> {
        event.preventDefault();
        const original = dragged.value;
        reset();
        if (!original || original.id === id || !source.available()) return;

        // The feature retains comparison/rejection/uncertainty ownership. Never
        // silently replace the captured token with a newer server projection.
        const ids = original.ids.filter(current => current !== original.id);
        ids.splice(ids.indexOf(id), 0, original.id);
        await source.submit(ids, original.token);
    }

    return {begin, drop, reset};
}
