import {onBeforeUnmount, ref, watch, type Ref} from 'vue';

/** Match the native picker delay without delaying explicit selection or pagination. The owner
 * disposes its timer, so a closed or replaced picker cannot issue a late search. */
export function useDebouncedValue(source: Ref<string>, delay = 200): Ref<string> {
    const result = ref(source.value);
    let timer: ReturnType<typeof setTimeout> | undefined;
    watch(source, value => {
        if (timer !== undefined) clearTimeout(timer);
        timer = setTimeout(() => { result.value = value; timer = undefined; }, delay);
    });
    onBeforeUnmount(() => { if (timer !== undefined) clearTimeout(timer); });
    return result;
}
