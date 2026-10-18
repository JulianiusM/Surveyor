<script setup lang="ts" generic="TCopy extends FrontendListCreationCopy">
import {computed, ref, watch} from 'vue';
import {useRoute} from 'vue-router';
import {useQuery} from '@tanstack/vue-query';
import type {components} from '../../types/api/v1';
import type {PilotRequestScope} from '../../types/FrontendPilotUiTypes';
import type {FrontendListCreationCopy, FrontendListCreationSource} from '../../types/FrontendListTypes';
import type {PilotPlainMessageKey} from '../../types/FrontendPilotUiTypes';
import {useActionState, usePilot} from '../app/context';
import {isReadDenial} from '../app/transport';
import {isPlainMessageKey} from '../../modules/localization/translator';
import {useCreationCommand} from '../composables/creation';
import {useFileSelectionRelease} from '../composables/fileSelection';
import {useReadRetry, useReadRetryAt} from '../composables/feedback';
import {usePageEntry} from '../composables/pageEntry';
import {useQueryAdmission} from '../app/queryCache';
import {usePageTitle} from '../composables/pageTitle';
import ActionButton from './ActionButton.vue';
import StatusNotice from './StatusNotice.vue';
import CommandFeedback from './CommandFeedback.vue';
import PageMessage from './PageMessage.vue';
import LoadingSkeleton from './LoadingSkeleton.vue';
import EventPicker from './EventPicker.vue';
import AudiencePermissions from './permissions/AudiencePermissions.vue';
import CreationAdmissionNotices from './CreationAdmissionNotices.vue';

// One matching root form owns admission, root drafts and confirmed destination.
// Feature collections are supplied through explicit slots and collector callbacks.
const props = defineProps<{icon: string; heading: PilotPlainMessageKey; headerLabel: PilotPlainMessageKey; notFound: PilotPlainMessageKey;
    created: PilotPlainMessageKey; leaveUnknown: PilotPlainMessageKey; creationUnknown: PilotPlainMessageKey;
    source: FrontendListCreationSource<TCopy>}>();
const context = usePilot();
const {messages} = context;
const route = useRoute();
const sourceId = computed(() =>
    typeof route.params.listId === 'string' ? route.params.listId.toLowerCase() : null,
);
const initialEventId = computed(() => typeof route.query.eventId === 'string' ? route.query.eventId : undefined);
const bootstrapError = computed(() => isInitialForm() ? props.source.initialError : undefined);

/** SSR seeds only the admitted document and actor; later SPA routes use their own query admission. */
function isInitialForm(): boolean {
    return context.initialDocumentFor(route.fullPath) !== undefined
        && context.bootstrap.session.locale === context.locale.value;
}

function initialCreationEntry(): components['schemas']['PackingCreateEntry'] | undefined {
    if (!isInitialForm() || !props.source.initialContext || sourceId.value) return;
    return {entry: context.bootstrap.pageEntry ?? {kind: 'render'}, context: props.source.initialContext,
        selectedEvent: props.source.initialSelectedEvent ?? null};
}

function initialDuplicate(): TCopy | undefined {
    return isInitialForm() ? props.source.initialDuplicate : undefined;
}
const title = ref('');
const description = ref('');
// A contextual URL is resolved before becoming draft state. Subsequent picker reads
// can retire a label while retaining an actual user choice for explicit recovery.
const eventId = ref<string | null>(null);
const selectedEvent = ref<components['schemas']['EventPickerOption'] | null>(null);
const image = ref<File | null>(null);
// Warm creation/duplicate routes can retain the same form node. Its chooser must
// release old bytes when the committed route releases this feature-owned draft.
const imageInput = useFileSelectionRelease(() => image.value);
const defaults = ref<components['schemas']['PermissionDefaults'] | null>(null);
const baseline = ref<string | null>(null);
const retainedContext = ref<components['schemas']['PackingCreateContext'] | null>(null);
// Vue reuses this route component between creation/duplicate URLs. A confirmed navigation
// starts a new draft instead of retaining a previous list's copied values or uploaded file.
// Watch each identity value independently. Router replaces its query object on a
// fragment visit too; returning a fresh tuple would mistake that for a new draft.
watch([sourceId, initialEventId, context.epoch], resetCreationDraft);

/** A cancelled guard never commits these inputs. Start the next admitted form only
 * after its route or actor changes, without carrying an unresolved prior command. */
function resetCreationDraft(): void {
    submission.reset();
    baseline.value = null;
    retainedContext.value = null;
    title.value = '';
    description.value = '';
    defaults.value = null;
    image.value = null;
    eventId.value = null;
    selectedEvent.value = null;
    props.source.reset?.();
}
const creation = usePageEntry({
    key: computed(() => props.source.creationKey(context.session.value?.context, initialEventId.value)),
    initial: initialCreationEntry(),
    // Duplicate GET supplies its own admitted form definitions. The separate
    // create-context endpoint retains the native account-only create GET policy.
    enabled: computed(() => !sourceId.value && !bootstrapError.value),
    read: readCreationEntry,
});
function readCreationEntry(scope: PilotRequestScope, signal: AbortSignal): Promise<components['schemas']['PackingCreateEntry']> {
    return props.source.createEntry(scope, signal, route.fullPath, initialEventId.value);
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
const duplicateKey = computed(() => props.source.duplicateKey(context.session.value?.context, sourceId.value, initialEventId.value));
const duplicateAdmission = useQueryAdmission(context, duplicateKey,
    computed(() => context.hydrated.value && !!sourceId.value && !bootstrapError.value));
const duplicate = useQuery({
    queryKey: duplicateKey,
    initialData: initialDuplicate,
    ...duplicateAdmission,
    queryFn: ({signal}) => props.source.duplicate(sourceId.value!, context.capture(), signal, initialEventId.value),
});

/** Cold duplicate admission uses the same native message card as its document route.
 * Only validated read denial selects that card; an unusable proxy response keeps
 * the ordinary admission recovery available instead of declaring the source gone.
 * Once copied, these fields are an independent creation draft: a later source denial
 * must not destroy them or turn an already admitted copy into an inaccessible source. */
function duplicateAdmissionKey(): PilotPlainMessageKey | undefined {
    const failure = duplicate.error.value;
    if (!sourceId.value || baseline.value !== null || !isReadDenial(failure)) return;
    if (failure.status === 404) return props.notFound;
    if (failure.status === 403) return 'common.notAllowed';
}
const admissionMessage = computed(() => bootstrapError.value ?? duplicateAdmissionKey()
    ?? (creation.outcome.value?.kind === 'denied' ? creation.outcome.value.messageKey : undefined));
const admissionError = computed(() => {
    const key = admissionMessage.value;
    return key ? messages.value.t(isPlainMessageKey(key) ? key : 'common.error') : undefined;
});
usePageTitle(() => messages.value.t(admissionError.value ? 'common.errorTitle' : props.heading));
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
const readAction = useActionState({eligible: mayRetryCreationRead,
    pending: () => reading.value});

function mayRetryCreationRead(): boolean {
    return sourceId.value ? context.mayRead() && retryAvailable.value : creation.retryAction.isAvailable();
}

/** Retry only the current admission read, respecting the shared server backoff.
 * Query state owns progress and recovered errors; this operation never submits the form. */
async function retryRead(): Promise<void> {
    if (!readAction.isAvailable()) return;
    // Explicit recovery remains available when terminal errors disable observation.
    if (sourceId.value) await duplicate.refetch({cancelRefetch: false});
    else await creation.retry();
}

function snapshot(): string {
    return JSON.stringify({
        title: title.value,
        description: description.value,
        eventId: eventId.value,
        defaults: defaults.value,
        featureDraft: props.source.draft?.(),
    });
}
watch(
    [formContext, duplicate.data, baseline],
    initializeForm,
    {immediate: true},
);

/** Initialize once from the admitted projection. Later reads update definitions, never
 * entered fields; a duplicate copies only the feature's admitted source projection. */
function initializeForm(): void {
    const create = formContext.value;
    const copy = duplicate.data.value;
    if (baseline.value !== null || !create || (sourceId.value && !copy)) return;
    title.value = copy?.title ?? '';
    description.value = copy?.description ?? '';
    selectedEvent.value = (copy ? copy.selectedEvent : creation.data.value?.selectedEvent) ?? null;
    eventId.value = selectedEvent.value?.id ?? null;
    defaults.value = {...(copy?.defaultPermissions ?? create.defaults)};
    // The feature initializes its independent collection before we capture one
    // root-plus-collection dirty baseline. Later reads never repeat this step.
    props.source.initialize?.(copy);
    baseline.value = snapshot();
}
const dirty = computed(() => image.value !== null || baseline.value !== null && snapshot() !== baseline.value);
const submission = useCreationCommand<components['schemas']['PackingCreated']>({
    dirty: () => dirty.value,
    eligible: () => !!defaults.value && !!formContext.value,
    readEntry: readSubmissionEntry,
    navigateEntry: creation.navigate,
    destination: props.source.destination,
    success: props.created, unknownMessage: props.leaveUnknown,
});
const {command, destination, blocked, createAction, submissionAdmissionError, submissionAdmittedAt,
    submissionRetryAt, submissionRetryAction, retrySubmissionAdmission} = submission;

function chooseImage(event: Event): void {
    image.value = (event.target as HTMLInputElement).files?.[0] ?? null;
}

/** A duplicate grant admits its form independently of creation. The server projects the
 * account-login journey and exact duplicate return; the browser does not duplicate that policy. */
async function readSubmissionEntry(scope: PilotRequestScope, returnTo: string): Promise<components['schemas']['PageEntryOutcome']> {
    return (await props.source.createEntry(scope, undefined, returnTo)).entry;
}

/** Revalidate account-only admission before submitting the native-equivalent draft.
 * The feature collector preserves its native item rules. Unknown delivery retains input;
 * a confirmed creation transfers its destination to the shared navigation owner so
 * a canceled or failed route load cannot make the creation command available again. */
async function create(): Promise<void> {
    await submission.submit(collectCreation);
}

/** The feature validates and captures its own collection only after account
 * admission. The shared owner submits once and retains uncertain outcomes. */
function collectCreation() {
    const prepared = props.source.prepare({title: title.value, description: description.value || null,
        eventId: eventId.value, defaultPermissions: defaults.value!}, image.value);
    if ('error' in prepared) {
        command.setError(prepared.error);
        return;
    }
    return prepared.operation;
}
</script>

<template>
    <!-- Native creation title/description controls have no HTML length caps. Keep
         their browser input behavior; the generated command contract and persistence
         retain their independent structural/storage bounds. Metadata editing has
         different native limits and must not lend them to this creation form. -->
    <!-- Native rejected creation POSTs render their ordinary flash above the card.
         Admission denials remain the separate full Error/Home outcome below. -->
    <CommandFeedback v-if="!admissionError" :feedback="command.feedback" part="error" error-kind="danger" :inline="false" />
    <!-- Use the shared error card/Home action for initial route denials. These
         denials mount no form, issue no resource queries and disclose no copy. -->
    <PageMessage v-if="admissionError" kind="error" :message="admissionError" :renewal="admissionMessage" />
    <section v-else class="card bg-dark text-white mb-3">
        <h1 class="card-header text-center">
            <i class="bi me-2" :class="icon" aria-hidden="true"></i>{{ messages.t(heading) }}
        </h1>
        <div class="card-body">
            <CommandFeedback :feedback="command.feedback" part="uncertain" :unknown-message="creationUnknown" />
            <StatusNotice v-if="destination.target.value" kind="success"
                :action="{state: destination.retryAction, label: messages.t('common.retry')}" @action="destination.retry">
                {{ messages.t('state.saved') }}
            </StatusNotice>
            <CreationAdmissionNotices
                :read="{error: loadError, lastUpdatedAt, retryAt, action: readAction, stale: !!lastUpdatedAt, kind: 'danger'}"
                :submission="{error: submissionAdmissionError, lastUpdatedAt: submissionAdmittedAt,
                    retryAt: submissionRetryAt, action: submissionRetryAction}"
                @retry-read="retryRead" @retry-submission="retrySubmissionAdmission" />
            <!-- Both create and duplicate use one admitted initial projection. The
                 event picker loads independently; a refresh never replaces this draft. -->
            <LoadingSkeleton v-if="initialLoading" v-bind="route.meta.loadingSkeleton" />
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
                                >{{ messages.t(headerLabel) }}</label
                            ><input
                                ref="imageInput"
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
                            <EventPicker v-if="formContext" v-model="eventId" :source="source.eventPicker" :current="selectedEvent" prefix="create" :disabled="blocked" />
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
                    <slot :disabled="blocked || !formContext"></slot>
                    <div class="d-flex justify-content-between align-items-center">
                        <slot name="before-submit" :disabled="blocked || !formContext"></slot>
                        <ActionButton type="submit" variant="success" :state="createAction"
                            ><i class="bi bi-check-lg me-1" aria-hidden="true"></i
                            >{{ messages.t('packing.createList') }}</ActionButton
                        >
                    </div>
                </fieldset>
            </form>
        </div>
    </section>
</template>
