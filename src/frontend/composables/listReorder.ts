import {onScopeDispose, ref, watchEffect} from 'vue';
import type {FrontendListReorderSource} from '../../types/FrontendListTypes';

/** Packing, Drivers and Activity share gesture lifetime and insertion feedback,
 * while each supplies its current capability, row order and generated command.
 * Polling never advances a gesture's
 * reviewed token or membership; one drop consumes it before starting a write. */
export function useListReorder(source: FrontendListReorderSource) {
    const dragged = ref<{id: string; token: string; ids: string[]} | null>(null);
    const target = ref<{id: string; after: boolean} | null>(null);

    /** Capture this row's admitted order before the browser starts moving it. */
    function begin(id: string, event: DragEvent): void {
        reset();
        const token = source.token();
        const ids = source.ids();
        if (!source.available() || !token || !ids.includes(id)) {
            event.preventDefault();
            return;
        }

        // Keep one original membership/token even if a background read completes.
        dragged.value = {id, token, ids: [...ids]};
        event.dataTransfer?.setData('text/plain', id);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    }

    function reset(): void { dragged.value = null; target.value = null; }

    /** Preview the exact edge used on drop without moving the admitted rows.
     * Captured membership also rejects other Activity days and external drags. */
    function over(id: string, event: DragEvent): void {
        const original = dragged.value;
        if (!original || !source.available() || original.id === id || !original.ids.includes(id)) {
            target.value = null;
            return;
        }

        // Keep cells and controls under the same row-sized target. A lower-half
        // placement can append after the final row, which before-only drops cannot.
        event.preventDefault();
        const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
        target.value = {id, after: event.clientY > bounds.top + bounds.height / 2};
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    }

    /** Moving between a row's descendants keeps its marker; leaving clears it. */
    function leave(id: string, event: DragEvent): void {
        const row = event.currentTarget as HTMLElement;
        if (event.relatedTarget instanceof Node && row.contains(event.relatedTarget)) return;
        if (target.value?.id === id) target.value = null;
    }

    /** One shared class contract paints table rows and Activity cards alike. */
    function classes(id: string): Record<string, boolean> {
        return {'pilot-reorder-dragging': dragged.value?.id === id,
            'pilot-reorder-before': target.value?.id === id && !target.value.after,
            'pilot-reorder-after': target.value?.id === id && target.value.after};
    }

    /** Submit the original membership and token after one native placement step.
     * Concurrent row changes remain a server comparison, never silently adopted. */
    async function drop(id: string, event: DragEvent): Promise<void> {
        event.preventDefault();
        const original = dragged.value;
        const after = target.value?.id === id && target.value.after;
        reset();
        if (!original || original.id === id || !original.ids.includes(id) || !source.available()) return;

        // The feature retains comparison/rejection/uncertainty ownership. Never
        // silently replace the captured token with a newer server projection.
        const ids = original.ids.filter(current => current !== original.id);
        ids.splice(ids.indexOf(id) + (after ? 1 : 0), 0, original.id);
        if (ids.every((current, position) => current === original.ids[position])) return;
        await source.submit(ids, original.token);
    }

    // Revocation, command locks and unmount release a gesture and its marker;
    // a later grant must require another deliberate drag-start/token capture.
    watchEffect(() => { if (!source.available()) reset(); });
    onScopeDispose(reset);

    return {begin, over, leave, classes, drop, reset};
}
