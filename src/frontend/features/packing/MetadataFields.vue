<script setup lang="ts">
import {computed, ref, watch} from 'vue';
import {useQuery} from '@tanstack/vue-query';
import type {components} from '../../../types/api/v1';
import type {PilotRead} from '../../../types/FrontendPilotUiTypes';
import {usePackingApi} from './api';
import {usePilot, refreshInterval, canRetryRead} from '../../app/context';
import {ApiFailure, InvalidInputError, ObsoleteRequestError} from '../../app/transport';
import {MetadataDraft} from '../../composables/metadataDraft';
import {useFeedbackError} from '../../composables/feedback';
import {packingKeys} from '../../app/queryKeys';
import ActionButton from '../../components/ActionButton.vue';
import StatusNotice from '../../components/StatusNotice.vue';
import LoadingSkeleton from '../../components/LoadingSkeleton.vue';

const props = withDefaults(defineProps<{listId: string; listTitle?: string; disabled?: boolean; active?: boolean}>(), {active: true});
const emit = defineEmits<{close: []; saved: []; accessLost: []}>();
const context = usePilot();
const api = usePackingApi(context);
const {messages} = context;
const draft = ref<MetadataDraft | null>(null);
const pending = ref(false);
const refreshing = ref(false);
const {error, setError} = useFeedbackError();
const unknown = ref(false);
const jitter = context.browser ? Math.round(Math.random() * 3000) : 0;
const key = computed(() => packingKeys.metadata(context.session.value?.context, props.listId, context.locale.value));
const metadata = useQuery({
    queryKey: key,
    enabled: computed(() => props.active !== false && context.hydrated.value && context.ready.value && context.visible.value),
    queryFn: ({signal, queryKey}) =>
        api.metadata(
            props.listId,
            context.capture(),
            signal,
            context.queryClient.getQueryData<PilotRead<components['schemas']['PackingMetadata']>>(queryKey),
        ),
    refetchInterval: (query) =>
        props.active !== false && context.visible.value
            ? refreshInterval(query.state.error, query.state.fetchFailureCount, jitter)
            : false,
    refetchIntervalInBackground: false,
});
watch(
    metadata.data,
    (result) => {
        if (!result?.etag) return;
        if (!draft.value) draft.value = new MetadataDraft(result.data, result.etag);
        // A background read updates the cache, but cannot decide what happened to a lost
        // command response. Keep that editor's baseline until its explicit recovery read.
        else if (!unknown.value) draft.value.receive(result.data, result.etag);
    },
    {immediate: true},
);
watch(metadata.error, (failure) => {
    if (failure instanceof ApiFailure && [401, 403, 404].includes(failure.status)) emit('accessLost');
});

// A locale-key refresh is not permission revocation. Retain the last known field projection until
// the server supplies new authority, so translated labels do not unmount a focused dirty input.
const fields = computed(
    () => metadata.data.value?.data.editableFields ?? draft.value?.baseline.editableFields ?? [],
);
const lostAuthority = computed(
    () => metadata.error.value instanceof ApiFailure && [401, 403, 404].includes(metadata.error.value.status),
);
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
    if (pending.value || refreshing.value || !canRetryRead(metadata.error.value)) return;
    await readMetadata(discard);
}

/** Internal conflict recovery runs while the rejected command still owns its pending guard. */
async function readMetadata(discard = false): Promise<void> {
    if (refreshing.value || !canRetryRead(metadata.error.value)) return;
    refreshing.value = true;
    setError(null);
    try {
        const result = await metadata.refetch({throwOnError: true});
        if (discard && result.data?.etag && draft.value) {
            // A confirmed relink follows the dialog's explicit discard decision. Failed
            // relinks keep the old draft, while a successful one adopts the new authority.
            draft.value.accept(result.data.data, result.data.etag);
            unknown.value = false;
        }
        if (unknown.value && result.data?.etag && draft.value) {
            // An explicit read offers conditional reapply review. It does not claim the lost write failed.
            draft.value.offerReview(result.data.data, result.data.etag);
        }
    } catch {
        setError('state.loadFailed');
    } finally {
        refreshing.value = false;
    }
}

/** The dialog keeps its command pending until the related editor has caught up.
 * Propagate read failures so a saved settings write cannot be reported as fully refreshed. */
async function refreshAfterSettings(): Promise<void> {
    await metadata.refetch({throwOnError: true});
}

/** Acknowledgement advances the baseline; saving the retained draft remains a separate action. */
function review(): void {
    if (draft.value?.review()) {
        unknown.value = false;
        setError(null);
    }
}

/** Send one sparse conditional command and classify a missing response as an unknown outcome. */
async function save(): Promise<void> {
    if (
        !draft.value?.dirty ||
        pending.value ||
        refreshing.value ||
        props.disabled ||
        lostAuthority.value ||
        fieldAccessChanged.value ||
        requiresReview.value ||
        unknown.value
    )
        return;
    const scope = context.capture();
    // The command guard covers both the write and a required conflict-reconciliation read.
    pending.value = true;
    setError(null);
    const finishUpdateCommand = context.updates.commandStarted();
    try {
        const result = await api.saveMetadata(
            props.listId,
            draft.value.patch,
            draft.value.etag,
            scope,
        );
        if (!context.isCurrent(scope)) return;
        // Only a confirmed response advances the local baseline and shared read cache together.
        draft.value.accept(result.data, result.etag!);
        context.queryClient.setQueryData(key.value, result);
        emit('saved');
        emit('close');
    } catch (failure) {
        if (failure instanceof ObsoleteRequestError || !context.isCurrent(scope)) return;
        if (failure instanceof InvalidInputError) {
            setError('api:errors.VALIDATION_FAILED');
        } else if (failure instanceof ApiFailure && failure.status === 412) {
            await readMetadata();
            setError('draft.conflict');
        } else if (failure instanceof ApiFailure && failure.status < 500) {
            setError(failure);
        } else {
            unknown.value = true;
            setError('state.unknownOutcome');
        }
    } finally {
        pending.value = false;
        finishUpdateCommand();
    }
}
defineExpose({mayLeave, pending, refreshing, unknown, dirty, refresh, refreshAfterSettings});
</script>

<template>
    <StatusNotice v-if="error" kind="danger">{{ error }}</StatusNotice>
    <!-- Recovery remains available while all mutation controls are blocked by uncertainty. -->
    <div v-if="unknown" class="mb-3">
        <ActionButton variant="outline-warning" :pending="refreshing"
            :disabled="pending || refreshing || !canRetryRead(metadata.error.value)" @click="refresh()">
            {{ messages.t('common.refresh') }}
        </ActionButton>
    </div>
    <StatusNotice v-if="lostAuthority || fieldAccessChanged" kind="warning">{{
        messages.t('state.forbidden')
    }}</StatusNotice>
    <StatusNotice v-if="!draft && metadata.error.value && !lostAuthority" kind="warning">
        <p class="mb-2">{{ messages.t('state.loadFailed') }}</p>
        <ActionButton variant="outline-secondary" :pending="metadata.isFetching.value"
            :disabled="pending || refreshing || !canRetryRead(metadata.error.value)" @click="refresh()">
            {{ messages.t('common.refresh') }}
        </ActionButton>
    </StatusNotice>
    <!-- A placeholder belongs to the first read only. Locale/background reads
         retain the same form, focused input and original edit baseline. -->
    <LoadingSkeleton v-if="!draft && metadata.isPending.value" variant="form" :rows="2" />
    <form v-if="draft" id="packing-metadata-form" @submit.prevent="save">
        <!-- Metadata owns its baseline and focused draft while the settings dialog switches
                 panels. Other commands never discard or implicitly submit these fields. -->
        <h3 class="fs-5">{{ messages.t('packing.properties') }}</h3>
        <fieldset :disabled="disabled || pending || refreshing || unknown || lostAuthority"
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
                    :disabled="pending"
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
            <ActionButton variant="outline-warning" :disabled="!canReview || pending" @click="review">
                {{ messages.t('draft.review') }}
            </ActionButton>
        </section>
        <div class="text-end">
            <ActionButton
                type="submit"
                :pending="pending"
                :disabled="disabled || !draft.dirty || unknown || lostAuthority || fieldAccessChanged || requiresReview"
            >
                {{ messages.t('packing.saveProperties') }}
            </ActionButton>
        </div>
    </form>
</template>
