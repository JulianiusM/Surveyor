<script setup lang="ts">
import {computed} from 'vue';
import type {FrontendListQuickAddValues} from '../../types/FrontendListTypes';
import {usePilot} from '../app/context';
import ActionButton from './ActionButton.vue';
import FormField from './FormField.vue';

// Matching list forms share their card, optional description and capacity controls.
// The feature supplies its distinct title control and retains every draft value,
// command, collected payload and confirmed/unknown reset decision.
const props = withDefaults(defineProps<{
    description: string;
    capacity: FrontendListQuickAddValues['maxAssignees'];
    disabled: boolean;
    pending?: boolean;
    hintClass?: string;
}>(), {hintClass: 'text-info'});
const emit = defineEmits<{
    'update:description': [value: string];
    'update:capacity': [value: FrontendListQuickAddValues['maxAssignees']];
    submit: [];
}>();
const {messages} = usePilot();
const capacityDraft = computed({get: readCapacity, set: updateCapacity});

function readCapacity(): FrontendListQuickAddValues['maxAssignees'] { return props.capacity; }
function updateCapacity(value: FrontendListQuickAddValues['maxAssignees']): void { emit('update:capacity', value); }
</script>

<template>
    <div class="card bg-dark text-light border-secondary mb-3">
        <div class="card-header p-2 d-flex align-items-center">
            <i class="bi bi-plus-circle me-2" aria-hidden="true"></i>
            <span class="flex-grow-1">{{ messages.t('packing.addNewItem') }}</span>
            <small class="fst-italic ms-2" :class="hintClass">{{ messages.t('packing.fillAllFields') }}</small>
        </div>
        <form class="card-body row gy-2 gx-2 align-items-end" @submit.prevent="emit('submit')">
            <!-- Packing's editable required title and Drivers' readonly actor
                 name remain distinct controls, with their native column width. -->
            <slot />
            <FormField id="quick-description" class="col-md-4" :name="null"
                :model-value="description" :label="messages.t('packing.description')"
                :placeholder="messages.t('packing.optional')" :disabled="disabled" :pending="pending"
                @update:model-value="emit('update:description', $event)" />
            <FormField id="quick-max" class="col-md-2" :label="messages.t('packing.maxNumber')" :pending="pending">
                <template #control="{controlRef}">
                    <!-- Use Vue's actual native number directive for its
                         number/empty decoding and DOM update lifecycle. The
                         installed Vue normalizes leading zeros on change or
                         a later rerender, just like the original list inputs;
                         a string-only adapter would preserve a different draft. -->
                    <input id="quick-max" :ref="controlRef" v-model.number="capacityDraft" type="number" min="1"
                        class="form-control text-bg-dark" :disabled="disabled" />
                </template>
            </FormField>
            <div class="col-md-2 d-grid">
                <ActionButton type="submit" variant="success" :disabled="disabled" :pending="pending" :show-spinner="false"
                    ><i class="bi bi-check-lg me-1" aria-hidden="true"></i
                    >{{ messages.t('packing.add') }}</ActionButton
                >
            </div>
        </form>
    </div>
</template>
