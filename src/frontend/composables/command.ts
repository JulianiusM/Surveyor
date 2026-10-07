import {ref} from 'vue';
import {onBeforeRouteLeave, onBeforeRouteUpdate} from 'vue-router';
import {onBeforeUnmount, onMounted} from 'vue';
import {usePilot} from '../app/context';
import {ApiFailure, InvalidInputError, ObsoleteRequestError} from '../app/api';
import type {PilotRequestScope} from '../../types/FrontendPilotUiTypes';
import type {MessageKey} from '../../types/LocalizationTypes';

/** One command owner per form/page. Commands never replay automatically: a missing response
 * blocks further commands until an explicit read reconciles the affected resource. A confirmed
 * write followed by a failed refresh remains a saved write, not a reason to submit again. */
export function useCommand(refresh: () => Promise<unknown>) {
    const context = usePilot();
    const pending = ref(false);
    const uncertain = ref(false);
    const error = ref<string | null>(null);
    const notice = ref<MessageKey | null>(null);
    // Register blockers during setup, before mounted draft guards can ask to discard edits.
    const removeIdentityGuard = context.registerIdentityGuard(() => !pending.value);
    onBeforeUnmount(removeIdentityGuard);

    async function reconcile(): Promise<void> {
        await refresh();
        uncertain.value = false;
        error.value = null;
        notice.value = null;
    }

    async function run<T>(operation: (scope: PilotRequestScope) => Promise<T>, refreshAfter = true): Promise<T | undefined> {
        if (pending.value || uncertain.value) return;
        const scope = context.capture();
        pending.value = true;
        error.value = null;
        notice.value = null;
        let confirmed = false;
        let result: T | undefined;
        try {
            result = await operation(scope);
            if (!context.isCurrent(scope)) return;
            confirmed = true;
            if (refreshAfter) await refresh();
            if (context.isCurrent(scope)) notice.value = 'state.saved';
        } catch (failure) {
            if (failure instanceof ObsoleteRequestError || !context.isCurrent(scope)) return;
            if (confirmed) notice.value = 'state.savedRefreshFailed';
            else if (failure instanceof InvalidInputError) error.value = context.messages.value.t('api:errors.VALIDATION_FAILED');
            else if (failure instanceof ApiFailure && failure.status < 500) {
                error.value = failure.message;
                // A stale inline edit stays a draft. Refresh only the remote representation;
                // its component still requires explicit review before adopting a new token.
                if (failure.status === 412) await refresh().catch(() => {});
            } else {
                uncertain.value = true;
                notice.value = 'state.unknownOutcome';
            }
        } finally { pending.value = false; }
        return confirmed ? result : undefined;
    }

    function mayLeave(): boolean { return !pending.value; }
    function beforeUnload(event: BeforeUnloadEvent): void {
        if (!pending.value) return;
        event.preventDefault(); event.returnValue = '';
    }
    onBeforeRouteLeave(mayLeave);
    onBeforeRouteUpdate(mayLeave);
    onMounted(() => window.addEventListener('beforeunload', beforeUnload));
    onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload));
    return {pending, uncertain, error, notice, run, reconcile};
}
