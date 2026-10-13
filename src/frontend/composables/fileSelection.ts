import {ref, watch} from 'vue';
import type {Ref} from 'vue';

/** Keep a browser chooser aligned with its feature-owned file draft. This owner
 * retains only the DOM reference: selected bytes, comparison tokens and the decision
 * to release them remain with the feature. Initial SSR/hydration selections are
 * preserved until that owner actually changes its draft to null. */
export function useFileSelectionRelease(selectedFile: () => File | null): Ref<HTMLInputElement | null> {
    const input = ref<HTMLInputElement | null>(null);

    // Observe releases rather than initialize the chooser from its model. File
    // controls cannot bind a nonempty value, and hydration may still be restoring
    // an early browser selection through the feature's ordinary change event.
    watch(selectedFile, clearReleasedSelection);
    return input;

    /** Clear the same chooser only after its feature has released the selection.
     * Background reads, rejected/unknown commands and canceled departure keep the
     * File and therefore leave this DOM node and its selected bytes untouched. */
    function clearReleasedSelection(file: File | null): void {
        if (file !== null || !input.value) return;

        // Clearing a file input releases its native FileList without recreating
        // the node, retaining a second draft or emitting another change event.
        input.value.value = '';
    }
}
