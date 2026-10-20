<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, ref} from 'vue';
import {RouterLink} from 'vue-router';
import type {components} from '../../../types/api/v1';
import {usePilot} from '../../app/context';
import {formatEventCivilDate} from './presentation';
import EntityDescription from '../../components/EntityDescription.vue';

// Detail and organizer pages share the same bounded Event presentation. This
// countdown changes display only; registration deadlines remain server-owned.
const props = defineProps<{event: components['schemas']['EventView']; admin?: boolean}>();
const {messages} = usePilot();
const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => { timer = setInterval(tick, 60000); });
onBeforeUnmount(() => clearInterval(timer));
const countdown = computed(deadlineCountdown);

function tick(): void { now.value = Date.now(); }

/** Display one deadline instant in the Event zone and the viewer's local zone.
 * This presentation never changes stored values or registration eligibility. */
function deadline(zone?: string): string {
    if (!props.event.bindingDeadline) return '';
    // The selected language changes wording; an omitted zone still follows the
    // browser's existing zone rather than changing the represented instant.
    return new Date(props.event.bindingDeadline).toLocaleString(messages.value.locale, {dateStyle: 'full', timeStyle: 'full', ...(zone ? {timeZone: zone} : {})});
}

/** Match native minute-resolution countdown geometry with localized whole wording. */
function deadlineCountdown(): string {
    if (!props.event.bindingDeadline) return '';
    const milliseconds = Date.parse(props.event.bindingDeadline) - now.value;
    if (milliseconds <= 0) return messages.value.t('event.closed');
    // The timer never grants or removes action capability at the deadline edge.
    const seconds = Math.floor(milliseconds / 1000);
    return messages.value.t('event.countdown', {days: Math.floor(seconds / 86400), hours: Math.floor((seconds % 86400) / 3600), minutes: Math.floor((seconds % 3600) / 60)});
}
</script>

<template>
    <!-- Both page intents use this same admitted summary. Optional native fields
         retain their conditions; description lines render as escaped text. -->
    <div class="card mb-3 bg-dark text-white border-secondary-subtle">
        <div class="card-body">
            <div class="row">
                <div class="col-md-6">
                    <dl class="row mb-0">
                        <dt class="col-sm-4">{{ messages.t('event.dates') }}</dt>
                        <dd class="col-sm-8"><span class="me-1">{{ formatEventCivilDate(event.startDate, messages.locale) }}</span>→<span class="ms-1">{{ formatEventCivilDate(event.endDate, messages.locale) }}</span></dd>
                        <template v-if="event.location">
                            <dt class="col-sm-4">{{ messages.t('event.locationLabel') }}</dt>
                            <dd class="col-sm-8">{{ event.location }}</dd>
                        </template>
                        <template v-if="event.maxParticipants">
                            <dt class="col-sm-4">{{ messages.t('event.capacity') }}</dt>
                            <dd class="col-sm-8">{{ event.maxParticipants }} / {{ event.registrationCount }}</dd>
                        </template>
                        <template v-if="event.bindingDeadline">
                            <dt class="col-sm-4">{{ messages.t('event.deadlineLabel') }}</dt>
                            <dd class="col-sm-8">
                                <p>{{ messages.t('event.eventTimezone', {timezone: event.timezone || 'UTC'}) }}<span class="ms-2">{{ deadline(event.timezone || 'UTC') }}</span></p>
                                <p>{{ messages.t('event.yourTimezone') }}<span class="ms-2">{{ deadline() }}</span><span class="text-info ms-2">({{ countdown }})</span></p>
                            </dd>
                        </template>
                    </dl>
                </div>

                <div class="col-md-6" v-if="event.description">
                    <label class="form-label">{{ messages.t('event.descriptionLabel') }}</label>
                    <!-- Event keeps its labeled column and ordinary paragraph
                         margins; only escaped line rendering is shared with lists. -->
                    <EntityDescription :description="event.description" :paragraph-id="null" paragraph-class="" />
                </div>
            </div>

            <!-- The feature capability grants navigation presentation only;
                 the destination's own entry owner rechecks admission. -->
            <div v-if="admin || event.capabilities.admin" class="row">
                <div class="col-12 d-flex justify-content-end gap-2">
                    <RouterLink class="btn btn-primary"
                        :to="`/frontend-pilot/event/${event.id}${admin ? '' : '/admin'}`"><i class="bi me-1" :class="admin ? 'bi-calendar2-event' : 'bi-check2-circle'" aria-hidden="true"></i>{{ messages.t(admin ? 'event.eventPage' : 'event.admin') }}</RouterLink>
                </div>
            </div>
        </div>
    </div>
</template>
