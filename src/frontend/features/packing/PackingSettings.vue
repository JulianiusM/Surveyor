<script setup lang="ts">
import {computed, onBeforeUnmount, ref, watch} from 'vue';
import {useRouter} from 'vue-router';
import {useQuery} from '@tanstack/vue-query';
import type {components} from '../../../types/api/v1';
import type {MessageKey} from '../../../types/LocalizationTypes';
import type {EntityHeaderLabels, EntityLifecycleLabels} from '../../../types/FrontendEntitySettingsTypes';
import type {PilotMetadataSnapshot, PilotRequestScope} from '../../../types/FrontendPilotUiTypes';
import {permissionLabel as translatedPermissionLabel} from '../../../modules/localization/permissionLabels';
import {usePackingApi} from './api';
import {usePilot, refreshInterval} from '../../app/context';
import {isReadDenial} from '../../app/transport';
import {useCommand} from '../../composables/command';
import {useReadRetry, useReadRetryAt} from '../../composables/feedback';
import {useConfirmedNavigation} from '../../composables/pageEntry';
import {useDebouncedValue} from '../../composables/debounced';
import {MetadataDraft} from '../../composables/metadataDraft';
import {packingKeys} from '../../app/queryKeys';
import {observeQueryReads, refetchFreshQuery, retireQueryFamily, useQueryAdmission} from '../../app/queryCache';
import ActionButton from '../../components/ActionButton.vue';
import AppDialog from '../../components/AppDialog.vue';
import StatusNotice from '../../components/StatusNotice.vue';
import LoadingSkeleton from '../../components/LoadingSkeleton.vue';
import AppTabList from '../../components/AppTabList.vue';
import MetadataFields from './MetadataFields.vue';
import EntityHeaderEditor from '../../components/EntityHeaderEditor.vue';
import EntityEventEditor from '../../components/EntityEventEditor.vue';
import EntityLifecycleActions from '../../components/EntityLifecycleActions.vue';
import AudiencePermissions from '../../components/permissions/AudiencePermissions.vue';
import PermissionFields from '../../components/permissions/PermissionFields.vue';

// The detail's metadata capability schedules its independent read early. It never
// grants fields or commands; each metadata response supplies its own authority/token.
const props = defineProps<{listId: string; listTitle?: string; metadataAvailable?: boolean}>();
const emit = defineEmits<{close: []; saved: []; accessLost: []}>();
const context = usePilot();
const api = usePackingApi(context);
const {messages} = context;
// Shared panels receive catalog wording and admitted presentation. Packing retains
// the draft/token and command owners, including each field's deliberate exceptions.
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
const router = useRouter();
const destination = useConfirmedNavigation();
let releaseDeparture: (() => void) | undefined;
let active = true;
onBeforeUnmount(retireEditor);

/** A denied read can retire this dialog before its admitted command settles.
 * Keep that command's root status/confirmed consent, but start no new editor reads. */
function retireEditor(): void {
    active = false;
    releaseUnconfirmedDeparture();
}
type Settings = components['schemas']['PackingSettings'];
type Defaults = components['schemas']['PermissionDefaults'];
type DefaultsSnapshot = PilotMetadataSnapshot<Defaults>;
const panel = ref(props.metadataAvailable === true ? 'general' : '');
const accessPanel = ref('defaults');
const fields = ref<InstanceType<typeof MetadataFields> | null>(null);
const image = ref<File | null>(null);
const addOpen = ref(false);
const profileQuery = ref('');
const profileSearchInput = ref('');
const profileSearch = useDebouncedValue(profileSearchInput);
const selectedProfile = ref('');
const preset = ref('');
const openAdmin = ref<string | null>(null);
// A confirmed write may outlive its failed read. Keep its clean local value separate
// from the last authoritative original/token until a successful read supplies authority.
const defaults = ref<MetadataDraft<Defaults, DefaultsSnapshot> | null>(null);
const admins = ref<Record<string, {original: number; value: number; token: string; name: string;
    isGuest: boolean; regrantReviewed?: boolean; confirmed?: number}>>({});
const event = ref<{original: string | null; value: string | null; token: string;
    confirmed?: string | null} | null>(null);
const imageToken = ref<string | null>(null);
const imageOriginal = ref<string | null>(null);
const jitter = context.browser ? Math.round(Math.random() * 3000) : 0;
const settingsKey = computed(() => packingKeys.settings(context.session.value?.context, props.listId));
const settingsAdmission = useQueryAdmission(context, settingsKey,
    computed(() => context.hydrated.value && context.visible.value));
const settings = useQuery({
    queryKey: settingsKey,
    ...settingsAdmission,
    queryFn: ({signal}) => api.settings(props.listId, context.capture(), signal),
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
    receiveDefaults(value);
    receiveAdmins(value);

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
    return !!defaults.value?.awaitingAuthority || event.value?.confirmed !== undefined
        || Object.values(admins.value).some(draft => draft.confirmed !== undefined);
}

/** The authorized Access projection admits all four audience fields. Keep that
 * feature mapping here; generic draft reconciliation owns neither audiences nor grants. */
function defaultsSnapshot(values: Defaults): DefaultsSnapshot {
    return {values, editableFields: ['participant', 'guest', 'authenticated', 'public']};
}

/** Audience controls retain their native independent review: untouched remote masks
 * appear immediately, and an overlapping local mask keeps its original/token. The
 * shared draft owner supplies sparse PATCH, equality and confirmation mechanics. */
function receiveDefaults(value: Settings): void {
    if (!value.access) return;
    const snapshot = defaultsSnapshot(value.access.defaults);
    const draft = defaults.value;
    if (!draft) defaults.value = new MetadataDraft(snapshot, value.settingsToken);
    else draft.receiveIndependent(snapshot, value.settingsToken);
}

/** Reconcile admitted administrator rows without overwriting entered masks.
 * Removed edited/regrant drafts stay reviewable. Edited confirmed drafts adopt
 * a new token only when the current server mask confirms that baseline; pristine
 * rows adopt the admitted server state directly. */
function receiveAdmins(value: Settings): void {
    if (!value.access) return;

    // First retire absent pristine rows. Keep a changed mask or deliberately
    // reviewed regrant so remote removal cannot silently discard that local choice.
    const active = new Set(value.access.admins.map((admin) => admin.profileId));
    for (const id of Object.keys(admins.value)) {
        const draft = admins.value[id]!;
        if (!active.has(id) && draft.value === (draft.confirmed ?? draft.original)
            && !draft.regrantReviewed) delete admins.value[id];
    }

    // Then admit current rows: clean drafts can fully adopt server state, while
    // edited drafts retain their local value and original comparison evidence.
    for (const admin of value.access.admins) {
        const draft = admins.value[admin.profileId];
        if (!draft || draft.value === (draft.confirmed ?? draft.original)) {
            admins.value[admin.profileId] = {
                original: admin.mask,
                value: admin.mask,
                token: admin.editToken,
                name: admin.name,
                isGuest: admin.isGuest,
            };
        } else if (draft.confirmed !== undefined) {
            // A completed command acknowledges this baseline, not newer authority.
            // Adopt the read token only when it agrees with that confirmed mask;
            // otherwise the differing remote mask still needs deliberate Review.
            draft.original = draft.confirmed;
            delete draft.confirmed;
            if (draft.original === admin.mask) draft.token = admin.editToken;
        }
    }
}
watch(settings.error, (failure) => {
    if (isReadDenial(failure)) emit('accessLost');
});
const data = computed(() => settings.data.value ?? last.value);
const initialLoading = computed(() => !data.value && settings.isPending.value);
const showMetadata = computed(() => data.value ? !!data.value.editableFields.length : props.metadataAvailable === true);
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
            enabled: state.capabilities.managePermissions && state.access,
        },
        {
            key: 'actions',
            label: 'packing.actions' as const,
            icon: 'bi-three-dots',
            enabled:
                state.capabilities.manageArchive || state.capabilities.duplicate || state.capabilities.remove,
        },
    ].filter((candidate) => candidate.enabled);
});
const panelTabs = computed(() => panels.value.map(tab => ({...tab, label: messages.value.t(tab.label),
    id: 'pilot-settings-tab-' + tab.key, controls: 'pilot-settings-' + tab.key})));
const showGeneral = computed(() => panels.value.some(tab => tab.key === 'general') || (!data.value && showMetadata.value));
const accessTabs = computed(() => [
    {key: 'defaults', label: messages.value.t('packing.groupPermissions'), id: 'pilot-access-defaults-tab', controls: 'pilot-access-defaults'},
    {key: 'admins', label: messages.value.t('packing.administrators'), id: 'pilot-access-admins-tab', controls: 'pilot-access-admins'},
]);
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
    const resource = props.listId;
    const result = await refetchFreshQuery<Settings>(context.queryClient, settingsKey.value, refetchSettings, mayRead);
    if (!active || resource !== props.listId || !context.isCurrent(scope)) return;
    receiveSettings(result, true);
    completedSettingsReads++;
    // Refresh related snapshots after a confirmed settings write. Each dirty form compares
    // only its own edited fields; unrelated setup changes do not manufacture conflicts.
    await fields.value?.refreshAfterSettings(relinkingMetadata && command.outcome.value?.confirmation === 'confirmed');
    if (active && resource === props.listId && context.isCurrent(scope)) emit('saved');

    function mayRead(): boolean {
        return active && resource === props.listId && context.mayRead(scope);
    }
}
const command = useCommand(refreshAfterCommand, false, {
    dirty: () => dirty.value || !!fields.value?.dirty,
    busy: () => !!busy.value,
    uncertain: () => !!fields.value?.unknown,
    unknownMessage: 'draft.leaveUnknown',
});
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
// Native commands lock the entire modal, including its navigation and nested tabs.
// Uncertainty alone keeps those tabs reachable so another panel cannot hide recovery.
const controlsPending = computed(() => !!busy.value || !!destination.target.value);
const awaitingAuthority = computed(() => awaitingSettingsAuthority() || !!fields.value?.awaitingAuthority);
const blocked = computed(
    () => busy.value || command.uncertain.value || fields.value?.unknown || awaitingAuthority.value || !!destination.target.value,
);
/** A confirmed metadata save stays confirmed even if its related settings read fails. */
async function metadataSaved(): Promise<void> {
    // Complete the current-value read before another panel sends a command.
    refreshingSettings.value = true;
    try {
        const scope = context.capture();
        const resource = props.listId;
        const result = await refetchFreshQuery<Settings>(context.queryClient, settingsKey.value, refetchSettings, mayRead);
        if (active && resource === props.listId && context.isCurrent(scope)) receiveSettings(result, true);

        function mayRead(): boolean {
            return active && resource === props.listId && context.mayRead(scope);
        }
    } catch {
        command.notice.value = 'state.savedRefreshFailed';
    } finally {
        refreshingSettings.value = false;
        emit('saved');
    }
}
const dirtyDefaults = computed(() => !!defaults.value?.dirty);
const defaultsPatch = computed<components['schemas']['PermissionDefaultsPatch']>(() => defaults.value?.patch ?? {});
const defaultsConflict = computed(() => !!defaults.value?.overlappingChanges);
const eventConflict = computed(() => !!event.value && event.value.original !== (data.value?.currentEvent?.id ?? null));
const headerConflict = computed(() => !!image.value && imageOriginal.value !== (data.value?.headerVersion ?? null));
/** Keep remote removal distinct from mask changes and an explicitly reviewed regrant.
 * A removed row remains a conflict until reviewed; a row restored meanwhile invalidates
 * that regrant review so its new saved grant cannot be overwritten accidentally. */
function adminConflict(id: string): boolean {
    const current = data.value?.access?.admins.find(admin => admin.profileId === id);
    const draft = admins.value[id];
    if (!draft) return false;

    // A current row compares its saved mask, whereas an absent row needs deliberate
    // regrant review. Reviewing never writes or resurrects the administrator itself.
    return current ? Boolean(draft.regrantReviewed) || draft.original !== current.mask : !draft.regrantReviewed;
}

/** Retry related reads explicitly; reconciliation never repeats the saved or uncertain write. */
async function refreshSettings(): Promise<void> {
    if (busy.value || !retryAvailable.value) return;
    refreshingSettings.value = true;
    const scope = context.capture();
    try {
        const reconciled = await command.reconcile();
        if (reconciled && context.isCurrent(scope)) {
            command.clearRecoveredError('state.loadFailed');
        }
    } catch {
        // A dependent metadata read can fail while settings itself remains readable.
        // Preserve that recovery warning until a matching read succeeds, not flash expiry.
        if (context.isCurrent(scope)) command.setError('state.loadFailed', 'durable');
    } finally {
        refreshingSettings.value = false;
    }
}
/** Retain a removed administrator's local draft beside current admitted rows so
 * the user can review removal without silently losing or recreating the grant. */
const displayedAdmins = computed(() => {
    // Current rows supply authoritative display; only absent draft rows supplement
    // them. Their retained original mask/token remains unavailable for blind saving.
    const current = data.value?.access?.admins ?? [];
    const active = new Set(current.map(admin => admin.profileId));
    return [...current, ...Object.entries(admins.value).filter(([id]) => !active.has(id))
        .map(([profileId, draft]) => ({profileId, name: draft.name, isGuest: draft.isGuest,
            mask: draft.original, editToken: draft.token}))];
});
/** Describe a retained draft's absence from the currently admitted ACL projection. */
function adminRemoved(id: string): boolean {
    // A local draft is not evidence that the saved administrator still exists.
    return !data.value?.access?.admins.some(admin => admin.profileId === id);
}

/** Count the saved grant, rather than its unsaved checkbox draft, for the native badge. */
function adminPermissionCount(mask: number): number {
    let count = 0;
    for (const permission of data.value?.access?.permissions ?? []) {
        if (mask & permission.bit) count++;
    }
    return count;
}

/** A removed grant stays visible for review even when its local mask is unchanged.
 * Existing grants warn only when local work overlaps the current server grant. */
function hasAdminWarning(id: string): boolean {
    if (adminRemoved(id)) return true;
    const draft = admins.value[id];
    return !!draft && (draft.value !== draft.original || draft.regrantReviewed === true) && adminConflict(id);
}

/** Keep removal/regrant feedback in this feature owner; the template only renders its key. */
function adminWarningMessage(id: string): MessageKey {
    if (!adminRemoved(id)) return 'draft.readConflict';
    if (admins.value[id]?.regrantReviewed) return 'packing.adminRegrantReviewed';
    return 'packing.adminRemoved';
}

function reviewHeader(): void {
    if (controlsPending.value) return;
    imageToken.value = data.value?.settingsToken ?? null;
    imageOriginal.value = data.value?.headerVersion ?? null;
}
const dirty = computed(
    () =>
        !!image.value ||
        (addOpen.value && (!!profileQuery.value || !!preset.value)) ||
        dirtyDefaults.value ||
        event.value?.value !== (event.value?.confirmed !== undefined ? event.value.confirmed : event.value?.original) ||
        Object.values(admins.value).some((draft) => draft.value !== (draft.confirmed ?? draft.original)
            || draft.regrantReviewed),
);
const profileKey = computed(() => packingKeys.profiles(context.session.value?.context, props.listId, profileSearch.value));
const profileAdmission = useQueryAdmission(context, profileKey,
    computed(() => addOpen.value && context.hydrated.value && context.visible.value && !!profileSearch.value));
const profiles = useQuery({
    queryKey: profileKey,
    ...profileAdmission,
    queryFn: ({signal}) => api.profiles(props.listId, profileSearch.value, context.capture(), signal),
    refetchInterval: (query) => addOpen.value && context.mayRead() && context.visible.value
        ? refreshInterval(query.state.error, query.state.fetchFailureCount, jitter) : false,
});
const profileRetryAvailable = useReadRetry(() => profiles.error.value);
const profileRetryAt = useReadRetryAt(() => profiles.error.value, profileRetryAvailable);
watch(profiles.error, retireDeniedProfiles, {flush: 'sync'});

/** Discovery owns only these suggestions and the selected returned identity.
 * Its denial does not revoke the independently admitted Settings projection or
 * discard typed search/preset drafts. Retire every search's protected cache body
 * while preserving the mounted query's explicit read recovery. */
function retireDeniedProfiles(failure: Error | null): void {
    if (!isReadDenial(failure)) return;
    selectedProfile.value = '';
    void retireQueryFamily(context.queryClient,
        packingKeys.profilesFamily(context.session.value?.context, props.listId), failure);
}

async function retryProfiles(): Promise<void> {
    if (!active || !addOpen.value || !context.mayRead() || profiles.isFetching.value || !profileRetryAvailable.value) return;
    await profiles.refetch({cancelRefetch: false});
}
function profileOptionValue(profile: components['schemas']['PackingProfileOption']): string {
    return profile.username || profile.profileId;
}
/** Only an exact current discovery result can supply the target profile ID.
 * Denied or freely edited text clears that target immediately, preventing an
 * old datalist selection from surviving a revoked/changed search projection. */
function selectMatchingProfile(): boolean {
    const match = isReadDenial(profiles.error.value) ? undefined : profiles.data.value?.find(
        (profile) => profileOptionValue(profile) === profileQuery.value.trim(),
    );
    selectedProfile.value = match?.profileId ?? '';
    return !!match;
}
watch(profileQuery, () => {
    // A datalist choice is the returned username (or ID for guests without email).
    // Retain that result set when selected; searching the display text again can
    // lose a valid choice. Arbitrary edits immediately remove its saved identity.
    if (!selectMatchingProfile()) profileSearchInput.value = profileQuery.value.trim();
});
watch(profiles.data, selectMatchingProfile);
function cancelAddAdmin(): void {
    addOpen.value = false;
    profileQuery.value = '';
    profileSearchInput.value = '';
    selectedProfile.value = '';
    preset.value = '';
}
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
async function upload(source?: Event): Promise<void> {
    if (blocked.value || headerConflict.value) return;

    // Native missing-file feedback happens before a request. The chosen file's
    // retained token must still exist; a later settings read cannot replace it.
    if (!image.value) {
        command.captureFeedback(source);
        command.setError('metadata.chooseImage', 'transient', 'inline');
        return;
    }
    if (!imageToken.value) return;

    // The shared command distinguishes write confirmation from refresh failure.
    // Rejection/unknown delivery keeps the file; confirmation alone releases it.
    const result = await command.run((scope) =>
        api.uploadHeader(props.listId, image.value!, imageToken.value!, scope),
        true, false, {initiator: source, presentation: 'inline', success: 'metadata.imageUpdated'},
    );
    // The shared chooser observes this explicit draft release. Clear its visible
    // FileList after confirmation as well, including a saved-but-stale read result.
    if (result) image.value = null;
}

/** Header removal is a separate reviewed command, not clearing the file draft.
 * The current settings token protects the stored image and the server retains
 * authority over the write and its post-commit file cleanup. */
async function removeImage(source?: Event): Promise<void> {
    if (data.value && window.confirm(messages.value.t('packing.confirmRemoveImage'))) {
        await command.run((scope) =>
            api.removeHeader(props.listId, data.value!.settingsToken, scope),
            true, false, {initiator: source, presentation: 'inline', success: 'metadata.imageRemoved'},
        );
    }
}
/** Relink one explicitly reviewed event choice through the existing command owner.
 * The accepted value is presentation only; a completed settings read supplies any new
 * comparison token. Relinking can revoke access and must preserve other editor drafts. */
async function saveEvent(source?: Event): Promise<void> {
    if (!event.value || blocked.value || eventConflict.value) return;
    // The native unchanged-link branch precedes confirmation and cross-form
    // discard decisions. A no-op explains itself without sending an empty write.
    if (event.value.value === event.value.original) {
        command.setInformation('metadata.eventUnchanged', {initiator: source, presentation: 'inline'});
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
    let result: components['schemas']['PackingEventChanged'] | undefined;
    try {
        result = await command.run((scope) =>
            api.linkEvent(
                props.listId,
                {eventId: submitted.value, expectedEventId: submitted.original},
                submitted.token,
                scope,
            ),
            true, false, {initiator: source, presentation: 'inline', success: 'metadata.eventUpdated'},
        );
    } finally {
        relinkingMetadata = false;
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
function reviewDefaults(): void {
    if (controlsPending.value || !defaults.value || !data.value?.access) return;
    // Native permission Review retains every entered mask as one explicit choice.
    // Metadata's per-field Mine/Current controls remain a separate presentation.
    const draft = defaults.value;
    draft.offerReview(defaultsSnapshot(data.value.access.defaults), data.value.settingsToken);
    for (const audience of draft.conflicts) draft.choices[audience] = 'mine';
    draft.review();
}
/** Save the sparse changed audience masks, retaining accepted presentation after a
 * failed follow-up read. A confirmed mask never manufactures a replacement write token. */
async function saveDefaults(source?: Event): Promise<void> {
    if (!defaults.value || blocked.value || defaultsConflict.value) return;
    if (!Object.keys(defaultsPatch.value).length) {
        // Sparse conditional commands preserve the no-empty-PATCH boundary.
        // A pristine save retains native permission feedback and renews its receipt.
        command.setNotice('permissions.updated', {initiator: source, presentation: 'inline'});
        return;
    }

    // Values, sparse patch and token belong to the same reviewed submission. A read
    // completing while the request waits cannot silently change that write's inputs.
    const submitted = {...defaults.value.values};
    const patch = {...defaultsPatch.value};
    const token = defaults.value.etag;
    const previousRead = completedSettingsReads;
    const result = await command.run((scope) =>
        api.setDefaults(props.listId, patch, token, scope),
        true, false, {initiator: source, presentation: 'inline', success: 'permissions.updated'},
    );

    // Show the confirmed choice even when refresh failed. If a newer settings read
    // did complete, reconcile its authoritative values and tokens through their owner.
    if (result && defaults.value) {
        defaults.value.confirm(defaultsSnapshot(submitted));
        if (completedSettingsReads > previousRead && last.value) receiveDefaults(last.value);
    }
}
/** Adopt current comparison evidence without replacing the entered permission
 * mask. A missing remote row needs explicit regrant consent; an existing zero
 * mask remains a real grant and follows its own administrator token. */
function reviewAdmin(id: string): void {
    if (controlsPending.value) return;
    const current = data.value?.access?.admins.find((admin) => admin.profileId === id);
    if (current && admins.value[id] && data.value) {
        admins.value[id]!.original = current.mask;
        admins.value[id]!.token = current.editToken;
        admins.value[id]!.regrantReviewed = false;
    } else if (!current && admins.value[id] && data.value?.access) {
        // The current settings snapshot proves only that this grant is absent. Reviewing
        // retains the requested mask and admits a deliberate new grant on the next Save.
        admins.value[id]!.token = data.value.settingsToken;
        admins.value[id]!.regrantReviewed = true;
    }
}
/** Save an existing named grant, or deliberately recreate a removed grant after Review.
 * Confirmation updates its local mask; only the newer settings projection admits later writes. */
async function saveAdmin(id: string, source?: Event): Promise<void> {
    const draft = admins.value[id];
    if (!draft || blocked.value || adminConflict(id)) return;

    // A removed row uses the reviewed root token; an existing row uses its own token.
    // The conflict gate requires explicit regrant review before addAdmin is reachable.
    const submitted = draft.value;
    const previousRead = completedSettingsReads;
    const result = await command.run((scope) =>
        adminRemoved(id)
            ? api.addAdmin(props.listId, {profileId: id, mask: submitted}, draft.token, scope)
            : api.updateAdmin(props.listId, id, submitted, draft.token, scope),
        true, false, {initiator: source, presentation: 'inline', success: 'permissions.updated'},
    );

    // Preserve the accepted mask independently of refresh, then reconcile a completed
    // newer read so concurrent grant changes cannot be hidden by the held write result.
    if (result && admins.value[id]) {
        admins.value[id]!.value = submitted;
        admins.value[id]!.confirmed = submitted;
        admins.value[id]!.regrantReviewed = false;
        if (completedSettingsReads > previousRead && last.value) receiveAdmins(last.value);
    }
}
/** A grant already removed remotely needs only local draft dismissal. Otherwise
 * confirm the server removal against that row's latest admitted mask token;
 * this does not silently acknowledge or recreate a conflicting permission draft. */
async function removeAdmin(id: string, source?: Event): Promise<void> {
    // Remote removal has already happened. Closing this retained local draft
    // issues no DELETE and must not accidentally recreate its reviewed mask.
    if (adminRemoved(id)) {
        delete admins.value[id];
        if (openAdmin.value === id) openAdmin.value = null;
        return;
    }

    // An existing row needs explicit confirmation and that admitted row's token.
    // The command owns refresh/error recovery instead of optimistically deleting it.
    if (data.value && window.confirm(messages.value.t('packing.confirmRemoveAdmin'))) {
        await command.run((scope) =>
            api.removeAdmin(props.listId, id, data.value!.access!.admins.find(admin => admin.profileId === id)!.editToken, scope),
            true, false, {initiator: source, presentation: 'inline', success: 'permissions.adminRemoved'},
        );
    }
}

/** Resolve the selected discovery result to its profile ID before granting a
 * preset. A rejected or unknown command keeps the selection for review; success
 * alone closes this form, without inferring authority from its display label. */
async function addAdmin(source?: Event): Promise<void> {
    if (!data.value?.access || blocked.value) return;

    // Discovery supplies the target ID; typed display text cannot select a grant.
    // Explain a missing choice locally before collecting a preset or issuing a write.
    if (!selectedProfile.value) {
        command.captureFeedback(source);
        command.setError('permissions.selectUser', 'transient', 'inline');
        return;
    }

    // Use the admitted preset and root baseline for a deliberate new grant.
    // Clear the form only after confirmation; unknown delivery retains its choice.
    const mask = data.value.access.presets.find((value) => value.key === preset.value)?.mask ?? 0;
    if (
        await command.run((scope) =>
            api.addAdmin(
                props.listId,
                {profileId: selectedProfile.value, mask},
                data.value!.settingsToken,
                scope,
            ),
            true, false, {initiator: source, presentation: 'inline', success: 'permissions.adminAdded'},
        )
    ) {
        cancelAddAdmin();
    }
}

/** Explain direct versus inherited archival before issuing the existing lifecycle
 * command. These are shared resource actions; personal visibility and permanent
 * deletion remain separate operations with their own confirmation and authority. */
async function archive(restore: boolean, source?: Event): Promise<void> {
    const confirmation = restore
        ? 'packing.confirmRestore'
        : data.value?.archive.inherited
          ? 'packing.confirmArchiveIndependent'
          : 'packing.confirmArchive';

    if (window.confirm(messages.value.t(confirmation))) {
        await command.run((scope) => api.archive(props.listId, restore, scope), true, false,
            {initiator: source, presentation: 'inline', success: restore ? 'overview.restored' : 'overview.archived'});
    }
}
/** Delete only after the command owner has approved departure of every mounted draft.
 * A confirmed deletion retains its destination/consent through failed navigation;
 * recovery repeats delivery, while the controller remains the deletion policy owner. */
async function remove(source?: Event): Promise<void> {
    if (blocked.value) return;
    const approval = command.prepareDeparture();
    if (!approval) return;
    if (!window.confirm(messages.value.t('packing.confirmDelete'))) {
        approval();
        return;
    }

    // Approve every mounted page/dialog draft before deletion. Consent releases no
    // values on rejection; after confirmation it covers only the ensuing departure.
    releaseDeparture = approval;
    const scope = context.capture();
    const origin = router.currentRoute.value.fullPath;
    try {
        const id = await command.run(deletePacking, false, false,
            {initiator: source, success: 'packing.deleted'});
        if (id) await destination.navigate('/frontend-pilot', scope, origin,
            {kind: 'success', messageKey: 'packing.deleted'});
    } finally {
        // A failed route delivery retains the confirmed destination and its approval.
        // Retry can only navigate; no DELETE or late discard prompt may run again.
        if (!destination.target.value) releaseApprovedDeparture();
    }
}

function releaseApprovedDeparture(): void {
    releaseDeparture?.();
    releaseDeparture = undefined;
}

/** A denied poll can close this editor after DELETE. Its confirmed departure consent
 * then remains with the root until navigation commits. Pending work releases through
 * remove's finally branch once its actual result is known; rejected work releases here. */
function releaseUnconfirmedDeparture(): void {
    if (!command.pending.value && command.outcome.value?.confirmation !== 'confirmed') releaseApprovedDeparture();
}

async function deletePacking(scope: PilotRequestScope): Promise<string> {
    await api.deletePacking(props.listId, scope);
    return props.listId;
}
/** Preserve the native two-letter avatar derived from the admitted display name. */
function initials(name: string): string {
    // Normalize word separators, then use the first two initials for the compact badge.
    return name
        .split(/\s+/u)
        .map((word) => word.charAt(0))
        .join('')
        .slice(0, 2)
        .toUpperCase();
}
/** Disclosure is local UI state, but native pending commands freeze it with the form.
 * Keep the same mounted draft when activation arrives while delivery is still pending. */
function toggleAddAdmin(): void {
    if (!controlsPending.value) addOpen.value = !addOpen.value;
}

/** An administrator's panel cannot be collapsed or switched during a submitted operation. */
function toggleAdmin(id: string): void {
    if (!controlsPending.value) openAdmin.value = openAdmin.value === id ? null : id;
}
function permissionLabel(key: string): string {
    return translatedPermissionLabel(key, messages.value.t);
}
</script>

<template>
    <AppDialog
        :open="true"
        :title="messages.t('packing.edit')"
        :subtitle="data?.title ?? listTitle"
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
                :id="'pilot-settings-tab-' + panels[0]!.key"
                class="visually-hidden"
                >{{ messages.t(panels[0]!.label) }}</span
            ></template
        >
        <!-- Native commands resolve their initiating section's feedback host. Keep
             one receipt owner here; only transient inline messages move to that host.
             Commands without a section use this same native modal fallback. -->
        <div data-dialog-feedback aria-live="polite">
            <StatusNotice v-if="command.error.value" :inline="command.errorPresentation.value === 'inline'"
                :kind="command.feedbackKind.value" :target="command.feedbackTarget.value"
                :disabled="controlsPending" :transient="command.transientError.value" :renewal="command.errorRenewal.value"
                @dismiss="command.setError(null)">{{ command.error.value }}</StatusNotice>
            <StatusNotice
                v-if="command.notice.value" :inline="command.noticeInline.value" :target="command.feedbackTarget.value" :disabled="controlsPending"
                :kind="command.noticeKind.value" :transient="command.transientNotice.value"
                :retry-at="command.notice.value === 'state.savedRefreshFailed' ? retryAt : undefined"
                :read-error="command.notice.value === 'state.savedRefreshFailed' ? settings.error.value : undefined"
                :notice="command.notice.value" :renewal="command.noticeRenewal.value" @dismiss="command.notice.value = null"
                >{{ messages.t(command.notice.value) }}</StatusNotice
            >
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
            v-if="showGeneral"
            v-show="panel === 'general'"
            id="pilot-settings-general"
            :role="data ? 'tabpanel' : undefined"
            :aria-labelledby="data ? 'pilot-settings-tab-general' : undefined"
        >
            <section v-if="showMetadata" class="mb-4">
                <MetadataFields
                    ref="fields"
                    :list-id="listId"
                    :list-title="data?.title ?? listTitle"
                    :disabled="!!blocked"
                    :busy="controlsPending"
                    :active="panel === 'general'"
                    @saved="metadataSaved"
                    @access-lost="emit('accessLost')"
                />
            </section>
            <EntityHeaderEditor v-if="data?.capabilities.editHeader"
                input-id="pilot-header-image" :labels="headerLabels" :selected-file="image"
                :has-image="!!data.headerUrl" :expanded="!data.editableFields.length"
                :conflict="headerConflict" :disabled="!!blocked" :reading="settings.isFetching.value"
                @choose="chooseImage" @review="reviewHeader" @upload="upload" @remove="removeImage" />
        </div>
        <LoadingSkeleton v-if="initialLoading" variant="form" :rows="3" />
        <template v-if="data">
            <section
                v-if="data.capabilities.linkEvent && event"
                v-show="panel === 'event'"
                id="pilot-settings-event"
                class="mb-4"
                role="tabpanel"
                aria-labelledby="pilot-settings-tab-event"
                data-entity-section="event"
            >
                <EntityEventEditor v-model="event.value" :original="event.original"
                    :current="data.currentEvent" :source="api.eventPicker" prefix="settings"
                    :title="messages.t('packing.linkedEvent')" :hint="messages.t('packing.eventHint')"
                    :submit-label="messages.t('packing.saveEvent')" :active="panel === 'event'"
                    :conflict="eventConflict" :disabled="!!blocked" @review="reviewEvent" @save="saveEvent" />
            </section>
            <section
                v-if="data.access && defaults"
                v-show="panel === 'access'"
                id="pilot-settings-access"
                role="tabpanel"
                aria-labelledby="pilot-settings-tab-access"
            >
                <AppTabList v-model="accessPanel" :tabs="accessTabs" :disabled="controlsPending" class="gap-1 mb-3" />
                <form
                    v-show="accessPanel === 'defaults'"
                    id="pilot-access-defaults"
                    role="tabpanel"
                    aria-labelledby="pilot-access-defaults-tab"
                    data-entity-section="permissions"
                    @submit.prevent="saveDefaults"
                >
                    <div data-command-feedback aria-live="polite"></div>
                    <AudiencePermissions
                        v-model="defaults.values"
                        :permissions="data.access.permissions"
                        :presets="data.access.presets"
                        prefix="settings-defaults"
                        :disabled="blocked"
                    />
                    <StatusNotice v-if="defaultsConflict" kind="warning"
                        ><p>{{ messages.t('draft.readConflict') }}</p>
                        <div class="pilot-conflict-values">
                            <dl>
                                <dt>{{ messages.t('draft.original') }}</dt>
                                <dd>{{ defaults.baseline.values }}</dd>
                            </dl>
                            <dl>
                                <dt>{{ messages.t('draft.mine') }}</dt>
                                <dd>{{ defaults.values }}</dd>
                            </dl>
                            <dl>
                                <dt>{{ messages.t('draft.current') }}</dt>
                                <dd>{{ data.access.defaults }}</dd>
                            </dl>
                        </div>
                        <ActionButton variant="outline-warning" :disabled="controlsPending" @click="reviewDefaults">{{
                            messages.t('draft.review')
                        }}</ActionButton></StatusNotice
                    >
                    <div class="d-flex justify-content-end border-top border-secondary pt-3">
                        <ActionButton
                            type="submit"
                            :disabled="blocked || (defaultsConflict)"
                            >{{ messages.t('packing.updatePermissions') }}</ActionButton
                        >
                    </div>
                </form>
                <div
                    v-show="accessPanel === 'admins'"
                    id="pilot-access-admins"
                    role="tabpanel"
                    aria-labelledby="pilot-access-admins-tab"
                    class="admin-matrix text-bg-dark"
                >
                    <div class="d-flex align-items-center justify-content-between mb-2">
                        <div class="d-flex align-items-center gap-2">
                            <i class="bi bi-shield-lock" aria-hidden="true"></i
                            ><strong>{{ messages.t('packing.administrators') }}</strong
                            ><span class="badge bg-secondary ms-1">{{ data.access.admins.length }}</span>
                        </div>
                        <ActionButton class="btn-sm" :disabled="controlsPending" @click="toggleAddAdmin"
                            ><i class="bi bi-person-plus me-1" aria-hidden="true"></i
                            >{{ messages.t('packing.add') }}</ActionButton
                        >
                    </div>
                    <div v-if="!data.access.admins.length" class="text-secondary small ms-1 mb-2">
                        {{ messages.t('packing.noAdministrators') }}
                    </div>
                    <div class="accordion accordion-flush">
                        <div
                            v-for="admin in displayedAdmins"
                            :key="admin.profileId"
                            class="accordion-item bg-dark border-secondary"
                            data-entity-section="administrator"
                        >
                            <h2 class="accordion-header">
                                <button
                                    class="accordion-button text-light bg-dark"
                                    :class="{collapsed: openAdmin !== admin.profileId}"
                                    type="button"
                                    :aria-expanded="openAdmin === admin.profileId"
                                    :disabled="controlsPending"
                                    @click="toggleAdmin(admin.profileId)"
                                >
                                    <span
                                        class="rounded-circle bg-secondary text-dark d-inline-flex justify-content-center align-items-center me-2"
                                        style="width: 24px; height: 24px; font-size: 12px"
                                        >{{ initials(admin.name) }}</span
                                    ><span class="me-2">{{ admin.name }}</span
                                    ><span class="badge bg-secondary ms-2"
                                        >{{ adminPermissionCount(admin.mask) }}/{{ data.access.permissions.length }}</span
                                    >
                                </button>
                            </h2>
                            <div v-show="openAdmin === admin.profileId" class="accordion-body bg-dark pt-2">
                                <div data-command-feedback aria-live="polite"></div>
                                <template v-if="admins[admin.profileId]">
                                    <PermissionFields
                                        v-model="admins[admin.profileId]!.value"
                                        :permissions="data.access.permissions"
                                        :presets="data.access.presets"
                                        :prefix="'admin-' + admin.profileId"
                                        :disabled="blocked"
                                    />
                                    <StatusNotice
                                        v-if="hasAdminWarning(admin.profileId)"
                                        kind="warning"
                                        ><p>{{ messages.t(adminWarningMessage(admin.profileId)) }}</p>
                                        <p>
                                            {{ messages.t('draft.original') }}:
                                            {{ admins[admin.profileId]!.original }} ·
                                            {{ messages.t('draft.mine') }}:
                                            {{ admins[admin.profileId]!.value }} ·
                                            <template v-if="!adminRemoved(admin.profileId)">{{ messages.t('draft.current') }}: {{ admin.mask }}</template>
                                        </p>
                                        <ActionButton
                                            v-if="adminConflict(admin.profileId)"
                                            variant="outline-warning"
                                            :disabled="controlsPending"
                                            @click="reviewAdmin(admin.profileId)"
                                            >{{ messages.t(adminRemoved(admin.profileId) ? 'packing.reviewAdminRegrant' : 'draft.review') }}</ActionButton
                                        ></StatusNotice
                                    >
                                    <!-- PermissionFields retains the last group's mb-3 inside its fieldset;
                                         avoid adding a second gap before the native Save/Remove row. -->
                                    <div class="d-flex justify-content-between">
                                        <ActionButton
                                            class="btn-sm"
                                            variant="outline-danger"
                                            :disabled="blocked"
                                            @click="removeAdmin(admin.profileId, $event)"
                                            ><i class="bi bi-trash me-1" aria-hidden="true"></i
                                            >{{ messages.t(adminRemoved(admin.profileId) ? 'packing.discardAdminDraft' : 'packing.removeAssignment') }}</ActionButton
                                        ><ActionButton
                                            class="btn-sm"
                                            :disabled="
                                                blocked ||
                                                adminConflict(admin.profileId)
                                            "
                                            @click="saveAdmin(admin.profileId, $event)"
                                            >{{ messages.t('common.save') }}</ActionButton
                                        >
                                    </div>
                                </template>
                            </div>
                        </div>
                    </div>
                    <form
                        v-show="addOpen"
                        class="mt-3 bg-dark text-light border border-secondary rounded p-3"
                        data-entity-section="administrator-add"
                        @submit.prevent="addAdmin"
                    >
                        <!-- Match the native inline form's title and field-group spacing. -->
                        <div class="mb-2">
                            <h5 class="modal-title">{{ messages.t('packing.addAdministrator') }}</h5>
                        </div>
                        <div data-command-feedback aria-live="polite"></div>
                        <StatusNotice v-if="profiles.error.value" kind="warning"
                            :last-updated-at="profiles.data.value ? profiles.dataUpdatedAt.value : undefined"
                            :retry-at="profileRetryAt" :read-error="profiles.error.value">
                            {{ messages.t(profiles.data.value ? 'state.stale' : 'state.loadFailed') }}
                            <ActionButton class="btn-sm ms-2" variant="outline-light" :pending="profiles.isFetching.value"
                                :disabled="!profileRetryAvailable" @click="retryProfiles">{{ messages.t('common.retry') }}</ActionButton>
                        </StatusNotice>
                        <div class="mb-3">
                            <label class="form-label" for="profile-search"
                                ><i class="bi bi-search me-1" aria-hidden="true" />{{
                                    messages.t('packing.profileSearch')
                                }}</label
                            ><input
                                id="profile-search"
                                v-model="profileQuery"
                                class="form-control text-bg-dark"
                                :placeholder="messages.t('packing.searchUser')"
                                :disabled="blocked"
                                list="profile-results"
                                @keydown.enter.prevent
                            />
                            <datalist id="profile-results">
                                <option
                                    v-for="profile in profiles.data.value ?? []"
                                    :key="profile.profileId"
                                    :value="profileOptionValue(profile)"
                                    :label="
                                        profile.name
                                            ? profile.name + ' <' + (profile.username || profile.profileId) + '>'
                                            : profileOptionValue(profile)
                                    "
                                /></datalist
                            ><small class="text-secondary d-block">{{ messages.t('packing.selectUser') }}</small>
                        </div>
                        <div class="mb-2">
                            <label class="form-label" for="initial-preset"
                                ><i class="bi bi-magic me-1" aria-hidden="true" />{{
                                    messages.t('packing.initialPreset')
                                }}</label
                            ><select
                                id="initial-preset"
                                v-model="preset"
                                class="form-select text-bg-dark"
                                :disabled="blocked"
                            >
                                <option value="">{{ messages.t('common.none') }}</option>
                                <option
                                    v-for="option in data.access.presets"
                                    :key="option.key"
                                    :value="option.key"
                                >
                                    {{ permissionLabel(option.key) }}
                                </option>
                            </select>
                        </div>
                        <div class="d-flex justify-content-end gap-2">
                            <ActionButton
                                variant="outline-secondary"
                                :disabled="blocked"
                                @click="cancelAddAdmin"
                                >{{ messages.t('common.cancel') }}</ActionButton
                            ><ActionButton type="submit" :disabled="blocked">{{
                                messages.t('packing.add')
                            }}</ActionButton>
                        </div>
                    </form>
                </div>
            </section>
            <div
                v-show="panel === 'actions'"
                id="pilot-settings-actions"
                role="tabpanel"
                aria-labelledby="pilot-settings-tab-actions"
            >
                <EntityLifecycleActions :labels="lifecycleLabels" :direct="data.archive.direct"
                    :inherited="data.archive.inherited" :event-url="data.archive.eventUrl"
                    :manage-archive="data.capabilities.manageArchive" :can-archive="data.capabilities.archive"
                    :can-restore="data.capabilities.restore" :can-duplicate="data.capabilities.duplicate"
                    :can-remove="data.capabilities.remove" :duplicate-to="'/frontend-pilot/packing/' + listId + '/duplicate'"
                    :disabled="!!blocked" @archive="archive" @remove="remove" />
            </div>
        </template>
        <template #footer
            ><ActionButton v-if="destination.target.value" variant="outline-secondary"
                :pending="destination.pending.value" @click="destination.retry">
                {{ messages.t('common.retry') }}
            </ActionButton
            ><ActionButton
                v-if="settings.error.value || command.uncertain.value || awaitingAuthority || command.notice.value === 'state.savedRefreshFailed'"
                variant="outline-secondary"
                :pending="refreshingSettings"
                :disabled="busy || !retryAvailable"
                @click="refreshSettings"
                >{{ messages.t('common.refresh') }}</ActionButton
            ><ActionButton variant="secondary" :disabled="busy || !!destination.target.value" @click="close">{{
                messages.t('common.close')
            }}</ActionButton></template
        >
    </AppDialog>
</template>
