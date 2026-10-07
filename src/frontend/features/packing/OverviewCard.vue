<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, ref} from 'vue';
import {RouterLink} from 'vue-router';
import type {components} from '../../../types/api/v1';
import {usePilot} from '../../app/context';
import {usePackingHeader} from '../../composables/packingHeader';
import {useDropdownPlacement} from '../../composables/dropdownPlacement';
import ActionButton from '../../components/ActionButton.vue';
const props = defineProps<{
    card: components['schemas']['PackingOverviewCard'];
    disabled?: boolean;
    expansion?: boolean;
    filtered?: boolean;
}>();
const emit = defineEmits<{
    visibility: [value: components['schemas']['PackingVisibilityInput']['visibility']];
    expand: [];
    archive: [restore: boolean];
    remove: [];
}>();
const {messages} = usePilot();
const packingHeader = usePackingHeader(
    computed(() => props.card.id),
    computed(() => (props.card.type === 'packing' ? props.card.headerVersion : null)),
);
const image = computed(() => (props.card.type === 'packing' ? packingHeader.value : props.card.headerUrl));
const menu = ref<HTMLDetailsElement | null>(null);
const {dropdownStyle, updatePlacement} = useDropdownPlacement(menu);
function closeMenu(restoreFocus = false): void {
    if (!menu.value) return;
    menu.value.open = false;
    if (restoreFocus) menu.value.querySelector('summary')?.focus();
}
function outside(event: PointerEvent): void {
    if (menu.value && !menu.value.contains(event.target as Node)) closeMenu();
}
function navigateMenu(event: KeyboardEvent): void {
    if (!menu.value || !['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    menu.value.open = true;
    updatePlacement();
    const options = [...menu.value.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const current = options.indexOf(document.activeElement as HTMLButtonElement);
    const next =
        current < 0
            ? event.key === 'ArrowDown'
                ? 0
                : options.length - 1
            : Math.max(0, Math.min(options.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)));
    options[next]?.focus({preventScroll: true});
}
onMounted(() => document.addEventListener('pointerdown', outside));
onBeforeUnmount(() => document.removeEventListener('pointerdown', outside));
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
                <details
                    ref="menu"
                    class="position-relative"
                    @keydown.esc.prevent="closeMenu(true)"
                    @keydown="navigateMenu"
                >
                    <summary
                        class="btn btn-sm btn-outline-light dropdown-toggle"
                        :aria-label="messages.t('overview.archiveMenu', {title: card.title})"
                    >
                        {{ messages.t('packing.archival') }}
                    </summary>
                    <div class="dropdown-menu show position-absolute" :style="dropdownStyle" @click="closeMenu()">
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
                    </div>
                </details>
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
            <ActionButton
                v-if="expansion && card.children"
                class="btn-sm mt-2"
                variant="outline-primary"
                :aria-label="messages.t('overview.showLinked', {title: card.title})"
                @click="emit('expand')"
                ><i class="bi bi-collection me-1" aria-hidden="true"></i
                >{{
                    filtered
                        ? messages.t('overview.linkedFiltered', {
                              matching: card.children.matching,
                              total: card.children.total,
                          })
                        : messages.t('overview.linkedTotal', {total: card.children.total})
                }}</ActionButton
            >
        </div>
        <div v-if="$slots.default" class="card-body border-top entity-overview-children"><slot /></div>
    </article>
</template>
