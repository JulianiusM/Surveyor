<script setup lang="ts">
import {computed, onBeforeUnmount, ref, watch} from 'vue';
import {useQuery} from '@tanstack/vue-query';
import type {components} from '../../../types/api/v1';
import type {PilotMetadataFieldPolicy, PilotRead, PilotRequestScope} from '../../../types/FrontendPilotUiTypes';
import {usePackingApi} from './api';
import {useActionState, usePilot, refreshInterval} from '../../app/context';
import {isReadDenial} from '../../app/transport';
import {MetadataDraft} from '../../composables/metadataDraft';
import {useReadRetry, useReadRetryAt} from '../../composables/feedback';
import {useCommand} from '../../composables/command';
import {packingKeys} from '../../app/queryKeys';
import {observeQueryReads, refetchFreshQuery, useQueryAdmission} from '../../app/queryCache';
import ActionButton from '../../components/ActionButton.vue';
import StatusNotice from '../../components/StatusNotice.vue';
import LoadingSkeleton from '../../components/LoadingSkeleton.vue';

// Mutation admission and pending interaction are distinct. An uncertain parent
// blocks another write while its retained editor must still offer read/review.
const props = withDefaults(defineProps<{listId: string; listTitle?: string; disabled?: boolean; busy?: boolean; active?: boolean}>(), {active: true});
const emit = defineEmits<{close: []; saved: []; accessLost: []}>();
const context = usePilot();
const api = usePackingApi(context);
const {messages} = context;
type Metadata = components['schemas']['PackingMetadata'];
type Values = Metadata['values'];
const fieldPolicy: PilotMetadataFieldPolicy<Values> = {description: normalizeDescription};
const draft = ref<MetadataDraft<Values, Metadata> | null>(null);
const form = ref<HTMLFormElement | null>(null);

/** Packing's optional description clears to null. Title comparison and omission stay
 * unchanged; shared reconciliation must not infer these semantics from field names. */
function normalizeDescription(value: Values['description']): Values['description'] {
    return value === '' ? null : value;
}

let active = true;
onBeforeUnmount(retireEditor);

/** Retire presentation only. An admitted PATCH still owns its status lease until
 * its result settles; losing this editor cannot prove that the write failed. */
function retireEditor(): void {
    active = false;
}

// Settings owns ordinary draft consent for its whole dialog. The shared command
// owner retains only admitted write/recovery status after these controls retire.
// Metadata always needs explicit review of a lost response, including unchanged reads.
const command = useCommand(readMetadata, true, {
    dirty: noIndependentDraft,
    unknownMessage: 'draft.leaveUnknown',
    problemKey: metadataProblem,
});
const {pending, recovering: refreshing, uncertain: unknown, error, transientError, errorRenewal,
    feedbackKind, setError, setInformation, clearRecoveredError} = command;

function noIndependentDraft(): boolean { return false; }

/** Conditional metadata failure has the native editor wording. All other validated
 * errors, including safe future codes, keep the shared presentation fallback. */
function metadataProblem(problem: components['schemas']['Problem']) {
    if (problem.code === 'PRECONDITION_FAILED') return 'draft.conflict' as const;
}

// A confirmed relink can require discarding a previously acknowledged properties
// draft. Retain that decision through a failed read; authority still comes from a read.
let discardAfterSettings = false;
const jitter = context.browser ? Math.round(Math.random() * 3000) : 0;
const key = computed(() => packingKeys.metadata(context.session.value?.context, props.listId));
const readAdmission = useQueryAdmission(context, key,
    computed(() => props.active !== false && context.hydrated.value && context.visible.value));
const metadata = useQuery({
    queryKey: key,
    ...readAdmission,
    queryFn: ({signal, queryKey}) =>
        api.metadata(
            props.listId,
            context.capture(),
            signal,
            context.queryClient.getQueryData<PilotRead<components['schemas']['PackingMetadata']>>(queryKey),
        ),
    refetchInterval: (query) =>
        props.active !== false && context.mayRead() && context.visible.value
            ? refreshInterval(query.state.error, query.state.fetchFailureCount, jitter)
            : false,
    refetchIntervalInBackground: false,
});
const retryAvailable = useReadRetry(() => metadata.error.value);
const retryAt = useReadRetryAt(() => metadata.error.value, retryAvailable);
watch(
    () => [metadata.data.value, metadata.dataUpdatedAt.value, metadata.isFetching.value, metadata.error.value] as const,
    ([result, _updatedAt, fetching, failure]) => {
        // Initial readable data may already be cached. Later confirmed authority
        // is adopted by an actual read success, rather than observer idle alone.
        if (!result?.etag || fetching || failure) return;
        if (!draft.value) draft.value = new MetadataDraft<Values, Metadata>(result.data, result.etag, fieldPolicy);
        // Reads may start before PATCH commits and finish afterward. During a command
        // they may narrow visible grants, but cannot advance its value/token baseline.
        // The command's own post-confirmation read adopts authority explicitly below.
        else if (pending.value || refreshing.value) return;
        // Idle can follow cancellation with retained data. Only an actual read
        // success below, or the explicit fresh-read continuation, grants authority.
        else if (discardAfterSettings || draft.value.awaitingAuthority) return;
        // A background read updates the cache, but cannot decide what happened to a lost
        // command response. Keep that editor's baseline until its explicit recovery read.
        else if (!unknown.value) draft.value.receive(result.data, result.etag);
    },
    {immediate: true},
);
const stopMetadataReads = observeQueryReads<PilotRead<Metadata>>(context.queryClient, () => key.value, receiveMetadataRead);
onBeforeUnmount(stopMetadataReads);

/** Healthy background convergence can restore a confirmed editor as well. Cache
 * aliases/cancellation do not call this path, and in-flight commands still own
 * their separate causal post-confirmation read before any baseline is adopted. */
function receiveMetadataRead(result: PilotRead<Metadata>): void {
    if (!active || !result.etag) return;
    clearRecoveredError('state.loadFailed');
    if (pending.value || refreshing.value || !draft.value) return;
    if (discardAfterSettings || draft.value.awaitingAuthority) {
        const discarded = discardAfterSettings;
        acceptReadAuthority(result);
        if (discarded) command.acknowledge();
    }
}
watch(metadata.error, (failure) => {
    // Only validated denial establishes lost access. An unusable response retains
    // this editor's values and baseline while the ordinary read warning recovers.
    if (isReadDenial(failure)) emit('accessLost');
});

// Language changes retain this machine-state projection. Prefer current admitted
// field authority; a retained draft baseline cannot restore a revoked field.
const fields = computed(
    () => metadata.data.value?.data.editableFields ?? draft.value?.baseline.editableFields ?? [],
);
const lostAuthority = computed(() => isReadDenial(metadata.error.value));
const fieldAccessChanged = computed(
    () => !!draft.value?.baseline.editableFields.some((field) => !fields.value.includes(field)),
);
const canReview = computed(
    () => draft.value?.remote && draft.value.conflicts.every((field) => draft.value?.choices[field]),
);
// Selecting field choices is not acknowledgement. Only Review advances the draft's
// baseline/token; prevent another stale write until that deliberate step completes.
const requiresReview = computed(() => !!draft.value?.remote);
const dirty = computed(() => !!draft.value?.dirty);
const awaitingAuthority = computed(() => !!draft.value?.awaitingAuthority);
const refreshAction = useActionState({eligible: mayRefreshMetadata, pending: () => refreshing.value,
    blocked: () => !!props.busy || pending.value});

function mayRefreshMetadata(): boolean { return active && context.mayRead() && retryAvailable.value; }

/** A current read can offer review after partial field revocation. A denied read
 * or retired actor/resource still forbids presenting any late result. */
function mayPresentResult(scope: PilotRequestScope, resource: string): boolean {
    return active && resource === props.listId && context.isCurrent(scope)
        && !lostAuthority.value;
}

/** A held command's old projection cannot restore fields removed by a newer read. */
function mayPublishSavedResult(scope: PilotRequestScope, resource: string): boolean {
    return mayPresentResult(scope, resource) && !fieldAccessChanged.value;
}

/** The dialog calls this for operations that explicitly discard only the metadata draft. */
function mayLeave(): boolean {
    if (pending.value || refreshing.value) return false;
    if (unknown.value) return window.confirm(messages.value.t('draft.leaveUnknown'));
    return !dirty.value || window.confirm(messages.value.t('draft.discard'));
}
// PackingSettings owns navigation and identity decisions for the complete dialog and
// reads the exposed draft state once; separate child guards would prompt twice.

/** Offer the latest authority for review without replaying an uncertain PATCH. */
async function refresh(discard = false): Promise<void> {
    if (!refreshAction.isAvailable()) return;
    discardAfterSettings ||= discard;
    let current = false;
    try {
        // The query owns this resource's failed-read warning. Retain the shared
        // recovery lifetime without creating a second identical command message.
        current = await command.recover(undefined, false);
    } catch {
        // A failed read keeps metadata.error and the draft/unknown baseline intact.
        // Settings' refreshAfterSettings still propagates failure to its own command.
    }
    if (current && discard && !discardAfterSettings) command.acknowledge();
}

/** Every successful adoption shares the same feature-owned feedback policy, whether
 * reached by this editor, the dialog's Refresh, or healthy background convergence.
 * Only the warning about this confirmed write's failed read is cleared. */
function acceptReadAuthority(result: PilotRead<Metadata>): void {
    if (!draft.value || !result.etag) return;
    draft.value.accept(result.data, result.etag);
    discardAfterSettings = false;
    if (command.notice.value === 'state.savedRefreshFailed') command.notice.value = null;
}

/** This read starts after confirmation/rejection, rather than treating an arbitrary
 * cache arrival as causally newer than a write. Cancel an older observer fetch first.
 * The shared owner protects its lifetime and distinguishes saved/read-failed outcomes. */
async function readMetadata(): Promise<void> {
    if (!active || lostAuthority.value) return;
    const scope = context.capture();
    const resource = props.listId;
    const result = await refetchFreshQuery<PilotRead<Metadata>>(context.queryClient, key.value, refetchMetadata, mayRead);
    if (!mayPresentResult(scope, resource) || !result.etag || !draft.value) return;
    clearRecoveredError('state.loadFailed');
    if (discardAfterSettings || draft.value.awaitingAuthority) {
        // Confirmed relinks honor the dialog's discard decision. Confirmed metadata
        // supplies clean values only; this later read supplies current grants/token.
        acceptReadAuthority(result);
    } else if (unknown.value) {
        // A read cannot prove whether a lost PATCH succeeded. Even unchanged authority
        // needs deliberate review before releasing uncertainty or permitting reapply.
        draft.value.offerReview(result.data, result.etag);
    } else {
        draft.value.receive(result.data, result.etag);
    }

    function mayRead(): boolean {
        return active && resource === props.listId && context.mayRead(scope);
    }
}

function refetchMetadata(): Promise<unknown> {
    return metadata.refetch({throwOnError: true});
}

/** The dialog keeps its command pending until the related editor has caught up.
 * Propagate read failures so a saved settings write cannot be reported as fully refreshed. */
async function refreshAfterSettings(discard = false): Promise<void> {
    if (!active) return;
    discardAfterSettings ||= discard;
    const current = await command.recover(undefined, false);
    if (current && discard && !discardAfterSettings) command.acknowledge();
}

/** Acknowledgement advances the baseline; saving the retained draft remains a separate action. */
function review(): void {
    if (props.busy || pending.value || refreshing.value || lostAuthority.value) return;
    if (draft.value?.review()) {
        command.acknowledge();
    }
}

/** Send one sparse conditional command and classify a missing response as an unknown outcome. */
async function save(): Promise<void> {
    if (
        !draft.value ||
        pending.value ||
        refreshing.value ||
        props.busy ||
        props.disabled ||
        lostAuthority.value ||
        fieldAccessChanged.value ||
        requiresReview.value ||
        awaitingAuthority.value ||
        unknown.value
    )
        return;
    if (!form.value || !reportPropertyValidity(form.value)) return;
    // Native Save remains available for a pristine form and explains the no-op.
    // This receipt never opens a command lease or submits an empty PATCH.
    if (!draft.value.dirty) {
        setInformation('metadata.noChanges');
        return;
    }
    const resource = props.listId;
    const submittedDraft = draft.value;
    const patch = submittedDraft.patch;
    const token = submittedDraft.etag;
    let publishConfirmation = false;

    /** The response acknowledges submitted values, regardless of an older GET or
     * locale change. It never writes old grants/token into the query cache. A denial
     * or partial revocation still prevents that old response publishing controls. */
    async function saveSubmittedMetadata(scope: PilotRequestScope): Promise<PilotRead<Metadata>> {
        const result = await api.saveMetadata(resource, patch, token, scope);
        publishConfirmation = mayPublishSavedResult(scope, resource);
        if (mayPresentResult(scope, resource)) submittedDraft.confirm(result.data);
        return result;
    }

    const result = await command.run(saveSubmittedMetadata, true, true,
        {presentation: 'inline', success: 'metadata.updated'});
    if (result && publishConfirmation && active && resource === props.listId && !lostAuthority.value) {
        // Related settings refresh owns its own failure; the metadata write stays
        // confirmed and its accepted values remain visible if either read fails.
        emit('saved');
        emit('close');
    }
}

/** Native property forms reveal the invalid field's collapsed ancestors before
 * asking the browser to focus/report it. novalidate lets this owner perform that
 * reveal first; constraints still precede both pristine feedback and any PATCH. */
function reportPropertyValidity(target: HTMLFormElement): boolean {
    // The pilot's disabled-state fieldset can itself match :invalid because of
    // its descendants. Inspect actual candidate controls so the collapsed field,
    // rather than that outer container, determines which ancestors must open.
    const controls = target.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
        'input, textarea, select');
    for (const control of controls) {
        if (!control.willValidate || control.validity.valid) continue;

        let parent = control.parentElement;
        while (parent && parent !== target) {
            if (parent instanceof HTMLDetailsElement) parent.open = true;
            parent = parent.parentElement;
        }
        break;
    }
    return target.reportValidity();
}
defineExpose({mayLeave, pending, refreshing, unknown, dirty, awaitingAuthority, retryAvailable, refresh, refreshAfterSettings});
</script>

<template>
    <StatusNotice v-if="error && !draft" :kind="feedbackKind" :transient="transientError" :renewal="errorRenewal"
        @dismiss="setError(null)">{{ error }}</StatusNotice>
    <!-- One recovery action covers uncertainty, confirmed values awaiting authority
         and failed reads. Keep its node while an unknown command's read fails so
         the focused control is retained rather than replaced by another Refresh. -->
    <div v-if="(unknown || awaitingAuthority || metadata.error.value) && !lostAuthority" class="mb-3">
        <ActionButton :variant="unknown || awaitingAuthority ? 'outline-warning' : 'outline-secondary'" :state="refreshAction"
            @click="refresh()">
            {{ messages.t('common.refresh') }}
        </ActionButton>
    </div>
    <StatusNotice v-if="lostAuthority || fieldAccessChanged" kind="warning">{{
        messages.t('state.forbidden')
    }}</StatusNotice>
    <!-- A recoverable read failure also belongs to a retained draft. Show its
         warning/retry without replacing fields or treating the failure as denial. -->
    <StatusNotice v-if="metadata.error.value && !lostAuthority && command.notice.value !== 'state.savedRefreshFailed'" kind="warning"
        :last-updated-at="metadata.data.value ? metadata.dataUpdatedAt.value : undefined"
        :retry-at="retryAt" :read-error="metadata.error.value">
        <p class="mb-2">{{ messages.t(metadata.data.value ? 'state.stale' : 'state.loadFailed') }}</p>
    </StatusNotice>
    <!-- A placeholder belongs to the first read only. Locale/background reads
         retain the same form, focused input and original edit baseline. -->
    <LoadingSkeleton v-if="!draft && metadata.isPending.value" variant="form" :rows="2" />
    <section v-if="draft" data-entity-section="properties">
        <!-- Metadata owns its baseline and focused draft while the settings dialog switches
                 panels. Other commands never discard or implicitly submit these fields. -->
        <h3 class="fs-5">{{ messages.t('packing.properties') }}</h3>
        <!-- Native inline feedback belongs to Properties, before its form/disclosures.
             It stays visible when Details closes and never disables recovery by itself. -->
        <div data-command-feedback aria-live="polite">
            <StatusNotice v-if="error" inline :kind="feedbackKind" :transient="transientError" :renewal="errorRenewal"
                :disabled="busy || pending || refreshing" @dismiss="setError(null)">{{ error }}</StatusNotice>
            <StatusNotice v-if="command.notice.value" inline :kind="command.noticeKind.value"
                :transient="command.transientNotice.value" :renewal="command.noticeRenewal.value"
                :last-updated-at="command.notice.value === 'state.savedRefreshFailed' && metadata.data.value && !lostAuthority
                    ? metadata.dataUpdatedAt.value : undefined"
                :retry-at="command.notice.value === 'state.savedRefreshFailed' ? retryAt : undefined"
                :read-error="command.notice.value === 'state.savedRefreshFailed' ? metadata.error.value : undefined"
                :disabled="busy || pending || refreshing" @dismiss="command.notice.value = null">
                {{ messages.t(command.notice.value) }}
            </StatusNotice>
        </div>
        <form ref="form" id="packing-metadata-form" novalidate @submit.prevent="save">
            <fieldset :disabled="disabled || busy || pending || refreshing || unknown || awaitingAuthority || lostAuthority"
                :aria-busy="pending || refreshing || metadata.isFetching.value">
                <details class="entity-property-group mb-3" open>
                    <summary class="fw-semibold">{{ messages.t('packing.details') }}</summary>
                    <div class="row g-3 pt-3">
                        <div v-if="fields.includes('title')" class="col-md-6">
                            <label class="form-label" for="packing-title">{{
                                messages.t('packing.title')
                            }}</label>
                            <input
                                id="packing-title"
                                v-model="draft.values.title"
                                name="title"
                                class="form-control text-bg-dark"
                                required
                                maxlength="255"
                            />
                        </div>
                        <div v-if="fields.includes('description')" class="col-12">
                            <label class="form-label" for="packing-description">{{
                                messages.t('packing.description')
                            }}</label>
                            <textarea
                                id="packing-description"
                                v-model="draft.values.description"
                                name="description"
                                class="form-control text-bg-dark"
                                rows="4"
                                maxlength="16000"
                            ></textarea>
                        </div>
                    </div>
                </details>
            </fieldset>
            <section v-if="draft.remote && !lostAuthority" class="border border-warning rounded p-3 mb-3">
                <!-- A lost response requires review even when authority is unchanged. Describe
                     that uncertainty without claiming another client changed the list. -->
                <h3 class="h6">{{ messages.t(unknown ? 'draft.review' : 'draft.changed') }}</h3>
                <p>{{ messages.t(unknown ? 'draft.unknownReview' : 'draft.conflict') }}</p>
                <div v-for="field in draft.remote.data.editableFields" :key="field" class="mb-3">
                    <h4 class="h6">
                        {{ messages.t(field === 'title' ? 'packing.title' : 'packing.description') }}
                    </h4>
                    <div class="pilot-conflict-values">
                        <dl>
                            <dt>{{ messages.t('draft.original') }}</dt>
                            <dd>{{ draft.baseline.values[field] || '—' }}</dd>
                        </dl>
                        <dl>
                            <dt>{{ messages.t('draft.mine') }}</dt>
                            <dd>{{ draft.values[field] || '—' }}</dd>
                        </dl>
                        <dl>
                            <dt>{{ messages.t('draft.current') }}</dt>
                            <dd>{{ draft.remote.data.values[field] || '—' }}</dd>
                        </dl>
                    </div>
                    <fieldset
                        v-if="draft.conflicts.includes(field)"
                        :disabled="busy || pending || refreshing"
                        class="d-flex flex-wrap gap-3"
                    >
                        <legend class="visually-hidden">{{ messages.t('draft.review') }}</legend>
                        <label
                            ><input
                                v-model="draft.choices[field]"
                                type="radio"
                                :name="`resolve-${field}`"
                                value="mine"
                            />
                            {{ messages.t('draft.useMine') }}</label
                        >
                        <label
                            ><input
                                v-model="draft.choices[field]"
                                type="radio"
                                :name="`resolve-${field}`"
                                value="current"
                            />
                            {{ messages.t('draft.useCurrent') }}</label
                        >
                    </fieldset>
                </div>
                <ActionButton variant="outline-warning" :disabled="!canReview || busy || pending || refreshing" @click="review">
                    {{ messages.t('draft.review') }}
                </ActionButton>
            </section>
            <div class="text-end">
                <ActionButton
                    type="submit"
                    :pending="pending"
                    :disabled="disabled || busy || refreshing || unknown || awaitingAuthority || lostAuthority || fieldAccessChanged || requiresReview"
                >
                    {{ messages.t('packing.saveProperties') }}
                </ActionButton>
            </div>
        </form>
    </section>
</template>
