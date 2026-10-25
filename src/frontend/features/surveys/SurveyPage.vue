<script setup lang="ts">
import {computed, onBeforeUnmount, reactive, ref, watch} from 'vue';
import {useRoute} from 'vue-router';
import type {components} from '../../../types/api/v1';
import type {SurveyAnswer, WeekDay, WeekInMonth} from '../../../types/SurveyTypes';
import type {FrontendRead} from '../../../types/FrontendUiTypes';
import {useActionState, useFrontend} from '../../app/context';
import {evictQueryFamilies, observeQueryReads, retireQueryFamily} from '../../app/queryCache';
import {overviewKeys, surveyKeys} from '../../app/queryKeys';
import {useListCommands, useListDetail} from '../../composables/listDetail';
import {usePageTitle} from '../../composables/pageTitle';
import {useSurveysApi} from './api';
import {combinationIdentity} from './presentation';
import EntityHeader from '../../components/EntityHeader.vue';
import EntityDescription from '../../components/EntityDescription.vue';
import ActionButton from '../../components/ActionButton.vue';
import CommandFeedback from '../../components/CommandFeedback.vue';
import StatusNotice from '../../components/StatusNotice.vue';
import EntityDetailReadState from '../../components/EntityDetailReadState.vue';
import RefreshButton from '../../components/RefreshButton.vue';
import SurveyBallot from './SurveyBallot.vue';
import SurveyResults from './SurveyResults.vue';
import CombinationFields from './CombinationFields.vue';
import SurveySettings from './SurveySettings.vue';

const context = useFrontend();
const {messages} = context;
const route = useRoute();
const api = useSurveysApi(context);
const surveyId = computed(() => String(route.params.surveyId).toLowerCase());
const key = computed(() => surveyKeys.detail(context.session.value?.context, surveyId.value));
const editorOpen = ref(false);
const answers = reactive<Record<string, Exclude<SurveyAnswer, null>>>({});
const baseline = ref<Record<string, Exclude<SurveyAnswer, null>>>({});
const combination = reactive<{weekday: WeekDay; nthWeek: WeekInMonth}>({weekday: 'MON', nthWeek: '1'});
// Both forms share command protection, but only the deliberate initiating form
// owns its pending spinner and temporary focus.
const pendingControl = ref<'ballot' | 'combination' | null>(null);
const ballotDirty = computed(() => Object.keys(answers).some(id => answers[id] !== baseline.value[id]));
const combinationDirty = computed(() => combination.weekday !== 'MON' || combination.nthWeek !== '1');
const {list, data, denied, refresh: readFresh, isActive} = useListDetail({
    resourceId: surveyId, queryKey: key, resourceFamily: () => surveyKeys.resource(context.session.value?.context, surveyId.value),
    read: api.survey.bind(api), denied: revokeAccess,
});
const {command, blocked, readAction, retryAt, refresh, retireSettingsAccess, reviewUnknownCreation} = useListCommands({
    active: isActive, denied: () => denied.value, reading: () => list.isFetching.value,
    error: () => list.error.value, refresh: refreshBallot,
}, {dirty: () => ballotDirty.value || combinationDirty.value, unknownMessage: 'draft.leaveUnknown'});
const ballotAction = useActionState({eligible: () => !!data.value?.capabilities.submitBallot,
    pending: () => command.pending.value && pendingControl.value === 'ballot', blocked: () => blocked.value});
const combinationAction = useActionState({eligible: () => !!data.value?.capabilities.addCombination,
    pending: () => command.pending.value && pendingControl.value === 'combination', blocked: () => blocked.value});
usePageTitle(() => messages.value.t('survey.documentTitle', {title: data.value?.title ?? messages.value.t('app.survey')}), true);
watch(data, value => {
    if (!command.pending.value && !command.recovering.value) receiveBallot(value);
}, {immediate: true});
const stopReads = observeQueryReads<FrontendRead<components['schemas']['SurveyView']>>(context.queryClient, () => key.value, result => {
    // Equal successful responses can refresh untouched personal values too.
    // Reads concurrent with a command cannot replace its confirmed baseline;
    // the command's causal follow-up below adopts only its own fresh response.
    if (isActive() && !command.pending.value && !command.recovering.value) receiveBallot(result.data);
});
onBeforeUnmount(stopReads);
watch([surveyId, context.epoch], resetDrafts, {flush: 'sync'});

/** Background reads update untouched radio values while preserving a personal
 * unsaved selection. New combinations appear as No in both DOM and payload;
 * removed columns release their obsolete draft instead of submitting foreign IDs. */
function receiveBallot(value: components['schemas']['SurveyView'] | null | undefined): void {
    if (!value) return;
    // Compare each local answer against its previous admitted personal value,
    // then advance the baseline independently of any retained local edit.
    const current: Record<string, Exclude<SurveyAnswer, null>> = {};
    for (const item of value.combinations) {
        const remote = value.ownAnswers[item.id] ?? 'no';
        current[item.id] = remote;
        if (!(item.id in answers) || answers[item.id] === baseline.value[item.id]) answers[item.id] = remote;
    }
    for (const id of Object.keys(answers)) if (!(id in current)) delete answers[id];
    baseline.value = current;
}

/** Accepted route/actor changes release old personal values and uncertainty.
 * A canceled departure never reaches this watcher or clears the open ballot. */
function resetDrafts(): void {
    // Scope change follows the root departure decision, so these personal
    // values cannot appear for a different survey or active profile.
    command.acknowledge();
    editorOpen.value = false;
    for (const id of Object.keys(answers)) delete answers[id];
    baseline.value = {};
    Object.assign(combination, {weekday: 'MON', nthWeek: '1'});
}

/** A validated detail denial releases personal/server values immediately.
 * Settings and overview caches retire through the existing query owner. */
function revokeAccess(failure: Error): void {
    // Close private presentation before asynchronous cache retirement starts.
    editorOpen.value = false;
    for (const id of Object.keys(answers)) delete answers[id];
    baseline.value = {};
    const actor = context.session.value?.context;
    void retireQueryFamily(context.queryClient, surveyKeys.resource(actor, surveyId.value), failure);
    void evictQueryFamilies(context.queryClient, [overviewKeys.all(actor)]);
}

/** Losing owner settings does not itself revoke participation. Retire only the
 * editors, then ask the detail owner for the actor's remaining admission. */
async function settingsAccessLost(): Promise<void> {
    editorOpen.value = false;
    const actor = context.session.value?.context;
    await retireSettingsAccess({resourceId: surveyId.value, currentResource: () => surveyId.value,
        families: [surveyKeys.editors(actor, surveyId.value)]});
}

/** Explicit recovery can read after denial. Only a successful new GET restores
 * personal state; a retained cache snapshot cannot acknowledge an unknown write. */
async function refreshBallot(): Promise<void> {
    // readFresh enforces the current visit and actual network receipt before
    // this explicit path adopts radio values while command recovery is pending.
    await readFresh();
    if (isActive() && !denied.value) receiveBallot(data.value);
}

/** Submit exactly the radio values shown for the currently admitted columns.
 * The existing backend replaces this profile's ballot with its legacy operation;
 * confirmation releases the submitted draft before the owning follow-up read. */
async function submitBallot(): Promise<void> {
    if (!ballotAction.isAvailable() || !data.value) return;
    const submitted = Object.fromEntries(data.value.combinations.map(item => [item.id, answers[item.id] ?? 'no']));
    pendingControl.value = 'ballot';
    try {
        await command.run(async scope => {
            const result = await api.submitBallot(surveyId.value, {answers: submitted}, scope);
            // Mutation confirmation is sufficient to release local edits, but only
            // the fresh GET below supplies the next shared result/authority snapshot.
            if (isActive() && context.isCurrent(scope)) baseline.value = {...submitted};
            return result;
        }, true, false, {success: 'survey.ballotSaved'});
    } finally { pendingControl.value = null; }
}

/** Every admitted profile can add a recurring combination. Unknown creation
 * needs explicit review because a resource read cannot identify the new row. */
async function addCombination(): Promise<void> {
    if (!combinationAction.isAvailable()) return;
    // An already displayed choice needs no write or recovery warning. Compare
    // both recurring fields against the admitted data, retaining the selection
    // and ballot while the shared notice owner presents this ordinary no-op.
    const identity = combinationIdentity(combination);
    if (data.value?.combinations.some(item => combinationIdentity(item) === identity)) {
        command.setInformation('survey.combinationAlreadyPresent');
        return;
    }
    // Capture both select values before sending. Only confirmed creation releases
    // them; rejected and unknown outcomes retain the visible combination draft.
    const submitted = {...combination};
    pendingControl.value = 'combination';
    try {
        const result = await command.run(scope => api.addCombination(surveyId.value, submitted, scope), true, true,
            {success: 'survey.combinationAdded', rejectionInformation: {SURVEY_COMBINATION_EXISTS: 'survey.combinationAlreadyPresent'}});
        if (result) Object.assign(combination, {weekday: 'MON', nthWeek: '1'});
    } finally { pendingControl.value = null; }
}
</script>

<template>
    <CommandFeedback :feedback="command.feedback" :disabled="command.pending.value || command.recovering.value"
        :creation-review="{required: command.reviewRequired.value, message: 'survey.reviewUnknownCombination', state: readAction}"
        @review-creation="reviewUnknownCreation('survey.confirmUnknownReviewed')" />
    <section class="card bg-dark text-white mb-3">
        <EntityHeader :resource-id="surveyId" :title="data?.title ?? messages.t('app.survey')" icon="bi-clipboard-check"
            :image-version="data?.headerVersion" :image-enabled="!!data && !denied" :image-query-key="key" :read-image="api.header.bind(api)"
            :settings-available="!!data?.capabilities.manageSettings" :settings-disabled="blocked" @settings="editorOpen = true">
            <template #actions><RefreshButton :state="readAction" @refresh="refresh" /></template>
        </EntityHeader>
        <div class="card-body">
            <EntityDetailReadState :denied="denied" :error="list.error.value" :has-data="!!data" :pending="list.isPending.value"
                :last-updated-at="data ? list.dataUpdatedAt.value : undefined" :retry-at="retryAt" :skeleton="route.meta.loadingSkeleton">
            </EntityDetailReadState>
            <template v-if="data">
                <StatusNotice v-if="data.archived" kind="info">{{ messages.t('packing.archived') }}</StatusNotice>
                <!-- Approved Survey correction reveals the saved instructions
                     through the same escaped multiline owner as matching lists. -->
                <EntityDescription :description="data.description" />
                <SurveyBallot :combinations="data.combinations" :answers="answers" :profile-name="data.profileName" :disabled="blocked" :action="ballotAction"
                    @answer="(id, answer) => answers[id] = answer" @submit="submitBallot" />
                <SurveyResults :combinations="data.combinations" :responses="data.responses" />
                <h2 class="text-center mt-5 mb-3"><i class="bi bi-calendar-plus-fill me-2" aria-hidden="true"></i>{{ messages.t('survey.addNewCombination') }}</h2>
                <form id="survey-add-combination" class="row g-3 justify-content-center" @submit.prevent="addCombination">
                    <CombinationFields v-model:weekday="combination.weekday" v-model:nth-week="combination.nthWeek" prefix="survey-add" :disabled="blocked" />
                    <div class="col-12 text-center d-grid mt-3"><ActionButton type="submit" variant="outline-primary" :state="combinationAction"><i class="bi bi-plus-lg me-1" aria-hidden="true"></i>{{ messages.t('survey.add') }}</ActionButton></div>
                </form>
            </template>
        </div>
    </section>
    <SurveySettings v-if="editorOpen && !denied" :key="surveyId" :survey-id="surveyId" :survey-title="data?.title"
        @close="editorOpen = false" @saved="refresh" @access-lost="settingsAccessLost" />
</template>
