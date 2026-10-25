<script setup lang="ts">
import {computed, nextTick, onBeforeUnmount} from 'vue';
import {RouterLink} from 'vue-router';
import {hashKey} from '@tanstack/vue-query';
import type {EntityHeaderProps} from '../../types/FrontendEntitySettingsTypes';
import type {FrontendRequestScope} from '../../types/FrontendUiTypes';
import {useFrontend} from '../app/context';
import {observeQueryReads} from '../app/queryCache';
import {useAuthorizedImage} from '../composables/authorizedImage';
import ActionButton from './ActionButton.vue';
import PageHeading from './PageHeading.vue';

// Features retain their admitted title, parent URL, image version and settings
// capability. This owner shares the displayed layout and binary-image lifecycle;
// neither a cached query nor a visible settings action grants server authority.
const props = defineProps<EntityHeaderProps>();
const emit = defineEmits<{settings: []}>();
const context = useFrontend();
const {messages} = context;
const image = useAuthorizedImage(
    computed(() => props.resourceId),
    computed(() => props.imageVersion),
    readHeader,
    computed(() => props.imageEnabled !== false),
);
const source = image.source;
const stopReads = observeQueryReads(context.queryClient, () => props.imageQueryKey, recoverHeaderAfterRead);
onBeforeUnmount(stopReads);

function readHeader(id: string, scope: FrontendRequestScope, signal: AbortSignal): Promise<Blob> {
    return props.readImage(id, scope, signal);
}

/** Equal successful feature reads can restore a missing binary image without
 * replacing a healthy browser URL. Only the supplied query's actual read receipt
 * reaches this path; cache aliases and canceled reads cannot regrant authority. */
async function recoverHeaderAfterRead(): Promise<void> {
    const resource = props.resourceId;
    const key = hashKey(props.imageQueryKey);
    // Query receipts arrive before a parent's next render passes new props. Let
    // that admitted image absence/version reach this owner before recovering it.
    await nextTick();
    if (resource !== props.resourceId || key !== hashKey(props.imageQueryKey)) return;

    // The image owner retains actor/resource/version admission, cooldown,
    // cancellation and URL disposal. This component stores no server snapshot.
    if (props.imageEnabled !== false) await image.refresh();
}
</script>

<template>
    <div class="card-header p-0">
        <img
            v-if="source"
            :src="source"
            :alt="title"
            class="card-img-top"
            style="object-fit: cover; height: 250px"
        />
        <PageHeading :title="title" :icon="icon">
            <template v-if="parentUrl" #parent>
                <RouterLink class="btn btn-outline-light entity-header-parent" :to="parentUrl">
                    <i class="bi bi-arrow-left-circle me-1" aria-hidden="true"></i>{{ messages.t('packing.goToEvent') }}
                </RouterLink>
            </template>
            <!-- Features own availability and pending state. Opening settings is
                 an explicit presentation event, never an inferred permission.
                 Injected actions retain the feature's existing read lifecycle. -->
            <template #actions>
                <ActionButton
                    v-if="settingsAvailable"
                    class="entity-header-settings"
                    variant="outline-light"
                    :disabled="settingsDisabled"
                    @click="emit('settings')"
                >
                    <i class="bi bi-gear me-1" aria-hidden="true"></i>{{ messages.t('packing.edit') }}
                </ActionButton>
                <slot name="actions" />
            </template>
        </PageHeading>
    </div>
</template>

<style scoped>
/* Parent navigation fills its mobile row. Settings and Refresh use the same
   shared phone action rows, with all admission retained by their feature. */
@media (max-width: 767.98px) {
    .entity-header-parent { width: 100%; }
    .entity-header-settings { flex: 1 1 auto; }
}
</style>
