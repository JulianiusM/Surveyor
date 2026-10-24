<script setup lang="ts">
import {computed, onBeforeUnmount, ref, watch} from 'vue';
import {useQuery} from '@tanstack/vue-query';
import type {components} from '../../types/api/v1';
import type {MessageKey} from '../../types/LocalizationTypes';
import type {PilotMetadataSnapshot} from '../../types/FrontendPilotUiTypes';
import type {EntityAccessEditorProps} from '../../types/FrontendEntityAccessTypes';
import {permissionLabel as translatedPermissionLabel} from '../../modules/localization/permissionLabels';
import {useActionState, usePilot, refreshInterval} from '../app/context';
import {isReadDenial} from '../app/transport';
import {retireQueryFamily, useQueryAdmission} from '../app/queryCache';
import {useDebouncedValue} from '../composables/debounced';
import {MetadataDraft} from '../composables/metadataDraft';
import {useReadRetry, useReadRetryAt} from '../composables/feedback';
import ActionButton from './ActionButton.vue';
import AppTabList from './AppTabList.vue';
import StatusNotice from './StatusNotice.vue';
import AudiencePermissions from './permissions/AudiencePermissions.vue';
import PermissionFields from './permissions/PermissionFields.vue';
import AppAccordionButton from './AppAccordionButton.vue';

// Inject feature operations and the complete-dialog command owner. Access drafts,
// discovery and native presentation are shared; server owners still decide grants.
const props = defineProps<EntityAccessEditorProps>();
const context = usePilot();
const {messages} = context;
const command = props.command;
const api = props.operations;
const data = computed(() => props.settings);
const blocked = computed(() => props.blocked);
const controlsPending = computed(() => props.controlsPending);
// The dialog's command is shared across panels and rows. Keep only the local
// initiating presentation identity, so blocked siblings never claim its focus.
const pendingAction = ref<{kind: 'defaults' | 'add' | 'save' | 'remove'; id?: string} | null>(null);
type Settings = EntityAccessEditorProps['settings'];
type Defaults = components['schemas']['PermissionDefaults'];
type DefaultsSnapshot = PilotMetadataSnapshot<Defaults>;
const accessPanel = ref('defaults');
const jitter = context.browser ? Math.round(Math.random() * 3000) : 0;
let active = true;
let completedSettingsReads = 0;
const last = ref<Settings | null>(null);
onBeforeUnmount(() => { active = false; });
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
const accessTabs = computed(() => [
    {key: 'defaults', label: messages.value.t('packing.groupPermissions'), id: 'pilot-access-defaults-tab', controls: 'pilot-access-defaults'},
    {key: 'admins', label: messages.value.t('packing.administrators'), id: 'pilot-access-admins-tab', controls: 'pilot-access-admins'},
]);
const dirtyDefaults = computed(() => !!defaults.value?.dirty);
const defaultsPatch = computed<components['schemas']['PermissionDefaultsPatch']>(() => defaults.value?.patch ?? {});
const defaultsConflict = computed(() => !!defaults.value?.overlappingChanges);
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

const profileKey = computed(() => props.profileKey(profileSearch.value));
const profileAdmission = useQueryAdmission(context, profileKey,
    computed(() => addOpen.value && context.hydrated.value && context.visible.value && !!profileSearch.value));
const profiles = useQuery({
    queryKey: profileKey,
    ...profileAdmission,
    queryFn: ({signal}) => api.profiles(props.resourceId, profileSearch.value, context.capture(), signal),
    refetchInterval: (query) => addOpen.value && context.mayRead() && context.visible.value
        ? refreshInterval(query.state.error, query.state.fetchFailureCount, jitter) : false,
});
const profileRetryAvailable = useReadRetry(() => profiles.error.value);
const profileRetryAt = useReadRetryAt(() => profiles.error.value, profileRetryAvailable);
watch(profiles.error, retireDeniedProfiles, {flush: 'sync'});

const profileRetryAction = useActionState({eligible: mayRetryProfiles, pending: () => profiles.isFetching.value});

watch(profileQuery, () => {
    // A datalist choice is the returned username (or ID for guests without email).
    // Retain that result set when selected; searching the display text again can
    // lose a valid choice. Arbitrary edits immediately remove its saved identity.
    if (!selectMatchingProfile()) profileSearchInput.value = profileQuery.value.trim();
});
watch(profiles.data, selectMatchingProfile);

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

/** Discovery owns only these suggestions and the selected returned identity.
 * Its denial does not revoke the independently admitted Settings projection or
 * discard typed search/preset drafts. Retire every search's protected cache body
 * while preserving the mounted query's explicit read recovery. */
function retireDeniedProfiles(failure: Error | null): void {
    if (!isReadDenial(failure)) return;
    selectedProfile.value = '';
    void retireQueryFamily(context.queryClient,
        props.profileFamily, failure);
}

function mayRetryProfiles(): boolean {
    return active && addOpen.value && context.mayRead() && profileRetryAvailable.value;
}

async function retryProfiles(): Promise<void> {
    if (!profileRetryAction.isAvailable()) return;
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

function cancelAddAdmin(): void {
    addOpen.value = false;
    profileQuery.value = '';
    profileSearchInput.value = '';
    selectedProfile.value = '';
    preset.value = '';
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
async function saveDefaults(): Promise<void> {
    if (!defaults.value || blocked.value || defaultsConflict.value) return;
    if (!Object.keys(defaultsPatch.value).length) {
        // Sparse conditional commands preserve the no-empty-PATCH boundary.
        // A pristine save retains native permission feedback and renews its receipt.
        command.setNotice('permissions.updated');
        return;
    }

    // Values, sparse patch and token belong to the same reviewed submission. A read
    // completing while the request waits cannot silently change that write's inputs.
    const submitted = {...defaults.value.values};
    const patch = {...defaultsPatch.value};
    const token = defaults.value.etag;
    const previousRead = completedSettingsReads;
    pendingAction.value = {kind: 'defaults'};
    let result: unknown;
    try {
        result = await command.run((scope) =>
            api.setDefaults(props.resourceId, patch, token, scope),
            true, false, {success: 'permissions.updated'},
        );
    } finally {
        pendingAction.value = null;
    }

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
async function saveAdmin(id: string): Promise<void> {
    const draft = admins.value[id];
    if (!draft || blocked.value || adminConflict(id)) return;

    // A removed row uses the reviewed root token; an existing row uses its own token.
    // The conflict gate requires explicit regrant review before addAdmin is reachable.
    const submitted = draft.value;
    const previousRead = completedSettingsReads;
    pendingAction.value = {kind: 'save', id};
    let result: unknown;
    try {
        result = await command.run((scope) =>
            adminRemoved(id)
                ? api.addAdmin(props.resourceId, {profileId: id, mask: submitted}, draft.token, scope)
                : api.updateAdmin(props.resourceId, id, submitted, draft.token, scope),
            true, false, {success: 'permissions.updated'},
        );
    } finally {
        pendingAction.value = null;
    }

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
async function removeAdmin(id: string): Promise<void> {
    if (blocked.value) return;
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
        pendingAction.value = {kind: 'remove', id};
        try {
            await command.run((scope) =>
                api.removeAdmin(props.resourceId, id, data.value!.access!.admins.find(admin => admin.profileId === id)!.editToken, scope),
                true, false, {success: 'permissions.adminRemoved'},
            );
        } finally {
            pendingAction.value = null;
        }
    }
}

/** Resolve the selected discovery result to its profile ID before granting a
 * preset. A rejected or unknown command keeps the selection for review; success
 * alone closes this form, without inferring authority from its display label. */
async function addAdmin(): Promise<void> {
    if (!data.value?.access || blocked.value) return;

    // Discovery supplies the target ID; typed display text cannot select a grant.
    // Explain a missing choice locally before collecting a preset or issuing a write.
    if (!selectedProfile.value) {
        command.setError('permissions.selectUser', 'transient');
        return;
    }

    // Use the admitted preset and root baseline for a deliberate new grant.
    // Clear the form only after confirmation; unknown delivery retains its choice.
    const mask = data.value.access.presets.find((value) => value.key === preset.value)?.mask ?? 0;
    pendingAction.value = {kind: 'add'};
    let result: unknown;
    try {
        result = await command.run((scope) =>
            api.addAdmin(
                props.resourceId,
                {profileId: selectedProfile.value, mask},
                data.value!.settingsToken,
                scope,
            ),
            true, false, {success: 'permissions.adminAdded'},
        );
    } finally {
        pendingAction.value = null;
    }
    if (result) cancelAddAdmin();
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
/** Reconcile independently saved access drafts only against admitted settings. */
function receiveSettings(value: Settings, fresh = false): void {
    last.value = value;
    if (fresh) completedSettingsReads++;
    // Canceled warm observers cannot release confirmed comparison evidence.
    // In-flight writes preserve their captured baseline until causal recovery.
    if (!fresh && (command.pending.value || command.recovering.value || awaitingAuthority.value)) return;
    receiveDefaults(value);
    receiveAdmins(value);
}
const awaitingAuthority = computed(() => !!defaults.value?.awaitingAuthority
    || Object.values(admins.value).some(draft => draft.confirmed !== undefined));
const dirty = computed(() => (addOpen.value && (!!profileQuery.value || !!preset.value)) || dirtyDefaults.value
    || Object.values(admins.value).some(draft => draft.value !== (draft.confirmed ?? draft.original) || draft.regrantReviewed));
watch(() => props.settings, value => receiveSettings(value), {immediate: true});
defineExpose({dirty, awaitingAuthority, receiveSettings});
</script>

<template>
            <section
                v-if="data.access && defaults"
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
                        <template #actions>
                            <ActionButton variant="outline-warning" :disabled="controlsPending" @click="reviewDefaults">{{
                                messages.t('draft.review')
                            }}</ActionButton>
                        </template></StatusNotice
                    >
                    <div class="pilot-action-row justify-content-end border-top border-secondary pt-3">
                        <ActionButton
                            type="submit"
                            :pending="pendingAction?.kind === 'defaults' && command.pending.value" :show-spinner="false"
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
                                <AppAccordionButton
                                    class="text-light bg-dark"
                                    :expanded="openAdmin === admin.profileId"
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
                                </AppAccordionButton>
                            </h2>
                            <div v-show="openAdmin === admin.profileId" class="accordion-body bg-dark pt-2">
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
                                        <template v-if="adminConflict(admin.profileId)" #actions>
                                            <ActionButton
                                                variant="outline-warning"
                                                :disabled="controlsPending"
                                                @click="reviewAdmin(admin.profileId)"
                                                >{{ messages.t(adminRemoved(admin.profileId) ? 'packing.reviewAdminRegrant' : 'draft.review') }}</ActionButton>
                                        </template></StatusNotice
                                    >
                                    <!-- PermissionFields retains the last group's mb-3 inside its fieldset;
                                         avoid adding a second gap before the native Save/Remove row. -->
                                    <div class="pilot-action-row justify-content-between">
                                        <ActionButton
                                            class="btn-sm"
                                            variant="outline-danger"
                                            :pending="pendingAction?.kind === 'remove' && pendingAction.id === admin.profileId && command.pending.value"
                                            :show-spinner="false"
                                            :disabled="blocked"
                                            @click="removeAdmin(admin.profileId)"
                                            ><i class="bi bi-trash me-1" aria-hidden="true"></i
                                            >{{ messages.t(adminRemoved(admin.profileId) ? 'packing.discardAdminDraft' : 'packing.removeAssignment') }}</ActionButton
                                        ><ActionButton
                                            class="btn-sm"
                                            :pending="pendingAction?.kind === 'save' && pendingAction.id === admin.profileId && command.pending.value"
                                            :show-spinner="false"
                                            :disabled="
                                                blocked ||
                                                adminConflict(admin.profileId)
                                            "
                                            @click="saveAdmin(admin.profileId)"
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
                        <StatusNotice v-if="profiles.error.value" kind="warning"
                            :last-updated-at="profiles.data.value ? profiles.dataUpdatedAt.value : undefined"
                            :retry-at="profileRetryAt" :read-error="profiles.error.value"
                            :action="{state: profileRetryAction, label: messages.t('common.retry')}" @action="retryProfiles">
                            {{ messages.t(profiles.data.value ? 'state.stale' : 'state.loadFailed') }}
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
                        <div class="pilot-action-row justify-content-end">
                            <ActionButton
                                variant="outline-secondary"
                                :disabled="blocked"
                                @click="cancelAddAdmin"
                                >{{ messages.t('common.cancel') }}</ActionButton
                            ><ActionButton type="submit" :disabled="blocked"
                                :pending="pendingAction?.kind === 'add' && command.pending.value" :show-spinner="false">{{
                                messages.t('packing.add')
                            }}</ActionButton>
                        </div>
                    </form>
                </div>
            </section>
</template>
