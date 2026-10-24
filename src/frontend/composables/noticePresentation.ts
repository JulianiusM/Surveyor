import {computed, onBeforeUnmount, onMounted, onUpdated, ref, shallowReactive, toRaw, watch} from 'vue';
import type {PilotContext} from '../../types/FrontendPilotUiTypes';
import type {PilotNoticePresentationSource} from '../../types/FrontendFeedbackTypes';

// Each application/request has its own presentation readers. Mounted components
// remain the owners of their props; this set copies no request or query state.
const presentations = new WeakMap<PilotContext, Set<PilotNoticePresentationSource>>();

/** Present one causal read failure through its live common notification. Ordinary
 * query notices keep their component/prop readers while their duplicate DOM is
 * hidden, so the common owner can display the query's actual freshness/deadline.
 * Different Error instances, missing errors and retired notices remain independent. */
export function useNoticePresentation(context: PilotContext | null, source: PilotNoticePresentationSource) {
    let entries = context ? presentations.get(context) : undefined;
    if (context && !entries) {
        entries = shallowReactive(new Set<PilotNoticePresentationSource>());
        presentations.set(context, entries);
    }
    const readers = entries;
    const visible = ref(false);
    let observer: MutationObserver | undefined;
    let mounted = false;
    const presentation: PilotNoticePresentationSource = {...source, presented: () => visible.value};
    /** Observe geometry/disclosure only; no visibility event initiates a read. */
    function refreshVisibility(): void {
        visible.value = source.common() && source.readError() instanceof Error && source.presented();
    }
    function stopObservation(): void {
        observer?.disconnect();
        observer = undefined;
        if (typeof window !== 'undefined') window.removeEventListener('resize', refreshVisibility);
    }
    /** Hidden ancestors and closed disclosures can change outside Vue props. */
    function observeVisibility(): void {
        stopObservation();
        refreshVisibility();
        if (!mounted || !source.common() || !(source.readError() instanceof Error)) return;
        // Scope this bounded observer to this mounted common presentation. It
        // retains only DOM visibility, and retires with the notice component.
        observer = new MutationObserver(refreshVisibility);
        observer.observe(document.documentElement, {attributes: true, childList: true, subtree: true,
            attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'open']});
        window.addEventListener('resize', refreshVisibility);
    }
    // SSR does not publish mounted UI readers or cross a request boundary. The
    // initial common node reserves its own space before hydration registers it.
    onMounted(() => { mounted = true; readers?.add(presentation); observeVisibility(); });
    onUpdated(refreshVisibility);
    watch([source.common, source.readError], observeVisibility, {flush: 'post'});
    onBeforeUnmount(() => { mounted = false; stopObservation(); readers?.delete(presentation); });

    /** Only actual Error identity joins two presentations of the same failed GET. */
    function sameFailure(candidate: PilotNoticePresentationSource): boolean {
        const failure = source.readError();
        return failure instanceof Error && toRaw(candidate.readError()) === toRaw(failure);
    }

    const duplicate = computed(() => !source.common() && !!readers
        && [...readers].some(candidate => candidate !== presentation && candidate.common()
            && candidate.presented() && sameFailure(candidate)));
    const readPresentation = computed(() => source.common() && readers
        ? [...readers].find(candidate => candidate !== presentation && !candidate.common() && sameFailure(candidate))
        : undefined);
    return {duplicate, readPresentation};
}
