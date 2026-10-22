import {inject, onBeforeUnmount, provide} from 'vue';
import type {InjectionKey} from 'vue';

// Only mounted form predicates are registered. Saved finance data and field
// values stay with their existing query/form owners, scoped to this section.
interface FinanceDraft {
    poolId: () => string | undefined;
    blocked: () => boolean;
}
const draftsKey: InjectionKey<Set<FinanceDraft>> = Symbol('finance-drafts');

/** Coordinate the native per-pool saved-input preview boundary across sibling
 * Vue forms without copying their drafts or introducing another state store. */
export function provideFinanceDrafts(): (poolId: string) => boolean {
    const drafts = new Set<FinanceDraft>();
    provide(draftsKey, drafts);

    /** Read each live form only when preview/apply is requested. Other pools'
     * independent drafts never prevent this pool's financial review. */
    return function hasPendingEdits(poolId: string): boolean {
        // Dirty, pending and unknown inputs cannot authorize a saved preview.
        return [...drafts].some(draft => draft.poolId() === poolId && draft.blocked());
    };
}

/** Register an existing form's live guard for its mounted lifetime. Standalone
 * consumers keep their normal command/draft behavior without a section owner. */
export function useFinanceDraft(poolId: FinanceDraft['poolId'], blocked: FinanceDraft['blocked']): void {
    const drafts = inject(draftsKey, null);
    if (!drafts) return;
    // Getter ownership preserves the current pool and lexical form state. No
    // registration survives unmount or private actor/source retirement.
    const draft = {poolId, blocked};
    drafts.add(draft);
    onBeforeUnmount(() => drafts.delete(draft));
}
