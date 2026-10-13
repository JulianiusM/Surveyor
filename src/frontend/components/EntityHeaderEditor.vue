<script setup lang="ts">
import type {EntityHeaderEditorProps} from '../../types/FrontendEntitySettingsTypes';
import {usePilot} from '../app/context';
import ActionButton from './ActionButton.vue';
import StatusNotice from './StatusNotice.vue';

// The feature supplies admitted presentation and retains the selected file/token.
// This shared panel owns native layout, DOM hooks and interaction events only.
defineProps<EntityHeaderEditorProps>();
const emit = defineEmits<{choose: [file: File | null]; review: []; upload: [source: Event]; remove: [source: Event]}>();
const {messages} = usePilot();

/** Decode the browser's file selection without storing a second draft or edit token. */
function chooseFile(event: Event): void {
    emit('choose', (event.target as HTMLInputElement).files?.[0] ?? null);
}
</script>

<template>
    <!-- Retain the native section/feedback host and file node while background reads run. -->
    <section class="mb-4" data-entity-section="image" :aria-busy="reading">
        <details class="entity-property-group" :open="expanded">
            <summary class="fw-semibold">{{ labels.title }}</summary>
            <div class="pt-3">
                <div data-command-feedback aria-live="polite"></div>
                <label class="form-label" :for="inputId">{{ labels.choose }}</label
                ><input :id="inputId" type="file" class="form-control"
                    accept="image/jpeg,image/png,image/gif" :disabled="disabled" @change="chooseFile" />
                <p class="form-text">{{ labels.hint }}</p>
                <!-- Review belongs to the feature's captured file baseline; it never writes. -->
                <StatusNotice v-if="conflict" kind="warning"
                    ><p>{{ messages.t('draft.readConflict') }}</p>
                    <p>{{ messages.t('draft.mine') }}: {{ imageName }}</p>
                    <ActionButton variant="outline-warning" :disabled="disabled" @click="emit('review')">{{
                        messages.t('draft.review')
                    }}</ActionButton></StatusNotice
                >
                <div class="d-flex flex-wrap gap-2">
                    <ActionButton :disabled="disabled || conflict" @click="emit('upload', $event)">{{
                        labels.upload
                    }}</ActionButton
                    ><ActionButton v-if="hasImage" variant="outline-danger" :disabled="disabled"
                        @click="emit('remove', $event)">{{ labels.remove }}</ActionButton>
                </div>
            </div>
        </details>
    </section>
</template>
