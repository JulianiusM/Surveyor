<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, ref, watch} from 'vue';
import {onBeforeRouteLeave, onBeforeRouteUpdate, RouterLink, useRouter} from 'vue-router';
import {useQuery} from '@tanstack/vue-query';
import type {components} from '../../../types/api/v1';
import {permissionLabel as translatedPermissionLabel} from '../../../modules/localization/permissionLabels';
import {usePackingApi} from './api';
import {usePilot, refreshInterval} from '../../app/context';
import {ApiFailure} from '../../app/transport';
import {useCommand} from '../../composables/command';
import {useDebouncedValue} from '../../composables/debounced';
import {packingKeys} from '../../app/queryKeys';
import ActionButton from '../../components/ActionButton.vue';
import AppDialog from '../../components/AppDialog.vue';
import StatusNotice from '../../components/StatusNotice.vue';
import AppTabList from '../../components/AppTabList.vue';
import MetadataFields from './MetadataFields.vue';
import EventPicker from '../../components/EventPicker.vue';
import AudiencePermissions from '../../components/permissions/AudiencePermissions.vue';
import PermissionFields from '../../components/permissions/PermissionFields.vue';

const props = defineProps<{listId: string; listTitle?: string}>();
const emit = defineEmits<{close: []; saved: []; accessLost: []}>();
const context = usePilot();
const api = usePackingApi(context);
const {messages} = context;
const router = useRouter();
type Settings = components['schemas']['PackingSettings'];
type Defaults = components['schemas']['PermissionDefaults'];
const panel = ref('');
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
const defaults = ref<{original: Defaults; values: Defaults; token: string} | null>(null);
const admins = ref<Record<string, {original: number; value: number; token: string; name: string;
    isGuest: boolean; regrantReviewed?: boolean}>>({});
const event = ref<{original: string | null; value: string | null; token: string} | null>(null);
const imageToken = ref<string | null>(null);
const imageOriginal = ref<string | null>(null);
const jitter = context.browser ? Math.round(Math.random() * 3000) : 0;
const settings = useQuery({
    queryKey: computed(() => packingKeys.settings(context.session.value?.context, props.listId, context.locale.value)),
    enabled: computed(() => context.hydrated.value && context.ready.value && context.visible.value),
    queryFn: ({signal}) => api.settings(props.listId, context.capture(), signal),
    refetchInterval: (query) =>
        context.visible.value ? refreshInterval(query.state.error, query.state.fetchFailureCount, jitter) : false,
});
// Retain draft owners through locale-key reads, but remove authority immediately on a confirmed
// denial. Each independently saved form keeps the token of the snapshot it actually edited.
const last = ref<Settings | null>(null);
watch(
    settings.data,
    (value) => {
        if (!value) return;
        last.value = value;
        if (value.access) {
            if (
                !defaults.value ||
                JSON.stringify(defaults.value.values) === JSON.stringify(defaults.value.original)
            ) {
                defaults.value = {
                    original: {...value.access.defaults},
                    values: {...value.access.defaults},
                    token: value.settingsToken,
                };
            } else {
                // A defaults save submits changed audiences only. Keep those local masks,
                // while adopting another client's changes to every untouched audience.
                let overlap = false;
                for (const audience of ['participant', 'guest', 'authenticated', 'public'] as const) {
                    const draft = defaults.value;
                    const current = value.access.defaults[audience];
                    if (draft.values[audience] === draft.original[audience]) {
                        draft.values[audience] = current;
                        draft.original[audience] = current;
                    } else if (draft.values[audience] === current) draft.original[audience] = current;
                    else if (draft.original[audience] !== current) overlap = true;
                }
                if (!overlap) defaults.value.token = value.settingsToken;
            }
            const active = new Set(value.access.admins.map((admin) => admin.profileId));
            for (const id of Object.keys(admins.value)) {
                const draft = admins.value[id]!;
                // Removing a remote grant must not silently discard a local mask edit. Keep
                // its row as a reviewable draft; only an explicit save may grant access again.
                if (!active.has(id) && draft.value === draft.original && !draft.regrantReviewed) delete admins.value[id];
            }
            for (const admin of value.access.admins) {
                const draft = admins.value[admin.profileId];
                if (!draft || draft.value === draft.original)
                    admins.value[admin.profileId] = {
                        original: admin.mask,
                        value: admin.mask,
                        token: admin.editToken,
                        name: admin.name,
                        isGuest: admin.isGuest,
                    };
            }
        }
        const eventId = value.currentEvent?.id ?? null;
        if (!event.value || event.value.value === event.value.original)
            event.value = {original: eventId, value: eventId, token: value.settingsToken};
    },
    {immediate: true},
);
watch(settings.error, (failure) => {
    if (failure instanceof ApiFailure && [401, 403, 404].includes(failure.status)) emit('accessLost');
});
const data = computed(() => settings.data.value ?? last.value);
const panels = computed(() => {
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
const accessTabs = computed(() => [
    {key: 'defaults', label: messages.value.t('packing.groupPermissions'), id: 'pilot-access-defaults-tab', controls: 'pilot-access-defaults'},
    {key: 'admins', label: messages.value.t('packing.administrators'), id: 'pilot-access-admins-tab', controls: 'pilot-access-admins'},
]);
watch(
    panels,
    (values) => {
        if (!values.some((value) => value.key === panel.value)) panel.value = values[0]?.key ?? '';
    },
    {immediate: true},
);
const command = useCommand(async () => {
    await settings.refetch({throwOnError: true});
    // Refresh related snapshots after a confirmed settings write. Each dirty form compares
    // only its own edited fields; unrelated setup changes do not manufacture conflicts.
    await fields.value?.refreshAfterSettings();
    emit('saved');
});
const refreshingSettings = ref(false);
const blocked = computed(
    () =>
        refreshingSettings.value || command.pending.value || command.uncertain.value || fields.value?.pending,
);
async function metadataSaved(): Promise<void> {
    // Complete the current-value read before another panel sends a command.
    refreshingSettings.value = true;
    try {
        await settings.refetch({throwOnError: true});
    } catch {
        command.notice.value = 'state.savedRefreshFailed';
        command.uncertain.value = true;
    } finally {
        refreshingSettings.value = false;
        emit('saved');
    }
}
const dirtyDefaults = computed(
    () =>
        !!defaults.value && JSON.stringify(defaults.value.values) !== JSON.stringify(defaults.value.original),
);
const defaultsPatch = computed<components['schemas']['PermissionDefaultsPatch']>(() => {
    const patch: components['schemas']['PermissionDefaultsPatch'] = {};
    if (defaults.value) for (const audience of ['participant', 'guest', 'authenticated', 'public'] as const) {
        if (defaults.value.values[audience] !== defaults.value.original[audience]) {
            patch[audience] = defaults.value.values[audience];
        }
    }
    return patch;
});
const defaultsConflict = computed(() => !!defaults.value && !!data.value?.access &&
    Object.keys(defaultsPatch.value).some(key => {
        const audience = key as keyof Defaults;
        return defaults.value!.original[audience] !== data.value!.access!.defaults[audience];
    }));
const eventConflict = computed(() => !!event.value && event.value.original !== (data.value?.currentEvent?.id ?? null));
const headerConflict = computed(() => !!image.value && imageOriginal.value !== (data.value?.headerVersion ?? null));
function adminConflict(id: string): boolean {
    const current = data.value?.access?.admins.find(admin => admin.profileId === id);
    const draft = admins.value[id];
    return !!draft && (current ? Boolean(draft.regrantReviewed) || draft.original !== current.mask : !draft.regrantReviewed);
}
const displayedAdmins = computed(() => {
    const current = data.value?.access?.admins ?? [];
    const active = new Set(current.map(admin => admin.profileId));
    return [...current, ...Object.entries(admins.value).filter(([id]) => !active.has(id))
        .map(([profileId, draft]) => ({profileId, name: draft.name, isGuest: draft.isGuest,
            mask: draft.original, editToken: draft.token}))];
});
function adminRemoved(id: string): boolean {
    return !data.value?.access?.admins.some(admin => admin.profileId === id);
}
function reviewHeader(): void {
    imageToken.value = data.value?.settingsToken ?? null;
    imageOriginal.value = data.value?.headerVersion ?? null;
}
const dirty = computed(
    () =>
        !!image.value ||
        (addOpen.value && (!!profileQuery.value || !!preset.value)) ||
        dirtyDefaults.value ||
        event.value?.value !== event.value?.original ||
        Object.values(admins.value).some((draft) => draft.value !== draft.original || draft.regrantReviewed),
);
const profiles = useQuery({
    queryKey: computed(() => packingKeys.profiles(context.session.value?.context, props.listId, profileSearch.value)),
    enabled: computed(() => addOpen.value && context.ready.value && context.visible.value && !!profileSearch.value),
    queryFn: ({signal}) => api.profiles(props.listId, profileSearch.value, context.capture(), signal),
});
function profileOptionValue(profile: components['schemas']['PackingProfileOption']): string {
    return profile.username || profile.profileId;
}
function selectMatchingProfile(): boolean {
    const match = profiles.data.value?.find(
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
function mayLeave(): boolean {
    if (blocked.value || !(fields.value?.mayLeave() ?? true)) return false;
    return !dirty.value || window.confirm(messages.value.t('draft.discard'));
}
function close(): void {
    if (mayLeave()) emit('close');
}
onBeforeRouteLeave(mayLeave);
onBeforeRouteUpdate(mayLeave);
function beforeUnload(event: BeforeUnloadEvent): void {
    if (!dirty.value && !blocked.value) return;
    event.preventDefault();
    event.returnValue = '';
}
let removeIdentityGuard: (() => void) | undefined;
onMounted(() => {
    removeIdentityGuard = context.registerIdentityGuard(mayLeave);
    window.addEventListener('beforeunload', beforeUnload);
});
onBeforeUnmount(() => {
    removeIdentityGuard?.();
    window.removeEventListener('beforeunload', beforeUnload);
});
const removeUpdateGuard = context.updates.registerGuard(() => !dirty.value);
onBeforeUnmount(removeUpdateGuard);
function chooseImage(event: Event): void {
    image.value = (event.target as HTMLInputElement).files?.[0] ?? null;
    imageToken.value = data.value?.settingsToken ?? null;
    imageOriginal.value = data.value?.headerVersion ?? null;
}
async function upload(): Promise<void> {
    if (!image.value || !imageToken.value || headerConflict.value) return;
    const result = await command.run((scope) =>
        api.uploadHeader(props.listId, image.value!, imageToken.value!, scope),
    );
    if (result) image.value = null;
}
async function removeImage(): Promise<void> {
    if (data.value && window.confirm(messages.value.t('packing.confirmRemoveImage'))) {
        await command.run((scope) =>
            api.removeHeader(props.listId, data.value!.settingsToken, scope),
        );
    }
}
async function saveEvent(): Promise<void> {
    if (!event.value || eventConflict.value) return;
    if (!window.confirm(messages.value.t('packing.confirmEvent'))) return;
    // Relinking changes inherited access/archive state. Never abandon a properties draft to
    // perform it; the existing dialog requires the same explicit discard decision first.
    if (!(fields.value?.mayLeave() ?? true)) return;
    const result = await command.run((scope) =>
        api.linkEvent(
            props.listId,
            {eventId: event.value!.value, expectedEventId: event.value!.original},
            event.value!.token,
            scope,
        ),
    );
    if (result && !result.canView) {
        emit('accessLost');
        return;
    }
    if (result && data.value)
        event.value = {
            original: data.value.currentEvent?.id ?? null,
            value: data.value.currentEvent?.id ?? null,
            token: data.value.settingsToken,
        };
    await fields.value?.refresh(!!result);
}
function reviewEvent(): void {
    if (!event.value || !data.value) return;
    event.value.original = data.value.currentEvent?.id ?? null;
    event.value.token = data.value.settingsToken;
}
function reviewDefaults(): void {
    if (!defaults.value || !data.value?.access) return;
    defaults.value.original = {...data.value.access.defaults};
    defaults.value.token = data.value.settingsToken;
}
async function saveDefaults(): Promise<void> {
    if (!defaults.value) return;
    if (!Object.keys(defaultsPatch.value).length) {
        command.notice.value = 'state.saved';
        return;
    }
    const result = await command.run((scope) =>
        api.setDefaults(props.listId, defaultsPatch.value, defaults.value!.token, scope),
    );
    if (result && data.value?.access)
        defaults.value = {
            original: {...data.value.access.defaults},
            values: {...data.value.access.defaults},
            token: data.value.settingsToken,
        };
}
function reviewAdmin(id: string): void {
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
async function saveAdmin(id: string): Promise<void> {
    const draft = admins.value[id];
    if (!draft || adminConflict(id)) return;
    const result = await command.run((scope) =>
        adminRemoved(id)
            ? api.addAdmin(props.listId, {profileId: id, mask: draft.value}, draft.token, scope)
            : api.updateAdmin(props.listId, id, draft.value, draft.token, scope),
    );
    if (result) reviewAdmin(id);
}
async function removeAdmin(id: string): Promise<void> {
    if (adminRemoved(id)) {
        delete admins.value[id];
        if (openAdmin.value === id) openAdmin.value = null;
        return;
    }
    if (data.value && window.confirm(messages.value.t('packing.confirmRemoveAdmin'))) {
        await command.run((scope) =>
            api.removeAdmin(props.listId, id, data.value!.access!.admins.find(admin => admin.profileId === id)!.editToken, scope),
        );
    }
}
async function addAdmin(): Promise<void> {
    if (!data.value?.access || !selectedProfile.value) return;
    const mask = data.value.access.presets.find((value) => value.key === preset.value)?.mask ?? 0;
    if (
        await command.run((scope) =>
            api.addAdmin(
                props.listId,
                {profileId: selectedProfile.value, mask},
                data.value!.settingsToken,
                scope,
            ),
        )
    ) {
        cancelAddAdmin();
    }
}
async function archive(restore: boolean): Promise<void> {
    const confirmation = restore
        ? 'packing.confirmRestore'
        : data.value?.archive.inherited
          ? 'packing.confirmArchiveIndependent'
          : 'packing.confirmArchive';
    if (window.confirm(messages.value.t(confirmation))) {
        await command.run((scope) => api.archive(props.listId, restore, scope));
    }
}
async function remove(): Promise<void> {
    if (!mayLeave() || !window.confirm(messages.value.t('packing.confirmDelete'))) return;
    // Delete has no representation to refresh. Its confirmation redirects inside the SPA.
    const id = await command.run(async (scope) => {
        await api.deletePacking(props.listId, scope);
        return props.listId;
    }, false);
    if (id) {
        defaults.value = null;
        admins.value = {};
        event.value = null;
        image.value = null;
        emit('close');
        await router.push('/frontend-pilot');
    }
}
function initials(name: string): string {
    return name
        .split(/\s+/u)
        .map((word) => word.charAt(0))
        .join('')
        .slice(0, 2)
        .toUpperCase();
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
        :pending="!!blocked"
        @close="close"
    >
        <template #navigation
            ><div v-if="panels.length > 1" class="px-3 pt-3">
                <AppTabList v-model="panel" :tabs="panelTabs"
                    class="nav-fill gap-1 entity-settings-nav" link-class="text-light" />
            </div>
            <span
                v-else-if="panels.length === 1"
                :id="'pilot-settings-tab-' + panels[0]!.key"
                class="visually-hidden"
                >{{ messages.t(panels[0]!.label) }}</span
            ></template
        >
        <StatusNotice v-if="command.error.value" kind="danger">{{ command.error.value }}</StatusNotice>
        <StatusNotice
            v-if="command.notice.value"
            :kind="command.notice.value === 'state.saved' ? 'success' : 'warning'"
            >{{ messages.t(command.notice.value) }}</StatusNotice
        >
        <StatusNotice v-if="settings.error.value" kind="warning">{{
            messages.t('state.loadFailed')
        }}</StatusNotice>
        <p v-if="!data">{{ messages.t('common.loading') }}</p>
        <template v-if="data">
            <div
                v-if="panels.some((tab) => tab.key === 'general')"
                v-show="panel === 'general'"
                id="pilot-settings-general"
                role="tabpanel"
                aria-labelledby="pilot-settings-tab-general"
            >
                <section v-if="data.editableFields.length" class="mb-4">
                    <MetadataFields
                        ref="fields"
                        :list-id="listId"
                        :list-title="data.title"
                        :disabled="!!blocked"
                        :active="panel === 'general'"
                        @saved="metadataSaved"
                        @access-lost="emit('accessLost')"
                    />
                </section>
                <section v-if="data.capabilities.editHeader" class="mb-4">
                    <details class="entity-property-group" :open="!data.editableFields.length">
                        <summary class="fw-semibold">{{ messages.t('packing.headerImage') }}</summary>
                        <div class="pt-3">
                            <label class="form-label" for="pilot-header-image">{{
                                messages.t('packing.chooseImage')
                            }}</label
                            ><input
                                id="pilot-header-image"
                                type="file"
                                class="form-control"
                                accept="image/jpeg,image/png,image/gif"
                                :disabled="blocked"
                                @change="chooseImage"
                            />
                            <p class="form-text">{{ messages.t('packing.imageHint') }}</p>
                            <StatusNotice v-if="headerConflict" kind="warning"
                                ><p>{{ messages.t('packing.readConflict') }}</p>
                                <p>{{ messages.t('draft.mine') }}: {{ image?.name }}</p>
                                <ActionButton
                                    variant="outline-warning"
                                    :disabled="blocked"
                                    @click="reviewHeader"
                                    >{{ messages.t('draft.review') }}</ActionButton
                                ></StatusNotice
                            >
                            <div class="d-flex flex-wrap gap-2">
                                <ActionButton
                                    :disabled="blocked || !image || headerConflict"
                                    @click="upload"
                                    >{{ messages.t('packing.upload') }}</ActionButton
                                ><ActionButton
                                    v-if="data.headerUrl"
                                    variant="outline-danger"
                                    :disabled="blocked"
                                    @click="removeImage"
                                    >{{ messages.t('packing.removeImage') }}</ActionButton
                                >
                            </div>
                        </div>
                    </details>
                </section>
            </div>
            <section
                v-if="data.capabilities.linkEvent && event"
                v-show="panel === 'event'"
                id="pilot-settings-event"
                class="mb-4"
                role="tabpanel"
                aria-labelledby="pilot-settings-tab-event"
            >
                <h3 class="fs-5">{{ messages.t('packing.linkedEvent') }}</h3>
                <form @submit.prevent="saveEvent">
                    <EventPicker
                        v-model="event.value"
                        :source="api.eventPicker"
                        :current="data.currentEvent"
                        prefix="settings"
                        inline
                        :disabled="blocked"
                    />
                    <p class="form-text">{{ messages.t('packing.eventHint') }}</p>
                    <StatusNotice v-if="eventConflict" kind="warning"
                        ><p>{{ messages.t('packing.readConflict') }}</p>
                        <dl>
                            <dt>{{ messages.t('draft.original') }}</dt>
                            <dd>{{ event.original || messages.t('packing.noEvent') }}</dd>
                            <dt>{{ messages.t('draft.mine') }}</dt>
                            <dd>{{ event.value || messages.t('packing.noEvent') }}</dd>
                            <dt>{{ messages.t('draft.current') }}</dt>
                            <dd>
                                {{
                                    data.currentEvent?.title ||
                                    data.currentEvent?.id ||
                                    messages.t('packing.noEvent')
                                }}
                            </dd>
                        </dl>
                        <ActionButton variant="outline-warning" :disabled="blocked" @click="reviewEvent">{{
                            messages.t('draft.review')
                        }}</ActionButton></StatusNotice
                    >
                    <ActionButton type="submit" :disabled="blocked || eventConflict">{{
                        messages.t('packing.saveEvent')
                    }}</ActionButton>
                </form>
            </section>
            <section
                v-if="data.access && defaults"
                v-show="panel === 'access'"
                id="pilot-settings-access"
                role="tabpanel"
                aria-labelledby="pilot-settings-tab-access"
            >
                <AppTabList v-model="accessPanel" :tabs="accessTabs" class="gap-2 mb-3" />
                <form
                    v-show="accessPanel === 'defaults'"
                    id="pilot-access-defaults"
                    role="tabpanel"
                    aria-labelledby="pilot-access-defaults-tab"
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
                        ><p>{{ messages.t('packing.readConflict') }}</p>
                        <div class="pilot-conflict-values">
                            <dl>
                                <dt>{{ messages.t('draft.original') }}</dt>
                                <dd>{{ defaults.original }}</dd>
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
                        <ActionButton variant="outline-warning" @click="reviewDefaults">{{
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
                        <ActionButton class="btn-sm" @click="addOpen = !addOpen"
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
                        >
                            <h2 class="accordion-header">
                                <button
                                    class="accordion-button text-light bg-dark"
                                    :class="{collapsed: openAdmin !== admin.profileId}"
                                    type="button"
                                    :aria-expanded="openAdmin === admin.profileId"
                                    @click="
                                        openAdmin = openAdmin === admin.profileId ? null : admin.profileId
                                    "
                                >
                                    <span
                                        class="rounded-circle bg-secondary text-dark d-inline-flex justify-content-center align-items-center me-2"
                                        style="width: 24px; height: 24px; font-size: 12px"
                                        >{{ initials(admin.name) }}</span
                                    ><span class="me-2">{{ admin.name }}</span
                                    ><span class="badge bg-secondary ms-2"
                                        >{{
                                            data.access.permissions.filter(
                                                (permission) => admin.mask & permission.bit,
                                            ).length
                                        }}/{{ data.access.permissions.length }}</span
                                    >
                                </button>
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
                                        v-if="
                                            adminRemoved(admin.profileId) || ((admins[admin.profileId]!.value !==
                                                admins[admin.profileId]!.original || admins[admin.profileId]!.regrantReviewed) &&
                                            adminConflict(admin.profileId))
                                        "
                                        kind="warning"
                                        ><p>{{ messages.t(adminRemoved(admin.profileId)
                                            ? admins[admin.profileId]!.regrantReviewed ? 'packing.adminRegrantReviewed' : 'packing.adminRemoved'
                                            : 'packing.readConflict') }}</p>
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
                                            @click="removeAdmin(admin.profileId)"
                                            ><i class="bi bi-trash me-1" aria-hidden="true"></i
                                            >{{ messages.t(adminRemoved(admin.profileId) ? 'packing.discardAdminDraft' : 'packing.removeAssignment') }}</ActionButton
                                        ><ActionButton
                                            class="btn-sm"
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
                        @submit.prevent="addAdmin"
                    >
                        <!-- Match the native inline form's title and field-group spacing. -->
                        <div class="mb-2">
                            <h5 class="modal-title">{{ messages.t('packing.addAdministrator') }}</h5>
                        </div>
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
                                <option value="">{{ messages.t('packing.none') }}</option>
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
                            ><ActionButton type="submit" :disabled="blocked || !selectedProfile">{{
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
                <section v-if="data.capabilities.manageArchive" class="mb-4">
                    <h3 class="fs-5">{{ messages.t('packing.archival') }}</h3>
                    <p>
                        {{
                            messages.t(
                                data.archive.inherited || data.archive.direct
                                    ? 'packing.archivedHint'
                                    : 'packing.activeHint',
                            )
                        }}
                    </p>
                    <p v-if="data.archive.inherited">
                        {{ messages.t('packing.inheritedHint') }}
                        <a v-if="data.archive.eventUrl" class="ms-1" :href="data.archive.eventUrl">{{
                            messages.t('packing.openEvent')
                        }}</a>
                    </p>
                    <div class="d-flex flex-wrap gap-2">
                        <ActionButton
                            v-if="data.capabilities.archive"
                            class="btn-sm"
                            variant="outline-light"
                            :disabled="blocked"
                            @click="archive(false)"
                            >{{ messages.t('packing.archive') }}</ActionButton
                        ><ActionButton
                            v-if="data.capabilities.restore"
                            class="btn-sm"
                            variant="outline-light"
                            :disabled="blocked"
                            @click="archive(true)"
                            >{{ messages.t('packing.restore') }}</ActionButton
                        >
                    </div>
                </section>
                <section v-if="data.capabilities.duplicate || data.capabilities.remove">
                    <h3 class="fs-5">{{ messages.t('packing.otherActions') }}</h3>
                    <div class="d-flex flex-wrap gap-2">
                        <RouterLink
                            v-if="data.capabilities.duplicate"
                            class="btn btn-outline-light"
                            :to="'/frontend-pilot/packing/' + listId + '/duplicate'"
                            >{{ messages.t('packing.duplicate') }}</RouterLink
                        ><ActionButton
                            v-if="data.capabilities.remove"
                            variant="outline-danger"
                            :disabled="blocked"
                            @click="remove"
                            >{{ messages.t('packing.deletePermanently') }}</ActionButton
                        >
                    </div>
                </section>
            </div>
        </template>
        <template #footer
            ><ActionButton
                v-if="command.uncertain.value"
                variant="outline-secondary"
                @click="command.reconcile()"
                >{{ messages.t('common.refresh') }}</ActionButton
            ><ActionButton variant="secondary" :disabled="blocked" @click="close">{{
                messages.t('common.close')
            }}</ActionButton></template
        >
    </AppDialog>
</template>
