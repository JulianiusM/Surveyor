<script setup lang="ts">
import {computed, watch} from 'vue';
import {RouterLink} from 'vue-router';
import type {components} from '../../../types/api/v1';
import type {PilotActionState, PilotOverviewCardInteraction, PilotRequestScope} from '../../../types/FrontendPilotUiTypes';
import {usePilot} from '../../app/context';
import {useAuthorizedImage} from '../../composables/authorizedImage';
import {ObsoleteRequestError} from '../../app/transport';
import {isOrdinaryNavigation} from '../../composables/pageEntry';
import ActionButton from '../../components/ActionButton.vue';
import AppNavigationDropdown from '../../components/AppNavigationDropdown.vue';

// Personal Overview and Event children share this presentation. Their owning
// feature supplies navigation, lifecycle and binary-read operations explicitly.
const props = withDefaults(defineProps<{
    card: components['schemas']['OverviewCard'];
    interaction: PilotOverviewCardInteraction;
    disabled?: boolean;
    navigationState?: PilotActionState;
    expansion?: boolean;
    expansionHref?: string;
    filtered?: boolean;
    readRevision?: number;
    active?: boolean;
    personalVisibility?: boolean;
}>(), {personalVisibility: true});
const emit = defineEmits<{
    visibility: [value: components['schemas']['OverviewVisibilityInput']['visibility']];
    expand: [];
    archive: [restore: boolean];
    automate: [paused: boolean];
    remove: [];
}>();
const context = usePilot();
const {messages} = context;
// A collection may require fresh data for writes while keeping retained cards
// navigable. Other hosts retain their existing overall disabled contract.
const writeDisabled = computed(() => props.disabled || props.interaction.writesDisabled);
// This card owns image lifetime and presentation. The region supplies the feature
// endpoint and SPA eligibility; adding a migrated feature does not add API imports here.
const authorizedHeader = useAuthorizedImage(
    computed(() => props.card.id),
    computed(() => props.interaction.readHeader ? props.card.headerVersion : null),
    readHeader,
    computed(() => props.active !== false),
);
const image = computed(() => props.interaction.readHeader ? authorizedHeader.source.value : props.card.headerUrl);

/** A retired feature declaration supplies no binary authority. The image helper
 * already fences actor, resource and version before installing any returned bytes. */
function readHeader(id: string, scope: PilotRequestScope, signal: AbortSignal): Promise<Blob> {
    const read = props.interaction.readHeader;
    if (!read) throw new ObsoleteRequestError();
    return read(id, scope, signal);
}
// The region owns JSON delivery. Its completion marker also advances for equal
// responses, allowing a missing binary image to recover while healthy URLs stay.
watch(() => props.readRevision, recoverHeaderAfterRead);

function recoverHeaderAfterRead(): void {
    if (props.interaction.readHeader) void authorizedHeader.refresh();
}

/** The href remains usable for a separate document; only ordinary clicks expand this region. */
function expand(event: MouseEvent): void {
    if (!isOrdinaryNavigation(event)) return;
    event.preventDefault();
    if (!props.disabled && props.navigationState?.isAvailable() !== false) emit('expand');
}
</script>
<template>
    <article
        class="card h-100 bg-secondary-subtle border-secondary js-item"
        :data-id="card.id"
        :data-type="card.type"
    >
        <component
            :is="interaction.migrated ? RouterLink : 'a'"
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
            :is="interaction.migrated ? RouterLink : 'a'"
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
                ><RouterLink :to="card.eventContext.url">{{ card.eventContext.title }}</RouterLink>
            </p>
            <div class="d-flex flex-wrap gap-2 align-items-center mb-2">
                <span class="badge bg-primary">{{
                    messages.t(`overview.types.${card.type}`)
                }}</span
                ><span v-if="card.archived" class="badge text-bg-secondary"
                    ><i class="bi bi-archive me-1" aria-hidden="true"></i
                    >{{ messages.t('common.archived') }}</span
                ><span v-if="personalVisibility && card.visibility !== 'default'" class="badge text-bg-info">{{
                    messages.t(card.visibility === 'hidden' ? 'overview.hiddenBadge' : 'overview.shown')
                }}</span>
            </div>
            <div class="d-flex flex-wrap gap-2">
                <AppNavigationDropdown v-if="personalVisibility || (interaction.lifecycle ?? interaction.migrated) && (card.capabilities.archive || card.capabilities.restore || card.automation?.canManage)" :navigation="false" :label="messages.t('common.archival')"
                    trigger-class="btn btn-sm btn-outline-light dropdown-toggle"
                    :trigger-label="messages.t('overview.archiveMenu', {title: card.title})">
                        <template
                            v-if="
                                (interaction.lifecycle ?? interaction.migrated) &&
                                (card.capabilities.archive || card.capabilities.restore || card.automation?.canManage)
                            "
                            ><h6 class="dropdown-header">{{ messages.t('overview.forEveryone') }}</h6>
                            <button
                                type="button"
                                v-if="card.capabilities.archive"
                                class="dropdown-item"
                                :disabled="writeDisabled"
                                @click="emit('archive', false)"
                            >
                                {{ messages.t('common.archive') }}</button
                            ><button
                                type="button"
                                v-if="card.capabilities.restore"
                                class="dropdown-item"
                                :disabled="writeDisabled"
                                @click="emit('archive', true)"
                            >
                                {{ messages.t('common.restore') }}
                            </button>
                            <button v-if="card.automation?.canManage" type="button" class="dropdown-item" :disabled="writeDisabled"
                                @click="emit('automate', !card.automation.paused)">{{ messages.t(card.automation.paused ? 'event.organizer.resumeAutomation' : 'event.organizer.pauseAutomation') }}</button>
                            <hr v-if="personalVisibility" class="dropdown-divider"
                        /></template>
                        <template v-if="personalVisibility">
                        <h6 class="dropdown-header">{{ messages.t('overview.onlyOverview') }}</h6>
                        <button
                            type="button"
                            v-if="card.visibility !== 'hidden'"
                            class="dropdown-item"
                            :disabled="writeDisabled"
                            @click="emit('visibility', 'hidden')"
                        >
                            {{ messages.t('overview.hide') }}
                        </button>
                        <button
                            type="button"
                            v-if="card.visibility !== 'shown'"
                            class="dropdown-item"
                            :disabled="writeDisabled"
                            @click="emit('visibility', 'shown')"
                        >
                            {{ messages.t('overview.show') }}</button
                        ><button
                            type="button"
                            v-if="card.visibility !== 'default'"
                            class="dropdown-item"
                            :disabled="writeDisabled"
                            @click="emit('visibility', 'default')"
                        >
                            {{ messages.t('overview.follow') }}
                        </button>
                        </template>
                </AppNavigationDropdown>
                <div
                    v-if="card.capabilities.duplicate || card.capabilities.remove"
                    class="d-inline btn-group"
                >
                    <RouterLink
                        v-if="interaction.migrated && interaction.duplicateUrl && card.capabilities.duplicate"
                        class="btn btn-sm btn-info"
                        :to="interaction.duplicateUrl"
                        ><i class="bi bi-files me-1" aria-hidden="true"></i
                        >{{ messages.t('common.duplicate') }}</RouterLink
                    >
                    <ActionButton
                        v-if="interaction.migrated && card.capabilities.remove"
                        class="btn-sm"
                        variant="danger"
                        :disabled="writeDisabled"
                        :pending="interaction.removePending" :show-spinner="false"
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
                :aria-disabled="disabled || navigationState?.disabled.value"
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
