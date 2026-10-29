<script setup lang="ts">
import {computed, onBeforeUnmount, ref, watch} from 'vue';
import {useQuery} from '@tanstack/vue-query';
import type {components} from '../../types/api/v1';
import type {EntityHeaderLabels, EntityLifecycleLabels} from '../../types/FrontendEntitySettingsTypes';
import type {FrontendRequestScope} from '../../types/FrontendUiTypes';
import type {EntitySettingsDialogProps, EntitySettingsProjection} from '../../types/FrontendEntityDialogTypes';
import type {EntityAccessOperations} from '../../types/FrontendEntityAccessTypes';
import {createEntityLifecycle, useEntityRemoval} from '../composables/entityLifecycle';
import {useActionState, useFrontend, refreshInterval} from '../app/context';
import {isReadDenial} from '../app/transport';
import {useCommand} from '../composables/command';
import {useReadRetry, useReadRetryAt} from '../composables/feedback';
import {useConfirmedNavigation} from '../composables/pageEntry';
import {observeQueryReads, refetchFreshQuery, useQueryAdmission} from '../app/queryCache';
import ActionButton from './ActionButton.vue';
import AppDialog from './AppDialog.vue';
import StatusNotice from './StatusNotice.vue';
import CommandFeedback from './CommandFeedback.vue';
import LoadingSkeleton from './LoadingSkeleton.vue';
import AppTabList from './AppTabList.vue';
import EntityMetadataEditor from './EntityMetadataEditor.vue';
import EntityHeaderEditor from './EntityHeaderEditor.vue';
import EntityEventEditor from './EntityEventEditor.vue';
import EntityLifecycleActions from './EntityLifecycleActions.vue';
import EntityAccessEditor from './EntityAccessEditor.vue';

// The detail's metadata capability schedules its independent read early. It never
// grants fields or commands; each metadata response supplies its own authority/token.
const props = defineProps<EntitySettingsDialogProps>();
const emit = defineEmits<{close: []; saved: []; accessLost: []}>();
const context = useFrontend();
const api = props.operations;
const {messages} = context;
// Shared panels receive catalog wording and admitted presentation. This dialog and
// its section editors own drafts, tokens and commands for root features;
// each feature injects its operations and retains its deliberate field exceptions.
const headerLabels = computed<EntityHeaderLabels>(() => ({
    title: messages.value.t('packing.headerImage'), choose: messages.value.t('packing.chooseImage'),
    hint: messages.value.t('packing.imageHint'), upload: messages.value.t('packing.upload'),
    remove: messages.value.t('packing.removeImage'),
}));
const lifecycleLabels = computed<EntityLifecycleLabels>(() => ({
    activeHint: messages.value.t('packing.activeHint'), archivedHint: messages.value.t('packing.archivedHint'),
    inheritedHint: messages.value.t('packing.inheritedHint'), openEvent: messages.value.t('packing.openEvent'),
    otherActions: messages.value.t('packing.otherActions'), deletePermanently: messages.value.t('packing.deletePermanently'),
}));
const destination = useConfirmedNavigation();
let active = true;
onBeforeUnmount(retireEditor);

/** A denied read can retire this dialog before its admitted command settles.
 * Keep that command's root status/confirmed consent, but start no new editor reads. */
function retireEditor(): void {
    active = false;
}
type Settings = EntitySettingsProjection;
const panel = ref(props.metadataAvailable === true ? 'general' : '');
const accessEditor = ref<InstanceType<typeof EntityAccessEditor> | null>(null);
// Surveys deliberately have no general permission model. Require a complete
// feature adapter and profile-query inputs before composing the shared ACL panel;
// absent controls never require dummy operations or create discovery requests.
const accessSetup = computed(() => {
    if (!hasAccessOperations(api) || !props.profileKey || !props.profileFamily) return null;
    return {operations: api, profileKey: props.profileKey, profileFamily: props.profileFamily};
});

/** Narrow the optional access contract only when its actual caller implements
 * every operation. Server-projected capabilities still decide admission. */
function hasAccessOperations(operations: EntitySettingsDialogProps['operations']): operations is EntitySettingsDialogProps['operations'] & EntityAccessOperations {
    // Keep these methods on their owning API object so method receivers survive.
    return !!operations.profiles && !!operations.setDefaults && !!operations.addAdmin
        && !!operations.updateAdmin && !!operations.removeAdmin;
}
const fields = ref<InstanceType<typeof EntityMetadataEditor> | null>(null);
const image = ref<File | null>(null);
const event = ref<{original: string | null; value: string | null; token: string;
    confirmed?: string | null} | null>(null);
const imageToken = ref<string | null>(null);
const imageOriginal = ref<string | null>(null);
// The shared command blocks every settings control, but only its initiating
// action may recover focus. This presentation tag grants no command admission.
const pendingAction = ref<'upload' | 'removeImage' | 'event' | 'archive' | 'automation' | 'remove' | null>(null);
const jitter = context.browser ? Math.round(Math.random() * 3000) : 0;
const settingsKey = computed(() => props.settingsKey);
const settingsAdmission = useQueryAdmission(context, settingsKey,
    computed(() => context.hydrated.value && context.visible.value));
const settings = useQuery({
    queryKey: settingsKey,
    ...settingsAdmission,
    queryFn: ({signal}) => api.settings(props.resourceId, context.capture(), signal),
    refetchInterval: (query) =>
        context.mayRead() && context.visible.value ? refreshInterval(query.state.error, query.state.fetchFailureCount, jitter) : false,
});
// Retain draft owners through same-key language refreshes, but remove authority immediately on a confirmed
// denial. Each independently saved form keeps the token of the snapshot it actually edited.
const last = ref<Settings | null>(null);
let completedSettingsReads = 0;
let relinkingMetadata = false;

/** Reconcile each independent editor with authority without replacing another editor's dirty baseline. */
function receiveSettings(value: Settings | undefined, fresh = false): void {
    if (!value) return;
    last.value = value;
    // A canceled warm refetch can expose retained data as a successful observer
    // result. Keep confirmed values/tokens separate until an actual fresh read;
    // in-flight commands likewise own their causal post-confirmation adoption.
    if (!fresh && (command.pending.value || command.recovering.value || awaitingSettingsAuthority())) return;
    accessEditor.value?.receiveSettings(value, fresh);

    // Event selection is a draft ID. Its current title/access projection can change independently.
    const eventId = value.currentEvent?.id ?? null;
    const originalEvent = event.value?.confirmed !== undefined ? event.value.confirmed : event.value?.original;
    if (!event.value || event.value.value === originalEvent) {
        event.value = {original: eventId, value: eventId, token: value.settingsToken};
    } else if (event.value.confirmed !== undefined) {
        // Further local edits keep the confirmed value as their baseline. The new
        // read can then expose a genuine overlap instead of comparing against stale data.
        event.value.original = event.value.confirmed;
        delete event.value.confirmed;
        if (event.value.original === eventId) event.value.token = value.settingsToken;
    }
}

/** Local confirmation is presentation, never a replacement server comparison token. */
function awaitingSettingsAuthority(): boolean {
    return !!accessEditor.value?.awaitingAuthority || event.value?.confirmed !== undefined;
}

watch(settings.error, (failure) => {
    if (isReadDenial(failure)) emit('accessLost');
});
const data = computed(() => settings.data.value ?? last.value);
const initialLoading = computed(() => !data.value && settings.isPending.value);
const showMetadata = computed(() => data.value ? !!data.value.editableFields.length : props.metadataAvailable === true);
// A write-grant change must not destroy the child that owns an unsaved draft or
// admitted command/recovery. Its current projection still controls visibility,
// writes and automatic reads; full read denial retires the dialog as before.
const retainedMetadata = computed(() => !!fields.value && (fields.value.dirty || fields.value.unknown
    || fields.value.pending || fields.value.refreshing || fields.value.awaitingAuthority));
/** Present only settings panels admitted by this projection; their controls still
 * use the feature's field/method capabilities and independent draft owners. */
const panels = computed(() => {
    // Missing settings are unknown admission, so do not invent an available tab.
    const state = data.value;
    if (!state) return [];
    return [
        {
            key: 'general',
            label: 'packing.general' as const,
            icon: 'bi-sliders',
            enabled: state.editableFields.length || state.capabilities.editHeader,
        },
        {
            key: 'event',
            label: 'packing.linkedEvent' as const,
            icon: 'bi-calendar-event',
            enabled: state.capabilities.linkEvent,
        },
        {
            key: 'access',
            label: 'packing.access' as const,
            icon: 'bi-people',
            enabled: state.capabilities.managePermissions && state.access && accessSetup.value,
        },
        {
            key: 'actions',
            label: 'packing.actions' as const,
            icon: 'bi-three-dots',
            enabled:
                state.capabilities.manageArchive || state.capabilities.duplicate || state.capabilities.remove
                || state.capabilities.export && props.exportLink,
        },
    ].filter((candidate) => candidate.enabled);
});
const panelTabs = computed(() => panels.value.map(tab => ({...tab, label: messages.value.t(tab.label),
    id: 'frontend-settings-tab-' + tab.key, controls: 'frontend-settings-' + tab.key})));
const showGeneral = computed(() => panels.value.some(tab => tab.key === 'general') || (!data.value && showMetadata.value));

watch(
    panels,
    (values) => {
        // Keep the known metadata panel usable while unrelated settings are still
        // loading. Actual settings authority controls all panels once it arrives.
        if (!data.value) return;
        if (!values.some((value) => value.key === panel.value)) panel.value = values[0]?.key ?? '';
    },
    {immediate: true},
);
/** Record a successful settings read independently of the optional related metadata read. */
async function refreshAfterCommand(): Promise<void> {
    // An explicit observer refetch bypasses query enabled state. The shared command
    // still settles normally, while a retired private editor cannot recreate its cache.
    if (!active || isReadDenial(settings.error.value)) return;
    const scope = context.capture();
    const resource = props.resourceId;
    const result = await refetchFreshQuery<Settings>(context.queryClient, settingsKey.value, refetchSettings, mayRead);
    if (!active || resource !== props.resourceId || !context.isCurrent(scope)) return;
    receiveSettings(result, true);
    completedSettingsReads++;
    // Refresh related snapshots after a confirmed settings write. Each dirty form compares
    // only its own edited fields; unrelated setup changes do not manufacture conflicts.
    // A retained hidden draft supplies no read grant. Only currently admitted
    // metadata joins the settings command's existing causal catch-up read.
    if (showMetadata.value) {
        await fields.value?.refreshAfterSettings(relinkingMetadata && command.outcome.value?.confirmation === 'confirmed');
    }
    if (active && resource === props.resourceId && context.isCurrent(scope)) emit('saved');

    function mayRead(): boolean {
        return active && resource === props.resourceId && context.mayRead(scope);
    }
}
const command = useCommand(refreshAfterCommand, false, {
    dirty: () => dirty.value || !!fields.value?.dirty,
    busy: () => !!busy.value,
    uncertain: () => !!fields.value?.unknown,
    unknownMessage: 'draft.leaveUnknown',
});
const lifecycle = createEntityLifecycle(api, command, messages);
const removal = useEntityRemoval(command, destination);
// Observe ordinary DTO changes for initial/clean drafts. Equal background network
// successes restore confirmed editors too; idle/cancel and manual aliases do not.
watch(settings.data, value => receiveSettings(value), {immediate: true});
const stopSettingsReads = observeQueryReads<Settings>(context.queryClient, () => settingsKey.value, receiveSettingsRead);
onBeforeUnmount(stopSettingsReads);

function receiveSettingsRead(value: Settings): void {
    if (active && !command.pending.value && !command.recovering.value) receiveSettings(value, true);
}

/** Keep the observer operation private; the cache owner certifies its actual read. */
function refetchSettings(): Promise<unknown> {
    return settings.refetch({throwOnError: true});
}

const settingsRetryAvailable = useReadRetry(() => settings.error.value);
const retryAt = useReadRetryAt(() => settings.error.value, settingsRetryAvailable);
// Refresh spans settings and the related metadata authority. Its visible control
// must honor either owner's server deadline, just as their transports do.
const retryAvailable = computed(() => settingsRetryAvailable.value && fields.value?.retryAvailable !== false);
const refreshingSettings = ref(false);
// Only an in-flight operation prevents dismissal outright. An unknown metadata command
// blocks mutations but keeps recovery and deliberate departure acknowledgement reachable.
const busy = computed(() => refreshingSettings.value || command.pending.value || command.recovering.value
    || fields.value?.pending || fields.value?.refreshing);
// Commands lock the entire modal, including its navigation and nested tabs.
// Uncertainty alone keeps those tabs reachable so another panel cannot hide recovery.
const controlsPending = computed(() => !!busy.value || !!destination.target.value);
const awaitingAuthority = computed(() => awaitingSettingsAuthority() || !!fields.value?.awaitingAuthority);
const blocked = computed(
    () => busy.value || command.uncertain.value || fields.value?.unknown || awaitingAuthority.value || !!destination.target.value,
);
const refreshAction = useActionState({eligible: mayRefreshSettings, pending: () => refreshingSettings.value,
    blocked: () => !!busy.value});

function mayRefreshSettings(): boolean { return active && context.mayRead() && retryAvailable.value; }
/** A confirmed metadata save stays confirmed even if its related settings read fails. */
async function metadataSaved(): Promise<void> {
    // Complete the current-value read before another panel sends a command.
    refreshingSettings.value = true;
    try {
        const scope = context.capture();
        const resource = props.resourceId;
        const result = await refetchFreshQuery<Settings>(context.queryClient, settingsKey.value, refetchSettings, mayRead);
        if (active && resource === props.resourceId && context.isCurrent(scope)) receiveSettings(result, true);

        function mayRead(): boolean {
            return active && resource === props.resourceId && context.mayRead(scope);
        }
    } catch (failure) {
        command.setReadNotice('state.savedRefreshFailed', failure);
    } finally {
        refreshingSettings.value = false;
        emit('saved');
    }
}
const eventConflict = computed(() => !!event.value && event.value.original !== (data.value?.currentEvent?.id ?? null));
const headerConflict = computed(() => !!image.value && imageOriginal.value !== (data.value?.headerVersion ?? null));

/** Retry related reads explicitly; reconciliation never repeats the saved or uncertain write. */
async function refreshSettings(): Promise<void> {
    if (!refreshAction.isAvailable()) return;
    refreshingSettings.value = true;
    const scope = context.capture();
    try {
        const reconciled = await command.reconcile();
        if (reconciled && context.isCurrent(scope)) {
            command.clearRecoveredError('state.loadFailed');
        }
    } catch (failure) {
        // A dependent metadata read can fail while settings itself remains readable.
        // Preserve that recovery warning until a matching read succeeds, not flash expiry.
        if (context.isCurrent(scope)) {
            if (command.notice.value === 'state.savedRefreshFailed') command.setReadNotice('state.savedRefreshFailed', failure);
            else command.setReadError('state.loadFailed', failure);
        }
    } finally {
        refreshingSettings.value = false;
    }
}

function reviewHeader(): void {
    if (controlsPending.value) return;
    imageToken.value = data.value?.settingsToken ?? null;
    imageOriginal.value = data.value?.headerVersion ?? null;
}
const dirty = computed(
    () =>
        !!image.value ||
        !!accessEditor.value?.dirty ||
        event.value?.value !== (event.value?.confirmed !== undefined ? event.value.confirmed : event.value?.original),
);
function close(): void {
    if (destination.target.value) return;
    if (command.mayLeave()) emit('close');
}
/** Capture the shared panel's selected file against this feature's current header baseline. */
function chooseImage(file: File | null): void {
    image.value = file;
    imageToken.value = data.value?.settingsToken ?? null;
    imageOriginal.value = data.value?.headerVersion ?? null;
}

/** Submit the selected file against the header baseline captured when it was
 * chosen. Retain that file after rejection or uncertain delivery; only a confirmed
 * command clears it, while the shared refresh owner admits subsequent authority. */
async function upload(): Promise<void> {
    // Retaining a local File/chooser through a narrowed projection is not a
    // write grant. Stale component callbacks need this current authority too.
    if (blocked.value || !data.value?.capabilities.editHeader || headerConflict.value) return;

    // Missing-file feedback happens before a request. The chosen file's
    // retained token must still exist; a later settings read cannot replace it.
    if (!image.value) {
        command.setError('metadata.chooseImage', 'transient');
        return;
    }
    if (!imageToken.value) return;

    // The shared command distinguishes write confirmation from refresh failure.
    // Rejection/unknown delivery keeps the file; confirmation alone releases it.
    pendingAction.value = 'upload';
    let result: unknown;
    try {
        result = await command.run((scope) =>
            api.uploadHeader(props.resourceId, image.value!, imageToken.value!, scope),
            true, false, {success: 'metadata.imageUpdated'},
        );
    } finally {
        pendingAction.value = null;
    }
    // The shared chooser observes this explicit draft release. Clear its visible
    // FileList after confirmation as well, including a saved-but-stale read result.
    if (result) image.value = null;
}

/** Header removal is a separate reviewed command, not clearing the file draft.
 * The current settings token protects the stored image and the server retains
 * authority over the write and its post-commit file cleanup. */
async function removeImage(): Promise<void> {
    if (blocked.value || !data.value?.capabilities.editHeader) return;
    if (data.value && window.confirm(messages.value.t('packing.confirmRemoveImage'))) {
        pendingAction.value = 'removeImage';
        try {
            await command.run((scope) =>
                api.removeHeader(props.resourceId, data.value!.settingsToken, scope),
                true, false, {success: 'metadata.imageRemoved'},
            );
        } finally {
            pendingAction.value = null;
        }
    }
}
/** Relink one explicitly reviewed event choice through the existing command owner.
 * The accepted value is presentation only; a completed settings read supplies any new
 * comparison token. Relinking can revoke access and must preserve other editor drafts. */
async function saveEvent(): Promise<void> {
    if (!event.value || blocked.value || eventConflict.value) return;
    // The unchanged-link branch precedes confirmation and cross-form
    // discard decisions. A no-op explains itself without sending an empty write.
    if (event.value.value === event.value.original) {
        command.setInformation('metadata.eventUnchanged');
        return;
    }
    if (!window.confirm(messages.value.t('packing.confirmEvent'))) return;
    // Relinking changes inherited access/archive state. Never abandon a properties draft to
    // perform it; the existing dialog requires the same explicit discard decision first.
    if (!(fields.value?.mayLeave() ?? true)) return;

    // Capture the reviewed choice before awaiting the write. Later settings reads must
    // not change the submitted target or its original relationship precondition.
    const submitted = {value: event.value.value, original: event.value.original, token: event.value.token};
    const previousRead = completedSettingsReads;
    relinkingMetadata = true;
    pendingAction.value = 'event';
    let result: components['schemas']['EntityEventChangeResult'] | undefined;
    try {
        result = await command.run((scope) =>
            api.linkEvent!(
                props.resourceId,
                {eventId: submitted.value, expectedEventId: submitted.original},
                submitted.token,
                scope,
            ),
            true, false, {success: 'metadata.eventUpdated'},
        );
    } finally {
        relinkingMetadata = false;
        pendingAction.value = null;
    }

    // The result may close this dialog entirely. Only a readable result can update
    // local presentation; receiveSettings separately adopts freshly read authority.
    if (result && !result.canView) {
        emit('accessLost');
        return;
    }
    if (result && event.value) {
        event.value.value = submitted.value;
        event.value.confirmed = submitted.value;
        if (completedSettingsReads > previousRead && last.value) receiveSettings(last.value, true);
    }
    // The command owner's refresh already updates related metadata. A failed read
    // keeps its existing recovery controls instead of throwing from this click handler.
}
function reviewEvent(): void {
    if (controlsPending.value || !event.value || !data.value) return;
    event.value.original = data.value.currentEvent?.id ?? null;
    event.value.token = data.value.settingsToken;
}

/** Explain direct versus inherited archival before issuing the existing lifecycle
 * command. These are shared resource actions; personal visibility and permanent
 * deletion remain separate operations with their own confirmation and authority. */
async function archive(restore: boolean): Promise<void> {
    if (blocked.value) return;
    // The admitted schedule flag selects the common restoration warning.
    // Explicit feature wording retains Event's distinct attached-entity details.
    pendingAction.value = 'archive';
    try {
        await lifecycle.archive(props.resourceId, restore, !!data.value?.archive.inherited,
            restore ? props.restoreConfirmation : props.archiveConfirmation, !!data.value?.archive.hasAutomaticSchedule);
    } finally {
        pendingAction.value = null;
    }
}

/** Automatic archival remains a separate shared lifecycle command. Resuming an
 * expired schedule requires the warning before its next run can archive. */
async function automate(paused: boolean): Promise<void> {
    if (blocked.value || !api.automate || !data.value?.capabilities.manageAutomation || !props.automationLabels) return;
    // Settings and child cards share confirmation/dispatch/feedback, while this
    // dialog retains current schedule admission and its related read dependencies.
    pendingAction.value = 'automation';
    try {
        await lifecycle.automate(props.resourceId, paused, props.automationLabels);
    } finally {
        pendingAction.value = null;
    }
}

/** Delete only after the command owner has approved departure of every mounted draft.
 * A confirmed deletion retains its destination through failed navigation, while
 * the original consent ends after the first delivery attempt. Recovery rechecks
 * current drafts and repeats only admitted reads/delivery; the controller owns deletion policy. */
async function remove(): Promise<void> {
    if (blocked.value) return;
    const scope = context.capture();
    pendingAction.value = 'remove';
    try {
        await removal.remove({operation: deleteResource, confirmation: 'packing.confirmDelete',
            success: props.deletedKey});
        // A confirmed DELETE has released this entity's editable state, even
        // when loading Overview failed. Close its obsolete modal so the common
        // read/navigation recovery remains reachable; sibling drafts keep their
        // own departure guards. Pending, rejected and unknown writes stay open.
        if (active && context.isCurrent(scope) && command.outcome.value?.confirmation === 'confirmed') emit('close');
    } finally {
        pendingAction.value = null;
    }
}

async function deleteResource(scope: FrontendRequestScope): Promise<string> {
    await api.deleteResource(props.resourceId, scope);
    return props.resourceId;
}

</script>

<template>
    <AppDialog
        :open="true"
        :title="messages.t('packing.edit')"
        :subtitle="data?.title ?? resourceTitle"
        :pending="controlsPending"
        @close="close"
    >
        <template #navigation
            ><div v-if="panels.length > 1" class="px-3 pt-3">
                <AppTabList v-model="panel" :tabs="panelTabs" :disabled="controlsPending"
                    class="nav-fill gap-1 entity-settings-nav" link-class="text-light" />
            </div>
            <span
                v-else-if="panels.length === 1"
                :id="'frontend-settings-tab-' + panels[0]!.key"
                class="visually-hidden"
                >{{ messages.t(panels[0]!.label) }}</span
            ></template
        >
        <!-- One receipt owner supplies shared notifications and contextual recovery. -->
        <div aria-live="polite">
            <CommandFeedback :feedback="command.feedback" :disabled="controlsPending" />
        </div>
        <StatusNotice v-if="settings.error.value" kind="warning"
            :last-updated-at="settings.data.value && !isReadDenial(settings.error.value) ? settings.dataUpdatedAt.value : undefined"
            :retry-at="retryAt" :read-error="settings.error.value">{{
            messages.t(settings.data.value ? 'state.stale' : 'state.loadFailed')
        }}</StatusNotice>
        <!-- Metadata can finish before settings (or vice versa). Neither read waits
             for the other's response, and each region keeps its own draft owner.
             This remains plain content until the authoritative tab list exists;
             changing its attributes preserves the same focused field nodes. -->
        <div
            v-if="showGeneral || image || retainedMetadata"
            v-show="showGeneral && panel === 'general'"
            id="frontend-settings-general"
            :role="data ? 'tabpanel' : undefined"
            :aria-labelledby="data ? 'frontend-settings-tab-general' : undefined"
        >
            <section v-if="showMetadata || retainedMetadata" v-show="showMetadata" class="mb-4">
                <component :is="metadataComponent"
                    ref="fields"
                    v-bind="metadataProps"
                    :disabled="!!blocked || !showMetadata"
                    :busy="controlsPending"
                    :active="showMetadata && panel === 'general'"
                    @saved="metadataSaved"
                    @access-lost="emit('accessLost')"
                />
            </section>
            <!-- A user's chosen File retains its actual chooser through
                 narrow grant loss. Hidden/disabled controls carry no old server
                 authority; regrant restores this same visible FileList. -->
            <EntityHeaderEditor v-if="data?.capabilities.editHeader || image"
                v-show="data?.capabilities.editHeader"
                input-id="frontend-header-image" :labels="headerLabels" :selected-file="image"
                :has-image="!!data?.headerUrl" :expanded="!data?.editableFields.length"
                :conflict="headerConflict" :disabled="!!blocked || !data?.capabilities.editHeader" :reading="settings.isFetching.value"
                :upload-pending="pendingAction === 'upload' && command.pending.value"
                :remove-pending="pendingAction === 'removeImage' && command.pending.value"
                @choose="chooseImage" @review="reviewHeader" @upload="upload" @remove="removeImage" />
        </div>
        <LoadingSkeleton v-if="initialLoading" variant="form" :rows="3" />
        <template v-if="data">
            <section
                v-if="data.capabilities.linkEvent && event && api.eventPicker"
                v-show="panel === 'event'"
                id="frontend-settings-event"
                class="mb-4"
                role="tabpanel"
                aria-labelledby="frontend-settings-tab-event"
                data-entity-section="event"
            >
                <EntityEventEditor v-model="event.value" :original="event.original"
                    :current="data.currentEvent ?? null" :source="api.eventPicker" prefix="settings"
                    :title="messages.t('packing.linkedEvent')" :hint="messages.t('packing.eventHint')"
                    :extra-hint="eventExtraHint"
                    :submit-label="messages.t('packing.saveEvent')" :active="panel === 'event'"
                    :conflict="eventConflict" :disabled="!!blocked" :pending="pendingAction === 'event' && command.pending.value"
                    @review="reviewEvent" @save="saveEvent" />
            </section>
            <EntityAccessEditor v-if="data.access && accessSetup" ref="accessEditor" v-show="panel === 'access'"
                :settings="data" :resource-id="resourceId" :command="command" :operations="accessSetup.operations"
                :profile-key="accessSetup.profileKey" :profile-family="accessSetup.profileFamily" :blocked="!!blocked"
                :controls-pending="!!controlsPending" />
            <div
                v-show="panel === 'actions'"
                id="frontend-settings-actions"
                role="tabpanel"
                aria-labelledby="frontend-settings-tab-actions"
            >
                <EntityLifecycleActions :labels="lifecycleLabels" :direct="data.archive.direct"
                    :inherited="data.archive.inherited" :event-url="data.archive.eventUrl"
                    :manage-archive="data.capabilities.manageArchive" :can-archive="data.capabilities.archive"
                    :can-restore="data.capabilities.restore" :can-duplicate="data.capabilities.duplicate"
                    :can-remove="data.capabilities.remove" :duplicate-to="duplicateTo"
                    :context-hint="data.currentEvent ? linkedEventArchiveHint : undefined"
                    :export-link="data.capabilities.export ? exportLink : undefined"
                    :automation="data.capabilities.manageAutomation && api.automate && automationLabels ? {paused: data.archive.autoArchivePaused,
                        pauseLabel: automationLabels.pause, resumeLabel: automationLabels.resume, pausedHint: automationLabels.pausedHint} : undefined"
                    :disabled="!!blocked"
                    :remove-disabled="removal.action.disabled.value"
                    :pending-action="command.pending.value
                        && (pendingAction === 'archive' || pendingAction === 'automation' || pendingAction === 'remove')
                        ? pendingAction : null"
                    @archive="archive" @remove="remove" @automate="automate" />
            </div>
        </template>
        <template #footer
            ><ActionButton
                v-if="settings.error.value || command.uncertain.value || fields?.unknown || awaitingAuthority || command.notice.value === 'state.savedRefreshFailed'"
                variant="outline-secondary"
                :state="refreshAction"
                @click="refreshSettings"
                >{{ messages.t('common.refresh') }}</ActionButton
            ><ActionButton variant="secondary" :disabled="busy || !!destination.target.value" @click="close">{{
                messages.t('common.close')
            }}</ActionButton></template
        >
    </AppDialog>
</template>
