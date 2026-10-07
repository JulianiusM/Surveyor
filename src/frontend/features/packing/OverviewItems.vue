<script setup lang="ts">
import {computed} from 'vue';
import type {components} from '../../../types/api/v1';
import {usePilot} from '../../app/context';
import ActionButton from '../../components/ActionButton.vue';
import StatusNotice from '../../components/StatusNotice.vue';
import OverviewCard from './OverviewCard.vue';

type Card = components['schemas']['PackingOverviewCard'];
const props = defineProps<{view: components['schemas']['PackingOverviewRegion']; disabled: boolean}>();
const emit = defineEmits<{
    visibility: [card: Card, value: components['schemas']['PackingVisibilityInput']['visibility']];
    archive: [card: Card, restore: boolean];
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
</script>
<template>
    <div v-if="view.items.length" class="row row-cols-1 row-cols-sm-2 row-cols-md-3 row-cols-lg-4 g-4">
        <div v-for="card in view.items" :key="card.type + ':' + card.id" class="col">
            <OverviewCard
                :card="card"
                :disabled="disabled"
                :expansion="!view.parent"
                :filtered="filtered"
                @visibility="emit('visibility', card, $event)"
                @archive="emit('archive', card, $event)"
                @remove="emit('remove', card)"
                @expand="emit('expand', card)"
            />
        </div>
    </div>
    <StatusNotice v-else kind="info" class="mb-0">{{
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
            class="d-flex gap-2"
            :aria-label="messages.t(view.parent ? 'overview.childNavigation' : 'overview.pageNavigation')"
        >
            <ActionButton
                class="btn-sm"
                variant="outline-secondary"
                :disabled="!view.hasPrevious || disabled"
                @click="emit('page', currentPage - 1)"
                >{{ messages.t('overview.previous') }}</ActionButton
            >
            <ActionButton
                class="btn-sm"
                variant="outline-secondary"
                :disabled="!view.hasNext || disabled"
                @click="emit('page', currentPage + 1)"
                >{{ messages.t('overview.next') }}</ActionButton
            >
        </nav>
    </div>
</template>
