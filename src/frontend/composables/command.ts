import {onBeforeUnmount, onMounted, ref} from 'vue';
import {onBeforeRouteLeave, onBeforeRouteUpdate} from 'vue-router';
import {usePilot} from '../app/context';
import {ApiFailure, InvalidInputError, ObsoleteRequestError} from '../app/transport';
import type {PilotCommandDraft, PilotRequestScope} from '../../types/FrontendPilotUiTypes';
import type {MessageKey} from '../../types/LocalizationTypes';
import {useFeedbackError} from './feedback';

/** One command owner per form/page. Commands never replay automatically: a missing response
 * blocks further commands until an authoritative read reconciles a desired-state update, or
 * the user explicitly reviews an unknown creation. A confirmed write followed by a failed
 * refresh remains a saved write, not a reason to submit again. */
export function useCommand(refresh: () => Promise<unknown>, requireUnknownReview = false, draft?: PilotCommandDraft) {
    const context = usePilot();
    const pending = ref(false);
    const uncertain = ref(false);
    const {error, setError} = useFeedbackError();
    const notice = ref<MessageKey | null>(null);
    const needsUnknownReview = ref(requireUnknownReview);
    // Register blockers during setup, before mounted draft guards can ask to discard edits.
    const removeIdentityGuard = context.registerIdentityGuard(mayLeave);
    onBeforeUnmount(removeIdentityGuard);
    const removeUpdateGuard = context.updates.registerGuard(mayReload);
    onBeforeUnmount(removeUpdateGuard);

    /** Read authority before releasing a desired-state command; creations still need acknowledgement. */
    async function reconcile(): Promise<void> {
        await refresh();
        // A resource read can reconcile a desired-state update. It cannot identify a created
        // row or prove that mail/registration failed; those commands need deliberate review.
        if (!needsUnknownReview.value) acknowledge();
    }

    /** Called after review or committed departure, never while a command is in flight. */
    function acknowledge(): void {
        if (pending.value) return;
        uncertain.value = false;
        setError(null);
        notice.value = null;
    }

    /** Execute once in the captured identity scope and distinguish write failure from refresh failure. */
    async function run<T>(operation: (scope: PilotRequestScope) => Promise<T>, refreshAfter = true,
                          reviewUnknown = requireUnknownReview): Promise<T | undefined> {
        if (pending.value || uncertain.value) return;
        // Capture authority before submission; a later identity change retires this result.
        const scope = context.capture();
        pending.value = true;
        setError(null);
        notice.value = null;
        needsUnknownReview.value = reviewUnknown;
        const finishUpdateCommand = context.updates.commandStarted();
        let confirmed = false;
        let result: T | undefined;
        try {
            result = await operation(scope);
            if (!context.isCurrent(scope)) return;
            confirmed = true;
            // Confirmation belongs to the write. A following read failure cannot undo it.
            if (refreshAfter) await refresh();
            if (context.isCurrent(scope)) notice.value = 'state.saved';
        } catch (failure) {
            if (failure instanceof ObsoleteRequestError || !context.isCurrent(scope)) return;
            if (confirmed) notice.value = 'state.savedRefreshFailed';
            else if (failure instanceof InvalidInputError) setError('api:errors.VALIDATION_FAILED');
            else if (failure instanceof ApiFailure && failure.status < 500) {
                setError(failure);
                // A stale inline edit stays a draft. Refresh only the remote representation;
                // its component still requires explicit review before adopting a new token.
                if (failure.status === 412) {
                    try {
                        await refresh();
                    } catch {
                        // The known conflict remains visible when its reconciliation read fails.
                    }
                }
            } else {
                uncertain.value = true;
                notice.value = 'state.unknownOutcome';
            }
        } finally {
            pending.value = false;
            finishUpdateCommand();
        }
        return confirmed ? result : undefined;
    }

    /** One form decision serves SPA routes and explicit identity switches without changing its draft. */
    function mayLeave(): boolean {
        if (pending.value || draft?.busy?.()) return false;
        if (!draft) return true;
        if (uncertain.value) return window.confirm(context.messages.value.t(draft.unknownMessage));
        return !draft.dirty() || window.confirm(context.messages.value.t('draft.discard'));
    }

    /** Update reloads are noninteractive: all local edits and unknown outcomes must first be resolved. */
    function mayReload(): boolean {
        return !pending.value && !uncertain.value && !draft?.busy?.() && !draft?.dirty();
    }

    /** Browser departure gets its native prompt, including password-only and reverted unknown drafts. */
    function beforeUnload(event: BeforeUnloadEvent): void {
        if (mayReload()) return;
        event.preventDefault();
        event.returnValue = '';
    }
    onBeforeRouteLeave(mayLeave);
    onBeforeRouteUpdate(mayLeave);
    onMounted(() => window.addEventListener('beforeunload', beforeUnload));
    onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload));
    return {pending, uncertain, error, notice, setError, run, reconcile, acknowledge, mayLeave};
}
