<script setup lang="ts">
import {RouterLink} from 'vue-router';
import type {EntityLifecycleActionsProps} from '../../types/FrontendEntitySettingsTypes';
import {usePilot} from '../app/context';
import ActionButton from './ActionButton.vue';

// The controller/feature supplies capabilities and destinations. This shared view
// keeps archival, duplicate navigation and permanent deletion as distinct actions.
defineProps<EntityLifecycleActionsProps>();
const emit = defineEmits<{archive: [restore: boolean, source: Event]; remove: [source: Event]; automate: [paused: boolean, source: Event]}>();
const {messages} = usePilot();
</script>

<template>
    <!-- Inherited archival explains the existing parent action without deleting any data. -->
    <section v-if="manageArchive" class="mb-4" data-entity-section="archival">
        <h3 class="fs-5">{{ messages.t('common.archival') }}</h3>
        <p>{{ inherited || direct ? labels.archivedHint : labels.activeHint }}</p>
        <!-- The native gap comes from ms-1 alone; adjacent text/link avoids another collapsed space. -->
        <p v-if="inherited">
            {{ labels.inheritedHint }}<RouterLink v-if="eventUrl" class="ms-1" :to="eventUrl">{{ labels.openEvent }}</RouterLink>
        </p>
        <p v-if="contextHint">{{ contextHint }}</p>
        <p v-if="automation?.paused">{{ automation.pausedHint }}</p>
        <div class="pilot-action-row">
            <ActionButton v-if="canArchive" class="btn-sm" variant="outline-light" :disabled="disabled"
                :pending="pendingAction === 'archive'" :show-spinner="false"
                @click="emit('archive', false, $event)">{{ messages.t('common.archive') }}</ActionButton
            ><ActionButton v-if="canRestore" class="btn-sm" variant="outline-light" :disabled="disabled"
                :pending="pendingAction === 'archive'" :show-spinner="false"
                @click="emit('archive', true, $event)">{{ messages.t('common.restore') }}</ActionButton>
            <ActionButton v-if="automation" class="btn-sm" variant="outline-light" :disabled="disabled"
                :pending="pendingAction === 'automation'" :show-spinner="false"
                @click="emit('automate', !automation.paused, $event)">{{ automation.paused ? automation.resumeLabel : automation.pauseLabel }}</ActionButton>
        </div>
    </section>
    <!-- Preserve ordinary duplicate-link semantics; deletion is a separately confirmed command. -->
    <section v-if="canDuplicate || canRemove || exportLink" data-entity-section="actions">
        <h3 class="fs-5">{{ labels.otherActions }}</h3>
        <div class="pilot-action-row">
            <RouterLink v-if="canDuplicate" class="btn btn-outline-light" :to="duplicateTo">{{
                messages.t('common.duplicate')
            }}</RouterLink
            ><a v-if="exportLink" class="btn btn-outline-light" :href="exportLink.url" target="_blank" rel="noopener">{{ exportLink.label }}</a
            ><ActionButton v-if="canRemove" variant="outline-danger" :disabled="disabled || removeDisabled"
                :pending="pendingAction === 'remove'" :show-spinner="false"
                @click="emit('remove', $event)">{{ labels.deletePermanently }}</ActionButton>
        </div>
    </section>
</template>
