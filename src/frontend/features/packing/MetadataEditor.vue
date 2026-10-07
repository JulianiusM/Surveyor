<script setup lang="ts">
import {ref} from 'vue';
import {usePilot} from '../../app/context';
import AppDialog from '../../components/AppDialog.vue';
import ActionButton from '../../components/ActionButton.vue';
import MetadataFields from './MetadataFields.vue';
defineProps<{listId: string; listTitle?: string}>();
const emit = defineEmits<{close: []; saved: []; accessLost: []}>();
const {messages} = usePilot();
const fields = ref<InstanceType<typeof MetadataFields> | null>(null);
function close(): void {
    if (fields.value?.mayLeave() ?? true) emit('close');
}
</script>
<template>
    <AppDialog
        :open="true"
        :title="messages.t('packing.edit')"
        :subtitle="listTitle"
        :pending="fields?.pending"
        @close="close"
    >
        <MetadataFields
            ref="fields"
            :list-id="listId"
            :list-title="listTitle"
            @close="emit('close')"
            @saved="emit('saved')"
            @access-lost="emit('accessLost')"
        />
        <template #footer>
            <ActionButton
                class="btn-sm"
                variant="outline-secondary"
                :disabled="fields?.pending"
                @click="fields?.refresh()"
                >{{ messages.t('common.refresh') }}</ActionButton
            >
            <ActionButton variant="secondary" :disabled="fields?.pending" @click="close">{{
                messages.t('common.close')
            }}</ActionButton>
        </template>
    </AppDialog>
</template>
