import {computed, type Ref} from 'vue';
import type {EntityMetadataEditorHandle} from '../../types/FrontendEntityMetadataTypes';

/** Expose the mounted editor's public workflow through a feature field adapter.
 * Both Packing and Event retain one underlying draft/command owner. These
 * derived flags follow ref replacement and create no second state or cache. */
export function useMetadataEditorHandle(editor: Readonly<Ref<EntityMetadataEditorHandle | null>>) {
    // A field adapter can exist before its editor mounts or after it retires.
    // Preserve the established absent-editor defaults without inventing authority.
    const pending = computed(() => editor.value?.pending ?? false);
    const refreshing = computed(() => editor.value?.refreshing ?? false);
    const unknown = computed(() => editor.value?.unknown ?? false);
    const dirty = computed(() => editor.value?.dirty ?? false);
    const awaitingAuthority = computed(() => editor.value?.awaitingAuthority ?? false);
    const retryAvailable = computed(() => editor.value?.retryAvailable ?? true);

    /** Ask the current mounted editor; no stale component handle is retained. */
    function mayLeave(): boolean {
        return editor.value?.mayLeave() ?? true;
    }

    /** The editor owns deliberate review, draft retention and read recovery. */
    function refresh(discard = false): Promise<void> | undefined {
        return editor.value?.refresh(discard);
    }

    /** Settings awaits the same editor's related read, including its failures. */
    function refreshAfterSettings(discard = false): Promise<void> | undefined {
        return editor.value?.refreshAfterSettings(discard);
    }

    return {mayLeave, pending, refreshing, unknown, dirty, awaitingAuthority, retryAvailable, refresh, refreshAfterSettings};
}
