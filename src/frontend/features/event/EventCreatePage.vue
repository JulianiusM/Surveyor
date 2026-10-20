<script setup lang="ts">
import {computed, reactive, ref, watch} from 'vue';
import {useRoute, RouterLink} from 'vue-router';
import type {components} from '../../../types/api/v1';
import type {PilotRequestScope} from '../../../types/FrontendPilotUiTypes';
import type {EntityMetadataValues} from '../../../types/FrontendEntityMetadataTypes';
import {usePilot} from '../../app/context';
import {eventKeys} from '../../app/queryKeys';
import {useCreationCommand} from '../../composables/creation';
import {usePageEntry} from '../../composables/pageEntry';
import {usePageTitle} from '../../composables/pageTitle';
import {useReadRetryAt} from '../../composables/feedback';
import {useEventApi} from './api';
import EventFields from './EventFields.vue';
import AudiencePermissions from '../../components/permissions/AudiencePermissions.vue';
import ActionButton from '../../components/ActionButton.vue';
import LoadingSkeleton from '../../components/LoadingSkeleton.vue';
import PageMessage from '../../components/PageMessage.vue';
import StatusNotice from '../../components/StatusNotice.vue';
import CommandFeedback from '../../components/CommandFeedback.vue';
import CreationAdmissionNotices from '../../components/CreationAdmissionNotices.vue';
import FileField from '../../components/FileField.vue';

const context = usePilot();
const {messages} = context;
const api = useEventApi(context);
const route = useRoute();
const sourceId = computed(() => typeof route.params.eventId === 'string' ? route.params.eventId.toLowerCase() : null);
const initial = context.initialDocumentFor(route.fullPath);
type Creation = components['schemas']['EventCreateEntry'] & {values?: components['schemas']['EventCreateInput']; sourceId?: string | null};
const fields = reactive<EntityMetadataValues>({});
const defaults = ref<components['schemas']['PermissionDefaults']>({participant: 0, guest: 0, authenticated: 0, public: 0});
const baseline = ref<string | null>(null);
const image = ref<File | null>(null);
watch([sourceId, context.epoch], resetCreation, {flush: 'sync'});
const entry = usePageEntry<Creation>({
    key: computed(() => sourceId.value ? eventKeys.duplicate(context.session.value?.context, sourceId.value)
        : eventKeys.creation(context.session.value?.context)),
    initial: initialCreation(), read: readCreation,
});
const definitions = computed(() => entry.outcome.value?.kind === 'render' ? entry.data.value?.context : undefined);
const retryAt = useReadRetryAt(() => entry.error.value, entry.retryAvailable);
const submission = useCreationCommand<components['schemas']['EventCreated']>({
    dirty: isDirty, eligible: () => !!definitions.value && baseline.value !== null,
    readEntry: readSubmissionEntry, navigateEntry: entry.navigate,
    destination: result => '/frontend-pilot/event/' + result.id,
    success: 'event.created', unknownMessage: 'event.leaveUnknown',
});
const {command, destination, blocked, createAction, submissionAdmissionError, submissionAdmittedAt,
    submissionRetryAt, submissionRetryAction, retrySubmissionAdmission} = submission;
watch([entry.data, sourceId], receiveCreation, {immediate: true});
usePageTitle(() => messages.value.t('event.createDocumentTitle'), true);

/** SSR creation/duplicate definitions belong only to their initial admitted URL. */
function initialCreation(): Creation | undefined {
    if (!initial) return;
    if (initial.eventDuplicate) return {entry: initial.pageEntry ?? {kind: 'render'},
        context: initial.eventDuplicate.formContext, values: initial.eventDuplicate.values, sourceId: sourceId.value};
    if (initial.eventCreateContext) return {entry: initial.pageEntry ?? {kind: 'render'}, context: initial.eventCreateContext};
    return initial.pageEntry ? {entry: initial.pageEntry, context: null} : undefined;
}

/** Duplicate admission copies only its bounded form values. This GET never
 * creates an Event, uploads bytes or consumes a registration capability. */
async function readCreation(scope: PilotRequestScope, signal: AbortSignal): Promise<Creation> {
    const source = sourceId.value;
    if (!source) return api.createEntry(scope, signal, route.fullPath);
    // Tag this local adaptation with its admitted source. On warm navigation the
    // previous observer can still render briefly, but cannot initialize a new draft.
    const duplicate = await api.duplicate(source, scope, signal);
    return {entry: {kind: 'render'}, context: duplicate.formContext, values: duplicate.values, sourceId: source};
}

/** First admission establishes a feature-owned form draft; background reads and
 * locale updates refresh definitions while retaining focused input and values. */
function receiveCreation(): void {
    if (baseline.value !== null || entry.outcome.value?.kind !== 'render' || !entry.data.value?.context) return;
    if ((entry.data.value.sourceId ?? null) !== sourceId.value) return;
    const seed = entry.data.value.values;
    Object.assign(fields, {title: '', description: '', startDate: '', endDate: '', location: '', maxParticipants: '',
        bindingDeadline: '', deadlineTz: 'UTC', requireDietaryInfo: false, allowDietComment: false,
        allowRegDateUpdatesAfterDeadline: false, allowRegCancelationAfterDeadline: false, allowRegDietUpdateAfterDeadline: false});
    if (seed) {
        // Keep masks separate from scalar fields; only the feature collector
        // adapts the admitted draft to its generated creation contract.
        const {defaultPermissions, ...values} = seed;
        Object.assign(fields, values);
        defaults.value = {...defaultPermissions};
    } else defaults.value = {...entry.data.value.context.defaults};
    baseline.value = snapshot();
}

function snapshot(): string { return JSON.stringify({fields, defaults: defaults.value}); }
function isDirty(): boolean { return !!image.value || baseline.value !== null && snapshot() !== baseline.value; }

/** Committed create/duplicate navigation releases the old draft and chooser.
 * Fragments, failed navigation and background reads retain their current values. */
function resetCreation(): void {
    submission.reset();
    baseline.value = null;
    image.value = null;
    // Remove stale fields before the new admitted projection can initialize them.
    for (const field of Object.keys(fields)) delete fields[field];
    defaults.value = {participant: 0, guest: 0, authenticated: 0, public: 0};
}

/** Duplication admits copying, while creation retains its independent native
 * account journey. The shared owner captures this read's actor and return URL. */
async function readSubmissionEntry(scope: PilotRequestScope, returnTo: string): Promise<components['schemas']['PageEntryOutcome']> {
    return (await api.createEntry(scope, undefined, returnTo)).entry;
}

async function create(): Promise<void> {
    await submission.submit(collectCreation);
}

/** Preserve native lexical date/capacity/deadline values and all audience masks.
 * Business parsing stays with the existing Event creation operation. */
function collectCreation() {
    const input: components['schemas']['EventCreateInput'] = {
        title: String(fields.title ?? ''), description: String(fields.description ?? ''),
        startDate: String(fields.startDate ?? ''), endDate: String(fields.endDate ?? ''),
        location: String(fields.location ?? ''), maxParticipants: String(fields.maxParticipants ?? ''),
        bindingDeadline: String(fields.bindingDeadline ?? ''), deadlineTz: String(fields.deadlineTz ?? 'UTC'),
        requireDietaryInfo: fields.requireDietaryInfo === true, allowDietComment: fields.allowDietComment === true,
        allowRegDateUpdatesAfterDeadline: fields.allowRegDateUpdatesAfterDeadline === true,
        allowRegCancelationAfterDeadline: fields.allowRegCancelationAfterDeadline === true,
        allowRegDietUpdateAfterDeadline: fields.allowRegDietUpdateAfterDeadline === true,
        defaultPermissions: {...defaults.value},
    };
    const selectedImage = image.value;
    return function createEvent(scope: PilotRequestScope) { return api.createEvent(input, selectedImage, scope); };
}
</script>

<template>
    <!-- Creation and duplication retain feature-owned fields while sharing
         admitted command delivery and navigation with Packing creation. -->

    <section class="card bg-dark text-white mb-3">
        <h1 class="card-header text-center"><i class="bi bi-calendar2-plus me-2" aria-hidden="true"></i>{{ messages.t('event.create') }}</h1>
        <div class="card-body">
            <CommandFeedback :feedback="command.feedback" part="error" error-kind="danger" />
            <CommandFeedback :feedback="command.feedback" part="uncertain" unknown-message="event.creationUnknown" />
            <StatusNotice v-if="destination.target.value" kind="success"
                :action="{state: destination.retryAction, label: messages.t('common.retry')}" @action="destination.retry">
                {{ messages.t('state.saved') }}
            </StatusNotice>
            <PageMessage v-if="entry.outcome.value?.kind === 'denied'" kind="error"
                :message="messages.t('common.notAllowed')" :renewal="entry.outcome.value" />
            <CreationAdmissionNotices
                :read="{error: entry.error.value, lastUpdatedAt: entry.admittedAt.value, retryAt,
                    action: entry.retryAction, stale: !!definitions}"
                :submission="{error: submissionAdmissionError, lastUpdatedAt: submissionAdmittedAt,
                    retryAt: submissionRetryAt, action: submissionRetryAction}"
                @retry-read="entry.retry" @retry-submission="retrySubmissionAdmission" />
            <LoadingSkeleton v-if="!definitions && baseline === null && entry.outcome.value?.kind !== 'denied'"
                v-bind="route.meta.loadingSkeleton" />

            <!-- A denied read disables submission without replacing the mounted
                 fields or chooser. Retry admits authority; it never creates. -->
            <form v-if="baseline !== null" id="eventForm" @submit.prevent="create">
                <fieldset :disabled="blocked || !definitions">
                    <EventFields :values="fields" prefix="event-create" :disabled="blocked || !definitions" />

                    <!-- The selected File and chooser share the feature's draft lifetime. -->
                    <div class="row mb-3">
                        <FileField id="event-header-image" name="headerImg" class="col-12" :label="messages.t('event.headerImage')"
                            label-icon="bi-card-image" :selected-file="image" @choose="image = $event" />
                    </div>

                    <!-- Visible audience controls retain every audience's draft;
                         the command submits their masks independently of disclosure. -->
                    <div class="row mb-3">
                        <div class="col-md-12">
                            <AudiencePermissions v-model="defaults" :permissions="definitions?.permissions ?? []"
                                :presets="definitions?.presets ?? []" prefix="event-create-permissions"
                                :disabled="blocked || !definitions" />
                        </div>
                    </div>

                    <div class="d-flex justify-content-end gap-2">
                        <RouterLink class="btn btn-outline-secondary" to="/frontend-pilot"><i class="bi bi-x-circle me-1" aria-hidden="true"></i>{{ messages.t('common.cancel') }}</RouterLink>
                        <ActionButton type="submit" variant="success" :state="createAction"><i class="bi bi-check-lg me-1" aria-hidden="true"></i>{{ messages.t('event.create') }}</ActionButton>
                    </div>
                </fieldset>
            </form>
        </div>
    </section>
</template>
