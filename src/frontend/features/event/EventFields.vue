<script setup lang="ts">
import {usePilot} from '../../app/context';
import type {EntityMetadataValues} from '../../../types/FrontendEntityMetadataTypes';
import TimezonePicker from '../../components/TimezonePicker.vue';

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
        <div v-for="input in propertyInputs.filter(input => fields?.includes(input.field))" :key="input.field"
            class="col-md-6">
            <label class="form-label" :for="prefix + '-' + input.field">{{ messages.t(input.label) }}</label>
            <input :id="prefix + '-' + input.field" :value="String(values[input.field] ?? '')"
                class="form-control text-bg-dark" :type="input.type" :name="input.field"
                :maxlength="'max' in input ? input.max : undefined" :required="input.required"
                :min="input.type === 'number' ? 1 : undefined" :step="input.type === 'datetime-local' ? 1 : undefined"
                @input="values[input.field] = ($event.target as HTMLInputElement).value" />
        </div>

        <div v-if="fields.includes('description')" class="col-12">
            <label class="form-label" :for="prefix + '-description'">{{ messages.t('packing.description') }}</label>
            <textarea :id="prefix + '-description'" :value="String(values.description ?? '')"
                class="form-control text-bg-dark" name="description" rows="4" maxlength="16000"
                @input="values.description = ($event.target as HTMLTextAreaElement).value"></textarea>
        </div>

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
        <div class="mb-3">
            <label class="form-label" :for="prefix + '-title'"><i class="bi bi-tag me-1" aria-hidden="true"></i>{{ messages.t('event.title') }}</label>
            <input :id="prefix + '-title'" v-model="values.title" class="form-control text-bg-dark" name="title"
                required maxlength="255" />
        </div>

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
        <div class="mb-3">
            <label class="form-label" :for="prefix + '-description'"><i class="bi bi-pencil-square me-1" aria-hidden="true"></i>{{ messages.t('event.description') }}</label>
            <textarea :id="prefix + '-description'" :value="String(values.description ?? '')"
                class="form-control text-bg-dark" name="description" rows="4" maxlength="16000"
                @input="values.description = ($event.target as HTMLTextAreaElement).value"></textarea>
        </div>
    </template>
</template>
