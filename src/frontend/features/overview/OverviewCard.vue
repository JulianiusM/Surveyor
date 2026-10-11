<script setup lang="ts">
import {computed, watch} from 'vue';
import {RouterLink} from 'vue-router';
import type {components} from '../../../types/api/v1';
import {usePilot} from '../../app/context';
import {useAuthorizedImage} from '../../composables/authorizedImage';
import {usePackingApi} from '../packing/api';
import {isOrdinaryNavigation} from '../../composables/pageEntry';
import ActionButton from '../../components/ActionButton.vue';
import AppNavigationDropdown from '../../components/AppNavigationDropdown.vue';

// TODO (docs/FRONTEND_PILOT.md): Migrate non-packing detail/administration destinations
// with their feature owners. These mixed Overview cards deliberately keep working native
// links until then; their shared projection does not make those workflows complete.
const props = defineProps<{
    card: components['schemas']['OverviewCard'];
    disabled?: boolean;
    expansion?: boolean;
    expansionHref?: string;
    filtered?: boolean;
    readRevision?: number;
    active?: boolean;
}>();
const emit = defineEmits<{
    visibility: [value: components['schemas']['OverviewVisibilityInput']['visibility']];
    expand: [];
    archive: [restore: boolean];
    remove: [];
}>();
const context = usePilot();
const {messages} = context;
const packingApi = usePackingApi(context);
const packingHeader = useAuthorizedImage(
    computed(() => props.card.id),
    computed(() => (props.card.type === 'packing' ? props.card.headerVersion : null)),
    packingApi.header.bind(packingApi),
    computed(() => props.active !== false),
);
const image = computed(() => (props.card.type === 'packing' ? packingHeader.source.value : props.card.headerUrl));
// The region owns JSON delivery. Its completion marker also advances for equal
// responses, allowing a missing binary image to recover while healthy URLs stay.
watch(() => props.readRevision, recoverHeaderAfterRead);

function recoverHeaderAfterRead(): void {
    if (props.card.type === 'packing') void packingHeader.refresh();
}

/** The href remains usable for a separate document; only ordinary clicks expand this region. */
function expand(event: MouseEvent): void {
    if (!isOrdinaryNavigation(event)) return;
    event.preventDefault();
    if (!props.disabled) emit('expand');
}
</script>
<template>
    <article
        class="card h-100 bg-secondary-subtle border-secondary js-item"
        :data-id="card.id"
        :data-type="card.type"
    >
        <component
            :is="card.type === 'packing' ? RouterLink : 'a'"
            v-if="image"
            :to="card.url"
            :href="card.url"
            ><img
                class="card-img-top"
                :src="image"
                :alt="card.title"
                style="object-fit: cover; height: 200px"
                loading="lazy"
        /></component>
        <component
            :is="card.type === 'packing' ? RouterLink : 'a'"
            class="card-body text-decoration-none"
            :to="card.url"
            :href="card.url"
            ><h4 class="card-title mb-1 text-break">{{ card.title }}</h4>
            <p v-if="card.description" class="card-text small mb-2 text-truncate" style="max-width: 100%">
                {{ card.description }}
            </p></component
        >
        <div class="card-footer">
            <p v-if="card.eventContext" class="small mb-2">
                <i class="bi bi-calendar-event me-1" aria-hidden="true"></i
                ><a :href="card.eventContext.url">{{ card.eventContext.title }}</a>
            </p>
            <div class="d-flex flex-wrap gap-2 align-items-center mb-2">
                <span class="badge bg-primary">{{
                    messages.t(`overview.types.${card.type}`)
                }}</span
                ><span v-if="card.archived" class="badge text-bg-secondary"
                    ><i class="bi bi-archive me-1" aria-hidden="true"></i
                    >{{ messages.t('packing.archivedOption') }}</span
                ><span v-if="card.visibility !== 'default'" class="badge text-bg-info">{{
                    messages.t(card.visibility === 'hidden' ? 'overview.hiddenBadge' : 'overview.shown')
                }}</span>
            </div>
            <div class="d-flex flex-wrap gap-2">
                <AppNavigationDropdown :navigation="false" :label="messages.t('packing.archival')"
                    trigger-class="btn btn-sm btn-outline-light dropdown-toggle"
                    :trigger-label="messages.t('overview.archiveMenu', {title: card.title})">
                        <template
                            v-if="
                                card.type === 'packing' &&
                                (card.capabilities.archive || card.capabilities.restore)
                            "
                            ><h6 class="dropdown-header">{{ messages.t('overview.forEveryone') }}</h6>
                            <button
                                type="button"
                                v-if="card.capabilities.archive"
                                class="dropdown-item"
                                :disabled="disabled"
                                @click="emit('archive', false)"
                            >
                                {{ messages.t('packing.archive') }}</button
                            ><button
                                type="button"
                                v-if="card.capabilities.restore"
                                class="dropdown-item"
                                :disabled="disabled"
                                @click="emit('archive', true)"
                            >
                                {{ messages.t('packing.restore') }}
                            </button>
                            <hr class="dropdown-divider"
                        /></template>
                        <h6 class="dropdown-header">{{ messages.t('overview.onlyOverview') }}</h6>
                        <button
                            type="button"
                            v-if="card.visibility !== 'hidden'"
                            class="dropdown-item"
                            :disabled="disabled"
                            @click="emit('visibility', 'hidden')"
                        >
                            {{ messages.t('overview.hide') }}
                        </button>
                        <button
                            type="button"
                            v-if="card.visibility !== 'shown'"
                            class="dropdown-item"
                            :disabled="disabled"
                            @click="emit('visibility', 'shown')"
                        >
                            {{ messages.t('overview.show') }}</button
                        ><button
                            type="button"
                            v-if="card.visibility !== 'default'"
                            class="dropdown-item"
                            :disabled="disabled"
                            @click="emit('visibility', 'default')"
                        >
                            {{ messages.t('overview.follow') }}
                        </button>
                </AppNavigationDropdown>
                <div
                    v-if="card.capabilities.duplicate || card.capabilities.remove"
                    class="d-inline btn-group"
                >
                    <RouterLink
                        v-if="card.type === 'packing' && card.capabilities.duplicate"
                        class="btn btn-sm btn-info"
                        :to="card.url + '/duplicate'"
                        ><i class="bi bi-files me-1" aria-hidden="true"></i
                        >{{ messages.t('packing.duplicate') }}</RouterLink
                    >
                    <ActionButton
                        v-if="card.type === 'packing' && card.capabilities.remove"
                        class="btn-sm"
                        variant="danger"
                        :disabled="disabled"
                        @click="emit('remove')"
                        ><i class="bi bi-trash me-1" aria-hidden="true"></i
                        >{{ messages.t('overview.delete') }}</ActionButton
                    >
                </div>
            </div>
            <a
                v-if="expansion && card.children"
                class="btn btn-sm mt-2 btn-outline-primary"
                :aria-label="messages.t('overview.showLinked', {title: card.title})"
                :href="expansionHref"
                :data-overview-event="card.id"
                @click="expand"
                ><i class="bi bi-collection me-1" aria-hidden="true"></i
                >{{
                    filtered
                        ? messages.t('overview.linkedFiltered', {
                              matching: card.children.matching,
                              total: card.children.total,
                          })
                        : messages.t('overview.linkedTotal', {total: card.children.total})
                }}</a
            >
        </div>
        <div v-if="$slots.default" class="card-body border-top entity-overview-children"><slot /></div>
    </article>
</template>
