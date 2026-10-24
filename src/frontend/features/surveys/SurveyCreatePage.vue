<script setup lang="ts">
import {computed, reactive, ref, watch} from 'vue';
import {useRoute} from 'vue-router';
import type {components} from '../../../types/api/v1';
import type {WeekDay, WeekInMonth} from '../../../types/SurveyTypes';
import type {PilotRequestScope} from '../../../types/FrontendPilotUiTypes';
import {usePilot} from '../../app/context';
import {surveyKeys} from '../../app/queryKeys';
import {useCreationCommand} from '../../composables/creation';
import {usePageEntry} from '../../composables/pageEntry';
import {usePageTitle} from '../../composables/pageTitle';
import {useReadRetryAt} from '../../composables/feedback';
import {useSurveysApi} from './api';
import CombinationFields from './CombinationFields.vue';
import ActionButton from '../../components/ActionButton.vue';
import CommandFeedback from '../../components/CommandFeedback.vue';
import LoadingSkeleton from '../../components/LoadingSkeleton.vue';
import PageMessage from '../../components/PageMessage.vue';
import CreationAdmissionNotices from '../../components/CreationAdmissionNotices.vue';
import FormField from '../../components/FormField.vue';
import FileField from '../../components/FileField.vue';

// Survey creation is standalone: its feature draft contains recurring choices,
// title, description and bytes. The shared owner handles command admission,
// uncertainty, dirty departure and confirmed navigation for this distinct form.
const context = usePilot();
const {messages} = context;
const api = useSurveysApi(context);
const route = useRoute();
const sourceId = computed(() => typeof route.params.surveyId === 'string' ? route.params.surveyId.toLowerCase() : null);
type Creation = components['schemas']['SurveyCreateEntry'] & {values?: components['schemas']['SurveyDuplicate']; sourceId?: string | null};
const fields = reactive({title: '', description: ''});
const rows = ref<{key: number; weekday: WeekDay; nthWeek: WeekInMonth}[]>([]);
let rowKey = 0;
const baseline = ref<string | null>(null);
const image = ref<File | null>(null);
const entry = usePageEntry<Creation>({
    key: computed(() => sourceId.value ? surveyKeys.duplicate(context.session.value?.context, sourceId.value)
        : surveyKeys.creation(context.session.value?.context)),
    initial: initialCreation(), read: readCreation,
});
const admitted = computed(() => entry.outcome.value?.kind === 'render' && !!entry.data.value?.context);
const retryAt = useReadRetryAt(() => entry.error.value, entry.retryAvailable);
const submission = useCreationCommand<components['schemas']['SurveyCreated']>({
    dirty: () => !!image.value || baseline.value !== null && snapshot() !== baseline.value,
    eligible: () => admitted.value && baseline.value !== null,
    readEntry: readSubmissionEntry, navigateEntry: entry.navigate,
    destination: result => '/frontend-pilot/survey/' + result.id,
    success: 'survey.created', unknownMessage: 'survey.leaveUnknown',
});
const {command, blocked, createAction, submissionAdmissionError, submissionAdmittedAt,
    submissionRetryAt, submissionRetryAction, retrySubmissionAdmission} = submission;
watch([sourceId, context.epoch], resetCreation, {flush: 'sync'});
watch([entry.data, sourceId], receiveCreation, {immediate: true});
usePageTitle(() => messages.value.t('survey.createDocumentTitle'), true);

/** Evaluate the seed only for its original admitted document. A later warm
 * source cannot reuse old values, identity, guest admission or creation context. */
function initialCreation(): Creation | undefined {
    const initial = context.initialDocumentFor(route.fullPath);
    if (!initial) return;
    if (initial.surveyDuplicate) return {entry: initial.pageEntry ?? {kind: 'render'}, context: {},
        values: initial.surveyDuplicate, sourceId: sourceId.value};
    if (initial.surveyCreateContext) return {entry: initial.pageEntry ?? {kind: 'render'}, context: initial.surveyCreateContext};
    return initial.pageEntry ? {entry: initial.pageEntry, context: null} : undefined;
}

/** Duplication admits reading copied values; submission separately checks the
 * account-only create journey. Neither admission read persists a Survey. */
async function readCreation(scope: PilotRequestScope, signal: AbortSignal): Promise<Creation> {
    const source = sourceId.value;
    if (!source) return api.createEntry(scope, signal, route.fullPath);
    const values = await api.duplicate(source, scope, signal);
    return {entry: {kind: 'render'}, context: {}, values, sourceId: source};
}

/** Initialize once from an admitted source, then keep the focused form and File
 * selection through ordinary background reads. New rows own stable local keys. */
function receiveCreation(): void {
    if (baseline.value !== null || !admitted.value || (entry.data.value?.sourceId ?? null) !== sourceId.value) return;
    const copy = entry.data.value?.values;
    fields.title = copy?.title ?? '';
    // The approved Vue-only duplicate correction seeds the actual saved values.
    // Later refreshes never replace these admitted, independently editable rows.
    fields.description = copy?.description ?? '';
    rows.value = copy?.combinations.length ? copy.combinations.map(item => ({key: rowKey++, weekday: item.weekday, nthWeek: item.nthWeek}))
        : [{key: rowKey++, weekday: 'MON', nthWeek: '1'}];
    baseline.value = snapshot();
}
/** Dirty comparison includes entered values and row order, while stable DOM
 * keys remain an implementation detail rather than a user-owned form value. */
function snapshot(): string {
    // Serialize the same recurring fields collected for creation. Adding then
    // removing an untouched row therefore returns to the original clean draft.
    const combinations = rows.value.map(({weekday, nthWeek}) => ({weekday, nthWeek}));
    return JSON.stringify({fields, combinations});
}

/** Only committed source/actor changes release this local draft and chooser.
 * Failed or canceled navigation retains its complete visible input. */
function resetCreation(): void {
    submission.reset();
    baseline.value = null;
    image.value = null;
    fields.title = '';
    fields.description = '';
    rows.value = [];
}
function addRow(): void { if (!blocked.value) rows.value.push({key: rowKey++, weekday: 'MON', nthWeek: '1'}); }
/** Keep one editable recurring choice throughout creation. The generated/server
 * minimum remains authoritative even if a caller submits outside this control. */
function removeRow(key: number): void {
    // Never mutate rows while creation admission or delivery is in flight.
    if (!blocked.value && rows.value.length > 1) rows.value = rows.value.filter(row => row.key !== key);
}
async function readSubmissionEntry(scope: PilotRequestScope, returnTo: string) {
    return (await api.createEntry(scope, undefined, returnTo)).entry;
}
async function create(): Promise<void> { await submission.submit(collectCreation); }

/** Capture recurring values and selected bytes once, after account admission.
 * Structural validation stays generated; normalization/business errors remain
 * with the existing controller and leave this editable draft intact. */
function collectCreation() {
    const input: components['schemas']['SurveyCreateInput'] = {title: fields.title, description: fields.description,
        combinations: rows.value.map(({weekday, nthWeek}) => ({weekday, nthWeek}))};
    const selectedImage = image.value;
    return function createSurvey(scope: PilotRequestScope) { return api.createSurvey(input, selectedImage, scope); };
}
</script>

<template>
    <CommandFeedback :feedback="command.feedback" :part="command.uncertain.value ? 'uncertain' : 'error'"
        error-kind="danger" unknown-message="survey.creationUnknown" />
    <PageMessage v-if="entry.outcome.value?.kind === 'denied'" kind="error" :message="messages.t('common.notAllowed')"
        :renewal="entry.outcome.value" />
    <section v-else class="card bg-dark text-white mb-3">
        <h1 class="card-header text-center"><i class="bi bi-clipboard-plus-fill me-2" aria-hidden="true"></i>{{ messages.t('survey.create') }}</h1>
        <div class="card-body">
            <CreationAdmissionNotices
                :read="{error: entry.error.value, lastUpdatedAt: entry.admittedAt.value, retryAt,
                    action: entry.retryAction, stale: admitted}"
                :submission="{error: submissionAdmissionError, lastUpdatedAt: submissionAdmittedAt,
                    retryAt: submissionRetryAt, action: submissionRetryAction}"
                @retry-read="entry.retry" @retry-submission="retrySubmissionAdmission" />
            <LoadingSkeleton v-if="!admitted && baseline === null" v-bind="route.meta.loadingSkeleton" />
            <!-- Native uses the row gutters directly on its form. Each stable
                 row keeps its selections while add/remove changes neighboring rows. -->
            <form v-if="baseline !== null" id="surveyForm" class="row gy-4 justify-content-center" @submit.prevent="create">
                <FormField id="title" v-model="fields.title" name="title" class="col-md-12" :label="messages.t('survey.title')"
                    label-icon="bi-tag" required :disabled="blocked || !admitted"
                    :pending="createAction.pending.value" />
                <FormField id="description" v-model="fields.description" name="description" class="col-md-12"
                    :label="messages.t('survey.description')" label-icon="bi-pencil-square" label-class="" multiline :disabled="blocked || !admitted"
                    :pending="createAction.pending.value" />
                <FileField id="headerImg" name="headerImg" class="col-12" :label="messages.t('survey.headerOptional')"
                    label-icon="bi-card-image" :selected-file="image" :disabled="blocked || !admitted" hydration-draft @choose="image = $event" />
                <div class="col-12">
                    <label class="form-label mb-2"><i class="bi bi-calendar4-week me-1" aria-hidden="true"></i>{{ messages.t('survey.selectCombinations') }}</label>
                    <div class="table-responsive">
                        <table class="table table-dark table-hover table-bordered align-middle">
                            <thead><tr><th class="text-center w-50">{{ messages.t('survey.weekdayLabel') }}</th><th class="text-center w-40">{{ messages.t('survey.weekOfMonth') }}</th><th class="text-center w-10">{{ messages.t('packing.action') }}</th></tr></thead>
                            <tbody id="combinationTable"><tr v-for="row in rows" :key="row.key" :id="'row-' + row.key">
                                <CombinationFields v-model:weekday="row.weekday" v-model:nth-week="row.nthWeek" :prefix="'combinations[' + row.key + ']'"
                                    creation :disabled="blocked || !admitted" />
                                <td class="text-center"><ActionButton variant="danger" class="btn-sm remove-combination-btn" :disabled="blocked || !admitted || rows.length <= 1" @click="removeRow(row.key)">{{ messages.t('survey.remove') }}</ActionButton></td>
                            </tr></tbody>
                        </table>
                    </div>
                </div>
                <div class="pilot-action-row justify-content-between">
                    <ActionButton id="addCombinationBtn" variant="outline-info" :disabled="blocked || !admitted" @click="addRow"><i class="bi bi-plus-circle me-1" aria-hidden="true"></i>{{ messages.t('survey.addCombination') }}</ActionButton>
                    <ActionButton type="submit" variant="success" :state="createAction"><i class="bi bi-check-lg me-1" aria-hidden="true"></i>{{ messages.t('survey.create') }}</ActionButton>
                </div>
            </form>
        </div>
    </section>
</template>
