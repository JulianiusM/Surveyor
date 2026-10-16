<script setup lang="ts">
import {computed, reactive, ref, watch} from 'vue';
import {useRoute, RouterLink} from 'vue-router';
import type {components} from '../../../types/api/v1';
import type {PilotRequestScope} from '../../../types/FrontendPilotUiTypes';
import type {EntityMetadataValues} from '../../../types/FrontendEntityMetadataTypes';
import {apiCompatibility} from '../../../../.generated/api/v1/policy.mjs';
import {usePilot} from '../../app/context';
import {eventKeys} from '../../app/queryKeys';
import {useDocumentForm} from '../../composables/command';
import {usePageEntry} from '../../composables/pageEntry';
import {usePageTitle} from '../../composables/pageTitle';
import {useReadRetryAt} from '../../composables/feedback';
import {useFileSelectionRelease} from '../../composables/fileSelection';
import {useEventApi} from './api';
import EventFields from './EventFields.vue';
import AudiencePermissions from '../../components/permissions/AudiencePermissions.vue';
import ActionButton from '../../components/ActionButton.vue';
import LoadingSkeleton from '../../components/LoadingSkeleton.vue';
import PageMessage from '../../components/PageMessage.vue';
import StatusNotice from '../../components/StatusNotice.vue';

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
const validation = ref(initial?.eventCreationSubmission?.error);
const image = ref<File | null>(null);
const imageInput = useFileSelectionRelease(() => image.value);
// Proof belongs to this admitted form visit. A subsequent actor cannot silently
// submit a restored document using fresh mutable session credentials.
const proof = {context: context.session.value?.context ?? '', csrf: context.session.value?.csrfToken ?? '', compatibility: apiCompatibility};
const form = useDocumentForm({dirty: isDirty});
watch([sourceId, context.epoch], resetCreation, {flush: 'sync'});
const entry = usePageEntry<Creation>({
    key: computed(() => sourceId.value ? eventKeys.duplicate(context.session.value?.context, sourceId.value)
        : eventKeys.creation(context.session.value?.context)),
    initial: initialCreation(), read: readCreation,
});
const definitions = computed(() => entry.outcome.value?.kind === 'render' ? entry.data.value?.context : undefined);
const retryAt = useReadRetryAt(() => entry.error.value, entry.retryAvailable);
const action = computed(() => sourceId.value ? `/frontend-pilot/event/${sourceId.value}/duplicate` : '/frontend-pilot/event/create');
watch([entry.data, sourceId], receiveCreation, {immediate: true});
usePageTitle(() => messages.value.t('event.create'));

/** SSR definitions and validation fields are admitted only for the initial URL. */
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
    const seed = context.initialDocumentFor(route.fullPath)?.eventCreationSubmission?.fields ?? entry.data.value.values;
    Object.assign(fields, {title: '', description: '', startDate: '', endDate: '', location: '', maxParticipants: '',
        bindingDeadline: '', deadlineTz: 'UTC', requireDietaryInfo: false, allowDietComment: false,
        allowRegDateUpdatesAfterDeadline: false, allowRegCancelationAfterDeadline: false, allowRegDietUpdateAfterDeadline: false});
    if (seed) {
        // Default permissions are serialized separately with native form names.
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
    baseline.value = null;
    validation.value = undefined;
    image.value = null;
    // Remove stale fields before the new admitted projection can initialize them.
    for (const field of Object.keys(fields)) delete fields[field];
    defaults.value = {participant: 0, guest: 0, authenticated: 0, public: 0};
}

function chooseImage(event: Event): void { image.value = (event.target as HTMLInputElement).files?.[0] ?? null; }

/** Native creation decodes permission names, rather than numeric masks. Keep
 * all audience drafts submitted even while their presentation is switched. */
function permissionKeys(mask: number): string[] {
    return definitions.value?.permissions.filter(permission => !!(mask & permission.bit)).map(permission => permission.key) ?? [];
}
</script>

<template>
    <!-- Creation retains the deliberate native document submission, including its
         existing backend ordering and validation redisplay, through one form owner. -->

    <section class="card bg-dark text-white mb-3">
        <h1 class="card-header text-center"><i class="bi bi-calendar2-plus me-2" aria-hidden="true"></i>{{ messages.t('event.create') }}</h1>
        <div class="card-body">
            <PageMessage v-if="entry.outcome.value?.kind === 'denied'" kind="error"
                :message="messages.t('common.notAllowed')" :renewal="entry.outcome.value" />
            <StatusNotice v-if="entry.error.value" kind="warning" :read-error="entry.error.value" :retry-at="retryAt"
                :last-updated-at="entry.admittedAt.value"
                :action="{state: entry.retryAction, label: messages.t('common.retry')}" @action="entry.retry">
                {{ messages.t(definitions ? 'state.stale' : 'state.loadFailed') }}
            </StatusNotice>
            <LoadingSkeleton v-if="!definitions && entry.outcome.value?.kind !== 'denied'" variant="form" :rows="5" />

            <!-- The admitted form captures its own context proof and submits native
                 field names. No API create/retry path runs beside this document POST. -->
            <form v-if="definitions && baseline !== null" id="eventForm" :action="action" method="POST"
                enctype="multipart/form-data" @submit="form.submit">
                <input type="hidden" name="_context" :value="proof.context" />
                <input type="hidden" name="_csrf" :value="proof.csrf" />
                <input type="hidden" name="_compat" :value="proof.compatibility" />
                <StatusNotice v-if="validation" kind="danger">{{ validation }}</StatusNotice>

                <EventFields :values="fields" prefix="event-create" />

                <!-- The selected File and chooser share the feature's draft lifetime. -->
                <div class="row mb-3">
                    <div class="col-12">
                        <label class="form-label" for="event-header-image"><i class="bi bi-card-image me-1" aria-hidden="true"></i>{{ messages.t('event.headerImage') }}</label>
                        <input ref="imageInput" id="event-header-image" class="form-control text-bg-dark" type="file"
                            name="headerImg" accept="image/jpeg,image/png,image/gif" @change="chooseImage" />
                    </div>
                </div>

                <!-- Visible audience controls retain every audience's draft. Hidden
                     named keys adapt masks to the existing native creation parser. -->
                <div class="row mb-3">
                    <div class="col-md-12">
                        <AudiencePermissions v-model="defaults" :permissions="definitions.permissions"
                            :presets="definitions.presets" prefix="event-create-permissions"
                            :disabled="form.pending.value" />
                        <template v-for="(mask, audience) in defaults" :key="audience">
                            <input type="hidden" :name="`defaultPerms[${audience}][]`" value="" />
                            <input v-for="permission in permissionKeys(mask)" :key="permission" type="hidden"
                                :name="`defaultPerms[${audience}][]`" :value="permission" />
                        </template>
                    </div>
                </div>

                <div class="d-flex justify-content-end gap-2">
                    <RouterLink class="btn btn-outline-secondary" to="/frontend-pilot"><i class="bi bi-x-circle me-1" aria-hidden="true"></i>{{ messages.t('common.cancel') }}</RouterLink>
                    <ActionButton type="submit" variant="success" :state="form.action"><i class="bi bi-check-lg me-1" aria-hidden="true"></i>{{ messages.t('event.create') }}</ActionButton>
                </div>
            </form>
        </div>
    </section>
</template>
