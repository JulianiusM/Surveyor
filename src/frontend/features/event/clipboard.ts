import {onBeforeUnmount, reactive} from 'vue';

/** Copy Event links and participant addresses through the same browser owner.
 * A temporary textarea supports browsers without the clipboard API;
 * feature feedback stays with its own command/notice owner. */
export async function copyEventText(value: string): Promise<void> {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return;
    }
    // Restore the invoker after the temporary selection, including a failed copy.
    const previous = document.activeElement;
    const input = document.createElement('textarea');
    input.value = value;
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.append(input);
    try {
        input.select();
        if (!document.execCommand('copy')) throw new Error('Clipboard unavailable');
    } finally {
        input.remove();
        if (previous instanceof HTMLElement && previous.isConnected) previous.focus({preventScroll: true});
    }
}

/** Share per-button clipboard lifetime without adding a command/result owner.
 * Clipboard rejection stays separate from registration/link writes and is not retried. */
export function useEventClipboard() {
    const pending = reactive(new Set<string>());
    const timers = new Set<ReturnType<typeof setTimeout>>();
    let active = true;
    let generation = 0;
    onBeforeUnmount(retire);

    /** A Copy invoker remains disabled through delivery and the 300ms delay. */
    async function copy(key: string, value: string): Promise<void> {
        if (!active || pending.has(key)) return;
        const admittedGeneration = generation;
        pending.add(key);
        try { await copyEventText(value); }
        catch { /* Copy does not turn clipboard rejection into a business result. */ }
        finally {
            // A retired component needs no timer or retained invoker identity.
            if (active && generation === admittedGeneration) {
                const timer = setTimeout(function releaseInvoker() {
                    pending.delete(key);
                    timers.delete(timer);
                }, 300);
                timers.add(timer);
            }
        }
    }
    function retire(): void {
        active = false;
        reset();
    }
    /** An actor/resource transition releases its invokers without canceling the browser copy. */
    function reset(): void {
        // A later settlement from that visit cannot schedule another button release.
        generation++;
        for (const timer of timers) clearTimeout(timer);
        timers.clear();
        pending.clear();
    }
    return {pending, copy, reset};
}
