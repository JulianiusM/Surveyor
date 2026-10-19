<script setup lang="ts">
import {computed, onBeforeUnmount, ref, shallowRef, watch} from 'vue';
import {useQuery, type QueryFunctionContext} from '@tanstack/vue-query';
import type {components} from '../../../types/api/v1';
import type {ActivityRecommendationDraftRow, ActivityRecommendationRow} from '../../../types/FrontendActivityRecommendationTypes';
import type {PilotRequestScope} from '../../../types/FrontendPilotUiTypes';
import {useActionState, usePilot} from '../../app/context';
import {activityKeys} from '../../app/queryKeys';
import {refetchFreshQuery, useQueryAdmission} from '../../app/queryCache';
import {ApiFailure, isReadDenial, ObsoleteRequestError} from '../../app/transport';
import {useCommand} from '../../composables/command';
import {useReadRetry} from '../../composables/feedback';
import ActionButton from '../../components/ActionButton.vue';
import CommandFeedback from '../../components/CommandFeedback.vue';
import StatusNotice from '../../components/StatusNotice.vue';
import ActivityRecommendationSchedule from './ActivityRecommendationSchedule.vue';
import ActivityRecommendationEditor from './ActivityRecommendationEditor.vue';
import ActivityWarnings from './ActivityWarnings.vue';
import {recommendationPartners, recommendationReview} from './recommendationDraft';
import {useActivityApi} from './api';

type Workspace = components['schemas']['ActivityRecommendations'];
type Preview = components['schemas']['ActivityRecommendationPreview'];
type Job = components['schemas']['ActivityRecommendationJob'];

// Server snapshots live in Query; the local review owns independent values and
// its saved baseline. Maintenance is a single-attempt entry command, never a
// query function or background refetch. Explicit generation completion retains
// its native entry trigger; automatic job completion reads only a pure snapshot.
const props = defineProps<{planId: string; view: components['schemas']['ActivityView'];
    assignmentMode?: components['schemas']['ActivityView']['assignmentMode']; disabled?: boolean}>();
const emit = defineEmits<{changed: []; denied: []}>();
const context = usePilot();
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
const frozen = shallowRef<components['schemas']['ActivityRecommendationApplication'] | null>(null);
const confirmation = ref(false);
const manualSlot = ref<string | null>(null);
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
const blocked = computed(() => !!props.disabled || revoked.value || command.action.disabled.value || previewing.value || confirmation.value);
// The admitted requirement form supplies its live mode, matching native's local
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
    pending: () => snapshot.isFetching.value, blocked: () => command.recoveryAction.disabled.value});
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
    // Approved R1: entry may return an already queued deadline job. Observe its
    // identity without another dispatch or changing native maintenance triggers.
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
    rows.value = value.recommendations.map(value => ({key: String(++rowSequence), value: {...value}}));
    baseline.value = JSON.stringify(recommendationReview(rows.value));
    warnings.value = value.warnings;
    previewFailed.value = false;
    remoteChanged.value = false;
}

/** Confirmed maintenance supplies a snapshot, not a saved-edit notification.
 * All native-equivalent entry triggers publish through this same owner. */
function publishWorkspace(value: Workspace, replace = false): void {
    if (!active || revoked.value) return;
    // Native's successful workspace load is quiet. Retain command uncertainty
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
async function advancedCommand<T>(operation: Promise<T>, scope: PilotRequestScope): Promise<T> {
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

/** Native opens the recommendation workspace once on page entry, even with the
 * Schedule tab active. Capture that trigger once; uncertain delivery never retries. */
async function enterWorkspace(): Promise<void> {
    if (!active || entered || !context.mayRead() || !command.action.isAvailable()) return;
    entered = true;
    // Native successful workspace loading is silent. Manufacturing a Saved
    // receipt here would reveal/focus it when a previously hidden tab opens.
    const value = await command.run(scope => advancedCommand(api.recommendationWorkspace(props.planId, scope), scope),
        false, true, {success: null});
    if (value) publishWorkspace(value, true);
}
watch(() => context.hydrated.value && context.mayRead(), ready => { if (ready) void enterWorkspace(); }, {immediate: true});

/** Only an explicit Reload discards a local draft and repeats native maintenance.
 * A canceled confirmation keeps every row and its current warning state. */
async function reload(): Promise<void> {
    if (blocked.value || dirty.value && !window.confirm(messages.value.t('draft.discard'))) return;
    const value = await command.run(scope => advancedCommand(api.recommendationWorkspace(props.planId, scope), scope),
        false, true, {success: null});
    if (value) publishWorkspace(value, true);
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
/** Observe a live job at the native cadence within its finite observation window. */
function jobInterval(query: {state: {data?: Job; error: Error | null}}): number | false {
    // Match native's bounded ten-minute observation while honoring admission,
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
/** Complete each known job once. Explicit generation retains native maintenance;
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
    const refreshed = await command.run(scope => advancedCommand(api.recommendationWorkspace(props.planId, scope), scope), false, true);
    if (refreshed) publishWorkspace(refreshed);
}
watch([job.data, command.pending, command.uncertain], finishObservedJob);
/** Dispatch deliberately once and consume only an explicitly accepted discard.
 * New edits made while the accepted calculation runs remain independent. */
async function generate(): Promise<void> {
    if (blocked.value || running.value || assignmentMode.value === 'FREE') return;
    if (dirty.value && !window.confirm(messages.value.t('draft.discard'))) return;
    const value = await command.run(scope => advancedCommand(api.generateRecommendations(props.planId, scope), scope), false, true);
    if (value && active) {
        // Confirmed dispatch consumes the deliberate discard decision. Edits
        // made after this baseline still survive the eventual job completion.
        baseline.value = JSON.stringify(recommendationReview(rows.value));
        explicitlyDispatched.add(value.job.id);
        observeJob(value.job, true);
    }
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
/** A swap's paired status changes together before warnings are recomputed. */
function changeStatus(row: ActivityRecommendationDraftRow, status: 'PENDING' | 'APPROVED' | 'REJECTED'): void {
    if (blocked.value) return;
    // Generated rows retain independent review state; manual swaps retain both legs.
    for (const partner of recommendationPartners(rows.value, row)) partner.value.status = status;
    void updateWarnings();
}
/** Removing a manual intent cancels its reciprocal leg without a server write. */
function remove(row: ActivityRecommendationDraftRow): void {
    if (blocked.value || !row.value.manual) return;
    // Filter by draft identity so no unrelated saved row is incidentally removed.
    const partners = recommendationPartners(rows.value, row);
    rows.value = rows.value.filter(candidate => !partners.includes(candidate));
    command.setNotice('activity.recommendations.removed', {presentation: 'inline'});
    void updateWarnings();
}
/** Publish the already constructed manual rows together into the local draft. */
function stage(values: ActivityRecommendationRow[]): void {
    if (blocked.value) return;
    // Local keys keep unsaved rows stable without inventing persisted UUIDs.
    rows.value.push(...values.map(value => ({key: String(++rowSequence), value})));
    manualSlot.value = null;
    void updateWarnings();
}
/** Stage the existing assignment's removal for later whole-batch review. */
function unassign(slotId: string, profileId: string): void {
    if (blocked.value || !workspace.value) return;
    // Preserve the native single-intent-per-placement guard and admitted identity.
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
    // Native reloads its document after a confirmed apply, performing one page
    // entry maintenance. Keep that invocation while staying in this document.
    const refreshed = await command.run(scope => advancedCommand(api.recommendationWorkspace(props.planId, scope), scope), false, true);
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
            <div class="d-flex gap-2">
                <ActionButton
                    type="button"
                    class="btn-sm" variant="outline-secondary"
                    data-recommendations-refresh
                    :disabled="blocked"
                    @click="reload"><i class="bi bi-arrow-clockwise me-1" aria-hidden="true"></i>{{ messages.t('activity.recommendations.reload') }}</ActionButton>
                <ActionButton
                    type="button"
                    class="btn-sm" variant="outline-primary"
                    data-recommendations-auto
                    :disabled="blocked || running || assignmentMode === 'FREE'"
                    :title="assignmentMode === 'FREE' ? messages.t('activity.recommendations.freeHint') : ''"
                    @click="generate"><i class="bi bi-stars me-1" aria-hidden="true"></i>{{ messages.t('activity.recommendations.auto') }}</ActionButton>
                <ActionButton
                    type="button"
                    class="btn-sm" variant="primary"
                    data-recommendations-apply
                    :disabled="blocked || !workspace"
                    @click="save"><i class="bi bi-save me-1" aria-hidden="true"></i>{{ messages.t('activity.saveChanges') }}</ActionButton>
            </div>
        </div>
        <div class="card-body">
            <p class="text-secondary small">{{ messages.t('activity.recommendations.description') }}</p>
            <StatusNotice kind="warning" class="small">{{ messages.t('activity.recommendations.linkedWarning') }}</StatusNotice>
            <div class="d-flex justify-content-between align-items-center mb-2">
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
            <CommandFeedback :feedback="command.feedback" inline :target="null" />
            <StatusNotice
                v-if="command.uncertain.value"
                kind="warning"
                :action="{label: messages.t('draft.review'), state: command.recoveryAction}"
                @action="reviewUnknown">{{ messages.t('activity.recommendations.unknownReview') }}</StatusNotice>
            <StatusNotice
                v-if="snapshot.error.value"
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
