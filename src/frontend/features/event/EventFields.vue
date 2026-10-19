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

        <FormField v-if="fields.includes('deadlineTz')" :id="prefix + '-timezone'" class="col-12"
            :label="messages.t('event.timezone')" :label-for="prefix + '-timezone-btn'" label-class="" :required-marker="false">
            <template #control>
                <TimezonePicker :id="prefix + '-timezone'" :model-value="String(values.deadlineTz || 'UTC')"
                    :disabled="disabled" @update:model-value="values.deadlineTz = $event" />
            </template>
        </FormField>

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
            <FormField :id="prefix + '-start'" class="col-md-6" name="startDate" type="date"
                :model-value="String(values.startDate ?? '')" :label="messages.t('event.startDate')"
                label-icon="bi-calendar-event" label-class="" required :required-marker="false"
                @update:model-value="values.startDate = $event" />
            <FormField :id="prefix + '-end'" class="col-md-6" name="endDate" type="date"
                :model-value="String(values.endDate ?? '')" :label="messages.t('event.endDate')"
                label-icon="bi-calendar2-event" label-class="" required :required-marker="false"
                @update:model-value="values.endDate = $event" />
        </div>
        <div class="row mb-3">
            <FormField :id="prefix + '-location'" class="col-md-8" name="location"
                :model-value="String(values.location ?? '')" :label="messages.t('event.location')" label-icon="bi-geo-alt" label-class=""
                :max-length="255" :placeholder="messages.t('event.locationPlaceholder')" @update:model-value="values.location = $event" />
            <!-- Keep raw capacity spelling, zero and the absence of constraints.
                 FormField emits lexical input; only the existing server coerces it. -->
            <FormField :id="prefix + '-capacity'" class="col-md-4" name="maxParticipants" type="number"
                :model-value="String(values.maxParticipants ?? '')" :label="messages.t('event.maxParticipants')"
                label-icon="bi-people" label-class="" @update:model-value="values.maxParticipants = $event" />
        </div>
        <div class="row mb-3">
            <FormField :id="prefix + '-deadline'" class="col-md-8" name="bindingDeadline" type="datetime-local" :step="1"
                :model-value="String(values.bindingDeadline ?? '')" :label="messages.t('event.bindingDeadline')"
                label-icon="bi-hourglass-split" label-class="" @update:model-value="values.bindingDeadline = $event">
                <template #label>{{ messages.t('event.bindingDeadline') }}<small class="ms-1">{{ messages.t('event.deadlineHint') }}</small></template>
            </FormField>
            <FormField :id="prefix + '-timezone'" class="col-md-4" :label="messages.t('event.timezone')"
                :label-for="prefix + '-timezone-btn'" label-class="" :required-marker="false">
                <template #control>
                    <TimezonePicker :id="prefix + '-timezone'" :model-value="String(values.deadlineTz || 'UTC')"
                        :disabled="disabled" mode="modal" @update:model-value="values.deadlineTz = $event" />
                </template>
                <div class="form-text mt-1">{{ messages.t('event.timezoneHint') }}</div>
            </FormField>
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
