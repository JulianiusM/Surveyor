<script setup lang="ts">
import {fieldAttributes as registrationFields} from "../../../../.generated/api/v1/browser/validateEventRegistrationInput.mjs";
import {computed, reactive, ref, watch} from 'vue';
import {useRoute} from 'vue-router';
import type {components} from '../../../types/api/v1';
import type {FrontendCheckboxChoice, FrontendRequestScope} from '../../../types/FrontendUiTypes';
import {eventDietaryGroups} from '../../../common/generated/domainChoices';
import {useActionState, useFrontend} from '../../app/context';
import {useCommand} from '../../composables/command';
import {useEventApi} from './api';
import {formatEventCivilDate} from './presentation';
import FormField from '../../components/FormField.vue';
import ActionButton from '../../components/ActionButton.vue';
import CommandFeedback from '../../components/CommandFeedback.vue';
import StatusNotice from '../../components/StatusNotice.vue';
import ChoiceCheckboxes from '../../components/ChoiceCheckboxes.vue';

const props = defineProps<{event: components['schemas']['EventView']; refresh: () => Promise<void>}>();
const context = useFrontend();
const {messages} = context;
const api = useEventApi(context);
const route = useRoute();
type Dietary = components['schemas']['EventRegistration']['dietary'][number];
const meals: readonly Dietary[] = eventDietaryGroups.meal;
const dietaryOptions = computed(() => ({meal: checkboxChoices(eventDietaryGroups.meal),
    requirement: checkboxChoices(eventDietaryGroups.requirement), text: checkboxChoices(eventDietaryGroups.text)}));

/** The generated groups own membership/order; this feature supplies reactive
 * localized wording and retains the existing lowercase native field spelling. */
function checkboxChoices(choices: readonly Dietary[]): FrontendCheckboxChoice<Dietary>[] {
    return choices.map(value => ({value, label: messages.value.t(`event.diet.${value}`), inputValue: value.toLowerCase()}));
}

// A single feature draft owns both the visible controls and submitted values.
// Read-only saved attendance remains in the Event projection supplied by props.
const fields = reactive({arrivalDate: '', departureDate: '', dietary: [] as Dietary[], allergyNotes: '', dietComment: ''});
const baseline = ref('');
let ownerId: string | null = null;
// Save and Cancel share protection and server refresh, while their initiating
// buttons retain separate pending/focus and existing spinner presentation.
const pendingControl = ref<'save' | 'cancel' | null>(null);
const command = useCommand(props.refresh, false, {dirty: isDirty, unknownMessage: 'draft.leaveUnknown'});
// The page displays a usable form to every admitted profile. The deliberate write
// owns its current permission rejection; the projection never grants authority.
const saveAction = useActionState({eligible: () => command.action.isAvailable(),
    pending: () => command.pending.value && pendingControl.value === 'save'});
// Cancellation follows its own participant admission; losing registration-write
// permission must not silently remove the participant cancellation action.
const cancelAction = useActionState({eligible: () => !!props.event.registration && command.action.isAvailable(),
    pending: () => command.pending.value && pendingControl.value === 'cancel'});
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
    await command.reconcileSafely();
}

/** Release only the completed form values; rejection and uncertain delivery keep them. */
function resetFields(registration: components['schemas']['EventRegistration'] | null): void {
    Object.assign(fields, registration ? {arrivalDate: registration.arrivalDate, departureDate: registration.departureDate,
        dietary: [...registration.dietary], allergyNotes: registration.allergyNotes, dietComment: registration.dietComment}
        : {arrivalDate: '', departureDate: '', dietary: [], allergyNotes: '', dietComment: ''});
    baseline.value = snapshot();
    command.clearRecoveredError('event.registration.mealRequired');
}

/** Copy the meal interaction: meat and fish can coexist, while selecting
 * vegetarian or vegan clears the other meals. Non-meal requirements remain. */
function selectDiet(choice: Dietary, checked: boolean): void {
    // Remove this choice first so unchecking releases only it. Checking then replaces
    // incompatible meals while retaining independent allergies and comment requirements.
    let selected = fields.dietary.filter(value => value !== choice);
    if (checked) {
        if (choice === 'VEGETARIAN' || choice === 'VEGAN') selected = selected.filter(value => !meals.includes(value));
        if (choice === 'MEAT' || choice === 'FISH') selected = selected.filter(value => value !== 'VEGETARIAN' && value !== 'VEGAN');
        selected.push(choice);
    }
    fields.dietary = selected;
    // Correcting the missing meal retires only that local rejection, without
    // erasing a distinct saved/unknown/server receipt from the shared owner.
    if (selected.some(value => meals.includes(value))) command.clearRecoveredError('event.registration.mealRequired');
}

/** Submit once through the existing registration operation. Admission carries
 * the route token without spending it; only this deliberate attendance write
 * supplies it to the consumption owner, never a background detail refresh. */
async function save(): Promise<void> {
    if (!saveAction.isAvailable()) return;
    if (props.event.requireDietaryInfo && !fields.dietary.some(value => meals.includes(value))) {
        // Local validation shares the same localized, sticky feedback receipt
        // as generated/server rejections; no request or draft reset occurs.
        command.setError('event.registration.mealRequired');
        return;
    }
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
    pendingControl.value = 'save';
    try {
        const result = await command.run(writeRegistration, true, false,
            {success: 'event.registration.saved'});
        if (result) {
            Object.assign(fields, submitted);
            baseline.value = snapshot();
            if (command.notice.value !== 'state.savedRefreshFailed') resetFields(props.event.registration);
        }
    } finally { pendingControl.value = null; }
    function writeRegistration(scope: FrontendRequestScope) { return api.saveRegistration(eventId, input, scope); }
}

/** Cancellation has its own confirmation and deadline policy on the server. */
async function cancel(): Promise<void> {
    if (!cancelAction.isAvailable() || !window.confirm(messages.value.t('event.registration.cancelConfirm'))) return;
    const eventId = props.event.id;
    // Retain the cancellation initiator until its whole confirmed-save/read
    // lifecycle completes; the sibling Save remains blocked without becoming busy.
    pendingControl.value = 'cancel';
    try {
        const result = await command.run(removeRegistration, true, false,
            {success: 'event.registration.cancelled'});
        if (result) resetFields(null);
    } finally { pendingControl.value = null; }
    function removeRegistration(scope: FrontendRequestScope) { return api.cancelRegistration(eventId, scope); }
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
            <!-- Saved dates remain visible above the independently editable draft. -->
            <div v-if="event.registration" class="row g-3">
                <div class="col-md-6">
                    <span class="form-label d-inline-block">{{ messages.t('event.registration.currentArrival') }}</span>
                    <p id="arrival">{{ formatEventCivilDate(event.registration.arrivalDate, messages.locale) }}</p>
                </div>
                <div class="col-md-6">
                    <span class="form-label d-inline-block">{{ messages.t('event.registration.currentDeparture') }}</span>
                    <p id="departure">{{ formatEventCivilDate(event.registration.departureDate, messages.locale) }}</p>
                </div>
            </div>
            <hr v-if="event.registration" />

            <form id="registrationForm" class="row g-3" @submit.prevent="save">
                <FormField id="arrivalDate" name="arrivalDate" v-model="fields.arrivalDate" class="col-md-6"
                    type="date" required label-class="" :required-marker="!event.registration" :min="event.startDate"
                    :max="event.endDate" :disabled="blocked"
                    :label-icon="event.registration ? 'bi-pencil' : 'bi-box-arrow-in-right'"
                    :label="messages.t(event.registration ? 'event.registration.changeArrival' : 'event.registration.arrival')"
                    :pending="saveAction.pending.value" />
                <FormField id="departureDate" name="departureDate" v-model="fields.departureDate" class="col-md-6"
                    type="date" required label-class="" :required-marker="!event.registration" :min="event.startDate"
                    :max="event.endDate" :disabled="blocked"
                    :label-icon="event.registration ? 'bi-pencil' : 'bi-box-arrow-right'"
                    :label="messages.t(event.registration ? 'event.registration.changeDeparture' : 'event.registration.departure')"
                    :pending="saveAction.pending.value" />

                <!-- Dietary sections exist only when this Event requires them.
                     Their selections remain local until one deliberate save. -->
                <div v-if="event.requireDietaryInfo" class="col-12">
                    <span class="form-label d-inline-block"><i class="bi bi-egg-fried me-1" aria-hidden="true"></i>{{ messages.t('event.registration.meals') }}</span>
                    <ChoiceCheckboxes :choices="dietaryOptions.meal" :selected="fields.dietary" id-prefix="diet"
                        name="dietary" :disabled="blocked" @change="selectDiet" />
                    <div class="form-text">{{ messages.t('event.registration.chooseMeal') }}</div>
                    <hr />

                    <!-- The form uses a different requirements icon before the first
                         registration; retain that visible distinction on updates. -->
                    <span class="form-label d-inline-block"><i class="bi me-1" :class="event.registration ? 'bi-exclamation-circle' : 'bi-egg-fried'" aria-hidden="true"></i>{{ messages.t('event.registration.requirements') }}</span>
                    <ChoiceCheckboxes :choices="dietaryOptions.requirement" :selected="fields.dietary" id-prefix="diet"
                        name="dietary" :disabled="blocked" @change="selectDiet" />
                    <FormField id="allergyNotes" name="allergyNotes" v-model="fields.allergyNotes" class="mt-2"
                        :max-length="registrationFields.allergyNotes.maxLength" :disabled="blocked" label-class="" :required-marker="false"
                        :required="fields.dietary.includes('ALLERGIES')"
                        :label="messages.t('event.registration.allergies')"
                        :placeholder="messages.t('event.registration.allergyPlaceholder')"
                        :pending="saveAction.pending.value" />

                    <template v-if="event.allowDietComment">
                        <hr />
                        <span class="form-label d-inline-block"><i class="bi bi-chat-dots me-1" aria-hidden="true"></i>{{ messages.t('event.registration.comments') }}</span>
                        <ChoiceCheckboxes :choices="dietaryOptions.text" :selected="fields.dietary" id-prefix="diet"
                            name="dietary" :disabled="blocked" @change="selectDiet" />
                        <div class="form-text">{{ messages.t('event.registration.commentHint') }}</div>
                        <FormField id="dietComment" name="dietComment" v-model="fields.dietComment" class="mt-2"
                            :max-length="registrationFields.allergyNotes.maxLength" :disabled="blocked" label-class=""
                            :label="messages.t('event.registration.comment')"
                            :placeholder="messages.t('event.registration.commentPlaceholder')"
                            :pending="saveAction.pending.value" />
                    </template>
                </div>

                <!-- Cancellation has separate server policy from saving changes.
                     Both controls reflect their existing shared command lifetime. -->
                <div class="col-12 frontend-action-row justify-content-end">
                    <ActionButton type="submit" :variant="event.registration ? 'primary' : 'success'"
                        :state="saveAction"><i class="bi me-1" :class="event.registration ? 'bi-save' : 'bi-check2-circle'" aria-hidden="true"></i>{{ messages.t(event.registration ? 'event.registration.update' : 'event.registration.save') }}</ActionButton>
                    <ActionButton v-if="event.registration" id="cancelRegistrationBtn" variant="outline-danger"
                        :state="cancelAction" @click="cancel"><i class="bi bi-x-circle me-1" aria-hidden="true"></i>{{ messages.t('event.registration.cancel') }}</ActionButton>
                </div>
            </form>
        </div>
    </section>
</template>
