<script setup lang="ts">
import {computed, reactive, ref, useId, watch} from 'vue';
import type {components} from '../../../types/api/v1';
import {useActionState, useFrontend} from '../../app/context';
import {eventKeys} from '../../app/queryKeys';
import {useCommand} from '../../composables/command';
import {useEventApi} from './api';
import {useEventSection} from './useEventSection';
import {useEventClipboard} from './clipboard';
import {eventDietaryLabel, formatEventDate} from './presentation';
import EventTotals from './EventTotals.vue';
import ActionButton from '../../components/ActionButton.vue';
import AppDialog from '../../components/AppDialog.vue';
import CommandFeedback from '../../components/CommandFeedback.vue';
import FormField from '../../components/FormField.vue';
import LoadingSkeleton from '../../components/LoadingSkeleton.vue';
import StatusNotice from '../../components/StatusNotice.vue';
import AppAccordionButton from '../../components/AppAccordionButton.vue';

type Participant = components['schemas']['EventParticipant'];
type DetailsSelection = {kind: 'summary'} | {kind: 'participant'; id: string};

// Page admission and roster access remain separate. Only the organizer caller
// enables management, and every write still uses its existing server operation.
const props = withDefaults(defineProps<{eventId: string; startDate: string; endDate: string; manageRegistrations?: boolean; active?: boolean}>(), {active: true});
const context = useFrontend();
const {messages} = context;
const api = useEventApi(context);
const id = useId();
const open = ref(false);
const filter = ref('');
// Removal uses a saved row; the separate date dialog and other roster controls
// retain their existing availability without inheriting its pending focus claim.
const removingId = ref<string | null>(null);
// Read-only notes retain selection only. Their displayed values always come
// from the current admitted roster, independently of the local search filter.
const detailsSelection = ref<DetailsSelection | null>(null);
const edit = reactive({id: '', arrivalDate: '', departureDate: '', originalArrival: '', originalDeparture: ''});
const key = computed(() => eventKeys.participants(context.session.value?.context, props.eventId));
const section = useEventSection(key, readParticipants, computed(() => props.active !== false), computed(() => open.value));
const dirty = computed(() => !!edit.id && (edit.arrivalDate !== edit.originalArrival || edit.departureDate !== edit.originalDeparture));
const command = useCommand(section.refresh, false, {dirty: () => dirty.value, unknownMessage: 'draft.leaveUnknown'});
const clipboard = useEventClipboard();
const available = useActionState({eligible: mayUseSection, blocked: () => command.action.disabled.value});
const management = useActionState({eligible: () => !!props.manageRegistrations && mayUseSection(),
    blocked: () => command.action.disabled.value});
const refreshAction = useActionState({eligible: () => section.readAction.isAvailable(),
    blocked: () => command.recoveryAction.disabled.value, pending: () => section.query.isFetching.value || command.recovering.value});
const rows = computed(filteredRows);
const dateTotals = computed(() => (section.data.value?.dateTotals ?? []).map(total => ({key: total.date, count: total.count})));
const hasSummary = computed(() => !!section.data.value?.allergies.length || !!section.data.value?.comments.length);
const details = computed(currentDetails);

/** Roster search matches names, email and dietary tokens locally while
 * totals continue to describe the complete admitted participant projection. */
function filteredRows(): Participant[] {
    const needle = filter.value.trim().toLowerCase();
    const matches: Participant[] = [];
    // Keep machine tokens searchable alongside their localized badges.
    // Filtering never requests another projection or recomputes server totals.
    for (const row of section.data.value?.participants ?? []) {
        const terms = [row.name, row.email ?? ''];
        for (const choice of row.dietary) {
            terms.push(choice.choice, eventDietaryLabel(messages.value, choice.choice));
        }
        if (!needle || terms.some(value => value.toLowerCase().includes(needle))) matches.push(row);
    }
    return matches;
}
watch([() => props.eventId, context.epoch, () => context.session.value?.context], retireLocalState);
watch(section.denied, denied => { if (denied) retireLocalState(); });
watch(details, closeMissingDetails);

function readParticipants(scope: Parameters<typeof api.participants>[1], signal: AbortSignal) {
    return api.participants(props.eventId, scope, signal);
}
function mayUseSection(): boolean { return props.active !== false && !!section.data.value && !section.denied.value; }

/** Retire all participant-owned values when the admitted Event or actor leaves.
 * A normal successful refresh preserves search and unsaved attendance dates. */
function retireLocalState(): void {
    // No retained row or modal value may cross a denial or identity transition.
    closeDetails();
    resetDates();
    filter.value = '';
    clipboard.reset();
}
function resetDates(): void { Object.assign(edit, {id: '', arrivalDate: '', departureDate: '', originalArrival: '', originalDeparture: ''}); }

/** Resolve an open read-only selection from the full current authorized roster.
 * Background reads update notes immediately without replacing genuine date drafts. */
function currentDetails(): {allergies: string[]; comments: string[]} | null {
    const selection = detailsSelection.value;
    const roster = section.data.value;
    if (!selection || !roster || section.denied.value) return null;

    // Summary values are projected by the controller. Searching visible rows
    // must not narrow either their scope or an already-open participant dialog.
    if (selection.kind === 'summary') {
        if (!hasSummary.value) return null;
        return {allergies: [...roster.allergies].sort(), comments: [...roster.comments].sort()};
    }

    const row = roster.participants.find(participant => participant.id === selection.id);
    if (!row || !hasDetails(row)) return null;
    return {allergies: participantNotes(row, 'ALLERGIES'), comments: participantNotes(row, 'COMMENT')};
}

/** Match per-person semicolon splitting and ordering without retaining
 * a second copy of the participant projection behind the selected dialog. */
function participantNotes(row: Participant, choice: 'ALLERGIES' | 'COMMENT'): string[] {
    const notes: string[] = [];
    // Individual dietary records can contain several notes; blank fragments
    // remain absent and Vue renders every retained value as escaped text.
    for (const entry of row.dietary) {
        if (entry.choice !== choice) continue;
        for (const fragment of (entry.additionalInfo ?? '').split(';')) {
            const note = fragment.trim();
            if (note) notes.push(note);
        }
    }
    return notes.sort();
}

/** Retire a selection when a fresh admitted roster removes its source. A new
 * participant with a different ID must never inherit the previous open dialog. */
function closeMissingDetails(value: ReturnType<typeof currentDetails>): void {
    if (!value) closeDetails();
}

function closeDetails(): void {
    detailsSelection.value = null;
}

/** Opening captures only the requested participant identity or whole-roster scope. */
function showDetails(row?: Participant): void {
    if (!available.isAvailable()) return;
    detailsSelection.value = row ? {kind: 'participant', id: row.id} : {kind: 'summary'};
}
/** A Details control requires a nonempty allergy/comment note on this admitted row. */
function hasDetails(row: Participant): boolean {
    // Meal-only choices do not disclose a meaningless empty notes dialog.
    return row.dietary.some(value => (value.choice === 'ALLERGIES' || value.choice === 'COMMENT') && !!value.additionalInfo);
}

/** Open a separate date draft from the current authorized row. Polling cannot
 * replace its values; only successful submission or approved dismissal releases it. */
function editDates(row: Participant): void {
    if (!management.isAvailable()) return;
    // The registration ID scopes the subsequent operation to this Event server-side.
    Object.assign(edit, {id: row.id, arrivalDate: row.arrivalDate ?? '', departureDate: row.departureDate ?? '',
        originalArrival: row.arrivalDate ?? '', originalDeparture: row.departureDate ?? ''});
}
function closeDates(): void { if (!command.pending.value && !command.recovering.value && command.mayLeave()) resetDates(); }

/** Submit the captured registration/date draft once, retaining it after rejection
 * or uncertain delivery. Controller validation owns the attendance/date policy. */
async function saveDates(event: Event): Promise<void> {
    if (!management.isAvailable()) return;
    const form = event.target as HTMLFormElement;
    if (!form.reportValidity()) return;
    // Date controls constrain each bound; the shared server checks their order.
    const registrationId = edit.id;
    const dates = {arrivalDate: edit.arrivalDate, departureDate: edit.departureDate};
    const result = await command.run(scope => api.updateRegistrationDates(props.eventId, registrationId, dates, scope),
        true, false, {success: 'event.organizer.attendanceUpdated'});
    if (result) resetDates();
}

/** Removal is deliberate and Event-scoped; refreshed roster delivery cannot turn
 * a confirmed deletion into a second DELETE or consume another participant row. */
async function removeRegistration(row: Participant): Promise<void> {
    if (!management.isAvailable()) return;
    if (!window.confirm(messages.value.t('event.organizer.deleteRegistrationConfirm'))) return;
    // Freeze this row's identity before I/O, independently of later query updates.
    removingId.value = row.id;
    try {
        await command.run(scope => api.removeRegistration(props.eventId, row.id, scope), true, false,
            {success: 'event.organizer.registrationDeleted'});
    } finally { removingId.value = null; }
}

/** Clipboard delivery never submits a registration command or changes its row. */
async function copyEmail(row: Participant): Promise<void> {
    if (!available.isAvailable() || !row.email) return;
    await clipboard.copy(row.id, row.email);
}
async function refresh(): Promise<void> {
    if (!refreshAction.isAvailable()) return;
    await command.reconcileSafely(section.refresh);
}
</script>

<template>
    <!-- This section owns only the separately authorized roster. Administration
         callers explicitly opt into management; participant-page rows stay read-only. -->

    <section class="event-participants text-bg-dark border border-secondary-subtile rounded-2 py-1 mb-3"
        data-entity-section>
        <!-- Durable recovery follows its active controls. One persistent receipt
             renderer below moves between date-dialog and page presentation. -->
        <div v-if="!edit.id">
            <CommandFeedback :feedback="command.feedback" part="uncertain"
                :action="{state: refreshAction, label: messages.t('common.refresh')}" @action="refresh" />
        </div>

        <div class="accordion accordion-flush">
            <div class="accordion-item bg-dark border-secondary">
                <h2 class="accordion-header">
                    <AppAccordionButton class="text-light bg-dark"
                        :expanded="open" :controls="`${id}-roster`" @click="open = !open">
                        <i class="bi bi-people-fill me-2" aria-hidden="true"></i>{{ messages.t('event.organizer.participants') }}<span class="badge bg-secondary ms-2">{{ section.data.value ? section.data.value.participants.length : messages.t('common.unknown') }}</span>
                    </AppAccordionButton>
                </h2>
                <div v-show="open" :id="`${id}-roster`" class="accordion-collapse">
                    <div class="accordion-body bg-dark">
                        <LoadingSkeleton v-if="section.loading.value" variant="table" :columns="5" :rows="3" :hide-column-on-mobile="2" />
            <StatusNotice v-if="section.query.error.value" kind="warning" :read-error="section.query.error.value"
                            :action="{state: refreshAction, label: messages.t('common.retry')}"
                            :retry-at="section.retryAt.value" @action="refresh">
                            {{ section.failure.value ?? messages.t('state.stale') }}
                        </StatusNotice>

                        <template v-if="section.data.value">
                            <!-- Totals describe the full admitted roster. Search only
                                 filters table rows and never hides summary notes. -->
                            <div class="mb-2">
                                <div class="js-date-totals small text-secondary">
                                    <EventTotals :entries="dateTotals" dates />
                                </div>
                            </div>
                            <div class="d-flex flex-wrap gap-2 justify-content-between align-items-center mb-3">
                                <div class="input-group input-group-sm w-auto">
                                    <span class="input-group-text bg-secondary text-light">
                                        <i class="bi bi-search" aria-hidden="true"></i>
                                    </span>
                                    <input v-model="filter" class="form-control text-bg-dark js-filter" type="text"
                                        :placeholder="messages.t('event.organizer.filterParticipants')"
                                        :aria-label="messages.t('event.organizer.filterParticipants')"
                                        :disabled="available.disabled.value" />
                                </div>
                            </div>
                            <div class="frontend-action-row mb-2">
                                <div class="js-totals small text-secondary">
                                    <EventTotals :entries="section.data.value.totals" />
                                </div>
                                <ActionButton v-if="hasSummary" class="btn-sm ms-auto" variant="outline-warning"
                                    :state="available" @click="showDetails()"><i class="bi bi-exclamation-triangle me-1" aria-hidden="true"></i>{{ messages.t('event.organizer.allergyDetails') }}</ActionButton>
                            </div>
                            <small class="text-secondary">{{ messages.t('event.organizer.participantsHelp') }}</small>

                            <div class="table-responsive">
                                <table class="table table-dark table-striped table-bordered align-middle mb-0">
                                    <thead>
                                        <tr>
                                            <th>{{ messages.t('event.organizer.name') }}</th>
                                            <th class="d-none d-md-table-cell">{{ messages.t('event.organizer.email') }}</th>
                                            <th>{{ messages.t('event.organizer.dates') }}</th>
                                            <th>{{ messages.t('event.organizer.dietary') }}</th>
                                            <th class="text-end">{{ messages.t('event.organizer.actions') }}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr v-for="row in rows" :key="row.id" :data-registration-id="row.id">
                                            <td>
                                                <div class="fw-semibold">{{ row.name }}</div>
                                                <div class="small text-secondary d-md-none">{{ row.email ?? '' }}</div>
                                            </td>
                                            <td class="d-none d-md-table-cell">
                                                <span v-if="row.email" class="d-none d-md-inline">{{ row.email }}</span>
                                                <span v-else class="text-secondary d-none d-md-inline">—</span>
                                            </td>
                                            <td>
                                                <div>{{ formatEventDate(row.arrivalDate, messages.locale) }} → {{ formatEventDate(row.departureDate, messages.locale) }}</div>
                                            </td>
                                            <td>
                                                <span v-for="choice in row.dietary" :key="choice.choice"
                                                    class="badge rounded-pill me-1"
                                                    :class="choice.choice === 'ALLERGIES' ? 'text-bg-danger' : choice.choice === 'COMMENT' ? 'text-bg-warning' : 'text-bg-secondary'">{{ eventDietaryLabel(messages, choice.choice) }}</span>
                                                <span v-if="!row.dietary.length" class="text-secondary">—</span>
                                            </td>
                                            <td class="text-end">
                                                <div class="btn-group btn-group-sm" role="group">
                                                    <ActionButton v-if="hasDetails(row)" variant="outline-warning"
                                                        :state="available" @click="showDetails(row)"><i class="bi bi-exclamation-triangle" aria-hidden="true"></i> {{ messages.t('event.organizer.details') }}</ActionButton>
                                                    <ActionButton v-if="manageRegistrations" variant="outline-info"
                                                        :state="management" @click="editDates(row)"><i class="bi bi-calendar2-week" aria-hidden="true"></i> {{ messages.t('event.organizer.editDates') }}</ActionButton>
                                                    <ActionButton v-if="row.email" variant="outline-light"
                                                        :state="available" :disabled="clipboard.pending.has(row.id)"
                                                        :pending="clipboard.pending.has(row.id)"
                                                        @click="copyEmail(row)"><i class="bi bi-clipboard" aria-hidden="true"></i> {{ messages.t('event.organizer.copyEmail') }}</ActionButton>
                                                    <ActionButton v-if="manageRegistrations" variant="outline-danger"
                                                        :pending="command.pending.value && removingId === row.id"
                                                        :state="management" @click="removeRegistration(row)"><i class="bi bi-trash" aria-hidden="true"></i> {{ messages.t('event.organizer.deleteRegistration') }}</ActionButton>
                                                </div>
                                            </td>
                                        </tr>
                                        <tr v-if="!section.data.value.participants.length">
                                            <td colspan="5">
                                                <div class="text-secondary small">{{ messages.t('event.organizer.noParticipants') }}</div>
                                            </td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </template>
                    </div>
                </div>
            </div>
        </div>

        <!-- Read-only notes follow current admitted data; only their selection
             is local. A fresh removed row or denial retires the open dialog. -->
        <AppDialog :open="details !== null" :title="messages.t('event.organizer.notesTitle')" compact
            title-class="fs-5" content-class="text-light border border-secondary" :fullscreen-on-small="false"
            @close="closeDetails">
            <section v-if="details?.allergies.length" class="mb-3">
                <h6 class="text-danger"><i class="bi bi-exclamation-triangle-fill me-1" aria-hidden="true"></i>{{ messages.t('event.organizer.allergies') }}</h6>
                <ul class="list-unstyled mb-0">
                    <li v-for="value in details.allergies" :key="value">{{ value }}</li>
                </ul>
            </section>
            <section v-if="details?.comments.length">
                <h6 class="text-warning"><i class="bi bi-chat-left-text-fill me-1" aria-hidden="true"></i>{{ messages.t('event.organizer.comments') }}</h6>
                <ul class="list-unstyled mb-0">
                    <li v-for="value in details.comments" :key="value">{{ value }}</li>
                </ul>
            </section>
        </AppDialog>

        <!-- Attendance dates are a genuine independent draft. Background roster
             reads update the table and notes without overwriting these controls. -->
        <AppDialog :open="!!edit.id" :title="messages.t('event.organizer.adjustDates')" standard
            content-class="text-light border border-secondary" footer-class="justify-content-between"
            :pending="command.pending.value || command.recovering.value" :fullscreen-on-small="false"
            @close="closeDates">
            <template #feedback>
                <CommandFeedback :feedback="command.feedback"
                    :part="command.uncertain.value ? 'error' : 'all'" />
            </template>
            <div>
                <CommandFeedback :feedback="command.feedback" part="uncertain"
                    :action="{state: refreshAction, label: messages.t('common.refresh')}" @action="refresh" />
            </div>
            <form :id="`${id}-date-form`" @submit.prevent="saveDates">
                <FormField :id="`${id}-arrival`" class="mb-3" :label="messages.t('event.organizer.arrival')"
                    label-class="" required :required-marker="false"
                    :pending="command.pending.value && !removingId">
                    <template #control="{controlRef}">
                        <input :id="`${id}-arrival`" :ref="controlRef" v-model="edit.arrivalDate" class="form-control text-bg-dark"
                            type="date" name="arrivalDate" required :min="startDate" :max="endDate"
                            :disabled="management.disabled.value" />
                    </template>
                </FormField>
                <FormField :id="`${id}-departure`" class="mb-0" :label="messages.t('event.organizer.departure')"
                    label-class="" required :required-marker="false"
                    :pending="command.pending.value && !removingId">
                    <template #control="{controlRef}">
                        <input :id="`${id}-departure`" :ref="controlRef" v-model="edit.departureDate" class="form-control text-bg-dark"
                            type="date" name="departureDate" required :min="startDate" :max="endDate"
                            :disabled="management.disabled.value" />
                    </template>
                </FormField>
            </form>
            <template #footer>
                <small class="text-secondary">{{ messages.t('event.organizer.eventWindow') }}</small>
                <div class="frontend-action-row">
                    <ActionButton variant="outline-secondary"
                        :disabled="command.pending.value || command.recovering.value" @click="closeDates">{{ messages.t('common.cancel') }}</ActionButton>
                    <ActionButton type="submit" :form="`${id}-date-form`" :state="management"
                        :pending="command.pending.value && !removingId"><i class="bi bi-save me-1" aria-hidden="true"></i>{{ messages.t('event.organizer.saveDates') }}</ActionButton>
                </div>
            </template>
        </AppDialog>
    </section>
</template>
