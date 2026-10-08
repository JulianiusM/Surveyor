import {inject, onBeforeUnmount, onMounted, provide, ref, shallowRef} from 'vue';
import {onBeforeRouteLeave, onBeforeRouteUpdate} from 'vue-router';
import {usePilot} from '../app/context';
import {ApiFailure, InvalidInputError, ObsoleteRequestError} from '../app/transport';
import type {PilotCommandDraft, PilotCommandOutcome, PilotRequestScope} from '../../types/FrontendPilotUiTypes';
import type {MessageKey} from '../../types/LocalizationTypes';
import {useFeedbackError} from './feedback';

/** These collaborators are private to the mounted draft tree. No draft values or callbacks
 * enter server rendering data, query caches, browser storage or another application request. */
interface DraftState {
    busy: boolean;
    dirty: boolean;
    unknownMessage: MessageKey | null;
}

interface DraftOwner {
    register(read: () => DraftState): () => void;
}

const draftOwnerKey = Symbol.for('surveyor.pilot.draft-owner');

/**
 * Compose mounted form state along the component tree. Only its root registers global
 * departure guards; descendants still receive their own decision for dialog Close.
 * This lets a page, its dialog and inline editors ask once without discarding on consent:
 * the owning form releases values only after navigation commits or a confirmed result.
 */
export function useDraftProtection(draft: PilotCommandDraft) {
    const context = usePilot();
    const parent = inject<DraftOwner | null>(draftOwnerKey, null);
    const children = new Set<() => DraftState>();
    provide<DraftOwner>(draftOwnerKey, {register});

    function register(read: () => DraftState): () => void {
        children.add(read);
        return function unregister(): void { children.delete(read); };
    }

    /** Pending work wins over prompts. One unknown outcome also covers other unsaved input. */
    function readState(): DraftState {
        const state: DraftState = {
            busy: draft.busy?.() ?? false,
            dirty: draft.dirty(),
            unknownMessage: draft.uncertain?.() ? draft.unknownMessage : null,
        };
        for (const read of children) {
            const child = read();
            state.busy ||= child.busy;
            state.dirty ||= child.dirty;
            state.unknownMessage ??= child.unknownMessage;
        }
        return state;
    }

    function mayLeave(): boolean {
        const state = readState();
        if (state.busy) return false;
        if (state.unknownMessage) return window.confirm(context.messages.value.t(state.unknownMessage));
        return !state.dirty || window.confirm(context.messages.value.t('draft.discard'));
    }

    /** Release updates cannot ask to discard input or silently acknowledge an unknown result. */
    function mayReload(): boolean {
        const state = readState();
        return !state.busy && !state.dirty && !state.unknownMessage;
    }

    function beforeUnload(event: BeforeUnloadEvent): void {
        if (mayReload()) return;
        event.preventDefault();
        event.returnValue = '';
    }

    if (parent) onBeforeUnmount(parent.register(readState));
    else {
        onBeforeUnmount(context.registerIdentityGuard(mayLeave));
        onBeforeUnmount(context.updates.registerGuard(mayReload));
        onBeforeRouteLeave(mayLeave);
        onBeforeRouteUpdate(mayLeave);
        onMounted(() => window.addEventListener('beforeunload', beforeUnload));
        onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload));
    }
    return {mayLeave, mayReload};
}

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
    const outcome = shallowRef<PilotCommandOutcome | null>(null);
    const needsUnknownReview = ref(requireUnknownReview);
    const protection = useDraftProtection({
        dirty: () => draft?.dirty() ?? false,
        busy: () => pending.value || (draft?.busy?.() ?? false),
        uncertain: () => uncertain.value || (draft?.uncertain?.() ?? false),
        unknownMessage: draft?.unknownMessage ?? 'draft.leaveUnknown',
    });

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
        outcome.value = null;
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
        outcome.value = {confirmation: 'pending', refresh: 'not-requested'};
        const finishUpdateCommand = context.updates.commandStarted();
        let confirmed = false;
        let result: T | undefined;
        try {
            result = await operation(scope);
            if (!context.isCurrent(scope)) {
                outcome.value = {confirmation: 'obsolete', refresh: 'not-requested'};
                return;
            }
            confirmed = true;
            outcome.value = {confirmation: 'confirmed', refresh: refreshAfter ? 'pending' : 'not-requested'};
            // Confirmation belongs to the write. A following read failure cannot undo it.
            if (refreshAfter) {
                await refresh();
                outcome.value = {confirmation: 'confirmed', refresh: 'succeeded'};
            }
            if (!context.isCurrent(scope)) {
                outcome.value = {confirmation: 'obsolete', refresh: outcome.value.refresh};
                return;
            }
            notice.value = 'state.saved';
        } catch (failure) {
            if (failure instanceof ObsoleteRequestError || !context.isCurrent(scope)) {
                outcome.value = {confirmation: 'obsolete', refresh: outcome.value?.refresh ?? 'not-requested'};
                return;
            }
            if (confirmed) {
                outcome.value = {confirmation: 'confirmed', refresh: 'failed'};
                notice.value = 'state.savedRefreshFailed';
            } else if (failure instanceof InvalidInputError) {
                outcome.value = {confirmation: 'rejected', refresh: 'not-requested'};
                setError('api:errors.VALIDATION_FAILED');
            } else if (failure instanceof ApiFailure && failure.status < 500) {
                outcome.value = {confirmation: 'rejected', refresh: 'not-requested'};
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
                outcome.value = {confirmation: 'unknown', refresh: 'not-requested'};
                uncertain.value = true;
                notice.value = 'state.unknownOutcome';
            }
        } finally {
            pending.value = false;
            finishUpdateCommand();
        }
        return confirmed ? result : undefined;
    }

    return {pending, uncertain, error, notice, outcome, setError, run, reconcile, acknowledge,
        mayLeave: protection.mayLeave};
}
