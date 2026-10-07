import {onBeforeUnmount, ref, watch, type Ref} from 'vue';
import {usePilot} from '../app/context';

/** Images use the same captured-session API as JSON. Revoke old object URLs on identity,
 * version and route changes; an obsolete fetch can never install another actor's image. */
export function usePackingHeader(listId: Ref<string>, version: Ref<string | null | undefined>) {
    const context = usePilot();
    const source = ref<string | null>(null);
    let controller: AbortController | null = null;
    function clear(): void {
        controller?.abort();
        controller = null;
        if (source.value) URL.revokeObjectURL(source.value);
        source.value = null;
    }
    watch([listId, version, () => context.session.value?.context, context.ready], async () => {
        clear();
        if (!context.browser || !context.ready.value || !version.value) return;
        const request = new AbortController();
        controller = request;
        const scope = context.capture();
        try {
            const blob = await context.api.header(listId.value, scope, request.signal);
            if (!request.signal.aborted && context.isCurrent(scope)) source.value = URL.createObjectURL(blob);
        } catch { /* The authorized JSON page remains usable when its optional image is unavailable. */ }
    }, {immediate: true});
    onBeforeUnmount(clear);
    return source;
}
