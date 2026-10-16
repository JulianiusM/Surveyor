<script setup lang="ts">
import {computed, reactive, ref, watch} from 'vue';
import {useRoute} from 'vue-router';
import type {components} from '../../../types/api/v1';
import type {PilotRequestScope} from '../../../types/FrontendPilotUiTypes';
import {useActionState, usePilot} from '../../app/context';
import {useCommand} from '../../composables/command';
import {useEventApi} from './api';
import {formatEventCivilDate} from './presentation';
import FormField from '../../components/FormField.vue';
import ActionButton from '../../components/ActionButton.vue';
import CommandFeedback from '../../components/CommandFeedback.vue';
import StatusNotice from '../../components/StatusNotice.vue';

const props = defineProps<{event: components['schemas']['EventView']; refresh: () => Promise<void>}>();
const context = usePilot();
const {messages} = context;
const api = useEventApi(context);
const route = useRoute();
type Dietary = components['schemas']['EventRegistration']['dietary'][number];
const meals: Dietary[] = ['MEAT', 'FISH', 'VEGETARIAN', 'VEGAN'];
const requirements: Dietary[] = ['HALAL', 'KOSHER', 'ALLERGIES'];

// A single feature draft owns both the visible controls and submitted values.
// Read-only saved attendance remains in the Event projection supplied by props.
const fields = reactive({arrivalDate: '', departureDate: '', dietary: [] as Dietary[], allergyNotes: '', dietComment: ''});
const baseline = ref('');
let ownerId: string | null = null;
const validation = ref(false);
const command = useCommand(props.refresh, false, {dirty: isDirty, unknownMessage: 'draft.leaveUnknown'});
// Native displays a usable form to every admitted profile. The deliberate write
// owns its current permission rejection; the projection never grants authority.
const saveAction = useActionState({eligible: () => command.action.isAvailable(),
    pending: () => command.pending.value});
// Cancellation follows its own participant admission; losing registration-write
// permission must not silently remove the native participant cancellation action.
const cancelAction = useActionState({eligible: () => !!props.event.registration && command.action.isAvailable(),
    pending: () => command.pending.value});
const blocked = computed(() => command.action.disabled.value);
watch(() => [props.event.id, props.event.registration], receiveRegistration, {immediate: true});
watch(() => context.epoch.value, retireActor, {flush: 'sync'});

function snapshot(): string {
    return JSON.stringify({...fields, dietary: [...fields.dietary].sort()});
}
function isDirty(): boolean { return baseline.value !== '' && snapshot() !== baseline.value; }

/** A retired actor releases visible values as well as captured command state. */
function retireActor(): void {
    ownerId = null;
    command.acknowledge();
    resetFields(null);
}

/** Adopt a fresh baseline only while the user has no intentional local changes.
 * A background roster/date refresh cannot overwrite an edited registration. */
function receiveRegistration(): void {
    if (ownerId === props.event.id && isDirty()) return;
    // An accepted resource departure releases the previous Event's inputs even
    // if Vue reuses this mounted registration component for the next route.
    if (ownerId !== props.event.id) command.acknowledge();
    ownerId = props.event.id;
    resetFields(props.event.registration);
}

/** Recover an uncertain desired-state command through fresh reads only. */
async function recover(): Promise<void> {
    await command.reconcile();
}

/** Release only the completed form values; rejection and uncertain delivery keep them. */
function resetFields(registration: components['schemas']['EventRegistration'] | null): void {
    Object.assign(fields, registration ? {arrivalDate: registration.arrivalDate, departureDate: registration.departureDate,
        dietary: [...registration.dietary], allergyNotes: registration.allergyNotes, dietComment: registration.dietComment}
        : {arrivalDate: '', departureDate: '', dietary: [], allergyNotes: '', dietComment: ''});
    baseline.value = snapshot();
    validation.value = false;
}

/** Copy the native meal interaction: meat and fish can coexist, while selecting
 * vegetarian or vegan clears the other meals. Non-meal requirements remain. */
function selectDiet(choice: Dietary, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    // Remove this choice first so unchecking releases only it. Checking then replaces
    // incompatible meals while retaining independent allergies and comment requirements.
    let selected = fields.dietary.filter(value => value !== choice);
    if (checked) {
        if (choice === 'VEGETARIAN' || choice === 'VEGAN') selected = selected.filter(value => !meals.includes(value));
        if (choice === 'MEAT' || choice === 'FISH') selected = selected.filter(value => value !== 'VEGETARIAN' && value !== 'VEGAN');
        selected.push(choice);
    }
    fields.dietary = selected;
}

/** Submit once through the existing registration operation. Admission carries
 * the route token without spending it; only this deliberate attendance write
 * supplies it to the consumption owner, never a background detail refresh. */
async function save(event: Event): Promise<void> {
    if (!saveAction.isAvailable()) return;
    validation.value = props.event.requireDietaryInfo && !fields.dietary.some(value => meals.includes(value));
    if (validation.value) return;
    const eventId = props.event.id;
    const regToken = typeof route.query.regToken === 'string' ? route.query.regToken : undefined;
    const input: components['schemas']['EventRegistrationInput'] = {arrivalDate: fields.arrivalDate,
        departureDate: fields.departureDate, dietary: props.event.requireDietaryInfo
            ? fields.dietary.filter(choice => choice !== 'COMMENT' || props.event.allowDietComment) : [],
        ...(props.event.requireDietaryInfo ? {allergyNotes: fields.allergyNotes,
            ...(props.event.allowDietComment ? {dietComment: fields.dietComment} : {})} : {}),
        ...(regToken ? {regToken} : {})};
    // Confirmation acknowledges these captured values even if the following GET
    // fails. Only a fresh read can supply a changed registration or current grants.
    const submitted = {...fields, dietary: [...fields.dietary]};
    const result = await command.run(writeRegistration, true, false,
        {initiator: event, presentation: 'inline', success: 'event.registration.saved'});
    if (result) {
        Object.assign(fields, submitted);
        baseline.value = snapshot();
        if (command.notice.value !== 'state.savedRefreshFailed') resetFields(props.event.registration);
    }
    function writeRegistration(scope: PilotRequestScope) { return api.saveRegistration(eventId, input, scope); }
}

/** Native cancellation has its own confirmation and deadline policy on the server. */
async function cancel(event: Event): Promise<void> {
    if (!cancelAction.isAvailable() || !window.confirm(messages.value.t('event.registration.cancelConfirm'))) return;
    const eventId = props.event.id;
    const result = await command.run(removeRegistration, true, false,
        {initiator: event, presentation: 'inline', success: 'event.registration.cancelled'});
    if (result) resetFields(null);
    function removeRegistration(scope: PilotRequestScope) { return api.cancelRegistration(eventId, scope); }
}
</script>

<template>
    <!-- The feature owns one date/diet draft; reads never submit it or spend a
         token. Deadline exceptions remain independent server-side decisions. -->

    <StatusNotice v-if="!event.registration && event.isFull" kind="danger">{{ messages.t('event.full') }}</StatusNotice>

    <section v-else class="card mb-3 bg-dark text-white border-secondary-subtle">
        <div class="card-header py-2"><i :class="event.registration ? 'bi bi-person-check me-2' : 'bi bi-person-plus me-2'" aria-hidden="true"></i>{{ messages.t(event.registration ? 'event.registration.yours' : 'event.registration.join') }}</div>
        <div class="card-body">
            <CommandFeedback :feedback="command.feedback" :part="command.uncertain.value ? 'error' : 'all'" />
            <CommandFeedback :feedback="command.feedback" part="uncertain"
                :action="{state: command.recoveryAction, label: messages.t('common.refresh')}" @action="recover" />
            <StatusNotice v-if="validation" kind="danger">{{ messages.t('event.registration.mealRequired') }}</StatusNotice>

            <!-- Saved dates remain visible above the independently editable draft. -->
            <div v-if="event.registration" class="row g-3">
                <div class="col-md-6">
                    <label class="form-label">{{ messages.t('event.registration.currentArrival') }}</label>
                    <p id="arrival">{{ formatEventCivilDate(event.registration.arrivalDate) }}</p>
                </div>
                <div class="col-md-6">
                    <label class="form-label">{{ messages.t('event.registration.currentDeparture') }}</label>
                    <p id="departure">{{ formatEventCivilDate(event.registration.departureDate) }}</p>
                </div>
            </div>
            <hr v-if="event.registration" />

            <form id="registrationForm" class="row g-3" @submit.prevent="save">
                <FormField id="arrivalDate" name="arrivalDate" v-model="fields.arrivalDate" class="col-md-6"
                    type="date" required label-class="" :required-marker="!event.registration" :min="event.startDate"
                    :max="event.endDate" :disabled="blocked"
                    :label-icon="event.registration ? 'bi-pencil' : 'bi-box-arrow-in-right'"
                    :label="messages.t(event.registration ? 'event.registration.changeArrival' : 'event.registration.arrival')" />
                <FormField id="departureDate" name="departureDate" v-model="fields.departureDate" class="col-md-6"
                    type="date" required label-class="" :required-marker="!event.registration" :min="event.startDate"
                    :max="event.endDate" :disabled="blocked"
                    :label-icon="event.registration ? 'bi-pencil' : 'bi-box-arrow-right'"
                    :label="messages.t(event.registration ? 'event.registration.changeDeparture' : 'event.registration.departure')" />

                <!-- Dietary sections exist only when this Event requires them.
                     Their selections remain local until one deliberate save. -->
                <div v-if="event.requireDietaryInfo" class="col-12">
                    <label class="form-label"><i class="bi bi-egg-fried me-1" aria-hidden="true"></i>{{ messages.t('event.registration.meals') }}</label>
                    <div class="row row-cols-3 row-cols-md-4 g-2">
                        <div v-for="choice in meals" :key="choice" class="col">
                            <div class="form-check">
                                <input :id="'diet-' + choice.toLowerCase()" class="form-check-input" type="checkbox"
                                    name="dietary" :value="choice.toLowerCase()"
                                    :checked="fields.dietary.includes(choice)" :disabled="blocked"
                                    @change="selectDiet(choice, $event)" />
                                <label class="form-check-label" :for="'diet-' + choice.toLowerCase()">{{ messages.t(`event.diet.${choice}`) }}</label>
                            </div>
                        </div>
                    </div>
                    <div class="form-text">{{ messages.t('event.registration.chooseMeal') }}</div>
                    <hr />

                    <!-- Native uses a different requirements icon before the first
                         registration; retain that visible distinction on updates. -->
                    <label class="form-label"><i class="bi me-1" :class="event.registration ? 'bi-exclamation-circle' : 'bi-egg-fried'" aria-hidden="true"></i>{{ messages.t('event.registration.requirements') }}</label>
                    <div class="row row-cols-3 row-cols-md-4 g-2">
                        <div v-for="choice in requirements" :key="choice" class="col">
                            <div class="form-check">
                                <input :id="'diet-' + choice.toLowerCase()" class="form-check-input" type="checkbox"
                                    name="dietary" :value="choice.toLowerCase()"
                                    :checked="fields.dietary.includes(choice)" :disabled="blocked"
                                    @change="selectDiet(choice, $event)" />
                                <label class="form-check-label" :for="'diet-' + choice.toLowerCase()">{{ messages.t(`event.diet.${choice}`) }}</label>
                            </div>
                        </div>
                    </div>
                    <FormField id="allergyNotes" name="allergyNotes" v-model="fields.allergyNotes" class="mt-2"
                        :max-length="4000" :disabled="blocked" label-class="" :required-marker="false"
                        :required="fields.dietary.includes('ALLERGIES')"
                        :label="messages.t('event.registration.allergies')"
                        :placeholder="messages.t('event.registration.allergyPlaceholder')" />

                    <template v-if="event.allowDietComment">
                        <hr />
                        <label class="form-label"><i class="bi bi-chat-dots me-1" aria-hidden="true"></i>{{ messages.t('event.registration.comments') }}</label>
                        <div class="row row-cols-3 row-cols-md-4 g-2">
                            <div class="col">
                                <div class="form-check">
                                    <input id="diet-comment" class="form-check-input" type="checkbox" name="dietary"
                                        value="comment" :checked="fields.dietary.includes('COMMENT')"
                                        :disabled="blocked" @change="selectDiet('COMMENT', $event)" />
                                    <label class="form-check-label" for="diet-comment">{{ messages.t('event.diet.COMMENT') }}</label>
                                </div>
                            </div>
                        </div>
                        <div class="form-text">{{ messages.t('event.registration.commentHint') }}</div>
                        <FormField id="dietComment" name="dietComment" v-model="fields.dietComment" class="mt-2"
                            :max-length="4000" :disabled="blocked" label-class=""
                            :label="messages.t('event.registration.comment')"
                            :placeholder="messages.t('event.registration.commentPlaceholder')" />
                    </template>
                </div>

                <!-- Cancellation has separate server policy from saving changes.
                     Both controls reflect their existing shared command lifetime. -->
                <div class="col-12 d-flex justify-content-end gap-2">
                    <ActionButton type="submit" :variant="event.registration ? 'primary' : 'success'"
                        :state="saveAction"><i class="bi me-1" :class="event.registration ? 'bi-save' : 'bi-check2-circle'" aria-hidden="true"></i>{{ messages.t(event.registration ? 'event.registration.update' : 'event.registration.save') }}</ActionButton>
                    <ActionButton v-if="event.registration" id="cancelRegistrationBtn" variant="outline-danger"
                        :state="cancelAction" @click="cancel"><i class="bi bi-x-circle me-1" aria-hidden="true"></i>{{ messages.t('event.registration.cancel') }}</ActionButton>
                </div>
            </form>
        </div>
    </section>
</template>
