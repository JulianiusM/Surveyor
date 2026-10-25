import {onBeforeUnmount, ref, watch, type Ref} from 'vue';

/** Match the picker delay without delaying explicit selection or pagination. The owner
 * disposes its timer, so a closed or replaced picker cannot issue a late search. A settlement
 * callback also observes edits returning to the original value, where the result ref is unchanged. */
export function useDebouncedValue(source: Ref<string>, delay = 200, settled?: (value: string) => void): Ref<string> {
    const result = ref(source.value);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending = source.value;

    function apply(): void {
        result.value = pending;
        timer = undefined;
        settled?.(pending);
    }

    function schedule(value: string): void {
        if (timer !== undefined) clearTimeout(timer);
        pending = value;
        timer = setTimeout(apply, delay);
    }

    function dispose(): void {
        if (timer !== undefined) clearTimeout(timer);
    }

    watch(source, schedule);
    onBeforeUnmount(dispose);
    return result;
}
