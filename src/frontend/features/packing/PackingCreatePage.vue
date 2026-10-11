<script setup lang="ts">
import {computed, ref, watch} from 'vue';
import {useRoute} from 'vue-router';
import {useQuery} from '@tanstack/vue-query';
import type {components} from '../../../types/api/v1';
import type {PilotRequestScope} from '../../../types/FrontendPilotUiTypes';
import type {MessageKey} from '../../../types/LocalizationTypes';
import {usePackingApi} from './api';
import {usePilot} from '../../app/context';
import {ApiFailure, isReadDenial} from '../../app/transport';
import {isPlainMessageKey} from '../../../modules/localization/translator';
import {useCommand} from '../../composables/command';
import {useReadRetry, useReadRetryAt} from '../../composables/feedback';
import {frontendDocumentUrl} from '../../../modules/lib/frontendIdentity';
import {useConfirmedNavigation, usePageEntry} from '../../composables/pageEntry';
import {packingKeys} from '../../app/queryKeys';
import {usePageTitle} from '../../composables/pageTitle';
import ActionButton from '../../components/ActionButton.vue';
import StatusNotice from '../../components/StatusNotice.vue';
import PageMessage from '../../components/PageMessage.vue';
import LoadingSkeleton from '../../components/LoadingSkeleton.vue';
import EventPicker from '../../components/EventPicker.vue';
import AudiencePermissions from '../../components/permissions/AudiencePermissions.vue';

const context = usePilot();
const api = usePackingApi(context);
const {messages} = context;
const route = useRoute();
const destination = useConfirmedNavigation();
const sourceId = computed(() =>
    typeof route.params.listId === 'string' ? route.params.listId.toLowerCase() : null,
);
const initialEventId = computed(() => typeof route.query.eventId === 'string' ? route.query.eventId : undefined);
const bootstrapError = computed(() => context.initialDocumentFor(route.fullPath)?.packingError);

/** SSR seeds only the admitted document and actor; later SPA routes use their own query admission. */
function isInitialForm(): boolean {
    return context.initialDocumentFor(route.fullPath) !== undefined
        && context.bootstrap.session.locale === context.locale.value;
}

function initialCreationEntry(): components['schemas']['PackingCreateEntry'] | undefined {
    if (!isInitialForm() || !context.bootstrap.packingCreateContext || sourceId.value) return;
    return {entry: context.bootstrap.pageEntry ?? {kind: 'render'}, context: context.bootstrap.packingCreateContext,
        selectedEvent: context.bootstrap.packingSelectedEvent ?? null};
}

function initialDuplicate(): components['schemas']['PackingDuplicate'] | undefined {
    return isInitialForm() ? context.bootstrap.packingDuplicate : undefined;
}
type Row = components['schemas']['PackingDuplicateItem'] & {key: number};
const nextKey = ref(0);
const title = ref('');
const description = ref('');
// A contextual URL is resolved before becoming draft state. Subsequent picker reads
// can retire a label while retaining an actual user choice for explicit recovery.
const eventId = ref<string | null>(null);
const selectedEvent = ref<components['schemas']['PackingEventOption'] | null>(null);
const image = ref<File | null>(null);
const rows = ref<Row[]>([]);
const defaults = ref<components['schemas']['PermissionDefaults'] | null>(null);
const baseline = ref<string | null>(null);
const submitted = ref(false);
const admittingSubmission = ref(false);
const leavingAfterSubmission = ref(false);
const retainedContext = ref<components['schemas']['PackingCreateContext'] | null>(null);
// Submission admission is a read with its own durable feedback. Keep its exact
// descriptor so recovered authority cannot erase a later command's validation.
let submissionAdmissionError: MessageKey | ApiFailure | null = null;
// Vue reuses this route component between creation/duplicate URLs. A confirmed navigation
// starts a new draft instead of retaining a previous list's copied rows or uploaded file.
// Watch each identity value independently. Router replaces its query object on a
// fragment visit too; returning a fresh tuple would mistake that for a new draft.
watch([sourceId, initialEventId, context.epoch], resetCreationDraft);

/** A cancelled guard never commits these inputs. Start the next admitted form only
 * after its route or actor changes, without carrying an unresolved prior command. */
function resetCreationDraft(): void {
    command.acknowledge();
    baseline.value = null;
    retainedContext.value = null;
    submissionAdmissionError = null;
    submitted.value = false;
    title.value = '';
    description.value = '';
    defaults.value = null;
    rows.value = [];
    image.value = null;
    eventId.value = null;
    selectedEvent.value = null;
}
const creation = usePageEntry({
    key: computed(() => packingKeys.creation(context.session.value?.context, initialEventId.value)),
    initial: initialCreationEntry(),
    // Duplicate GET supplies its own admitted form definitions. The separate
    // create-context endpoint retains the native account-only create GET policy.
    enabled: computed(() => !sourceId.value && !bootstrapError.value),
    read: readCreationEntry,
});
function readCreationEntry(scope: PilotRequestScope, signal: AbortSignal): Promise<components['schemas']['PackingCreateEntry']> {
    return api.createEntry(scope, signal, route.fullPath, initialEventId.value);
}
// A locale entry read must not unmount a focused creation draft. Retain only this
// actor/route's admitted form definitions; the committed-route watcher releases them.
function receiveCreationEntry(): void {
    const value = creation.data.value;
    if (creation.reading.value || creation.error.value) return;
    if (value?.entry.kind === 'render' && value.context)
        retainedContext.value = value.context;
}
watch([creation.data, creation.reading, creation.error], receiveCreationEntry, {immediate: true});
// A confirmed creation denial retires server-owned definitions, while entered
// values, the selected file and the dirty baseline remain this user's local draft.
watch([creation.error, creation.outcome], retireDeniedCreationContext, {flush: 'sync'});
function retireDeniedCreationContext(): void {
    if (!isReadDenial(creation.error.value) && creation.outcome.value?.kind !== 'denied') return;
    retainedContext.value = null;
    selectedEvent.value = null;
}
const duplicate = useQuery({
    queryKey: computed(() => packingKeys.duplicate(context.session.value?.context, sourceId.value, initialEventId.value)),
    initialData: initialDuplicate,
    enabled: computed(() => context.hydrated.value && context.ready.value && !!sourceId.value && !bootstrapError.value),
    queryFn: ({signal}) => api.duplicate(sourceId.value!, context.capture(), signal, initialEventId.value),
});

/** Cold duplicate admission uses the same native message card as its document route.
 * Only validated read denial selects that card; an unusable proxy response keeps
 * the ordinary admission recovery available instead of declaring the source gone.
 * Once copied, these fields are an independent creation draft: a later source denial
 * must not destroy them or turn an already admitted copy into an inaccessible source. */
function duplicateAdmissionKey(): 'packing.notFound' | 'common.notAllowed' | undefined {
    const failure = duplicate.error.value;
    if (!sourceId.value || baseline.value !== null || !isReadDenial(failure)) return;
    if (failure.status === 404) return 'packing.notFound';
    if (failure.status === 403) return 'common.notAllowed';
}
const admissionMessage = computed(() => bootstrapError.value ?? duplicateAdmissionKey()
    ?? (creation.outcome.value?.kind === 'denied' ? creation.outcome.value.messageKey : undefined));
const admissionError = computed(() => {
    const key = admissionMessage.value;
    return key ? messages.value.t(isPlainMessageKey(key) ? key : 'common.error') : undefined;
});
usePageTitle(() => messages.value.t(admissionError.value ? 'common.errorTitle' : 'packing.create'));
const formContext = computed(() => sourceId.value ? duplicate.data.value?.formContext
    : isReadDenial(creation.error.value) ? undefined : creation.data.value?.context ?? retainedContext.value);
const loadError = computed(() => sourceId.value ? duplicate.error.value : creation.error.value);
const retryAvailable = useReadRetry(() => loadError.value);
const retryAt = useReadRetryAt(() => loadError.value, retryAvailable);
// Only an admitted current source/read can supply freshness. A copied draft stays
// independent of a later source denial; its form values are never a read receipt.
const lastUpdatedAt = computed(() => {
    if (sourceId.value) return duplicate.data.value && !isReadDenial(duplicate.error.value)
        ? duplicate.dataUpdatedAt.value : undefined;
    return creation.admittedAt.value;
});
const initialLoading = computed(() => !formContext.value && !loadError.value
    && (sourceId.value ? duplicate.isPending.value : creation.pending.value));
const reading = computed(() => sourceId.value ? duplicate.isFetching.value : creation.reading.value);

/** Retry only the current admission read, respecting the shared server backoff.
 * Query state owns progress and recovered errors; this operation never submits the form. */
async function retryRead(): Promise<void> {
    if (reading.value || !retryAvailable.value) return;
    const queryKey = sourceId.value ? packingKeys.duplicate(context.session.value?.context, sourceId.value, initialEventId.value)
        : packingKeys.creation(context.session.value?.context, initialEventId.value);
    await context.queryClient.refetchQueries({queryKey, type: 'active'}, {cancelRefetch: false});
}

function snapshot(): string {
    return JSON.stringify({
        title: title.value,
        description: description.value,
        eventId: eventId.value,
        rows: rows.value,
        defaults: defaults.value,
    });
}
function newRow(value?: components['schemas']['PackingDuplicateItem']): Row {
    return {
        key: nextKey.value++,
        title: value?.title ?? '',
        description: value?.description ?? '',
        // Native duplication initializes historical blank capacities to one in its form.
        maxAssignees: value?.maxAssignees || 1,
        requiredByAll: value?.requiredByAll ?? false,
    };
}
watch(
    [formContext, duplicate.data, baseline],
    initializeForm,
    {immediate: true},
);

/** Initialize once from the admitted projection. Later reads update definitions, never
 * entered fields; a duplicate copies rows/defaults while retaining its native exclusions. */
function initializeForm(): void {
    const create = formContext.value;
    const copy = duplicate.data.value;
    if (baseline.value !== null || !create || (sourceId.value && !copy)) return;
    title.value = copy?.title ?? '';
    description.value = copy?.description ?? '';
    selectedEvent.value = (copy ? copy.selectedEvent : creation.data.value?.selectedEvent) ?? null;
    eventId.value = selectedEvent.value?.id ?? null;
    defaults.value = {...(copy?.defaultPermissions ?? create.defaults)};
    // Duplicate preserves row order and Everyone, but does not copy assignments, image,
    // event association, administrators or archive state. Empty source lists retain zero rows.
    rows.value = copy ? copy.items.map(newRow) : [newRow()];
    baseline.value = snapshot();
}
const dirty = computed(
    () =>
        !submitted.value &&
        (image.value !== null || (baseline.value !== null && snapshot() !== baseline.value)),
);
const command = useCommand(context.refreshSession, true, {
    dirty: () => dirty.value && !leavingAfterSubmission.value,
    busy: () => admittingSubmission.value,
    unknownMessage: 'packing.leaveUnknown',
});
const blocked = computed(() => submitted.value || command.pending.value || command.uncertain.value || admittingSubmission.value);
function chooseImage(event: Event): void {
    image.value = (event.target as HTMLInputElement).files?.[0] ?? null;
}
/** A duplicate grant admits its form independently of creation. The server projects the
 * account-login journey and exact duplicate return; the browser does not duplicate that policy. */
async function admitSubmission(): Promise<boolean> {
    const scope = context.capture();
    // Fragments move within this document and cannot cancel a submitted form.
    // Path/query, actor and locale changes still retire the admission receipt.
    const expectedRoute = frontendDocumentUrl(route.fullPath);
    admittingSubmission.value = true;
    try {
        const result = await api.createEntry(scope, undefined, expectedRoute);
        if (!context.isCurrent(scope, true) || frontendDocumentUrl(route.fullPath) !== expectedRoute) return false;
        if (submissionAdmissionError) {
            command.clearRecoveredError(submissionAdmissionError);
            submissionAdmissionError = null;
        }
        if (result.entry.kind === 'render') return true;

        // A known submission admission is a completed native form journey. It does
        // not introduce another discard prompt; cancellation by another owner still
        // keeps this mounted draft. Pending/unknown commands never use this bypass.
        admittingSubmission.value = false;
        leavingAfterSubmission.value = true;
        await creation.navigate(result.entry, scope, expectedRoute);
        return false;
    } catch (failure) {
        if (context.isCurrent(scope, true) && frontendDocumentUrl(route.fullPath) === expectedRoute) {
            submissionAdmissionError = failure instanceof ApiFailure ? failure : 'state.loadFailed';
            command.setError(submissionAdmissionError, 'durable');
        }
        return false;
    } finally {
        admittingSubmission.value = false;
        leavingAfterSubmission.value = false;
    }
}

/** Mirror the native browser collector: omit blank titles, trim item strings and
 * parse the number field with its historical fallback. Root fields keep their whitespace. */
function collectedItems(): components['schemas']['PackingNewItem'][] {
    const items: components['schemas']['PackingNewItem'][] = [];
    for (const row of rows.value) {
        const itemTitle = row.title.trim();
        if (!itemTitle) continue;
        const capacity = String(row.maxAssignees ?? '');
        items.push({title: itemTitle, description: row.description?.trim() ?? '',
            maxAssignees: Number.parseInt(capacity || '1'), requiredByAll: row.requiredByAll});
    }
    return items;
}

async function create(): Promise<void> {
    if (!defaults.value || !formContext.value || blocked.value) return;
    // A held preflight cannot reuse definitions retired by another confirmed read.
    if (!(await admitSubmission()) || !formContext.value) return;

    const items = collectedItems();
    if (!items.length) {
        // Native collection omits blank rows, then redisplays this field error.
        // Keep its exact known presentation without sending an invalid typed body.
        command.setError('packing.itemsRequired');
        return;
    }
    const scope = context.capture();
    const origin = route.fullPath;
    const result = await command.run(
        (scope) =>
            api.createPacking(
                {
                    title: title.value,
                    description: description.value || null,
                    eventId: eventId.value,
                    defaultPermissions: defaults.value!,
                    items,
                },
                image.value,
                scope,
            ),
        false,
    );
    if (result) {
        // A created ID is confirmation even when delivery of its page fails. Retain
        // that destination under the shared navigation owner and never submit again.
        submitted.value = true;
        await destination.navigate('/frontend-pilot/packing/' + result.id, scope, origin,
            {kind: 'success', messageKey: 'packing.created'});
    }
}
</script>

<template>
    <!-- Native creation title/description controls have no HTML length caps. Keep
         their browser input behavior; the generated command contract and persistence
         retain their independent structural/storage bounds. Metadata editing has
         different native limits and must not lend them to this creation form. -->
    <!-- Native rejected creation POSTs render their ordinary flash above the card.
         Admission denials remain the separate full Error/Home outcome below. -->
    <StatusNotice v-if="!admissionError && command.error.value" kind="danger"
        :transient="command.transientError.value" :renewal="command.errorRenewal.value"
        @dismiss="command.setError(null)">{{ command.error.value }}</StatusNotice>
    <!-- Use the shared error card/Home action for initial route denials. These
         denials mount no form, issue no resource queries and disclose no copy. -->
    <PageMessage v-if="admissionError" kind="error" :message="admissionError" :renewal="admissionMessage" />
    <section v-else class="card bg-dark text-white mb-3">
        <h1 class="card-header text-center">
            <i class="bi bi-bag-plus me-2" aria-hidden="true"></i>{{ messages.t('packing.create') }}
        </h1>
        <div class="card-body">
            <StatusNotice v-if="command.uncertain.value" kind="warning">{{
                messages.t('packing.creationUnknown')
            }}</StatusNotice>
            <StatusNotice v-if="destination.target.value" kind="success">
                {{ messages.t('state.saved') }}
                <ActionButton class="btn-sm ms-2" variant="outline-light"
                    :pending="destination.pending.value" @click="destination.retry">
                    {{ messages.t('common.retry') }}
                </ActionButton>
            </StatusNotice>
            <StatusNotice v-if="loadError" kind="danger" :last-updated-at="lastUpdatedAt"
                :retry-at="retryAt" :read-error="loadError">
                {{ messages.t(lastUpdatedAt ? 'state.stale' : 'state.loadFailed') }}
                <ActionButton class="btn-sm ms-2" variant="outline-light" :pending="reading"
                    :disabled="!retryAvailable" @click="retryRead">{{ messages.t('common.retry') }}</ActionButton>
            </StatusNotice>
            <!-- Both create and duplicate use one admitted initial projection. The
                 event picker loads independently; a refresh never replaces this draft. -->
            <LoadingSkeleton v-if="initialLoading" variant="form" :rows="5" />
            <!-- An initialized local draft keeps its native controls/FileList on
                 confirmed denial. Retire server-owned definitions below and disable
                 submission until fresh admission; a cold denied visit has no form. -->
            <form v-if="defaults && (formContext || baseline !== null)" :aria-busy="reading" @submit.prevent="create">
                <!-- Additional native draft controls opt in to the shared mount boundary.
                     Hydration restores their models without submitting or replaying actions. -->
                <fieldset :disabled="blocked || !formContext">
                    <div class="mb-3">
                        <label class="form-label" for="create-title"
                            ><i class="bi bi-tag me-1" aria-hidden="true"></i
                            >{{ messages.t('packing.title') }} *</label
                        ><input
                            id="create-title"
                            v-model="title"
                            class="form-control text-bg-dark"
                            required
                        />
                    </div>
                    <div class="row mb-3">
                        <div class="col-md-12">
                            <label class="form-label" for="create-description"
                                ><i class="bi bi-pencil-square me-1" aria-hidden="true"></i
                                >{{ messages.t('packing.descriptionOptional') }}</label
                            ><textarea
                                id="create-description"
                                v-model="description"
                                class="form-control text-bg-dark"
                            ></textarea>
                        </div>
                    </div>
                    <div class="row mb-3">
                        <div class="col-12">
                            <label class="form-label" for="create-header"
                                ><i class="bi bi-card-image me-1" aria-hidden="true"></i
                                >{{ messages.t('packing.headerOptional') }}</label
                            ><input
                                id="create-header"
                                class="form-control text-bg-dark"
                                type="file"
                                data-hydration-draft
                                accept="image/jpeg,image/png,image/gif"
                                @change="chooseImage"
                            />
                        </div>
                    </div>
                    <div class="row mb-3">
                        <div class="col-md-12">
                            <EventPicker v-if="formContext" v-model="eventId" :source="api.eventPicker" :current="selectedEvent" prefix="create" :disabled="blocked" />
                        </div>
                    </div>
                    <div class="row mb-3">
                        <div class="col-md-12">
                            <AudiencePermissions
                                v-if="formContext"
                                v-model="defaults"
                                :permissions="formContext.permissions"
                                :presets="formContext.presets"
                                prefix="create-defaults"
                                :disabled="blocked"
                                hydration-draft
                            />
                        </div>
                    </div>
                    <div class="mb-3">
                        <label class="form-label"
                            ><i class="bi bi-list-ul me-1" aria-hidden="true"></i
                            >{{ messages.t('packing.itemsToPack') }}</label
                        >
                        <div class="table-responsive">
                            <table class="table table-dark table-striped table-bordered align-middle">
                                <thead>
                                    <tr>
                                        <th class="text-center w-25">{{ messages.t('packing.item') }}</th>
                                        <th class="text-center w-50">
                                            {{ messages.t('packing.description') }}
                                        </th>
                                        <th class="text-center w-15">
                                            {{ messages.t('packing.maxNumber') }}
                                        </th>
                                        <th class="text-center w-10">{{ messages.t('packing.action') }}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr v-for="(row, index) in rows" :key="row.key">
                                        <td>
                                            <input
                                                v-model="row.title"
                                                class="form-control text-bg-dark"
                                                required
                                                :aria-label="messages.t('packing.item') + ' ' + (index + 1)"
                                            />
                                        </td>
                                        <td>
                                            <input
                                                v-model="row.description"
                                                class="form-control text-bg-dark"
                                                :aria-label="
                                                    messages.t('packing.description') + ' ' + (index + 1)
                                                "
                                            />
                                        </td>
                                        <td style="width: 110px">
                                            <input
                                                v-model.number="row.maxAssignees"
                                                class="form-control text-bg-dark"
                                                type="number"
                                                data-hydration-draft
                                                required
                                                min="1"
                                                :aria-label="
                                                    messages.t('packing.maxNumber') + ' ' + (index + 1)
                                                "
                                            />
                                        </td>
                                        <td class="text-center">
                                            <label
                                                class="form-check form-switch d-inline-flex align-items-center me-3"
                                                ><input
                                                    v-model="row.requiredByAll"
                                                    type="checkbox"
                                                    data-hydration-draft
                                                    class="form-check-input"
                                                /><span class="ms-1 small">{{
                                                    messages.t('packing.everyone')
                                                }}</span></label
                                            ><ActionButton
                                                class="btn-sm"
                                                variant="outline-danger"
                                                :aria-label="messages.t('packing.removeRow')"
                                                @click="rows.splice(index, 1)"
                                                ><i class="bi bi-x-lg" aria-hidden="true"></i
                                            ></ActionButton>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                    <div class="d-flex justify-content-between align-items-center">
                        <ActionButton variant="outline-info" @click="rows.push(newRow())"
                            ><i class="bi bi-plus-circle me-1" aria-hidden="true"></i
                            >{{ messages.t('packing.addRow') }}</ActionButton
                        ><ActionButton type="submit" variant="success" :pending="command.pending.value"
                            ><i class="bi bi-check-lg me-1" aria-hidden="true"></i
                            >{{ messages.t('packing.createList') }}</ActionButton
                        >
                    </div>
                </fieldset>
            </form>
        </div>
    </section>
</template>
