<script setup lang="ts">
// Matching creation and assignment forms share these three native checkboxes.
// Parents retain drafts, normalization and save authority; this presentation
// owner emits one changed value and keeps the supplied IDs, names and wording.
defineProps<{
    assignAll: boolean;
    isDefault: boolean;
    subtractPersonalInvoices: boolean;
    allId: string;
    defaultId: string;
    subtractId: string;
    allName: string;
    defaultName: string;
    subtractName: string;
    allLabel: string;
    defaultLabel: string;
    subtractLabel: string;
    subtractClass?: string;
}>();
const emit = defineEmits<{
    'update:assignAll': [value: boolean];
    'update:isDefault': [value: boolean];
    'update:subtractPersonalInvoices': [value: boolean];
}>();

function checked(event: Event): boolean { return (event.target as HTMLInputElement).checked; }
</script>

<template>
    <div>
        <div class="form-check">
            <input :id="allId" :checked="assignAll" :name="allName" class="form-check-input" type="checkbox"
                @change="emit('update:assignAll', checked($event))" />
            <label :for="allId" class="form-check-label">{{ allLabel }}</label>
        </div>
        <div class="form-check">
            <input :id="defaultId" :checked="isDefault" :name="defaultName" class="form-check-input" type="checkbox"
                @change="emit('update:isDefault', checked($event))" />
            <label :for="defaultId" class="form-check-label">{{ defaultLabel }}</label>
        </div>
        <!-- Creation's default explanation precedes its spaced deduction field;
             assignment's factor/default explanation remains after all fields. -->
        <slot name="afterDefault" />
        <div class="form-check" :class="subtractClass">
            <input :id="subtractId" :checked="subtractPersonalInvoices" :name="subtractName" class="form-check-input" type="checkbox"
                @change="emit('update:subtractPersonalInvoices', checked($event))" />
            <label :for="subtractId" class="form-check-label">{{ subtractLabel }}</label>
        </div>
        <slot />
    </div>
</template>
