<script setup lang="ts">
import {computed, reactive, ref, useId, watch} from 'vue';
import {RouterLink} from 'vue-router';
import type {components} from '../../../types/api/v1';
import type {PilotOverviewCardInteraction} from '../../../types/FrontendPilotUiTypes';
import type {PilotRequestScope} from '../../../types/FrontendPilotUiTypes';
import {useActionState, usePilot} from '../../app/context';
import {eventKeys} from '../../app/queryKeys';
import {useCommand} from '../../composables/command';
import {useConfirmedNavigation} from '../../composables/pageEntry';
import {useEventApi} from './api';
import {useEventSection} from './useEventSection';
import {usePackingApi} from '../packing/api';
import {useDriversApi} from '../drivers/api';
import {useActivityApi} from '../activity/api';
import {createEntityLifecycle, useEntityRemoval} from '../../composables/entityLifecycle';
import OverviewCard from '../overview/OverviewCard.vue';
import ActionButton from '../../components/ActionButton.vue';
import AppNavigationDropdown from '../../components/AppNavigationDropdown.vue';
import CommandFeedback from '../../components/CommandFeedback.vue';
import LoadingSkeleton from '../../components/LoadingSkeleton.vue';
import StatusNotice from '../../components/StatusNotice.vue';
import AppAccordionButton from '../../components/AppAccordionButton.vue';

type Card = components['schemas']['OverviewCard'];
type ChildType = 'packing' | 'activity' | 'drivers';
const props = withDefaults(defineProps<{eventId: string; admin?: boolean; active?: boolean}>(), {active: true});
const context = usePilot();
const {messages} = context;
const api = useEventApi(context);
const packingApi = usePackingApi(context);
const driversApi = useDriversApi(context);
const activityApi = useActivityApi(context);
const id = useId();
const expanded = ref(true);
const adminOpen = ref<ChildType | null>(null);
const key = computed(() => eventKeys.things(context.session.value?.context, props.eventId, !!props.admin));
const disclosed = computed(() => props.admin ? adminOpen.value !== null : expanded.value);
const section = useEventSection(key, readThings, computed(() => props.active !== false), disclosed);
const command = useCommand(section.refresh);
const destination = useConfirmedNavigation();
const removal = useEntityRemoval(command, destination);
const available = useActionState({eligible: mayUseThings, pending: () => command.pending.value,
    blocked: () => command.action.disabled.value || !!destination.target.value});
const refreshAction = useActionState({eligible: () => section.readAction.isAvailable(),
    blocked: () => command.recoveryAction.disabled.value || !!destination.target.value, pending: () => section.query.isFetching.value});
const search = ref('');
const selectedType = ref('all');
const adminSearch = reactive({packing: '', activity: '', drivers: ''});
const groups = [
    {
        type: 'packing', title: 'event.organizer.packingLists', filter: 'event.organizer.filterPacking',
        create: 'event.organizer.createPacking', empty: 'event.organizer.noPacking',
        icon: 'bi-box-seam', itemIcon: 'bi-bag-check', createIcon: 'bi-plus-circle',
    },
    {
        type: 'activity', title: 'event.organizer.activityPlans', filter: 'event.organizer.filterActivity',
        create: 'event.organizer.createActivity', empty: 'event.organizer.noActivities',
        icon: 'bi-calendar', itemIcon: 'bi-calendar-check', createIcon: 'bi-calendar-plus',
    },
    {
        type: 'drivers', title: 'event.organizer.driversLists', filter: 'event.organizer.filterDrivers',
        create: 'event.organizer.createDrivers', empty: 'event.organizer.noDrivers',
        icon: 'bi-car-front', itemIcon: 'bi-car-front', createIcon: 'bi-plus-circle',
    },
] as const;
const items = computed(() => section.data.value?.items ?? []);
const types = computed(() => [...new Set(items.value.map(card => card.type))]);
const filtered = computed(() => items.value.filter(card => matches(card, search.value)
    && (selectedType.value === 'all' || card.type === selectedType.value)));
watch([() => props.eventId, context.epoch, () => context.session.value?.context], retireLocalState);

function readThings(scope: Parameters<typeof api.thingsToDo>[1], signal: AbortSignal) {
    return api.thingsToDo(props.eventId, scope, signal, !!props.admin);
}
function mayUseThings(): boolean { return props.active !== false && !!section.data.value && !section.denied.value; }
function matches(card: Card, value: string): boolean {
    const needle = value.trim().toLowerCase();
    return !needle || `${card.title} ${card.description ?? ''}`.toLowerCase().includes(needle);
}
/** Organizer groups partition the existing projection, without discovering members. */
function groupItems(type: ChildType): Card[] {
    // Counts include every admitted item of this child family before local search.
    return items.value.filter(card => card.type === type);
}
/** Native administration searches only child titles within each independent group. */
function groupRows(type: ChildType): Card[] {
    // Keep a group's query separate from participant-card title/description search.
    return groupItems(type).filter(card => card.title.toLowerCase().includes(adminSearch[type].trim().toLowerCase()));
}
function createHref(type: ChildType): string {
    return `/frontend-pilot/${type}/create?eventId=${encodeURIComponent(props.eventId)}`;
}
function toggleGroup(type: ChildType): void {
    adminOpen.value = adminOpen.value === type ? null : type;
}

/** Shared cards retain their presentation owner. Migrated children receive SPA
 * navigation and their own authorized image operation through explicit inputs. */
function interaction(card: Card): PilotOverviewCardInteraction {
    if (card.type === 'drivers') return {migrated: true, lifecycle: true, readHeader: driversApi.header.bind(driversApi)};
    if (card.type === 'activity') return {migrated: true, lifecycle: true, readHeader: activityApi.header.bind(activityApi)};
    return {migrated: card.type === 'packing', lifecycle: true,
        ...(card.type === 'packing' ? {readHeader: packingApi.header.bind(packingApi)} : {})};
}
function retireLocalState(): void {
    search.value = '';
    selectedType.value = 'all';
    Object.assign(adminSearch, {packing: '', activity: '', drivers: ''});
}
function childType(card: Card): ChildType | null {
    return card.type === 'packing' || card.type === 'activity' || card.type === 'drivers' ? card.type : null;
}

/** Shared archival never changes personal placement or deletes a child. Every
 * child reuses the same confirmation owner and its parent-scoped backend adapter. */
async function archive(card: Card, restore: boolean): Promise<void> {
    if (!available.isAvailable()) return;
    const lifecycle = createChildLifecycle(card);
    if (!lifecycle) return;
    // The shared owner selects the native scheduled-restore warning from the
    // current admitted projection; this host keeps only child/API ownership.
    await lifecycle.archive(card.id, restore, card.inheritedArchived, undefined, !!card.automation);
}

/** Pause/resume uses the controller-projected schedule capability. Only resuming
 * requires the native warning about an already elapsed automatic-archive date. */
async function automate(card: Card, paused: boolean): Promise<void> {
    if (!available.isAvailable() || !card.automation?.canManage) return;
    const lifecycle = createChildLifecycle(card);
    if (!lifecycle) return;
    // The server rechecks schedule eligibility; presentation never infers dates.
    await lifecycle.automate(card.id, paused);
}

/** Bind this admitted Event/child intent to the existing generated operations.
 * Both archive and schedule controls reuse that binding and the same stateless
 * confirmation owner; refreshed rows cannot replace the reviewed parent/type. */
function createChildLifecycle(card: Card) {
    const type = childType(card);
    if (!type) return;

    // Capture the parent and page intent before the command can await admission.
    // Only the generated feature adapter constructs endpoints or request bodies.
    const eventId = props.eventId;
    const admin = !!props.admin;
    return createEntityLifecycle({archive: changeChildArchive, automate: changeChildAutomation}, command, messages);

    function changeChildArchive(childId: string, restore: boolean, scope: PilotRequestScope) {
        return api.archiveChild(eventId, type!, childId, restore, scope, admin);
    }
    function changeChildAutomation(childId: string, pauseSchedule: boolean, scope: PilotRequestScope) {
        return api.automateChild(eventId, type!, childId, pauseSchedule, scope, admin);
    }
}

/** The Event organizer owns deletion through its parent-scoped child operation.
 * Shared removal approves sibling drafts before writing and retains the existing
 * dashboard destination as client navigation after its confirmed JSON receipt. */
async function deleteChild(card: Card): Promise<void> {
    if (!available.isAvailable()) return;
    const type = childType(card);
    if (!type) return;
    const eventId = props.eventId;
    const admin = !!props.admin;
    const childId = card.id;
    const success = type === 'packing' ? 'packing.deleted'
        : type === 'activity' ? 'event.organizer.activityDeleted' : 'event.organizer.driversDeleted';
    await removal.remove({operation: removeChild, confirmation: 'event.organizer.deleteChildConfirm', success});

    function removeChild(scope: PilotRequestScope) {
        return api.deleteChild(eventId, type!, childId, scope, admin);
    }
}
async function refresh(): Promise<void> {
    if (!refreshAction.isAvailable()) return;
    await command.reconcileSafely(section.refresh);
}
</script>

<template>
    <!-- The same admitted related projection has native participant cards or
         organizer list groups. Local filtering never changes membership/authority. -->
    <section data-entity-section>
        <div>
            <CommandFeedback :feedback="command.feedback" :part="command.uncertain.value ? 'error' : 'all'" />
            <CommandFeedback
                :feedback="command.feedback"
                part="uncertain"
                :action="{state: refreshAction, label: messages.t('common.refresh')}"
                @action="refresh"
            />
        </div>
        <StatusNotice v-if="destination.target.value" kind="success"
            :action="{state: destination.retryAction, label: messages.t('common.retry')}" @action="destination.retry">
            {{ messages.t('state.saved') }}
        </StatusNotice>
        <LoadingSkeleton v-if="section.loading.value" :variant="admin ? 'roster' : 'cards'" :rows="4" />
        <StatusNotice
            v-if="section.query.error.value"
            kind="warning"
            :action="{state: refreshAction, label: messages.t('common.retry')}"
            :retry-at="section.retryAt.value"
            @action="refresh"
        >
            {{ section.failure.value ?? messages.t('state.stale') }}
        </StatusNotice>

        <template v-if="section.data.value">
            <!-- Organizer groups keep independent title filters and their existing
                 owner actions. Unmigrated detail links remain explicit boundaries. -->
            <div v-if="admin" class="row">
                <div class="accordion accordion-dark">
                    <div v-for="group in groups" :key="group.type" class="accordion-item dashboard-accordion-item">
                        <h2 class="accordion-header">
                            <AppAccordionButton
                                class="dashboard-accordion-button"
                                :expanded="adminOpen === group.type"
                                :controls="`${id}-${group.type}`"
                                @click="toggleGroup(group.type)"
                            >
                                <i class="bi me-2" :class="group.icon" aria-hidden="true"></i>{{ messages.t(group.title) }}<span class="badge bg-secondary ms-2">{{ groupItems(group.type).length }}</span>
                            </AppAccordionButton>
                        </h2>
                        <div
                            v-show="adminOpen === group.type"
                            :id="`${id}-${group.type}`"
                            class="accordion-collapse dashboard-accordion-body"
                        >
                            <div class="accordion-body">
                                <div class="dashboard-toolbar">
                                    <div class="dashboard-filter input-group input-group-sm">
                                        <span class="input-group-text"><i class="bi bi-search" aria-hidden="true"></i></span>
                                        <input
                                            v-model="adminSearch[group.type]"
                                            class="form-control"
                                            type="search"
                                            :placeholder="messages.t(group.filter)"
                                            :aria-label="messages.t(group.filter)"
                                            :disabled="available.disabled.value"
                                        />
                                        <component
                                            :is="RouterLink"
                                            class="btn btn-primary"
                                            :to="createHref(group.type)"
                                            :href="createHref(group.type)"
                                        >
                                            <i class="bi me-1" :class="group.createIcon" aria-hidden="true"></i>{{ messages.t(group.create) }}
                                        </component>
                                    </div>
                                    <div class="dashboard-count small">
                                        <i class="bi bi-list-ul" aria-hidden="true"></i><span>{{ groupRows(group.type).length }}</span>
                                    </div>
                                </div>

                                <div v-if="groupItems(group.type).length" class="list-group dashboard-list">
                                    <div
                                        v-for="card in groupRows(group.type)"
                                        :key="card.id"
                                        class="list-group-item list-group-item-action d-flex justify-content-between align-items-center"
                                    >
                                        <component
                                            :is="RouterLink"
                                            class="text-decoration-none flex-grow-1"
                                            :to="card.url"
                                            :href="card.url"
                                        >
                                            <i class="bi me-2" :class="group.itemIcon" aria-hidden="true"></i>{{ card.title }}
                                        </component>
                                        <div
                                            v-if="card.capabilities.duplicate || card.capabilities.remove"
                                            class="d-inline btn-group ms-2"
                                        >
                                            <component
                                                :is="RouterLink"
                                                v-if="card.capabilities.duplicate"
                                                class="btn btn-sm btn-outline-info"
                                                :to="card.url + '/duplicate'"
                                                :href="card.url + '/duplicate'"
                                            >
                                                <i class="bi bi-files me-1" aria-hidden="true"></i>{{ messages.t('common.duplicate') }}
                                            </component>
                                            <ActionButton
                                                v-if="card.capabilities.remove"
                                                type="button"
                                                class="btn-sm"
                                                variant="outline-danger"
                                                :state="available"
                                                :disabled="available.disabled.value"
                                                @click="deleteChild(card)"
                                            >
                                                <i class="bi bi-trash me-1" aria-hidden="true"></i>{{ messages.t('overview.delete') }}
                                            </ActionButton>
                                        </div>
                                    </div>
                                </div>
                                <!-- The shared spacing input preserves native empty-card spacing. -->
                                <StatusNotice v-else kind="info" no-margin>{{ messages.t(group.empty) }}</StatusNotice>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Participant cards share Overview presentation without personal
                 visibility. Search/type selection remain local presentation state. -->
            <div v-else class="accordion accordion-dark">
                <div class="accordion-item entity-overview overflow-visible">
                    <h2 class="accordion-header">
                        <AppAccordionButton
                            :expanded="expanded"
                            :controls="`${id}-things`"
                            @click="expanded = !expanded"
                        >
                            <i class="bi bi-clipboard-check me-2" aria-hidden="true"></i>{{ messages.t('event.organizer.thingsToDo') }}<span class="badge bg-secondary ms-2">{{ items.length }}</span>
                        </AppAccordionButton>
                    </h2>
                    <div v-show="expanded" :id="`${id}-things`" class="accordion-collapse">
                        <div class="accordion-body">
                            <div v-if="items.length" class="d-flex flex-wrap gap-2 mb-3 align-items-center">
                                <div class="input-group input-group-sm" style="max-width: 320px">
                                    <span class="input-group-text"><i class="bi bi-search" aria-hidden="true"></i></span>
                                    <input
                                        v-model="search"
                                        class="form-control"
                                        type="search"
                                        :placeholder="messages.t('event.organizer.searchThings')"
                                        :aria-label="messages.t('event.organizer.searchThings')"
                                        :disabled="available.disabled.value"
                                    />
                                </div>
                                <AppNavigationDropdown
                                    :navigation="false"
                                    :label="messages.t('overview.filter')"
                                    trigger-class="btn btn-outline-secondary btn-sm dropdown-toggle"
                                >
                                    <button
                                        class="dropdown-item"
                                        type="button"
                                        :aria-pressed="selectedType === 'all'"
                                        :disabled="available.disabled.value"
                                        @click="selectedType = 'all'"
                                    >
                                        {{ messages.t('overview.allTypes') }}
                                    </button>
                                    <hr class="dropdown-divider" />
                                    <button
                                        v-for="type in types"
                                        :key="type"
                                        class="dropdown-item"
                                        type="button"
                                        :aria-pressed="selectedType === type"
                                        :disabled="available.disabled.value"
                                        @click="selectedType = type"
                                    >
                                        {{ messages.t(`overview.types.${type}`) }}
                                    </button>
                                </AppNavigationDropdown>
                                <span class="small text-body-secondary" aria-live="polite">
                                    {{ messages.t('event.organizer.shown', {count: filtered.length}) }}
                                </span>
                            </div>

                            <div v-if="items.length" class="row row-cols-1 row-cols-sm-2 row-cols-md-3 row-cols-lg-4 g-4">
                                <div v-for="card in filtered" :key="card.type + ':' + card.id" class="col">
                                    <OverviewCard
                                        :card="card"
                                        :interaction="interaction(card)"
                                        :personal-visibility="false"
                                        :disabled="available.disabled.value"
                                        :active="active && expanded"
                                        :read-revision="section.query.dataUpdatedAt.value"
                                        @archive="archive(card, $event)"
                                        @automate="automate(card, $event)"
                                    />
                                </div>
                            </div>
                            <StatusNotice v-if="items.length && !filtered.length" kind="info" no-margin class="mt-3">
                                {{ messages.t('overview.noMatches') }}
                            </StatusNotice>
                            <StatusNotice v-if="!items.length" kind="info" no-margin>
                                {{ messages.t('event.organizer.nothingToDo') }}
                            </StatusNotice>
                        </div>
                    </div>
                </div>
            </div>
        </template>
    </section>
</template>
