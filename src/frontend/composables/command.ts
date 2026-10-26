import {computed, effectScope, inject, onBeforeUnmount, onMounted, provide, ref, shallowRef, watch} from 'vue';
import {useRouter} from 'vue-router';
import type {NavigationFailure, RouteLocationNormalized} from 'vue-router';
import {useActionState, useFrontend} from '../app/context';
import {ApiFailure, InvalidInputError, ObsoleteRequestError} from '../app/transport';
import type {FrontendCommandDraft, FrontendCommandFeedback, FrontendCommandOutcome, FrontendDraftState, FrontendPlainMessageKey,
    FrontendRecoveryRead, FrontendRequestScope} from '../../types/FrontendUiTypes';
import {useFeedbackError, useReadRetry} from './feedback';
import {frontendDocumentUrl} from '../../modules/lib/frontendIdentity';
import type {FrontendCommandPresentation} from '../../types/FrontendFeedbackTypes';

/** These collaborators are private to the mounted draft tree. No draft values or callbacks
 * enter server rendering data, query caches, browser storage or another application request. */
interface DraftOwner {
    register(read: () => FrontendDraftState): () => void;
    prepareDeparture(): (() => void) | undefined;
    retainCommand(read: () => FrontendDraftState, scope: FrontendRequestScope, onDeparture?: () => void): () => void;
}

/** Only command status survives a retired editor. Form values and edit authority stay with
 * their component; actor/visit scope prevents these leases from blocking a later identity. */
interface RetainedCommand {
    read: () => FrontendDraftState;
    scope: FrontendRequestScope;
    origin: string;
    onDeparture?: () => void;
}

const draftOwnerKey = Symbol.for('surveyor.frontend.draft-owner');

/** Each visible notice is its own receipt, including a repeated identical no-op.
 * No feature intent or translated text is inferred from another command's result. */
interface CommandNotice {
    key: FrontendPlainMessageKey;
    kind: 'success' | 'warning';
    transient: boolean;
    readError?: Error;
}

/**
 * Compose mounted form state along the component tree. Only its root registers global
 * departure guards; descendants still receive their own decision for dialog Close.
 * This lets a page, its dialog and inline editors ask once without discarding on consent:
 * the owning form releases values only after navigation commits or a confirmed result.
 */
export function useDraftProtection(draft: FrontendCommandDraft) {
    const context = useFrontend();
    const router = useRouter();
    const parent = inject<DraftOwner | null>(draftOwnerKey, null);
    const ownerScope = context.capture();
    const children = new Set<() => FrontendDraftState>();
    const approvedDepartures = new Set<{origin: string}>();
    const commands = new Set<RetainedCommand>();
    let mounted = true;
    let disposeRoot = () => {};
    provide<DraftOwner>(draftOwnerKey, {register, prepareDeparture, retainCommand});

    /** Attach a child's live draft state to this owner until that child unmounts.
     * Only its reader is retained; field values remain in the child component. */
    function register(read: () => FrontendDraftState): () => void {
        // Read current state at each departure decision instead of copying a
        // dirty/pending snapshot that could outlive the child's actual work.
        children.add(read);
        return function unregister(): void { children.delete(read); };
    }

    /** Pending work wins over prompts. One unknown outcome also covers other unsaved input. */
    function readState(): FrontendDraftState {
        // A persistent shell owner can admit later commands after an actor transition.
        // Ordinary fields still belong to their original draft scope; each status lease
        // and child reader supplies its own authority instead of inheriting that scope.
        const currentDraft = mounted && context.isCurrent(ownerScope);
        const state: FrontendDraftState = {
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

    /** Anchors remain in the same document. They do not discard input or
     * acknowledge uncertainty; actual path/query departures still need one decision. */
    function admitNavigation(to: RouteLocationNormalized, from: RouteLocationNormalized): boolean {
        return frontendDocumentUrl(to.fullPath) === frontendDocumentUrl(from.fullPath) || mayLeave();
    }

    /** An irreversible command must obtain the whole page's departure decision before
     * writing. Descendants delegate to the root, including sibling drafts behind a dialog.
     * The caller retains this root lease through the write and first delivery attempt,
     * then releases it so later departures review current drafts. Pending work still
     * blocks departure; automatic reload never treats approval as a clean draft. */
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
    function retainCommand(read: () => FrontendDraftState, scope: FrontendRequestScope, onDeparture?: () => void): () => void {
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

    /** Root consent can outlive a denied child editor. Retire remaining leases after
     * actual departure; a failed navigation alone retires none. The command caller
     * still releases its original consent when the first delivery attempt settles. */
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
export function useCommand(refresh: () => Promise<unknown>, requireUnknownReview = false, draft?: FrontendCommandDraft) {
    const context = useFrontend();
    const router = useRouter();
    const pending = ref(false);
    const recovering = ref(false);
    const uncertain = ref(false);
    const {error, transientError, errorRenewal, feedbackKind, readError: errorReadError, setError, setReadError,
        setInformation: setFeedbackInformation, clearRecoveredError} = useFeedbackError(draft?.problemKey);
    const noticeReceipt = shallowRef<CommandNotice | null>(null);
    // Keep the existing writable notice contract for durable recovery callers.
    // Feature success uses setNotice; assigning a warning never inherits an old
    // success receipt's lifetime or dismissal renewal.
    const notice = computed({
        get: () => noticeReceipt.value?.key ?? null,
        set: (key: FrontendPlainMessageKey | null) => {
            noticeReceipt.value = key === null ? null : {key, kind: key === 'state.saved' ? 'success' : 'warning',
                transient: key === 'state.saved'};
        },
    });
    const noticeKind = computed(() => noticeReceipt.value?.kind ?? 'warning');
    const transientNotice = computed(() => noticeReceipt.value?.transient ?? false);
    const noticeRenewal = computed(() => noticeReceipt.value);
    const noticeReadError = computed(() => noticeReceipt.value?.readError ?? null);
    const readRetryAvailable = useReadRetry(() => noticeReadError.value ?? errorReadError.value);
    const outcome = shallowRef<FrontendCommandOutcome | null>(null);
    const needsUnknownReview = ref(requireUnknownReview);
    // Consumers may explain the current command's manual review without
    // confusing unrelated dirty fields with an unconfirmed creation outcome.
    const reviewRequired = computed(() => needsUnknownReview.value);
    const unknownMessage = draft?.unknownMessage ?? 'draft.leaveUnknown';
    const externalBusy = draft?.busy;
    let commandScope: FrontendRequestScope | undefined;
    let releaseCommandProtection: (() => void) | undefined;
    let mounted = true;
    onBeforeUnmount(() => { mounted = false; });
    const action = useActionState({eligible: ownsCommand, pending: () => pending.value,
        blocked: () => recovering.value || uncertain.value});
    // Recovery can itself establish session admission. Its generic lifetime must
    // not depend on the resource-read barrier that this operation may reopen.
    const recoveryAction = useActionState({eligible: mayRecoverCommand,
        pending: () => pending.value || recovering.value});
    const readRecoveryAction = useActionState({eligible: mayReconcileRead,
        pending: () => pending.value || recovering.value});
    const protection = useDraftProtection({
        dirty: () => draft?.dirty() ?? false,
        busy: () => pending.value || recovering.value || (draft?.busy?.() ?? false),
        uncertain: () => uncertain.value || (draft?.uncertain?.() ?? false),
        unknownMessage,
    });

    function ownsCommand(): boolean { return mounted; }
    function mayRecoverCommand(): boolean { return mounted && (draft?.recoveryEligible?.() ?? true); }

    /** Only a retained read failure admits the generic feedback recovery action. */
    function mayReconcileRead(): boolean {
        // Unknown write review remains the feature's explicit operation. This
        // action can neither repeat a write nor acknowledge uncertain creation.
        return !uncertain.value && !!(noticeReadError.value ?? errorReadError.value)
            && readRetryAvailable.value && recoveryAction.isAvailable();
    }

    /** Retry this receipt's read through the existing command reconciliation. */
    async function reconcileRead(): Promise<boolean> {
        if (!readRecoveryAction.isAvailable()) return false;
        const reviewedError = errorReadError.value;
        const reviewedErrorRenewal = errorRenewal.value;
        // Reuse this command's captured read lifetime and exact refresh callback,
        // even when the failed query belongs to an enclosing feature section.
        // Ordinary feature Refresh controls own an outer pending flag. This
        // shared control instead uses the existing retained read lifetime, so
        // a second click cannot start/cancel another reconciliation GET.
        const reconciled = await reconcileSafely(readForRecovery);
        if (reconciled && errorReadError.value === reviewedError && errorRenewal.value === reviewedErrorRenewal)
            clearRecoveredError('state.loadFailed');
        return reconciled;
    }

    function readForRecovery(): Promise<boolean> {
        return readAuthority(refreshAuthority, false);
    }

    /** This retained status carries no fields or callbacks into another feature. Ordinary
     * mounted drafts remain in the component tree; only admitted command uncertainty lasts. */
    function readCommandState(): FrontendDraftState {
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
    async function reconcile(read: FrontendRecoveryRead = refreshAuthority): Promise<boolean> {
        if (!recoveryAction.isAvailable()) return false;
        const scope = context.capture();
        const origin = frontendDocumentUrl(router.currentRoute.value.fullPath);
        const reviewedCommand = commandScope;
        const reviewedUnknown = uncertain.value;
        const reviewedNotice = noticeReceipt.value;
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
        else if (noticeReceipt.value === reviewedNotice && (reviewedNotice?.key === 'state.stale'
            || reviewedNotice?.key === 'state.savedRefreshFailed')) {
            // Refresh clears its own read warning, while validation and
            // confirmed success retain their independently owned transient lifetime.
            notice.value = null;
        }
        return true;

        function ownsReconciliation(): boolean {
            return mounted && context.isCurrent(scope) && commandScope === reviewedCommand
                && frontendDocumentUrl(router.currentRoute.value.fullPath) === origin;
        }
    }

    /** Deliberate UI recovery consumes a failed read at its existing query surface.
     * Unlike a causal post-command refresh, an event handler has no awaiting owner
     * to receive rejection. Preserve its draft/status and report unsuccessful recovery. */
    async function reconcileSafely(read: FrontendRecoveryRead = refreshAuthority): Promise<boolean> {
        const reviewedNotice = noticeReceipt.value;
        const reviewedError = errorReadError.value;
        const reviewedErrorRenewal = errorRenewal.value;
        try {
            // Keep all current-actor, command and fresh-read checks in reconcile;
            // consuming delivery failure never acknowledges or retries a write.
            return await reconcile(read);
        } catch (failure) {
            // The read owner retains its failure, cooldown and last admitted data.
            // Renew only this still-owned read identity after a failed Retry so
            // the common notice does not describe the previous GET indefinitely.
            if (noticeReceipt.value === reviewedNotice && reviewedNotice?.readError
                && (reviewedNotice.key === 'state.stale' || reviewedNotice.key === 'state.savedRefreshFailed')) {
                setReadNotice(reviewedNotice.key, failure);
            } else if (reviewedError && errorReadError.value === reviewedError && errorRenewal.value === reviewedErrorRenewal) {
                setReadError('state.loadFailed', failure);
            }
            return false;
        }
    }

    /** Recover authority without interpreting an unchanged read as a failed creation or
     * mail request. One retained status lease protects the whole read, even if a denied
     * response retires this editor. Actor/document/component retirement stops follow-up
     * reads and feedback; it never interrupts the authoritative session update itself. */
    async function recover(read: FrontendRecoveryRead = refreshAuthority, presentFailure = true): Promise<boolean> {
        // Related editors propagate failure to their confirmed parent command. They
        // still share this same retained read lifetime instead of duplicating leases.
        return readAuthority(read, presentFailure);
    }

    /** One status lifetime covers identity recovery and unknown resource reconciliation.
     * Their callers own distinct error surfaces: explicit identity recovery presents its
     * durable warning here, while resource queries keep their existing throwing contract. */
    async function readAuthority(read: FrontendRecoveryRead, presentFailure: boolean): Promise<boolean> {
        if (!recoveryAction.isAvailable()) return false;
        const scope = context.capture();
        const origin = frontendDocumentUrl(router.currentRoute.value.fullPath);
        const reviewedErrorRenewal = errorRenewal.value;
        recovering.value = true;
        const releaseRecovery = protection.retainCommand(readCommandState, scope);

        function isCurrentRead(): boolean {
            return mounted && context.isCurrent(scope)
                && frontendDocumentUrl(router.currentRoute.value.fullPath) === origin;
        }

        try {
            await read(scope, isCurrentRead);
            const current = isCurrentRead();
            if (current && presentFailure && errorRenewal.value === reviewedErrorRenewal) clearRecoveredError('state.loadFailed');
            return current;
        } catch (failure) {
            // Only this recovery owns its durable warning. A retired page cannot attach
            // feedback to a later form, and recovery cannot erase unrelated validation.
            if (isCurrentRead() && presentFailure && errorRenewal.value === reviewedErrorRenewal) setReadError('state.loadFailed', failure);
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
        releaseProtection();
    }

    /** Confirmed no-ops create a fresh localized receipt without opening a write lease. */
    function setInformation(key: FrontendPlainMessageKey): void {
        notice.value = null;
        setFeedbackInformation(key);
    }

    /** Success wording belongs to the operation, while lifetime and repeat renewal
     * remain generic. A confirmed result uses this same path after its follow-up read. */
    function setNotice(key: FrontendPlainMessageKey): void {
        publishNotice(key);
    }

    /** Only the operation confirms success. Shared presentation owns its visible host. */
    function publishNotice(key: FrontendPlainMessageKey): void {
        noticeReceipt.value = {key, kind: 'success', transient: true};
    }

    /** Explain a failed read through this notice's existing immutable receipt.
     * Error identity joins presentation only; the query still owns its state. */
    function setReadNotice(key: 'state.stale' | 'state.savedRefreshFailed', failure: unknown): void {
        noticeReceipt.value = {key, kind: 'warning', transient: false,
            ...(failure instanceof Error ? {readError: failure} : {})};
    }

    /** Execute once in the captured identity scope, protecting its status through
     * any requested follow-up read. Only the operation's admitted result confirms
     * a write; refresh failure cannot undo it, and unknown delivery never replays.
     * Return that confirmed result even when its follow-up remains stale. New
     * operations require a mounted owner; already admitted work can outlive it. */
    async function run<T>(operation: (scope: FrontendRequestScope) => Promise<T>, refreshAfter = true,
                          reviewUnknown = requireUnknownReview, feedback?: FrontendCommandFeedback): Promise<T | undefined> {
        // A delayed preflight can finish after admission retires its form. Reject
        // that new submission before capturing authority or retaining a status lease.
        // Work admitted before unmount keeps its existing deferred steps and settlement.
        if (!action.isAvailable()) return;

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
                // Returning from a native confirmation can trigger focus/session
                // revalidation while the write settles. Join that existing read
                // before refreshing instead of treating its temporary dispatch
                // barrier as a failed saved-state read. No new session request or
                // command replay is needed; real read failures still reach below.
                if (!context.mayRead(scope) && context.sessionRead.value.pending) await context.refreshSession();
                if (!context.isCurrent(scope)) throw new ObsoleteRequestError();
                await refresh();
                outcome.value = {confirmation: 'confirmed', refresh: 'succeeded'};
            }
            if (!context.isCurrent(scope)) {
                outcome.value = {confirmation: 'obsolete', refresh: outcome.value.refresh};
                return;
            }
            // Successful maintenance can deliberately have no success notice.
            // This presentation choice leaves confirmation and every failure path intact.
            if (feedback?.success !== null) publishNotice(feedback?.success ?? 'state.saved');
        } catch (failure) {
            // Actual actor retirement still closes every result. Before confirmation,
            // intentional disposal also keeps its existing obsolete outcome.
            if (!context.isCurrent(scope) || (!confirmed && failure instanceof ObsoleteRequestError)) {
                outcome.value = {confirmation: 'obsolete', refresh: outcome.value?.refresh ?? 'not-requested'};
                return;
            }
            if (confirmed) {
                // Routine session verification can pause/cancel the follow-up read
                // without retiring this actor. Preserve the completed write's result
                // so its form releases submitted input instead of offering it again.
                outcome.value = {confirmation: 'confirmed', refresh: 'failed'};
                setReadNotice('state.savedRefreshFailed', failure);
            } else if (failure instanceof InvalidInputError) {
                outcome.value = {confirmation: 'rejected', refresh: 'not-requested'};
                // Keep the feature's validated field diagnostic localized across
                // language changes. Other callers retain the common fallback.
                setError(failure);
            } else if (failure instanceof ApiFailure && failure.confirmedRejection) {
                outcome.value = {confirmation: 'rejected', refresh: 'not-requested'};
                // Operations may identify a known no-op as information without
                // replacing shared receipt timing, localized wording or placement.
                // The validated rejection still retains its honest outcome.
                const information = failure.problem && feedback?.rejectionInformation?.[failure.problem.code];
                if (information) setFeedbackInformation(information);
                else setError(failure);
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
                    setError(failure, 'durable');
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

    /** Presentation clears only its own receipt. It never acknowledges uncertainty,
     * releases a draft/status lease or changes the admitted command's outcome. */
    function dismissError(): void { setError(null); }
    function dismissNotice(): void { notice.value = null; }

    // Share the actual refs rather than copying their current values into another
    // reactive store. No write, draft or authority callback reaches presentation;
    // guarded read-only recovery delegates to this same command owner.
    const feedback: FrontendCommandPresentation = {error, transientError, errorRenewal, feedbackKind,
        notice, noticeKind, transientNotice, noticeRenewal, uncertain, errorReadError, noticeReadError,
        readRecoveryAction, reconcileRead, dismissError, dismissNotice};

    return {action, recoveryAction, pending, recovering, uncertain, reviewRequired, feedback, error, transientError, errorRenewal, feedbackKind,
        notice, noticeKind, transientNotice, noticeRenewal, outcome, setError, setInformation, setNotice,
        clearRecoveredError, setReadError, setReadNotice, run, reconcile, reconcileSafely, recover, acknowledge,
        mayLeave: protection.mayLeave, prepareDeparture: protection.prepareDeparture};
}
