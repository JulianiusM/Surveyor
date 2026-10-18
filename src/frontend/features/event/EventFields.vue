<script setup lang="ts">
import {usePilot} from '../../app/context';
import type {EntityMetadataValues} from '../../../types/FrontendEntityMetadataTypes';
import TimezonePicker from '../../components/TimezonePicker.vue';
import FormField from '../../components/FormField.vue';

// The same field owner serves creation and permission-filtered properties. The
// caller retains values; absent fields never render a hidden writable mirror.
defineProps<{values: EntityMetadataValues; fields?: readonly string[]; prefix: string; disabled?: boolean}>();
const {messages} = usePilot();
const flags = [
    {field: 'allowRegDateUpdatesAfterDeadline', label: 'event.dateUpdates', icon: 'bi-calendar-range'},
    {field: 'allowRegCancelationAfterDeadline', label: 'event.cancelUpdates', icon: 'bi-calendar-x'},
    {field: 'requireDietaryInfo', label: 'event.requireDiet', icon: 'bi-egg-fried'},
    {field: 'allowDietComment', label: 'event.allowComment', icon: 'bi-chat-dots'},
    {field: 'allowRegDietUpdateAfterDeadline', label: 'event.dietUpdates', icon: 'bi-egg-fried'},
] as const;
const propertyInputs = [
    {field: 'title', label: 'packing.title', type: 'text', max: 255, required: true},
    {field: 'location', label: 'event.locationLabel', type: 'text', max: 255, required: false},
    {field: 'startDate', label: 'event.startDateLabel', type: 'date', required: true},
    {field: 'endDate', label: 'event.endDateLabel', type: 'date', required: true},
    {field: 'bindingDeadline', label: 'event.deadlineLabel', type: 'datetime-local', required: false},
    {field: 'maxParticipants', label: 'event.maxParticipantsLabel', type: 'number', required: false},
] as const;
</script>

<template>
    <!-- Native properties use independent disclosure families, compact generic
         labels and a stricter capacity constraint than the creation form below. -->

    <div v-if="fields" class="row g-3 pt-3">
        <FormField v-for="input in propertyInputs.filter(input => fields?.includes(input.field))" :key="input.field"
            :id="prefix + '-' + input.field" class="col-md-6" :name="input.field" :type="input.type"
            :model-value="String(values[input.field] ?? '')" :label="messages.t(input.label)" label-class=""
            :max-length="'max' in input ? input.max : undefined" :required="input.required" :required-marker="false"
            :min="input.type === 'number' ? 1 : undefined" :step="input.type === 'datetime-local' ? 1 : undefined"
            @update:model-value="values[input.field] = $event" />

        <FormField v-if="fields.includes('description')" :id="prefix + '-description'" class="col-12" name="description"
            :model-value="String(values.description ?? '')" :label="messages.t('packing.description')" label-class=""
            multiline :rows="4" :max-length="16000" @update:model-value="values.description = $event" />

        <div v-if="fields.includes('deadlineTz')" class="col-12">
            <label class="form-label" :for="prefix + '-timezone-btn'">{{ messages.t('event.timezone') }}</label>
            <TimezonePicker :id="prefix + '-timezone'" :model-value="String(values.deadlineTz || 'UTC')"
                :disabled="disabled" @update:model-value="values.deadlineTz = $event" />
        </div>

        <div v-for="option in flags.filter(option => fields?.includes(option.field))" :key="option.field"
            class="col-12">
            <div class="form-check">
                <input :id="prefix + '-' + option.field" v-model="values[option.field]" class="form-check-input"
                    type="checkbox" :name="option.field" />
                <label class="form-check-label" :for="prefix + '-' + option.field">{{ messages.t(option.field === 'allowDietComment' ? 'event.allowCommentLabel' : option.label) }}</label>
            </div>
        </div>
    </div>

    <template v-else>
        <!-- Native field order, column widths, constraints and unchecked omission are
             retained. These flags configure distinct server-enforced deadline rules. -->
        <FormField :id="prefix + '-title'" class="mb-3" name="title" :model-value="String(values.title ?? '')"
            :label="messages.t('event.title')" label-icon="bi-tag" label-class="" required :required-marker="false"
            :max-length="255" @update:model-value="values.title = $event" />

        <div class="row mb-3">
            <div class="col-md-6">
                <label class="form-label" :for="prefix + '-start'"><i class="bi bi-calendar-event me-1" aria-hidden="true"></i>{{ messages.t('event.startDate') }}</label>
                <input :id="prefix + '-start'" v-model="values.startDate" class="form-control text-bg-dark"
                    type="date" name="startDate" required />
            </div>
            <div class="col-md-6">
                <label class="form-label" :for="prefix + '-end'"><i class="bi bi-calendar2-event me-1" aria-hidden="true"></i>{{ messages.t('event.endDate') }}</label>
                <input :id="prefix + '-end'" v-model="values.endDate" class="form-control text-bg-dark" type="date"
                    name="endDate" required />
            </div>
        </div>
        <div class="row mb-3">
            <div class="col-md-8">
                <label class="form-label" :for="prefix + '-location'"><i class="bi bi-geo-alt me-1" aria-hidden="true"></i>{{ messages.t('event.location') }}</label>
                <input :id="prefix + '-location'" v-model="values.location" class="form-control text-bg-dark"
                    name="location" maxlength="255" :placeholder="messages.t('event.locationPlaceholder')" />
            </div>
            <div class="col-md-4">
                <label class="form-label" :for="prefix + '-capacity'"><i class="bi bi-people me-1" aria-hidden="true"></i>{{ messages.t('event.maxParticipants') }}</label>
                <!-- Keep the raw DOM number spelling: the shared native owner decides
                     coercion and optional/unlimited capacity, including zero. -->
                <input :id="prefix + '-capacity'" :value="String(values.maxParticipants ?? '')"
                    class="form-control text-bg-dark" type="number" name="maxParticipants"
                    @input="values.maxParticipants = ($event.target as HTMLInputElement).value" />
            </div>
        </div>
        <div class="row mb-3">
            <div class="col-md-8">
                <label class="form-label" :for="prefix + '-deadline'"><i class="bi bi-hourglass-split me-1" aria-hidden="true"></i>{{ messages.t('event.bindingDeadline') }}<small class="ms-1">{{ messages.t('event.deadlineHint') }}</small></label>
                <input :id="prefix + '-deadline'" v-model="values.bindingDeadline" class="form-control text-bg-dark"
                    type="datetime-local" name="bindingDeadline" step="1" />
            </div>
            <div class="col-md-4">
                <label class="form-label" :for="prefix + '-timezone-btn'">{{ messages.t('event.timezone') }}</label>
                <TimezonePicker :id="prefix + '-timezone'" :model-value="String(values.deadlineTz || 'UTC')"
                    :disabled="disabled" mode="modal" @update:model-value="values.deadlineTz = $event" />
                <div class="form-text mt-1">{{ messages.t('event.timezoneHint') }}</div>
            </div>
        </div>
        <div class="row mb-3">
            <div v-for="option in flags" :key="option.field" class="col-md-4">
                <div class="form-check">
                    <input :id="prefix + '-' + option.field" v-model="values[option.field]" class="form-check-input"
                        type="checkbox" :name="option.field" />
                    <label class="form-check-label" :for="prefix + '-' + option.field"><i class="bi me-1" :class="option.icon" aria-hidden="true"></i>{{ messages.t(option.label) }}</label>
                </div>
            </div>
        </div>
        <FormField :id="prefix + '-description'" class="mb-3" name="description" :model-value="String(values.description ?? '')"
            :label="messages.t('event.description')" label-icon="bi-pencil-square" label-class=""
            multiline :rows="4" :max-length="16000" @update:model-value="values.description = $event" />
    </template>
</template>
