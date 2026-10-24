<script setup lang="ts">
import {computed} from 'vue';
import type {components} from '../../../types/api/v1';
import type {PilotActionState, PilotOverviewCardInteraction} from '../../../types/FrontendPilotUiTypes';
import {usePilot} from '../../app/context';
import {isOrdinaryNavigation} from '../../composables/pageEntry';
import StatusNotice from '../../components/StatusNotice.vue';
import OverviewCard from './OverviewCard.vue';

type Card = components['schemas']['OverviewCard'];
const props = defineProps<{view: components['schemas']['OverviewRegion']; disabled: boolean; navigationState?: PilotActionState; readRevision?: number; active?: boolean;
    pageHref: (page: number) => string; expandHref: (card: Card) => string;
    cardInteraction: (card: Card) => PilotOverviewCardInteraction}>();
const emit = defineEmits<{
    visibility: [card: Card, value: components['schemas']['OverviewVisibilityInput']['visibility']];
    archive: [card: Card, restore: boolean];
    automate: [card: Card, paused: boolean];
    remove: [card: Card];
    expand: [card: Card];
    page: [page: number];
}>();
const {messages} = usePilot();
const filtered = computed(() => Boolean(props.view.q) || props.view.type !== 'all');
// Empty membership, privately hidden content and an actual no-match filter are distinct
// native states. The shared card counts alone cannot identify an applied filter.
const emptyMessage = computed(() => {
    if (props.view.parent) return filtered.value ? 'overview.noMatchingChildren' : 'overview.emptyChildren';
    if (filtered.value) return 'overview.noMatches';
    if (props.view.region === 'hidden') return 'overview.emptyHidden';
    if (props.view.totalEntities) return 'overview.allHidden';
    return props.view.collection === 'participant' ? 'overview.emptyParticipant' : 'overview.emptyOwner';
});
// A parent card is a navigation container. Its pager counts matching children, while the
// outer region counts cards (an event grouping several lists is still one outer card).
const currentPage = computed(() => (props.view.parent ? props.view.childPage : props.view.page));
const count = computed(() =>
    props.view.parent ? (props.view.parent.children?.matching ?? 0) : props.view.totalCards,
);
const range = computed(() => ({
    first: count.value ? (currentPage.value - 1) * props.view.pageSize + 1 : 0,
    last: Math.min(currentPage.value * props.view.pageSize, count.value),
    count: count.value,
}));

/** Disabled pagers remain inert; eligible modified clicks keep their native destination. */
function followPage(event: MouseEvent, page: number, available: boolean): void {
    if (!isOrdinaryNavigation(event)) return;
    event.preventDefault();
    if (available && !props.disabled && props.navigationState?.isAvailable() !== false) emit('page', page);
}
</script>
<template>
    <div v-if="view.items.length" class="row row-cols-1 row-cols-sm-2 row-cols-md-3 row-cols-lg-4 g-4">
        <div v-for="card in view.items" :key="card.type + ':' + card.id" class="col">
            <OverviewCard
                :card="card"
                :interaction="cardInteraction(card)"
                :disabled="disabled"
                :navigation-state="navigationState"
                :expansion="!view.parent"
                :filtered="filtered"
                :read-revision="readRevision"
                :active="active"
                :expansion-href="expandHref(card)"
                @visibility="emit('visibility', card, $event)"
                @archive="emit('archive', card, $event)"
                @automate="emit('automate', card, $event)"
                @remove="emit('remove', card)"
                @expand="emit('expand', card)"
            />
        </div>
    </div>
    <!-- Empty and filtered regions retain native zero bottom spacing. Use the
         shared notice's spacing input so its default utility cannot override it. -->
    <StatusNotice v-else kind="info" no-margin>{{
        messages.t(emptyMessage)
    }}</StatusNotice>
    <div
        v-if="view.items.length || view.parent"
        class="d-flex flex-wrap justify-content-between align-items-center gap-2 mt-3"
    >
        <span class="small text-body-secondary">{{
            messages.t(view.parent ? 'overview.childRange' : 'overview.cardRange', range)
        }}</span>
        <nav
            class="pilot-action-row"
            :aria-label="messages.t(view.parent ? 'overview.childNavigation' : 'overview.pageNavigation')"
        >
            <a
                class="btn btn-sm btn-outline-secondary" :class="{disabled: !view.hasPrevious || disabled}"
                :aria-disabled="!view.hasPrevious || disabled || navigationState?.disabled.value"
                :href="view.hasPrevious && !disabled ? pageHref(currentPage - 1) : undefined"
                @click="followPage($event, currentPage - 1, view.hasPrevious)"
                >{{ messages.t('overview.previous') }}</a
            >
            <a
                class="btn btn-sm btn-outline-secondary" :class="{disabled: !view.hasNext || disabled}"
                :aria-disabled="!view.hasNext || disabled || navigationState?.disabled.value"
                :href="view.hasNext && !disabled ? pageHref(currentPage + 1) : undefined"
                @click="followPage($event, currentPage + 1, view.hasNext)"
                >{{ messages.t('overview.next') }}</a
            >
        </nav>
    </div>
</template>
