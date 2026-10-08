<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, ref, watch} from 'vue';
import {onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter} from 'vue-router';
import {useQuery} from '@tanstack/vue-query';
import type {components} from '../../../types/api/v1';
import {usePackingApi} from './api';
import {usePilot} from '../../app/context';
import {useCommand} from '../../composables/command';
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
const router = useRouter();
const sourceId = computed(() =>
    typeof route.params.listId === 'string' ? route.params.listId.toLowerCase() : null,
);
const admissionError = computed(() => context.bootstrap.initialUrl?.split('?')[0] === route.path
    && context.bootstrap.session.context === context.session.value?.context
    ? context.bootstrap.packingError : undefined);
usePageTitle(() => messages.value.t(admissionError.value ? 'common.errorTitle' : 'packing.create'));

/** SSR seeds only the admitted document and actor; later SPA routes use their own query admission. */
function isInitialForm(): boolean {
    return context.bootstrap.initialUrl === route.fullPath
        && context.bootstrap.session.context === context.session.value?.context;
}

function initialCreationContext(): components['schemas']['PackingCreateContext'] | undefined {
    return isInitialForm() ? context.bootstrap.packingCreateContext : undefined;
}

function initialDuplicate(): components['schemas']['PackingDuplicate'] | undefined {
    return isInitialForm() ? context.bootstrap.packingDuplicate : undefined;
}
type Row = components['schemas']['PackingDuplicateItem'] & {key: number};
const nextKey = ref(0);
const title = ref('');
const description = ref('');
const eventId = ref<string | null>(typeof route.query.eventId === 'string' ? route.query.eventId : null);
const image = ref<File | null>(null);
const rows = ref<Row[]>([]);
const defaults = ref<components['schemas']['PermissionDefaults'] | null>(null);
const baseline = ref<string | null>(null);
const submitted = ref(false);
// Vue reuses this route component between creation/duplicate URLs. A confirmed navigation
// starts a new draft instead of retaining a previous list's copied rows or uploaded file.
watch(
    () => [sourceId.value, route.query.eventId],
    () => {
        // This watcher runs after navigation commits. The user has acknowledged leaving the
        // prior draft; its unknown command must not disable the newly initialized form.
        command.acknowledge();
        baseline.value = null;
        submitted.value = false;
        title.value = '';
        description.value = '';
        defaults.value = null;
        rows.value = [];
        image.value = null;
        eventId.value = typeof route.query.eventId === 'string' ? route.query.eventId : null;
    },
);
const creation = useQuery({
    queryKey: computed(() => packingKeys.creation(context.session.value?.context)),
    initialData: initialCreationContext,
    // Duplicate GET supplies its own admitted form definitions. The separate
    // create-context endpoint retains the native account-only create GET policy.
    enabled: computed(() => context.hydrated.value && context.ready.value && context.session.value?.kind === 'account'
        && !sourceId.value && !admissionError.value),
    queryFn: ({signal}) => api.createContext(context.capture(), signal),
});
const duplicate = useQuery({
    queryKey: computed(() => packingKeys.duplicate(context.session.value?.context, sourceId.value)),
    initialData: initialDuplicate,
    enabled: computed(() => context.hydrated.value && context.ready.value && !!sourceId.value && !admissionError.value),
    queryFn: ({signal}) => api.duplicate(sourceId.value!, context.capture(), signal),
});
const formContext = computed(() => sourceId.value ? duplicate.data.value?.formContext : creation.data.value);
const loadError = computed(() => sourceId.value ? duplicate.error.value : creation.error.value);
const initialLoading = computed(() => !formContext.value && !loadError.value
    && (sourceId.value ? duplicate.isPending.value : creation.isPending.value));
const reading = computed(() => sourceId.value ? duplicate.isFetching.value : creation.isFetching.value);

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
    ([create, copy]) => {
        if (baseline.value !== null || !create || (sourceId.value && !copy)) return;
        title.value = copy?.title ?? '';
        description.value = copy?.description ?? '';
        defaults.value = {...(copy?.defaultPermissions ?? create.defaults)};
        // Duplicate preserves row order and Everyone, but does not copy assignments, image,
        // event association, administrators or archive state. Empty source lists retain zero rows.
        rows.value = copy ? copy.items.map(newRow) : [newRow()];
        baseline.value = snapshot();
    },
    {immediate: true},
);
const dirty = computed(
    () =>
        !submitted.value &&
        (image.value !== null || (baseline.value !== null && snapshot() !== baseline.value)),
);
const command = useCommand(async () => {
    await context.refreshSession();
}, true);
const blocked = computed(() => command.pending.value || command.uncertain.value);
function mayLeave(): boolean {
    if (command.pending.value) return false;
    if (command.uncertain.value) return window.confirm(messages.value.t('packing.leaveUnknown'));
    return !dirty.value || window.confirm(messages.value.t('draft.discard'));
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
}
async function create(): Promise<void> {
    if (!defaults.value) return;
    // Preserve native creation POST admission even when a duplicate grant allowed
    // this visitor to inspect the draft. Login remains an ordinary guarded navigation.
    if (context.session.value?.kind !== 'account') {
        await router.push({path: '/frontend-pilot/users/login', query: {next: route.fullPath}});
        return;
    }
    if (!rows.value.length) {
        command.setError('packing.fillAllFields');
        return;
    }
    const result = await command.run(
        (scope) =>
            api.createPacking(
                {
                    title: title.value.trim(),
                    description: description.value.trim() || null,
                    eventId: eventId.value,
                    defaultPermissions: defaults.value!,
                    items: rows.value.map((row) => ({
                        title: row.title.trim(),
                        description: row.description?.trim() || null,
                        maxAssignees: Number(row.maxAssignees),
                        requiredByAll: row.requiredByAll,
                    })),
                },
                image.value,
                scope,
            ),
        false,
    );
    if (result) {
        submitted.value = true;
        await router.push('/frontend-pilot/packing/' + result.id);
    }
}
</script>

<template>
    <!-- Use the shared error card/Home action for initial route denials. These
         denials mount no form, issue no resource queries and disclose no copy. -->
    <PageMessage v-if="admissionError" kind="error" :message="messages.t(admissionError)" />
    <section v-else class="card bg-dark text-white mb-3">
        <h1 class="card-header text-center">
            <i class="bi bi-bag-plus me-2" aria-hidden="true"></i>{{ messages.t('packing.create') }}
        </h1>
        <div class="card-body">
            <StatusNotice v-if="command.error.value" kind="danger">{{ command.error.value }}</StatusNotice>
            <StatusNotice v-if="command.uncertain.value" kind="warning">{{
                messages.t('packing.creationUnknown')
            }}</StatusNotice>
            <StatusNotice v-if="loadError" kind="danger">{{
                messages.t('state.loadFailed')
            }}</StatusNotice>
            <!-- Both create and duplicate use one admitted initial projection. The
                 event picker loads independently; a refresh never replaces this draft. -->
            <LoadingSkeleton v-if="initialLoading" variant="form" :rows="5" />
            <form v-if="defaults && formContext" :aria-busy="reading" @submit.prevent="create">
                <fieldset :disabled="blocked">
                    <div class="mb-3">
                        <label class="form-label" for="create-title"
                            ><i class="bi bi-tag me-1" aria-hidden="true"></i
                            >{{ messages.t('packing.title') }} *</label
                        ><input
                            id="create-title"
                            v-model="title"
                            class="form-control text-bg-dark"
                            required
                            maxlength="255"
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
                                maxlength="65535"
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
                                accept="image/jpeg,image/png,image/gif"
                                @change="chooseImage"
                            />
                        </div>
                    </div>
                    <div class="row mb-3">
                        <div class="col-md-12">
                            <EventPicker v-model="eventId" :source="api.eventPicker" prefix="create" :disabled="blocked" />
                        </div>
                    </div>
                    <div class="row mb-3">
                        <div class="col-md-12">
                            <AudiencePermissions
                                v-model="defaults"
                                :permissions="formContext.permissions"
                                :presets="formContext.presets"
                                prefix="create-defaults"
                                :disabled="blocked"
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
                                                maxlength="255"
                                                :aria-label="messages.t('packing.item') + ' ' + (index + 1)"
                                            />
                                        </td>
                                        <td>
                                            <input
                                                v-model="row.description"
                                                class="form-control text-bg-dark"
                                                maxlength="65535"
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
