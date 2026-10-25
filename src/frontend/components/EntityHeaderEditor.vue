<script setup lang="ts">
import type {EntityHeaderEditorProps} from '../../types/FrontendEntitySettingsTypes';
import {useFrontend} from '../app/context';
import FileField from './FileField.vue';
import ActionButton from './ActionButton.vue';
import StatusNotice from './StatusNotice.vue';

// The feature supplies admitted presentation and retains the selected file/token.
// This shared panel owns layout, DOM hooks and interaction events only.
defineProps<EntityHeaderEditorProps>();
const emit = defineEmits<{choose: [file: File | null]; review: []; upload: [source: Event]; remove: [source: Event]}>();
const {messages} = useFrontend();
</script>

<template>
    <!-- Background reads retain the selected file node and its reviewed baseline. -->
    <section class="mb-4" data-entity-section="image" :aria-busy="reading">
        <details class="entity-property-group" :open="expanded">
            <summary class="fw-semibold">{{ labels.title }}</summary>
            <div class="pt-3">
                <FileField :id="inputId" :label="labels.choose" :selected-file="selectedFile" :disabled="disabled"
                    :dark="false" @choose="emit('choose', $event)" />
                <p class="form-text">{{ labels.hint }}</p>
                <!-- Review belongs to the feature's captured file baseline; it never writes. -->
                <StatusNotice v-if="conflict" kind="warning"
                    ><p>{{ messages.t('draft.readConflict') }}</p>
                    <p>{{ messages.t('draft.mine') }}: {{ selectedFile?.name }}</p>
                    <template #actions>
                        <ActionButton variant="outline-warning" :disabled="disabled" @click="emit('review')">{{
                            messages.t('draft.review')
                        }}</ActionButton>
                    </template></StatusNotice
                >
                <div class="frontend-action-row">
                    <ActionButton :disabled="disabled || conflict" :pending="uploadPending" :show-spinner="false"
                        @click="emit('upload', $event)">{{
                        labels.upload
                    }}</ActionButton
                    ><ActionButton v-if="hasImage" variant="outline-danger" :disabled="disabled"
                        :pending="removePending" :show-spinner="false"
                        @click="emit('remove', $event)">{{ labels.remove }}</ActionButton>
                </div>
            </div>
        </details>
    </section>
</template>
