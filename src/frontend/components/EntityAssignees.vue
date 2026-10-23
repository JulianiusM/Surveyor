<script setup lang="ts">
import ActionButton from './ActionButton.vue';

// Lists pass their admitted names and removable assignment IDs. This shared
// presentation never treats the visible control as server authorization.
defineProps<{assignees: {name: string; assignmentId: string | null}[];
    removable: boolean; disabled: boolean; pendingAssignmentId?: string | null; removeLabel: string}>();
const emit = defineEmits<{remove: [id: string]}>();
</script>

<template>
    <ul class="list-unstyled mb-0">
        <li v-for="(assignee, index) in assignees" :key="assignee.assignmentId ?? index"
            class="d-flex align-items-center gap-1">
            <i class="bi bi-person-fill" aria-hidden="true"></i><span class="flex-grow-1">{{ assignee.name }}</span>
            <!-- Features may retain native button spacing/data hooks. This list
                 still admits removal only for an explicitly disclosed identity. -->
            <template v-if="removable && assignee.assignmentId !== null">
                <slot name="remove" :assignment-id="assignee.assignmentId">
                    <ActionButton class="btn-sm" variant="outline-danger"
                        :disabled="disabled" :pending="pendingAssignmentId === assignee.assignmentId" :show-spinner="false"
                        :aria-label="removeLabel" @click="emit('remove', assignee.assignmentId)">&times;</ActionButton>
                </slot>
            </template>
        </li>
    </ul>
</template>
