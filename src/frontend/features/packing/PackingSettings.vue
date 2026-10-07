<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, ref, watch} from 'vue';
import {onBeforeRouteLeave, onBeforeRouteUpdate, RouterLink, useRouter} from 'vue-router';
import {useQuery} from '@tanstack/vue-query';
import type {components} from '../../../types/api/v1';
import type {MessageKey} from '../../../types/LocalizationTypes';
import {usePilot, refreshInterval} from '../../app/context';
import {ApiFailure} from '../../app/api';
import {useCommand} from '../../composables/command';
import ActionButton from '../../components/ActionButton.vue';
import AppDialog from '../../components/AppDialog.vue';
import StatusNotice from '../../components/StatusNotice.vue';
import MetadataFields from './MetadataFields.vue';
import EventPicker from './EventPicker.vue';
import AudiencePermissions from './AudiencePermissions.vue';
import PermissionFields from './PermissionFields.vue';

const props = defineProps<{listId: string; listTitle?: string}>();
const emit = defineEmits<{close: []; saved: []; accessLost: []}>();
const context = usePilot();
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
const profileSearch = ref('');
const selectedProfile = ref('');
const preset = ref('');
const openAdmin = ref<string | null>(null);
const defaults = ref<{original: Defaults; values: Defaults; token: string} | null>(null);
const admins = ref<Record<string, {original: number; value: number; token: string}>>({});
const event = ref<{original: string | null; value: string | null; token: string} | null>(null);
const imageToken = ref<string | null>(null);
const settings = useQuery({
    queryKey: computed(() => [
        'v1',
        context.session.value?.context,
        context.locale.value,
        'packing',
        props.listId,
        'settings',
    ]),
    enabled: computed(() => context.hydrated.value && context.ready.value && context.visible.value),
    queryFn: ({signal}) => context.api.settings(props.listId, context.capture(), signal),
    refetchInterval: (query) =>
        context.visible.value ? refreshInterval(query.state.error, query.state.fetchFailureCount, 0) : false,
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
            }
            const active = new Set(value.access.admins.map((admin) => admin.profileId));
            for (const id of Object.keys(admins.value)) if (!active.has(id)) delete admins.value[id];
            for (const admin of value.access.admins) {
                const draft = admins.value[admin.profileId];
                if (!draft || draft.value === draft.original)
                    admins.value[admin.profileId] = {
                        original: admin.mask,
                        value: admin.mask,
                        token: value.settingsToken,
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
/** Match Bootstrap's tab keyboard behavior without attaching its DOM controller to Vue. */
function navigateTabs(event: KeyboardEvent): void {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    const current = event.target as HTMLButtonElement;
    if (current.getAttribute('role') !== 'tab') return;
    const tabs = Array.from(
        (event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>(
            '[role="tab"]:not(:disabled)',
        ),
    );
    const index = tabs.indexOf(current);
    if (index < 0) return;
    event.preventDefault();
    event.stopPropagation();
    const next =
        event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? tabs.length - 1
              : (index + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1) + tabs.length) % tabs.length;
    tabs[next]?.click();
    tabs[next]?.focus();
}
watch(
    panels,
    (values) => {
        if (!values.some((value) => value.key === panel.value)) panel.value = values[0]?.key ?? '';
    },
    {immediate: true},
);
const command = useCommand(async () => {
    await settings.refetch({throwOnError: true});
    // Header, access, event and archive writes also advance the metadata revision.
    // An untouched editor adopts the result; a dirty editor keeps its review boundary.
    await fields.value?.refreshAfterSettings();
    emit('saved');
});
const refreshingSettings = ref(false);
const blocked = computed(
    () =>
        refreshingSettings.value || command.pending.value || command.uncertain.value || fields.value?.pending,
);
async function metadataSaved(): Promise<void> {
    // Metadata advances the shared settings revision. Finish this read before another
    // panel may send a command, so this client's own save cannot produce a stale token.
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
const dirty = computed(
    () =>
        !!image.value ||
        (addOpen.value && (!!profileQuery.value || !!preset.value)) ||
        dirtyDefaults.value ||
        event.value?.value !== event.value?.original ||
        Object.values(admins.value).some((draft) => draft.value !== draft.original),
);
const profiles = useQuery({
    queryKey: computed(() => [
        'v1',
        context.session.value?.context,
        'packing',
        props.listId,
        'profiles',
        profileSearch.value,
    ]),
    enabled: computed(() => addOpen.value && context.ready.value && !!profileSearch.value),
    queryFn: ({signal}) => context.api.profiles(props.listId, profileSearch.value, context.capture(), signal),
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
    if (!selectMatchingProfile()) profileSearch.value = profileQuery.value.trim();
});
watch(profiles.data, selectMatchingProfile);
function cancelAddAdmin(): void {
    addOpen.value = false;
    profileQuery.value = '';
    profileSearch.value = '';
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
function chooseImage(event: Event): void {
    image.value = (event.target as HTMLInputElement).files?.[0] ?? null;
    imageToken.value = data.value?.settingsToken ?? null;
}
async function upload(): Promise<void> {
    if (!image.value || !imageToken.value || imageToken.value !== data.value?.settingsToken) return;
    const result = await command.run((scope) =>
        context.api.uploadHeader(props.listId, image.value!, imageToken.value!, scope),
    );
    if (result) image.value = null;
}
async function removeImage(): Promise<void> {
    if (data.value && window.confirm(messages.value.t('packing.confirmRemoveImage'))) {
        await command.run((scope) =>
            context.api.removeHeader(props.listId, data.value!.settingsToken, scope),
        );
    }
}
async function saveEvent(): Promise<void> {
    if (!event.value || event.value.token !== data.value?.settingsToken) return;
    if (!window.confirm(messages.value.t('packing.confirmEvent'))) return;
    // Relinking changes inherited access/archive state. Never abandon a properties draft to
    // perform it; the existing dialog requires the same explicit discard decision first.
    if (!(fields.value?.mayLeave() ?? true)) return;
    const result = await command.run((scope) =>
        context.api.linkEvent(
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
    const result = await command.run((scope) =>
        context.api.setDefaults(props.listId, defaults.value!.values, defaults.value!.token, scope),
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
        admins.value[id]!.token = data.value.settingsToken;
    }
}
async function saveAdmin(id: string): Promise<void> {
    const draft = admins.value[id];
    if (!draft) return;
    const result = await command.run((scope) =>
        context.api.updateAdmin(props.listId, id, draft.value, draft.token, scope),
    );
    if (result) reviewAdmin(id);
}
async function removeAdmin(id: string): Promise<void> {
    if (data.value && window.confirm(messages.value.t('packing.confirmRemoveAdmin'))) {
        await command.run((scope) =>
            context.api.removeAdmin(props.listId, id, data.value!.settingsToken, scope),
        );
    }
}
async function addAdmin(): Promise<void> {
    if (!data.value?.access || !selectedProfile.value) return;
    const mask = data.value.access.presets.find((value) => value.key === preset.value)?.mask ?? 0;
    if (
        await command.run((scope) =>
            context.api.addAdmin(
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
        await command.run((scope) => context.api.archive(props.listId, restore, scope));
    }
}
async function remove(): Promise<void> {
    if (!mayLeave() || !window.confirm(messages.value.t('packing.confirmDelete'))) return;
    // Delete has no representation to refresh. Its confirmation redirects inside the SPA.
    const id = await command.run(async (scope) => {
        await context.api.deletePacking(props.listId, scope);
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
    return messages.value.t(('permissions.' + key) as MessageKey);
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
                <ul
                    class="nav nav-pills nav-fill gap-1 entity-settings-nav"
                    role="tablist"
                    @keydown="navigateTabs"
                >
                    <li v-for="tab in panels" :key="tab.key" class="nav-item" role="presentation">
                        <button
                            :id="'pilot-settings-tab-' + tab.key"
                            class="nav-link text-light"
                            :class="{active: panel === tab.key}"
                            type="button"
                            role="tab"
                            :tabindex="panel === tab.key ? 0 : -1"
                            :aria-selected="panel === tab.key"
                            :aria-controls="'pilot-settings-' + tab.key"
                            @click="panel = tab.key"
                        >
                            <i class="bi me-1" :class="tab.icon" aria-hidden="true"></i
                            >{{ messages.t(tab.label) }}
                        </button>
                    </li>
                </ul>
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
                            <StatusNotice v-if="image && imageToken !== data.settingsToken" kind="warning"
                                ><p>{{ messages.t('packing.readConflict') }}</p>
                                <p>{{ messages.t('draft.mine') }}: {{ image.name }}</p>
                                <ActionButton
                                    variant="outline-warning"
                                    :disabled="blocked"
                                    @click="imageToken = data.settingsToken"
                                    >{{ messages.t('draft.review') }}</ActionButton
                                ></StatusNotice
                            >
                            <div class="d-flex flex-wrap gap-2">
                                <ActionButton
                                    :disabled="blocked || !image || imageToken !== data.settingsToken"
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
                        :current="data.currentEvent"
                        prefix="settings"
                        inline
                        :disabled="blocked"
                    />
                    <p class="form-text">{{ messages.t('packing.eventHint') }}</p>
                    <StatusNotice v-if="event.token !== data.settingsToken" kind="warning"
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
                    <ActionButton type="submit" :disabled="blocked || event.token !== data.settingsToken">{{
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
                <div class="nav nav-pills gap-2 mb-3" role="tablist" @keydown="navigateTabs">
                    <button
                        id="pilot-access-defaults-tab"
                        type="button"
                        role="tab"
                        aria-controls="pilot-access-defaults"
                        :aria-selected="accessPanel === 'defaults'"
                        :tabindex="accessPanel === 'defaults' ? 0 : -1"
                        class="nav-link"
                        :class="{active: accessPanel === 'defaults'}"
                        @click="accessPanel = 'defaults'"
                    >
                        {{ messages.t('packing.groupPermissions') }}</button
                    ><button
                        id="pilot-access-admins-tab"
                        type="button"
                        role="tab"
                        aria-controls="pilot-access-admins"
                        :aria-selected="accessPanel === 'admins'"
                        :tabindex="accessPanel === 'admins' ? 0 : -1"
                        class="nav-link"
                        :class="{active: accessPanel === 'admins'}"
                        @click="accessPanel = 'admins'"
                    >
                        {{ messages.t('packing.administrators') }}
                    </button>
                </div>
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
                    <StatusNotice v-if="dirtyDefaults && defaults.token !== data.settingsToken" kind="warning"
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
                            :disabled="blocked || (dirtyDefaults && defaults.token !== data.settingsToken)"
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
                            v-for="admin in data.access.admins"
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
                                            admins[admin.profileId]!.value !==
                                                admins[admin.profileId]!.original &&
                                            admins[admin.profileId]!.token !== data.settingsToken
                                        "
                                        kind="warning"
                                        ><p>{{ messages.t('packing.readConflict') }}</p>
                                        <p>
                                            {{ messages.t('draft.original') }}:
                                            {{ admins[admin.profileId]!.original }} ·
                                            {{ messages.t('draft.mine') }}:
                                            {{ admins[admin.profileId]!.value }} ·
                                            {{ messages.t('draft.current') }}: {{ admin.mask }}
                                        </p>
                                        <ActionButton
                                            variant="outline-warning"
                                            @click="reviewAdmin(admin.profileId)"
                                            >{{ messages.t('draft.review') }}</ActionButton
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
                                            >{{ messages.t('packing.removeAssignment') }}</ActionButton
                                        ><ActionButton
                                            class="btn-sm"
                                            :disabled="
                                                blocked ||
                                                admins[admin.profileId]!.token !== data.settingsToken
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
