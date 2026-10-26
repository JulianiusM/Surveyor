import {computed, ref, watch} from 'vue';
import type {Ref} from 'vue';

/** Page a caller-selected Finance projection without owning its filters or rows.
 * Callers retain reset triggers, deferred settlement filtering and expansion;
 * only count, slice and clamping share this local presentation lifetime. */
export function useFinancePagination<T>(rows: () => readonly T[], size: Ref<number>) {
    const page = ref(0);
    const pages = computed(() => Math.max(1, Math.ceil(rows().length / size.value)));
    const visible = computed(() => rows().slice(page.value * size.value, (page.value + 1) * size.value));

    // A source shrinking during refresh cannot leave an empty out-of-range page.
    // Resetting after a filter change remains the caller's deliberate policy.
    watch(pages, clampPage);
    function clampPage(count: number): void { page.value = Math.min(page.value, count - 1); }

    return {page, pages, visible};
}
