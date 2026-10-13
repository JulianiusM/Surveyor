import {computed, effectScope, inject, onBeforeUnmount, onMounted, provide, ref, shallowRef, watch} from 'vue';
import {useRouter} from 'vue-router';
import type {NavigationFailure, RouteLocationNormalized} from 'vue-router';
import {usePilot} from '../app/context';
import {ApiFailure, InvalidInputError, ObsoleteRequestError} from '../app/transport';
import type {PilotCommandDraft, PilotCommandFeedback, PilotCommandOutcome, PilotDraftState, PilotPlainMessageKey,
    PilotRecoveryRead, PilotRequestScope} from '../../types/FrontendPilotUiTypes';
import {inlineFeedbackTarget, useFeedbackError} from './feedback';
import {frontendDocumentUrl} from '../../modules/lib/frontendIdentity';

/** These collaborators are private to the mounted draft tree. No draft values or callbacks
 * enter server rendering data, query caches, browser storage or another application request. */
interface DraftOwner {
    register(read: () => PilotDraftState): () => void;
    prepareDeparture(): (() => void) | undefined;
    retainCommand(read: () => PilotDraftState, scope: PilotRequestScope, onDeparture?: () => void): () => void;
}

/** Only command status survives a retired editor. Form values and edit authority stay with
 * their component; actor/visit scope prevents these leases from blocking a later identity. */
interface RetainedCommand {
    read: () => PilotDraftState;
    scope: PilotRequestScope;
    origin: string;
    onDeparture?: () => void;
}

const draftOwnerKey = Symbol.for('surveyor.pilot.draft-owner');

/** Each visible notice is its own receipt, including a repeated identical no-op.
 * No feature intent or translated text is inferred from another command's result. */
interface CommandNotice {
    key: PilotPlainMessageKey;
    kind: 'success' | 'warning';
    transient: boolean;
    presentation: 'flash' | 'inline';
}

/**
 * Compose mounted form state along the component tree. Only its root registers global
 * departure guards; descendants still receive their own decision for dialog Close.
 * This lets a page, its dialog and inline editors ask once without discarding on consent:
 * the owning form releases values only after navigation commits or a confirmed result.
 */
export function useDraftProtection(draft: PilotCommandDraft) {
    const context = usePilot();
    const router = useRouter();
    const parent = inject<DraftOwner | null>(draftOwnerKey, null);
    const ownerScope = context.capture();
    const children = new Set<() => PilotDraftState>();
    const approvedDepartures = new Set<{origin: string}>();
    const commands = new Set<RetainedCommand>();
    let mounted = true;
    let disposeRoot = () => {};
    provide<DraftOwner>(draftOwnerKey, {register, prepareDeparture, retainCommand});

    /** Attach a child's live draft state to this owner until that child unmounts.
     * Only its reader is retained; field values remain in the child component. */
    function register(read: () => PilotDraftState): () => void {
        // Read current state at each departure decision instead of copying a
        // dirty/pending snapshot that could outlive the child's actual work.
        children.add(read);
        return function unregister(): void { children.delete(read); };
    }

    /** Pending work wins over prompts. One unknown outcome also covers other unsaved input. */
    function readState(): PilotDraftState {
        // A persistent shell owner can admit later commands after an actor transition.
        // Ordinary fields still belong to their original draft scope; each status lease
        // and child reader supplies its own authority instead of inheriting that scope.
        const currentDraft = mounted && context.isCurrent(ownerScope);
        const state: PilotDraftState = {
            busy: currentDraft && (draft.busy?.() ?? false),
            dirty: currentDraft && draft.dirty(),
            unknownMessage: currentDraft && draft.uncertain?.() ? draft.unknownMessage : null,
        };
        for (const read of children) {
            const child = read();
            state.busy ||= child.busy;
            state.dirty ||= child.dirty;
            state.unknownMessage ??= child.unknownMessage;
        }
        for (const command of commands) {
            if (!context.isCurrent(command.scope)) continue;
            const retained = command.read();
            state.busy ||= retained.busy;
            state.unknownMessage ??= retained.unknownMessage;
        }
        return state;
    }

    /** Decide departure from the combined page/dialog state. Pending work blocks
     * departure before any prompt; unknown delivery needs its own acknowledgement
     * even when an earlier destructive command already obtained discard consent. */
    function mayLeave(): boolean {
        const state = readState();

        if (state.busy) return false;
        if (state.unknownMessage) return window.confirm(context.messages.value.t(state.unknownMessage));
        if (approvedDepartures.size) return true;
        return !state.dirty || window.confirm(context.messages.value.t('draft.discard'));
    }

    /** Native anchors remain in the same document. They do not discard input or
     * acknowledge uncertainty; actual path/query departures still need one decision. */
    function admitNavigation(to: RouteLocationNormalized, from: RouteLocationNormalized): boolean {
        return frontendDocumentUrl(to.fullPath) === frontendDocumentUrl(from.fullPath) || mayLeave();
    }

    /** An irreversible command must obtain the whole page's departure decision before
     * writing. Descendants delegate to the root, including sibling drafts behind a dialog.
     * Keep this consent until its confirmed navigation finishes; its later route guard must
     * not ask whether to discard an already deleted resource. Pending work still blocks
     * departure, and automatic reload never treats this approval as a clean draft. */
    function prepareDeparture(): (() => void) | undefined {
        if (parent) return parent.prepareDeparture();
        if (!mayLeave()) return;
        const departure = {origin: router.currentRoute.value.fullPath};
        approvedDepartures.add(departure);

        return function releaseDeparture(): void {
            // Set removal is idempotent even after the root retired all leases.
            approvedDepartures.delete(departure);
        };
    }

    /** A command outlives a component when a denied read retires that component first.
     * Delegate its small status lease to the root, preserving one aggregated decision for
     * pending work and unknown results even after its ordinary child registration is gone. */
    function retainCommand(read: () => PilotDraftState, scope: PilotRequestScope, onDeparture?: () => void): () => void {
        if (parent) return parent.retainCommand(read, scope, onDeparture);
        const command = {read, scope, onDeparture, origin: router.currentRoute.value.fullPath};
        commands.add(command);

        return function releaseCommand(): void {
            commands.delete(command);
            disposeIfRetired();
        };
    }

    function disposeIfRetired(): void {
        if (!mounted && !commands.size) disposeRoot();
    }

    /** Confirmed deletion can close its child editor on a later denied read while this
     * page remains mounted. Accepted consent belongs to the root's visit, not that child:
     * release it after actual departure or actor retirement, never on failed delivery. */
    function retireDepartures(to: RouteLocationNormalized, _from: RouteLocationNormalized,
                              failure?: NavigationFailure | void): void {
        if (failure) return;
        const destination = frontendDocumentUrl(to.fullPath);
        for (const departure of approvedDepartures) {
            if (frontendDocumentUrl(departure.origin) !== destination) approvedDepartures.delete(departure);
        }
        // An accepted different visit acknowledges an orphaned unknown outcome. Pending
        // leases cannot reach this branch through our guard, and are never released early.
        for (const command of commands) {
            if (frontendDocumentUrl(command.origin) !== destination && !command.read().busy) {
                commands.delete(command);
                // Persistent shell forms need the same explicit acknowledgement as
                // route forms that reset/unmount. Retire first; release is idempotent.
                command.onDeparture?.();
            }
        }
        disposeIfRetired();
    }

    /** Retire departure consent and obsolete command leases after actor/context
     * replacement. Current retained commands still protect their own admitted work. */
    function clearDepartures(): void {
        // Consent belongs to the retired visit/actor and cannot authorize discard
        // under the replacement identity, even if this shell remains mounted.
        approvedDepartures.clear();

        // A persistent root can also hold newer commands. Remove only leases whose
        // captured scope retired, leaving current pending/unknown status intact.
        for (const command of commands) {
            if (!context.isCurrent(command.scope)) commands.delete(command);
        }

        // An unmounted root releases its shared guards only after the final lease
        // is gone; mounted roots continue aggregating their remaining children.
        disposeIfRetired();
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

    if (parent) {
        const unregister = parent.register(readState);
        onBeforeUnmount(() => { mounted = false; unregister(); });
    } else {
        const removeDepartureObserver = router.afterEach(retireDepartures);
        const removeIdentityGuard = context.registerIdentityGuard(mayLeave);
        const removeUpdateGuard = context.updates.registerGuard(mayReload);
        // Root ownership, rather than RouterView membership, defines this guard's
        // lifetime. The shared header and a retired editor keep the same single guard.
        const removeRouteGuard = router.beforeEach(admitNavigation);
        // Component-owned effects stop on unmount. This detached scope observes only
        // retained command authority until settlement/departure, then releases itself.
        const lifetime = effectScope(true);
        lifetime.run(() => watch([context.epoch, () => context.session.value?.context], clearDepartures, {flush: 'sync'}));
        let disposed = false;
        /** Retire the root's shared guards exactly once after its final retained
         * command settles. A component unmount alone must not release these guards
         * while an orphaned command still protects an unknown or pending result. */
        disposeRoot = function disposeProtection(): void {
            if (disposed) return;
            disposed = true;

            removeDepartureObserver();
            removeIdentityGuard();
            removeUpdateGuard();
            removeRouteGuard();
            lifetime.stop();
            approvedDepartures.clear();
            window.removeEventListener('beforeunload', beforeUnload);
        };
        onBeforeUnmount(() => {
            mounted = false;
            // Release ordinary draft state now. Outstanding command leases keep only
            // this root's existing guards until result settlement or acknowledgement.
            disposeIfRetired();
        });
        onMounted(() => window.addEventListener('beforeunload', beforeUnload));
    }
    return {mayLeave, mayReload, prepareDeparture, retainCommand};
}

/** One command owner per form/page. Commands never replay automatically: a missing response
 * blocks further commands until an authoritative read reconciles a desired-state update, or
 * the user explicitly reviews an unknown creation. A confirmed write followed by a failed
 * refresh remains a saved write, not a reason to submit again. */
export function useCommand(refresh: () => Promise<unknown>, requireUnknownReview = false, draft?: PilotCommandDraft) {
    const context = usePilot();
    const router = useRouter();
    const pending = ref(false);
    const recovering = ref(false);
    const uncertain = ref(false);
    const {error, transientError, errorRenewal, errorPresentation, feedbackKind, setError,
        setInformation: setFeedbackInformation, clearRecoveredError} = useFeedbackError(draft?.problemKey);
    const noticeReceipt = shallowRef<CommandNotice | null>(null);
    // Keep the existing writable notice contract for durable recovery callers.
    // Feature success uses setNotice; assigning a warning never inherits an old
    // success receipt's lifetime, inline presentation, or dismissal renewal.
    const notice = computed({
        get: () => noticeReceipt.value?.key ?? null,
        set: (key: PilotPlainMessageKey | null) => {
            noticeReceipt.value = key === null ? null : {key, kind: key === 'state.saved' ? 'success' : 'warning',
                transient: key === 'state.saved', presentation: 'flash'};
        },
    });
    const noticeKind = computed(() => noticeReceipt.value?.kind ?? 'warning');
    const transientNotice = computed(() => noticeReceipt.value?.transient ?? false);
    const noticeInline = computed(() => noticeReceipt.value?.presentation === 'inline');
    const noticeRenewal = computed(() => noticeReceipt.value);
    const feedbackTarget = shallowRef<HTMLElement | null>(null);
    const outcome = shallowRef<PilotCommandOutcome | null>(null);
    const needsUnknownReview = ref(requireUnknownReview);
    const unknownMessage = draft?.unknownMessage ?? 'draft.leaveUnknown';
    const externalBusy = draft?.busy;
    let commandScope: PilotRequestScope | undefined;
    let releaseCommandProtection: (() => void) | undefined;
    let mounted = true;
    onBeforeUnmount(() => { mounted = false; });
    const protection = useDraftProtection({
        dirty: () => draft?.dirty() ?? false,
        busy: () => pending.value || recovering.value || (draft?.busy?.() ?? false),
        uncertain: () => uncertain.value || (draft?.uncertain?.() ?? false),
        unknownMessage,
    });

    /** This retained status carries no fields or callbacks into another feature. Ordinary
     * mounted drafts remain in the component tree; only admitted command uncertainty lasts. */
    function readCommandState(): PilotDraftState {
        return {busy: pending.value || recovering.value || (externalBusy?.() ?? false), dirty: false,
            unknownMessage: uncertain.value ? unknownMessage : null};
    }

    /** A persistent shell form can outlive the actor that owned its earlier command.
     * Retire settled uncertainty/feedback on that transition, without stopping an HTTP
     * operation; its finally block still releases pending work under the captured scope. */
    function retireSettledCommand(): void {
        if (commandScope && !pending.value && !context.isCurrent(commandScope)) acknowledge();
    }
    watch([context.epoch, () => context.session.value?.context], retireSettledCommand, {flush: 'sync'});

    function releaseProtection(): void {
        releaseCommandProtection?.();
        releaseCommandProtection = undefined;
    }

    /** Read authority before releasing a desired-state command; creations still need acknowledgement.
     * Return eligibility for any explicit follow-up so retired reads cannot open review prompts.
     * An explicit recovery may supply a fresh read distinct from its normal post-write follow-up;
     * both use the same scoped protection and never infer authority from a skipped callback. */
    async function reconcile(read: PilotRecoveryRead = refreshAuthority): Promise<boolean> {
        if (pending.value || recovering.value || !mounted) return false;
        const scope = context.capture();
        const origin = frontendDocumentUrl(router.currentRoute.value.fullPath);
        const reviewedCommand = commandScope;
        const reviewedUnknown = uncertain.value;
        const reviewedNotice = notice.value;
        // An unknown write's reconciliation is protected recovery. An ordinary
        // background/resource refresh can still retire with its page. Both must
        // retain the command identity captured before the read, because an older
        // GET cannot acknowledge a later independently submitted unknown mutation.
        let currentRead = true;
        try {
            if (reviewedUnknown) currentRead = await readAuthority(read, false);
            else await read(scope, ownsReconciliation);
        } catch (failure) {
            // The query retains its own failure. An obsolete caller must not replace
            // a newer command's unknown warning or attach feedback to another list.
            if (ownsReconciliation()) throw failure;
            return false;
        }
        if (!ownsReconciliation() || !currentRead) return false;
        // A resource read can reconcile a desired-state update. It cannot identify a created
        // row or prove that mail/registration failed; those commands need deliberate review.
        if (reviewedUnknown && !needsUnknownReview.value) acknowledge();
        else if (notice.value === reviewedNotice && (reviewedNotice === 'state.stale'
            || reviewedNotice === 'state.savedRefreshFailed')) {
            // Native Refresh clears its own read warning, while validation and
            // confirmed success retain their independently owned transient lifetime.
            notice.value = null;
        }
        return true;

        function ownsReconciliation(): boolean {
            return mounted && context.isCurrent(scope) && commandScope === reviewedCommand
                && frontendDocumentUrl(router.currentRoute.value.fullPath) === origin;
        }
    }

    /** Recover authority without interpreting an unchanged read as a failed creation or
     * mail request. One retained status lease protects the whole read, even if a denied
     * response retires this editor. Actor/document/component retirement stops follow-up
     * reads and feedback; it never interrupts the authoritative session update itself. */
    async function recover(read: PilotRecoveryRead = refreshAuthority, presentFailure = true): Promise<boolean> {
        // Related editors propagate failure to their confirmed parent command. They
        // still share this same retained read lifetime instead of duplicating leases.
        return readAuthority(read, presentFailure);
    }

    /** One status lifetime covers identity recovery and unknown resource reconciliation.
     * Their callers own distinct error surfaces: explicit identity recovery presents its
     * durable warning here, while resource queries keep their existing throwing contract. */
    async function readAuthority(read: PilotRecoveryRead, presentFailure: boolean): Promise<boolean> {
        if (pending.value || recovering.value || !mounted) return false;
        const scope = context.capture();
        const origin = frontendDocumentUrl(router.currentRoute.value.fullPath);
        recovering.value = true;
        const releaseRecovery = protection.retainCommand(readCommandState, scope);

        function isCurrentRead(): boolean {
            return mounted && context.isCurrent(scope)
                && frontendDocumentUrl(router.currentRoute.value.fullPath) === origin;
        }

        try {
            await read(scope, isCurrentRead);
            const current = isCurrentRead();
            if (current && presentFailure) clearRecoveredError('state.loadFailed');
            return current;
        } catch (failure) {
            // Only this recovery owns its durable warning. A retired page cannot attach
            // feedback to a later form, and recovery cannot erase unrelated validation.
            if (isCurrentRead() && presentFailure) setError('state.loadFailed', 'durable');
            if (!presentFailure) throw failure;
            return false;
        } finally {
            recovering.value = false;
            releaseRecovery();
            retireSettledCommand();
        }
    }

    function refreshAuthority(): Promise<unknown> {
        return refresh();
    }

    /** Called after review or committed departure, never while a command is in flight. */
    function acknowledge(): void {
        if (pending.value || recovering.value) return;
        uncertain.value = false;
        setError(null);
        notice.value = null;
        outcome.value = null;
        feedbackTarget.value = null;
        releaseProtection();
    }

    /** Local native inline validation/no-ops use the same receipt placement as writes.
     * Capture only presentation, never draft values or authority, before dispatch ends. */
    function captureFeedback(initiator?: Event | Element): void {
        feedbackTarget.value = inlineFeedbackTarget(initiator);
    }

    /** Confirmed native no-ops explain their result without opening a write lease.
     * They still create a fresh localized receipt and retain the initiating host. */
    function setInformation(key: PilotPlainMessageKey, feedback?: PilotCommandFeedback): void {
        captureFeedback(feedback?.initiator);
        notice.value = null;
        setFeedbackInformation(key, feedback?.presentation ?? 'flash');
    }

    /** Success wording belongs to the operation, while lifetime and repeat renewal
     * remain generic. A confirmed result uses this same path after its follow-up read. */
    function setNotice(key: PilotPlainMessageKey, feedback?: PilotCommandFeedback): void {
        captureFeedback(feedback?.initiator);
        publishNotice(key, feedback?.presentation);
    }

    /** Publication retains a command's already captured section. Its asynchronous
     * confirmation must never resolve an event whose currentTarget has expired. */
    function publishNotice(key: PilotPlainMessageKey, presentation: 'flash' | 'inline' = 'flash'): void {
        noticeReceipt.value = {key, kind: 'success', transient: true, presentation};
    }

    /** Execute once in the captured identity scope, protecting its status through
     * any requested follow-up read. Only the operation's admitted result confirms
     * a write; refresh failure cannot undo it, and unknown delivery never replays.
     * Return that confirmed result even when its follow-up remains stale. */
    async function run<T>(operation: (scope: PilotRequestScope) => Promise<T>, refreshAfter = true,
                          reviewUnknown = requireUnknownReview, feedback?: PilotCommandFeedback): Promise<T | undefined> {
        if (pending.value || recovering.value || uncertain.value) return;
        // Capture the DOM presentation boundary synchronously. Event currentTarget
        // expires after dispatch, while feedback can arrive after the write and its
        // follow-up read. Recovery retains this same host instead of moving it to a
        // different section's controls or creating another message state owner.
        captureFeedback(feedback?.initiator);

        // Capture authority before submission; a later identity change retires this result.
        const scope = context.capture();
        commandScope = scope;
        pending.value = true;
        releaseCommandProtection = protection.retainCommand(readCommandState, scope, acknowledge);
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
            // The DOM target was captured before dispatch ended. Do not resolve
            // that expired event again when confirmation arrives asynchronously.
            publishNotice(feedback?.success ?? 'state.saved', feedback?.presentation);
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
                setError('api:errors.VALIDATION_FAILED', 'transient', feedback?.presentation);
            } else if (failure instanceof ApiFailure && failure.confirmedRejection) {
                outcome.value = {confirmation: 'rejected', refresh: 'not-requested'};
                setError(failure, 'transient', feedback?.presentation);
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
                // Validated server text can explain an uncertain write without
                // proving rejection or permitting replay. Keep that diagnostic
                // durable; proxy/HTML/network exception text stays generic.
                if (failure instanceof ApiFailure && failure.safeDetail !== null) {
                    setError(failure, 'durable', feedback?.presentation);
                }
            }
        } finally {
            pending.value = false;
            if (!context.isCurrent(scope)) {
                uncertain.value = false;
                setError(null);
                notice.value = null;
            }
            // Follow-up reads are part of the protected command lifetime. A known result
            // releases it now; uncertainty remains until explicit acknowledgement or a
            // committed departure, even when the submitting component already retired.
            if (!uncertain.value || !context.isCurrent(scope)) releaseProtection();
            finishUpdateCommand();
        }
        return confirmed ? result : undefined;
    }

    return {pending, recovering, uncertain, error, transientError, errorRenewal, errorPresentation, feedbackKind, feedbackTarget,
        notice, noticeKind, transientNotice, noticeInline, noticeRenewal, outcome, setError, setInformation, setNotice,
        clearRecoveredError, captureFeedback, run, reconcile, recover, acknowledge,
        mayLeave: protection.mayLeave, prepareDeparture: protection.prepareDeparture};
}
