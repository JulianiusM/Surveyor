<script setup lang="ts">
import {computed, onBeforeUnmount, ref, shallowRef, watch} from 'vue';
import {useQuery, type QueryFunctionContext} from '@tanstack/vue-query';
import type {components} from '../../../types/api/v1';
import type {ActivityRecommendationDraftRow, ActivityRecommendationPairChoice, ActivityRecommendationReviewAction,
    ActivityRecommendationRow} from '../../../types/FrontendActivityRecommendationTypes';
import type {FrontendRequestScope} from '../../../types/FrontendUiTypes';
import {useActionState, useFrontend} from '../../app/context';
import {activityKeys} from '../../app/queryKeys';
import {refetchFreshQuery, useQueryAdmission} from '../../app/queryCache';
import {ApiFailure, isReadDenial, ObsoleteRequestError} from '../../app/transport';
import {useCommand} from '../../composables/command';
import {useReadRetry} from '../../composables/feedback';
import ActionButton from '../../components/ActionButton.vue';
import AppDialog from '../../components/AppDialog.vue';
import FormField from '../../components/FormField.vue';
import CommandFeedback from '../../components/CommandFeedback.vue';
import StatusNotice from '../../components/StatusNotice.vue';
import ActivityRecommendationSchedule from './ActivityRecommendationSchedule.vue';
import ActivityRecommendationEditor from './ActivityRecommendationEditor.vue';
import ActivityWarnings from './ActivityWarnings.vue';
import {pairRecommendationRows, reconcileRecommendationRows, recommendationIdentity, recommendationPartners,
    recommendationRelationship, recommendationReview, revalidateRecommendationGroups} from './recommendationDraft';
import {activityParticipantName} from './presentation';
import {useActivityApi} from './api';

type Workspace = components['schemas']['ActivityRecommendations'];
type Preview = components['schemas']['ActivityRecommendationPreview'];
type Job = components['schemas']['ActivityRecommendationJob'];

// Server snapshots live in Query; the local review owns independent values and
// its saved baseline. Maintenance is a single-attempt entry command, never a
// query function or background refetch. Explicit generation completion retains
// its entry trigger; automatic job completion reads only a pure snapshot.
const props = defineProps<{planId: string; view: components['schemas']['ActivityView'];
    assignmentMode?: components['schemas']['ActivityView']['assignmentMode']; disabled?: boolean}>();
const emit = defineEmits<{changed: []; denied: []}>();
const context = useFrontend();
const {messages} = context;
const api = useActivityApi(context);
const key = computed(() => activityKeys.recommendations(context.session.value?.context, props.planId));
const loaded = ref(false);
const revoked = ref(false);
const rows = ref<ActivityRecommendationDraftRow[]>([]);
const baseline = ref('');
const warnings = shallowRef<Preview['warnings']>([]);
const previewFailed = ref(false);
const previewing = ref(false);
// Only the deliberate initiating action owns transient button focus. Its handler
// spans preview/command handoffs; background entry/job maintenance has no claim.
const pendingControl = ref<'reload' | 'generate' | 'save' | null>(null);
const frozen = shallowRef<components['schemas']['ActivityRecommendationApplication'] | null>(null);
const confirmation = ref(false);
const manualSlot = ref<string | null>(null);
const pairChoice = shallowRef<ActivityRecommendationPairChoice | null>(null);
const pairSelection = ref('');
const pairStale = ref(false);
const jobId = ref<string | null>(null);
const jobStartedAt = ref(0);
const jobTimedOut = ref(false);
const jobTerminal = shallowRef<Job | null>(null);
const remoteChanged = ref(false);
const result = shallowRef<components['schemas']['ActivityRecommendationApplyResult'] | null>(null);
const dirty = computed(() => JSON.stringify(recommendationReview(rows.value)) !== baseline.value && loaded.value);
let active = true;
let sequence = 0;
let rowSequence = 0;
let entered = false;
let previewAbort: AbortController | undefined;
const completed = new Set<string>();
const explicitlyDispatched = new Set<string>();
onBeforeUnmount(() => { active = false; sequence++; previewAbort?.abort(); });
const admission = useQueryAdmission(context, key, computed(() => loaded.value && !revoked.value));
const snapshot = useQuery({queryKey: key, ...admission, queryFn: readSnapshot, staleTime: Infinity});
const workspace = computed(() => revoked.value ? undefined : snapshot.data.value);
const command = useCommand(refreshSnapshot, true, {dirty: () => dirty.value,
    busy: () => previewing.value || confirmation.value, unknownMessage: 'draft.leaveUnknown'});
const reviewBlocked = computed(() => !!props.disabled || revoked.value || command.action.disabled.value || previewing.value || confirmation.value);
const blocked = computed(() => reviewBlocked.value || pairChoice.value !== null);
const pairOptions = computed(currentPairOptions);
// The admitted requirement form supplies its live mode, using the local
// Auto control. The server still decides generation from persisted settings.
const assignmentMode = computed(() => props.assignmentMode ?? props.view.assignmentMode);
const retryRead = useReadRetry(() => snapshot.error.value);
const jobKey = computed(() => activityKeys.recommendationJob(context.session.value?.context, props.planId, jobId.value ?? ''));
const jobAdmission = useQueryAdmission(context, jobKey, computed(() => !!jobId.value && !revoked.value && !jobTimedOut.value));
const job = useQuery({queryKey: jobKey, ...jobAdmission, queryFn: readJob, refetchInterval: jobInterval,
    refetchIntervalInBackground: false, retry: false});
const retryJob = useReadRetry(() => job.error.value);
const running = computed(() => !!jobId.value && !jobTimedOut.value && !job.error.value
    && (!job.data.value || isRunning(job.data.value)));
const counts = computed(() => ({PENDING: rows.value.filter(row => row.value.status === 'PENDING').length,
    APPROVED: rows.value.filter(row => row.value.status === 'APPROVED').length,
    REJECTED: rows.value.filter(row => row.value.status === 'REJECTED').length}));
const statuses = ['PENDING', 'APPROVED', 'REJECTED'] as const;
const snapshotAction = useActionState({eligible: () => retryRead.value && !revoked.value,
    pending: () => snapshot.isFetching.value || command.recovering.value, blocked: () => command.recoveryAction.disabled.value});
const jobAction = useActionState({eligible: () => retryJob.value && !revoked.value,
    pending: () => job.isFetching.value});
const previewAction = useActionState({eligible: () => !blocked.value});

/** Pure reconciliation cannot enqueue work or infer whether a dispatched command
 * failed. It updates only this captured actor/plan's authorized server snapshot. */
async function readSnapshot({signal}: QueryFunctionContext): Promise<Workspace> {
    const scope = context.capture();
    const planId = props.planId;
    const value = await api.recommendations(planId, scope, signal);
    if (!active || signal.aborted || !context.isCurrent(scope) || planId !== props.planId) throw new ObsoleteRequestError();
    return value;
}
/** Recovery requires a newly dispatched authorized GET, including when Query
 * structurally shares an unchanged response with the previous snapshot. */
async function refreshSnapshot(): Promise<void> {
    // The shared helper rejects canceled/cache-only delivery as fresh authority.
    await refetchFreshQuery<Workspace>(context.queryClient, key.value, () => snapshot.refetch({throwOnError: true}),
        () => active && !revoked.value && context.mayRead());
}

/** Install a known receipt without replacing intentional unsaved review choices.
 * New data still supplies current modal choices; applying always rechecks them. */
function receive(value: Workspace, replace = false): void {
    if (!active || revoked.value) return;
    // Saved legs may retire while intentional status edits remain local. Their
    // former partner must never attach itself to a different reverse operation.
    revalidateRecommendationGroups(rows.value, value.recommendations);
    // Approved R1: entry may return an already queued deadline job. Observe its
    // identity without another dispatch or changing maintenance triggers.
    if (value.autoGenerationJob) observeJob(value.autoGenerationJob);
    if (dirty.value && !replace) {
        // Compare saved intent with the draft's original baseline. An unchanged
        // recovery read is not a remote conflict and never replaces local choices.
        const savedReview = recommendationReview(value.recommendations.map(value => ({key: '', value})));
        remoteChanged.value = JSON.stringify(savedReview) !== baseline.value;
        // Changed assignment/context inputs can change local warnings even when
        // saved review rows are equal. A frozen confirmation keeps its own digest.
        if (!confirmation.value && !previewing.value && !command.pending.value && context.mayRead()) void updateWarnings();
        return;
    }
    // Clone mutable review rows out of Query. Their status belongs to the draft;
    // the authorized server snapshot remains unchanged for other observers.
    rows.value = reconcileRecommendationRows(value.recommendations, rows.value, nextRecommendationKey);
    baseline.value = JSON.stringify(recommendationReview(rows.value));
    warnings.value = value.warnings;
    previewFailed.value = false;
    remoteChanged.value = false;
}

/** Confirmed maintenance supplies a snapshot, not a saved-edit notification.
 * All feature-specific entry triggers publish through this same owner. */
function publishWorkspace(value: Workspace, replace = false): void {
    if (!active || revoked.value) return;
    // A successful workspace load is quiet. Retain command uncertainty
    // and errors, while removing only this confirmed load's generic success.
    command.feedback.dismissNotice();
    receive(value, replace);
    context.queryClient.setQueryData(key.value, value);
    loaded.value = true;
}
watch(snapshot.data, value => { if (value) receive(value); });
watch(() => props.view, () => {
    // Slots, assignments and Event context are inputs to the advanced snapshot.
    // Refresh only its pure projection; dirty rows survive the new remote data.
    if (loaded.value && !revoked.value) void context.queryClient.invalidateQueries({queryKey: key.value, exact: true});
});
watch([snapshot.error, () => job.error.value], ([snapshotFailure, jobFailure]) => {
    // An unavailable observed job does not revoke the independently admitted
    // workspace. Authentication/permission loss still retires its private data.
    const jobDenied = isReadDenial(jobFailure) && !(jobFailure instanceof ApiFailure && jobFailure.status === 404);
    if (!isReadDenial(snapshotFailure) && !jobDenied) return;
    retireAdvancedAccess();
}, {flush: 'sync'});

/** Retire only the advanced workspace when its current grant is lost. Pending
 * command receipts keep their shared lifetime without retaining private rows. */
function retireAdvancedAccess(): void {
    if (revoked.value) return;
    // The independently admitted schedule/participant projection remains owned
    // by the parent. This subtree releases every advanced draft and modal.
    revoked.value = true;
    rows.value = [];
    baseline.value = JSON.stringify([]);
    loaded.value = false;
    warnings.value = [];
    frozen.value = null;
    confirmation.value = false;
    manualSlot.value = null;
    cancelPairChoice();
    jobId.value = null;
    jobTerminal.value = null;
    result.value = null;
    previewAbort?.abort();
    // Job observations are children of the same recommendation query family;
    // cancellation and removal release their private cached projections too.
    void context.queryClient.cancelQueries({queryKey: key.value});
    context.queryClient.removeQueries({queryKey: key.value});
    emit('denied');
}

/** Commands and warning previews enforce the same private-projection retirement
 * as query reads. Rejections still propagate to the existing command owner. */
async function advancedCommand<T>(operation: Promise<T>, scope: FrontendRequestScope): Promise<T> {
    try {
        return await operation;
    } catch (failure) {
        // A late former actor's rejection cannot retire another actor's view.
        // The operation's validated denial, rather than localized feedback text,
        // establishes loss of this workspace's current access.
        if (active && context.isCurrent(scope) && isReadDenial(failure)) retireAdvancedAccess();
        throw failure;
    }
}

/** The page opens the recommendation workspace once on page entry, even with the
 * Schedule tab active. Capture that trigger once; uncertain delivery never retries. */
async function enterWorkspace(): Promise<void> {
    if (!active || entered || !context.mayRead() || !command.action.isAvailable()) return;
    entered = true;
    // Successful workspace loading is quiet. The shared notification host must
    // not announce a saved change when this entry only prepares the workspace.
    const value = await command.run(scope => advancedCommand(api.recommendationWorkspace(props.planId, scope), scope),
        false, true, {success: null});
    if (value) publishWorkspace(value, true);
}
watch(() => context.hydrated.value && context.mayRead(), ready => { if (ready) void enterWorkspace(); }, {immediate: true});

/** Only an explicit Reload discards a local draft and repeats maintenance.
 * A canceled confirmation keeps every row and its current warning state. */
async function reload(): Promise<void> {
    if (blocked.value || dirty.value && !window.confirm(messages.value.t('draft.discard'))) return;
    // Feature-specific maintenance starts only after accepted discard. Its
    // initiating Reload stays distinct from automatic entry/job maintenance.
    pendingControl.value = 'reload';
    try {
        const value = await command.run(scope => advancedCommand(api.recommendationWorkspace(props.planId, scope), scope),
            false, true, {success: null});
        if (value) publishWorkspace(value, true);
    } finally { pendingControl.value = null; }
}

/** A retained domain job is observed through its own identity. No generation
 * POST is repeated by progress observation, visibility recovery or a failed GET. */
function observeJob(value: Job, restart = false): void {
    if (jobId.value === value.id && !restart) return;
    // A dispatch receipt chooses one observer key. A deliberate coalesced
    // dispatch may restart observation after an earlier unavailable GET.
    jobId.value = value.id;
    jobStartedAt.value = Date.now();
    jobTimedOut.value = false;
    jobTerminal.value = isRunning(value) ? null : value;
    context.queryClient.setQueryData(activityKeys.recommendationJob(context.session.value?.context, props.planId, value.id), value);
}
function isRunning(value: Job): boolean { return value.status === 'QUEUED' || value.status === 'RUNNING'; }
/** Observe a live job at the cadence within its finite observation window. */
function jobInterval(query: {state: {data?: Job; error: Error | null}}): number | false {
    // Use bounded ten-minute observation while honoring admission,
    // background visibility and any server read cooldown in shared transport.
    if (!jobId.value || !active || !context.mayRead() || !context.visible.value || query.state.error || jobTimedOut.value) return false;
    if (Date.now() - jobStartedAt.value >= 600_000) { jobTimedOut.value = true; return false; }
    return !query.state.data || isRunning(query.state.data) ? 500 : false;
}
/** A late or canceled status read cannot publish into a replacement job/actor. */
async function readJob({signal}: QueryFunctionContext): Promise<Job> {
    // Capture the observation identity before HTTP; Query cancellation alone
    // cannot establish that a response belongs to the current mounted job.
    const id = jobId.value!;
    const scope = context.capture();
    const value = await api.recommendationJob(props.planId, id, scope, signal);
    if (!active || signal.aborted || !context.isCurrent(scope) || id !== jobId.value) throw new ObsoleteRequestError();
    return value;
}
/** Complete each known job once. Explicit generation retains maintenance;
 * approved deadline-job observation adopts saved results through a pure read. */
async function finishObservedJob(): Promise<void> {
    const value = job.data.value;
    if (!value || isRunning(value) || completed.has(value.id) || command.pending.value || command.uncertain.value) return;
    completed.add(value.id);
    jobTerminal.value = value;
    if (value.status !== 'COMPLETE' || !active || revoked.value) return;
    // Preserve edits made while generation ran; a late response is not consent
    // to discard them. An explicit Reload can adopt the new saved proposals.
    if (!explicitlyDispatched.has(value.id)) {
        try {
            // Observing automatic work must never enqueue another calculation.
            // Query owns a failed result read and its deliberate retry control.
            await refreshSnapshot();
        } catch {
            // Retain the terminal job and draft; the snapshot presents its error.
        }
        return;
    }
    const refreshed = await command.run(scope => advancedCommand(api.recommendationWorkspace(props.planId, scope), scope),
        false, true, {success: null});
    if (refreshed) publishWorkspace(refreshed);
}
watch([job.data, command.pending, command.uncertain], finishObservedJob);
/** Dispatch deliberately once and consume only an explicitly accepted discard.
 * New edits made while the accepted calculation runs remain independent. */
async function generate(): Promise<void> {
    if (blocked.value || running.value || assignmentMode.value === 'FREE') return;
    if (dirty.value && !window.confirm(messages.value.t('draft.discard'))) return;
    pendingControl.value = 'generate';
    try {
        const value = await command.run(scope => advancedCommand(api.generateRecommendations(props.planId, scope), scope), false, true);
        if (value && active) {
            // Confirmed dispatch consumes the deliberate discard decision. Edits
            // made after this baseline still survive the eventual job completion.
            baseline.value = JSON.stringify(recommendationReview(rows.value));
            explicitlyDispatched.add(value.job.id);
            observeJob(value.job, true);
        }
    } finally { pendingControl.value = null; }
}

/** Every draft change invalidates prior warning authority. New warnings may
 * publish only for the identical serialized draft, actor and mounted workspace. */
async function previewRows(additional: ActivityRecommendationRow[] = []): Promise<Preview> {
    const scope = context.capture();
    const all = [...rows.value, ...additional.map(value => ({key: '', value}))];
    return advancedCommand(api.previewRecommendations(props.planId, recommendationReview(all), scope), scope);
}
/** Refresh persistent row warnings for one exact draft generation without writing it. */
async function updateWarnings(): Promise<void> {
    if (!active || revoked.value) return;
    const request = ++sequence;
    previewAbort?.abort();
    previewAbort = new AbortController();
    const scope = context.capture();
    const body = recommendationReview(rows.value);
    const serialized = JSON.stringify(body);
    try {
        // Cancellation and generation checks protect this read; the exact same
        // feature serializer is used by the final save preview below.
        const preview = await advancedCommand(api.previewRecommendations(props.planId, body, scope, previewAbort.signal), scope);
        if (active && request === sequence && context.isCurrent(scope) && serialized === JSON.stringify(recommendationReview(rows.value))) {
            warnings.value = preview.warnings;
            previewFailed.value = false;
        }
    } catch {
        if (active && !revoked.value && request === sequence && context.isCurrent(scope)) previewFailed.value = true;
    }
}
/** A swap's paired status changes together; ambiguous saved rows first need
 * explicit counterpart selection without changing either local review value. */
function changeStatus(row: ActivityRecommendationDraftRow, status: 'PENDING' | 'APPROVED' | 'REJECTED'): void {
    requestReviewAction(row, {kind: 'status', status});
}
/** Removing a manual intent cancels its reciprocal leg without a server write. */
function remove(row: ActivityRecommendationDraftRow): void {
    if (row.value.manual) requestReviewAction(row, {kind: 'remove'});
}

/** Keys are local render identity; operation identity owns read reconciliation. */
function nextRecommendationKey(): string { return String(++rowSequence); }

/** An admitted snapshot must still contain a saved operation before review can
 * change it. Newly staged operations have no saved identity to retire yet. */
function currentSavedOperation(row: ActivityRecommendationDraftRow): boolean {
    return !row.value.id || !!workspace.value?.recommendations.some(value => recommendationIdentity(value) === recommendationIdentity(row.value));
}

/** Capture the reviewed operation and its corresponding admitted server value.
 * Names and locale are presentation only; a changed/removed saved operation
 * cannot inherit a chooser confirmation intended for its former contents. */
function pairVersion(row: ActivityRecommendationDraftRow): string {
    // Retain local review status and fresh saved status as separate evidence;
    // either can change while the operation's stable identity remains equal.
    const saved = row.value.id ? workspace.value?.recommendations.find(value => value.id === row.value.id) : undefined;
    return JSON.stringify([recommendationIdentity(row.value), row.value.status,
        row.value.id ? saved ? [recommendationIdentity(saved), saved.status] : null : 'local']);
}

/** Resolve only unchanged candidates from this chooser's captured actor and row.
 * Locale and clean-read labels remain presentation only; unavailable or replaced
 * operations disappear without replacing intentional dirty review values. */
function currentPairOptions(): ActivityRecommendationDraftRow[] {
    const choice = pairChoice.value;
    if (!choice || !context.isCurrent(choice.scope)) return [];
    const row = rows.value.find(value => recommendationIdentity(value.value) === choice.rowIdentity);
    if (!row || !currentSavedOperation(row) || pairVersion(row) !== choice.rowVersion) return [];
    // Only the relationship owner selects eligible opposite moves. A known
    // local pair or explicit single move cannot be borrowed by this chooser.
    const relationship = recommendationRelationship(rows.value, row);
    if (relationship.kind !== 'ambiguous') return [];
    const candidates: ActivityRecommendationDraftRow[] = [];
    for (const candidate of relationship.candidates) {
        const captured = choice.candidates.find(value => value.identity === recommendationIdentity(candidate.value));
        if (captured && currentSavedOperation(candidate) && captured.version === pairVersion(candidate)) candidates.push(candidate);
    }
    return candidates;
}

/** Stage no status/removal until pairing is known. Every matching review action
 * uses the same resolver as schedule labels, keeping distinct swaps independent. */
function requestReviewAction(row: ActivityRecommendationDraftRow, action: ActivityRecommendationReviewAction): void {
    if (!active || blocked.value || !rows.value.includes(row)) return;
    const relationship = recommendationRelationship(rows.value, row);
    // Dirty snapshots retain values for review, but cannot revive retired saved
    // operations or apply a paired action to a replaced leg.
    if (!relationship.partners.every(currentSavedOperation)) {
        command.setError('activity.recommendations.pairStale');
        return;
    }
    if (relationship.kind === 'ambiguous') {
        pairSelection.value = '';
        pairStale.value = false;
        pairChoice.value = {scope: context.capture(), rowIdentity: recommendationIdentity(row.value),
            rowVersion: pairVersion(row), action, candidates: relationship.candidates.map(candidate =>
                ({identity: recommendationIdentity(candidate.value), version: pairVersion(candidate)}))};
        return;
    }
    // Remember a mutually unique restored pair once the user acts on it. Future
    // harmless reads preserve that relationship even if other moves are added.
    if (relationship.kind === 'paired') pairRecommendationRows(row, relationship.partners.find(partner => partner !== row)!);
    applyReviewAction(row, action);
}

/** Apply one already admitted local action to exactly its resolved relationship.
 * The existing warning/application owners retain every later server boundary. */
function applyReviewAction(row: ActivityRecommendationDraftRow, action: ActivityRecommendationReviewAction): void {
    const partners = recommendationPartners(rows.value, row);
    if (action.kind === 'status') {
        for (const partner of partners) partner.value.status = action.status;
    } else {
        // Object identity selects this current draft's exact legs; no first
        // reverse-slot match can delete a participant from another swap.
        rows.value = rows.value.filter(candidate => !partners.includes(candidate));
        command.setNotice('activity.recommendations.removed');
    }
    void updateWarnings();
}

/** Cancel releases chooser state only; the review's values remain byte-for-byte unchanged. */
function cancelPairChoice(): void {
    pairChoice.value = null;
    pairSelection.value = '';
    pairStale.value = false;
}

/** Revalidate immediately before grouping or mutating. Background replacement,
 * lost authority or an actor change can never turn an old choice into a new action. */
function confirmPairChoice(): void {
    const choice = pairChoice.value;
    if (!active || !choice || reviewBlocked.value || !context.isCurrent(choice.scope)) return;
    // Resolve again against current draft and authority. A former option's
    // identity alone cannot confirm a changed saved status or endpoint.
    const row = rows.value.find(value => recommendationIdentity(value.value) === choice.rowIdentity);
    const partner = pairOptions.value.find(value => recommendationIdentity(value.value) === pairSelection.value);
    if (!row || !partner || pairVersion(row) !== choice.rowVersion || !pairRecommendationRows(row, partner)) {
        pairSelection.value = '';
        pairStale.value = true;
        return;
    }
    // Only this final admission records a group and releases the captured action.
    // Cancellation and every earlier failure leave the review untouched.
    const action = choice.action;
    cancelPairChoice();
    applyReviewAction(row, action);
}

/** A chooser's captured operation must survive the same admission lifecycle as
 * its containing review. Losing a candidate clears that selection before render. */
function reconcilePairChoice(): void {
    const choice = pairChoice.value;
    if (!choice) return;
    // Authority/command retirement closes the whole chooser before any action.
    if (!active || revoked.value || reviewBlocked.value || !context.isCurrent(choice.scope)) {
        cancelPairChoice();
        return;
    }
    // Losing one candidate clears only that selection; losing the requested
    // operation or all evidence retires the intent instead of guessing a partner.
    if (!pairOptions.value.length) {
        cancelPairChoice();
        command.setError('activity.recommendations.pairStale');
    } else if (pairSelection.value && !pairOptions.value.some(row => recommendationIdentity(row.value) === pairSelection.value)) {
        pairSelection.value = '';
        pairStale.value = true;
    }
}
watch([rows, workspace, reviewBlocked, context.epoch], reconcilePairChoice, {flush: 'sync'});

/** Identify a counterpart through admitted participant/slot labels, never opaque
 * local group keys. Translation changes labels without changing the chosen value. */
function pairOptionLabel(row: ActivityRecommendationDraftRow): string {
    return messages.value.t('activity.recommendations.pairOption', {
        name: activityParticipantName(row.value.profile.name, messages.value.t, row.value.profile.nameIsFallback, row.value.profile.id),
        source: row.value.sourceItem?.title ?? '', target: row.value.item.title,
    });
}
/** Publish the already constructed manual rows together into the local draft. */
function stage(values: ActivityRecommendationRow[]): void {
    if (blocked.value) return;
    // Construction supplies both swap legs together. A single staged move is
    // explicitly independent, even if a later separate move has reverse endpoints.
    const staged: ActivityRecommendationDraftRow[] = values.map(value => ({key: nextRecommendationKey(), value, swapGroup: null}));
    if (staged.length === 2) pairRecommendationRows(staged[0]!, staged[1]!);
    rows.value.push(...staged);
    manualSlot.value = null;
    void updateWarnings();
}
/** Stage the existing assignment's removal for later whole-batch review. */
function unassign(slotId: string, profileId: string): void {
    if (blocked.value || !workspace.value) return;
    // Preserve the single-intent-per-placement guard and admitted identity.
    if (rows.value.some(row => row.value.item.id === slotId && row.value.profile?.id === profileId)) {
        command.setError('activity.recommendations.duplicate');
        return;
    }
    const assignment = workspace.value.existingAssignments.find(item => item.item.id === slotId && item.profile.id === profileId);
    if (assignment) stage([{item: assignment.item, profile: assignment.profile, sourceItem: null,
        status: 'APPROVED', operation: 'UNASSIGN', manual: true}]);
}
/** Preview new manual legs within the entire current review, then select their warnings. */
async function manualPreview(values: ActivityRecommendationRow[]): Promise<components['schemas']['ActivityWarning'][]> {
    const preview = await previewRows(values);
    // Return only new operation warnings, including each reciprocal swap leg.
    return preview.warnings.filter(entry => values.some(value => value.item.id === entry.recommendation.itemId
        && value.profile?.id === entry.recommendation.profileId
        && value.operation === (entry.recommendation.operation ?? 'ASSIGN')
        && (value.sourceItem?.id ?? null) === (entry.recommendation.sourceItemId ?? null))).flatMap(entry => entry.warnings);
}

/** Freeze the complete batch before preview. Confirmation consumes that batch
 * and its exact overlap digest; no mutable current draft is substituted later. */
async function save(): Promise<void> {
    if (blocked.value || !workspace.value) return;
    pendingControl.value = 'save';
    previewing.value = true;
    sequence++;
    previewAbort?.abort();
    const scope = context.capture();
    const body = recommendationReview(rows.value);
    try {
        const preview = await advancedCommand(api.previewRecommendations(props.planId, body, scope), scope);
        if (!active || !context.isCurrent(scope)) return;
        warnings.value = preview.warnings;
        previewFailed.value = false;
        frozen.value = {...body, ...(preview.overlapConfirmation ? {overlapConfirmation: preview.overlapConfirmation} : {})};
        if (preview.overlapConfirmation) confirmation.value = true;
        else {
            previewing.value = false;
            await applyFrozen();
        }
    } catch (failure) {
        if (active && !revoked.value && context.isCurrent(scope)) {
            frozen.value = null;
            previewFailed.value = true;
            command.setError('activity.recommendations.warningsFailed');
        }
    } finally {
        previewing.value = false;
        pendingControl.value = null;
    }
}
function cancelConfirmation(): void { confirmation.value = false; frozen.value = null; }
/** Submit the frozen acknowledged batch once and retain its actual completion receipt. */
async function applyFrozen(): Promise<void> {
    const body = frozen.value;
    if (!body || command.action.disabled.value) return;
    confirmation.value = false;
    frozen.value = null;
    const value = await command.run(scope => advancedCommand(api.applyRecommendations(props.planId, body, scope), scope), false, true);
    if (!active || !value) { if (!command.uncertain.value && active && !revoked.value) await updateWarnings(); return; }
    // A confirmed application releases only this submitted review. A later read
    // failure cannot turn it into another apply attempt or clear sibling drafts.
    result.value = value;
    warnings.value = value.warnings;
    baseline.value = JSON.stringify(recommendationReview(rows.value));
    emit('changed');
    // A confirmed apply performs one workspace-entry maintenance call.
    // Keep that explicit lifecycle step separate from pure background reads.
    const refreshed = await command.run(scope => advancedCommand(api.recommendationWorkspace(props.planId, scope), scope),
        false, true, {success: null});
    if (refreshed) publishWorkspace(refreshed);
}

/** Unknown dispatch/application requires an actual pure read and deliberate
 * review. Neither an unchanged snapshot nor a missing job proves noncompletion. */
async function reviewUnknown(): Promise<void> {
    // Fresh saved proposals allow deliberate review, but do not identify a lost
    // dispatch response or prove that its calculation has stopped.
    const current = await command.reconcileSafely(refreshSnapshot);
    if (!current || !active || !workspace.value) return;
    loaded.value = true;
    if (window.confirm(messages.value.t('activity.recommendations.reviewedUnknown'))) command.acknowledge();
}
function statusLabel(status: typeof statuses[number]): string {
    return messages.value.t(status === 'APPROVED' ? 'activity.recommendations.approved'
        : status === 'REJECTED' ? 'activity.recommendations.rejected' : 'activity.recommendations.pending');
}
</script>

<template>
    <hr />
    <div class="mb-3">
        <span class="badge bg-light text-dark me-2">{{ messages.t('activity.recommendations.step') }}</span><span class="fw-semibold">{{ messages.t('activity.recommendations.stepTitle') }}</span>
    </div>
    <div id="recommendationPanel" class="card text-bg-dark border border-secondary-subtle">
        <div class="card-header d-flex justify-content-between align-items-center">
            <span class="d-flex align-items-center gap-2">
                <i class="bi bi-magic me-1" aria-hidden="true"></i><span>{{ messages.t('activity.recommendations.title') }}</span>
            </span>
            <div class="frontend-action-row">
                <ActionButton
                    type="button"
                    class="btn-sm" variant="outline-secondary"
                    data-recommendations-refresh
                    :pending="pendingControl === 'reload'"
                    :disabled="blocked"
                    @click="reload"><i class="bi bi-arrow-clockwise me-1" aria-hidden="true"></i>{{ messages.t('activity.recommendations.reload') }}</ActionButton>
                <ActionButton
                    type="button"
                    class="btn-sm" variant="outline-primary"
                    data-recommendations-auto
                    :pending="pendingControl === 'generate'"
                    :disabled="blocked || running || assignmentMode === 'FREE'"
                    :title="assignmentMode === 'FREE' ? messages.t('activity.recommendations.freeHint') : ''"
                    @click="generate"><i class="bi bi-stars me-1" aria-hidden="true"></i>{{ messages.t('activity.recommendations.auto') }}</ActionButton>
                <ActionButton
                    type="button"
                    class="btn-sm" variant="primary"
                    data-recommendations-apply
                    :pending="pendingControl === 'save'"
                    :disabled="blocked || !workspace"
                    @click="save"><i class="bi bi-save me-1" aria-hidden="true"></i>{{ messages.t('activity.saveChanges') }}</ActionButton>
            </div>
        </div>
        <div class="card-body">
            <p class="text-secondary small">{{ messages.t('activity.recommendations.description') }}</p>
            <StatusNotice kind="warning" class="small">{{ messages.t('activity.recommendations.linkedWarning') }}</StatusNotice>
            <div class="frontend-section-heading mb-2">
                <p class="text-secondary small mb-0">{{ messages.t('activity.recommendations.reviewHint') }}</p>
                <small id="recommendationSummaryStats" class="text-secondary">
                    <span v-if="!rows.length" class="text-secondary">{{ messages.t('activity.recommendations.empty') }}</span>
                    <template v-else>
                        <span
                            v-for="status in statuses"
                            :key="status"
                            class="badge text-white me-1"
                            :class="status === 'APPROVED' ? 'bg-success' : status === 'REJECTED' ? 'bg-danger' : 'bg-secondary'">{{ messages.t('activity.recommendations.count', {status: statusLabel(status), count: counts[status]}) }}</span>
                    </template>
                </small>
            </div>
            <CommandFeedback :feedback="command.feedback" />
            <StatusNotice
                v-if="command.uncertain.value"
                kind="warning"
                :action="{label: messages.t('draft.review'), state: command.recoveryAction}"
                @action="reviewUnknown">{{ messages.t('activity.recommendations.unknownReview') }}</StatusNotice>
            <StatusNotice
                v-if="snapshot.error.value"
                :read-error="snapshot.error.value"
                kind="warning"
                :action="{label: messages.t('common.retry'), state: snapshotAction}"
                @action="command.recover(refreshSnapshot)">{{ messages.t('state.loadFailed') }}</StatusNotice>
            <StatusNotice v-if="remoteChanged" kind="warning">{{ messages.t('activity.recommendations.draftChanged') }}</StatusNotice>
            <StatusNotice
                v-if="previewFailed"
                kind="warning"
                :action="{label: messages.t('common.retry'), state: previewAction}"
                @action="updateWarnings">{{ messages.t('activity.recommendations.warningsFailed') }}</StatusNotice>
            <StatusNotice v-if="!loaded && command.pending.value" kind="info">{{ messages.t('activity.recommendations.loading') }}</StatusNotice>
            <StatusNotice v-if="running" kind="info">{{ messages.t(job.data.value?.status === 'RUNNING' ? 'activity.recommendations.jobRunning' : 'activity.recommendations.jobQueued') }}</StatusNotice>
            <StatusNotice
                v-if="job.error.value"
                :read-error="job.error.value"
                kind="warning"
                :action="{label: messages.t('activity.recommendations.jobRetry'), state: jobAction}"
                @action="job.refetch()">{{ messages.t('activity.recommendations.jobReadFailed') }}</StatusNotice>
            <StatusNotice v-if="jobTimedOut" kind="warning">{{ messages.t('activity.recommendations.jobTimeout') }}</StatusNotice>
            <StatusNotice
                v-if="jobTerminal"
                :kind="jobTerminal.status === 'COMPLETE' ? 'success' : 'warning'">{{ messages.t(jobTerminal.status === 'COMPLETE' ? 'activity.recommendations.jobComplete' : jobTerminal.status === 'STALE' ? 'activity.recommendations.jobStale' : 'activity.recommendations.jobFailed') }}</StatusNotice>
            <StatusNotice v-if="result" kind="info">{{ messages.t('activity.recommendations.saved', {applied: result.applied, skipped: result.skipped}) }}</StatusNotice>
            <ActivityRecommendationSchedule
                v-if="workspace"
                :view="view"
                :workspace="workspace"
                :rows="rows"
                :warnings="warnings"
                :disabled="blocked"
                @status="changeStatus"
                @remove="remove"
                @add="manualSlot = $event"
                @unassign="unassign"
            />
        </div>
    </div>
    <ActivityRecommendationEditor
        v-if="manualSlot && workspace"
        :key="manualSlot"
        :slot-id="manualSlot"
        :workspace="workspace"
        :view="view"
        :rows="rows"
        :disabled="blocked"
        :preview="manualPreview"
        @close="manualSlot = null"
        @stage="stage"
    />
    <!-- Saved wire rows contain no swap identity. This shared dialog asks for
         the missing relationship before changing status or removing either leg. -->
    <AppDialog id="recommendationPairDialog" :open="pairChoice !== null"
        :title="messages.t('activity.recommendations.pairTitle')" standard :fullscreen-on-small="false"
        :pending="reviewBlocked" initial-focus="#recommendationPairCounterpart" @close="cancelPairChoice">
        <p>{{ messages.t('activity.recommendations.pairHint') }}</p>
        <FormField id="recommendationPairCounterpart" :label="messages.t('activity.recommendations.pairCounterpart')" label-class="">
            <template #control>
                <select id="recommendationPairCounterpart" v-model="pairSelection" class="form-select text-bg-dark" :disabled="reviewBlocked">
                    <option value="">{{ messages.t('activity.recommendations.pairChoose') }}</option>
                    <option v-for="candidate in pairOptions" :key="candidate.key" :value="recommendationIdentity(candidate.value)">{{ pairOptionLabel(candidate) }}</option>
                </select>
            </template>
        </FormField>
        <StatusNotice v-if="pairStale" kind="warning">{{ messages.t('activity.recommendations.pairStale') }}</StatusNotice>
        <template #footer>
            <ActionButton id="recommendationPairCancel" variant="outline-secondary" :disabled="reviewBlocked" @click="cancelPairChoice">{{ messages.t('common.cancel') }}</ActionButton>
            <ActionButton id="recommendationPairConfirm" variant="primary" :disabled="reviewBlocked || !pairSelection" @click="confirmPairChoice">{{ messages.t('activity.recommendations.pairConfirm') }}</ActionButton>
        </template>
    </AppDialog>
    <ActivityWarnings
        :open="confirmation"
        title=""
        :warnings="warnings.filter(entry => entry.recommendation.status === 'APPROVED').flatMap(entry => entry.warnings.filter(warning => warning.type === 'overlap' && warning.confirmable))"
        :slots="view.slots"
        :pending="command.pending.value"
        :confirm-disabled="command.action.disabled.value || !!disabled || revoked"
        :confirm-label="messages.t('activity.recommendations.confirmOverlap')"
        @close="cancelConfirmation"
        @confirm="applyFrozen"
    />
</template>
