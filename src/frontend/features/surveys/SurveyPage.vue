<script setup lang="ts">
import {computed, onBeforeUnmount, reactive, ref, watch} from 'vue';
import {useRoute} from 'vue-router';
import type {components} from '../../../types/api/v1';
import type {SurveyAnswer, WeekDay, WeekInMonth} from '../../../types/SurveyTypes';
import type {PilotRead} from '../../../types/FrontendPilotUiTypes';
import {useActionState, usePilot} from '../../app/context';
import {evictQueryFamilies, observeQueryReads, retireQueryFamily} from '../../app/queryCache';
import {overviewKeys, surveyKeys} from '../../app/queryKeys';
import {useListDetail} from '../../composables/listDetail';
import {useCommand} from '../../composables/command';
import {usePageTitle} from '../../composables/pageTitle';
import {useReadRetry, useReadRetryAt} from '../../composables/feedback';
import {useSurveysApi} from './api';
import EntityHeader from '../../components/EntityHeader.vue';
import EntityDescription from '../../components/EntityDescription.vue';
import ActionButton from '../../components/ActionButton.vue';
import CommandFeedback from '../../components/CommandFeedback.vue';
import StatusNotice from '../../components/StatusNotice.vue';
import LoadingSkeleton from '../../components/LoadingSkeleton.vue';
import SurveyBallot from './SurveyBallot.vue';
import SurveyResults from './SurveyResults.vue';
import CombinationFields from './CombinationFields.vue';
import SurveySettings from './SurveySettings.vue';

const context = usePilot();
const {messages} = context;
const route = useRoute();
const api = useSurveysApi(context);
const surveyId = computed(() => String(route.params.surveyId).toLowerCase());
const key = computed(() => surveyKeys.detail(context.session.value?.context, surveyId.value));
const editorOpen = ref(false);
let active = true;
onBeforeUnmount(() => { active = false; });
const answers = reactive<Record<string, Exclude<SurveyAnswer, null>>>({});
const baseline = ref<Record<string, Exclude<SurveyAnswer, null>>>({});
const combination = reactive<{weekday: WeekDay; nthWeek: WeekInMonth}>({weekday: 'MON', nthWeek: '1'});
const ballotDirty = computed(() => Object.keys(answers).some(id => answers[id] !== baseline.value[id]));
const combinationDirty = computed(() => combination.weekday !== 'MON' || combination.nthWeek !== '1');
const {list, data, denied, refresh: readFresh} = useListDetail({
    resourceId: surveyId, queryKey: key, resourceFamily: () => surveyKeys.resource(context.session.value?.context, surveyId.value),
    read: api.survey.bind(api), denied: revokeAccess,
});
const command = useCommand(refreshAfterCommand, false, {dirty: () => ballotDirty.value || combinationDirty.value, unknownMessage: 'draft.leaveUnknown'});
const blocked = computed(() => command.action.disabled.value);
const retryAvailable = useReadRetry(() => list.error.value);
const retryAt = useReadRetryAt(() => list.error.value, retryAvailable);
const readAction = useActionState({eligible: () => active && context.mayRead() && retryAvailable.value,
    pending: () => list.isFetching.value, blocked: () => command.recoveryAction.disabled.value});
const ballotAction = useActionState({eligible: () => !!data.value?.capabilities.submitBallot,
    pending: () => command.pending.value, blocked: () => blocked.value});
const combinationAction = useActionState({eligible: () => !!data.value?.capabilities.addCombination,
    pending: () => command.pending.value, blocked: () => blocked.value});
usePageTitle(() => messages.value.t('survey.documentTitle', {title: data.value?.title ?? messages.value.t('app.survey')}), true);
watch(data, value => {
    if (!command.pending.value && !command.recovering.value) receiveBallot(value);
}, {immediate: true});
const stopReads = observeQueryReads<PilotRead<components['schemas']['SurveyView']>>(context.queryClient, () => key.value, result => {
    // Equal successful responses can refresh untouched personal values too.
    // Reads concurrent with a command cannot replace its confirmed baseline;
    // the command's causal follow-up below adopts only its own fresh response.
    if (active && !command.pending.value && !command.recovering.value) receiveBallot(result.data);
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
    const id = surveyId.value;
    // Cancel editor reads before detail recovery can admit another projection.
    await evictQueryFamilies(context.queryClient, [surveyKeys.editors(actor, id)]);
    if (active && id === surveyId.value && actor === context.session.value?.context) await refresh();
}

/** Confirmed/unknown status belongs to the shared command owner; recovery only
 * reads the current resource and never resubmits a ballot or creates a column. */
async function refresh(): Promise<void> {
    if (!readAction.isAvailable()) return;
    // Reconciliation can clear desired-state uncertainty only after dispatching
    // a fresh resource read; it never infers success from an idle cached value.
    try { await command.reconcile(refreshBallot); }
    catch { command.notice.value = 'state.stale'; }
}
async function refreshAfterCommand(): Promise<void> {
    if (!active || denied.value) return;
    await refreshBallot();
}

/** Explicit recovery can read after denial. Only a successful new GET restores
 * personal state; a retained cache snapshot cannot acknowledge an unknown write. */
async function refreshBallot(): Promise<void> {
    // readFresh enforces the current visit and actual network receipt before
    // this explicit path adopts radio values while command recovery is pending.
    await readFresh();
    if (active && !denied.value) receiveBallot(data.value);
}

/** Submit exactly the radio values shown for the currently admitted columns.
 * The existing backend replaces this profile's ballot with its legacy operation;
 * confirmation releases the submitted draft before the owning follow-up read. */
async function submitBallot(): Promise<void> {
    if (!ballotAction.isAvailable() || !data.value) return;
    const submitted = Object.fromEntries(data.value.combinations.map(item => [item.id, answers[item.id] ?? 'no']));
    await command.run(async scope => {
        const result = await api.submitBallot(surveyId.value, {answers: submitted}, scope);
        // Mutation confirmation is sufficient to release local edits, but only
        // the fresh GET below supplies the next shared result/authority snapshot.
        if (active && context.isCurrent(scope)) baseline.value = {...submitted};
        return result;
    }, true, false, {success: 'survey.ballotSaved'});
}

/** Every admitted profile can add a recurring combination. Unknown creation
 * needs explicit review because a resource read cannot identify the new row. */
async function addCombination(): Promise<void> {
    if (!combinationAction.isAvailable()) return;
    // Capture both select values before sending. Only confirmed creation releases
    // them; rejected and unknown outcomes retain the visible combination draft.
    const submitted = {...combination};
    const result = await command.run(scope => api.addCombination(surveyId.value, submitted, scope), true, true,
        {success: 'survey.combinationAdded'});
    if (result) Object.assign(combination, {weekday: 'MON', nthWeek: '1'});
}
/** An unknown added row cannot be identified from a later read. Show current
 * results first, then require deliberate acknowledgement before another add. */
async function reviewUnknownCombination(): Promise<void> {
    if (!readAction.isAvailable()) return;
    // The explicit confirmation releases uncertainty, without dispatching the
    // original creation or guessing which recurring row belongs to it.
    try {
        if (await command.reconcile(refreshBallot) && window.confirm(messages.value.t('survey.confirmUnknownReviewed'))) command.acknowledge();
    } catch { command.notice.value = 'state.stale'; }
}
</script>

<template>
    <CommandFeedback :feedback="command.feedback" :disabled="command.pending.value || command.recovering.value">
        <template #notice><template v-if="command.uncertain.value && command.reviewRequired.value">
            <p>{{ messages.t('survey.reviewUnknownCombination') }}</p>
            <ActionButton variant="outline-warning" :state="readAction" @click="reviewUnknownCombination">{{ messages.t('draft.review') }}</ActionButton>
        </template></template>
    </CommandFeedback>
    <section class="card bg-dark text-white mb-3">
        <EntityHeader :resource-id="surveyId" :title="data?.title ?? messages.t('app.survey')" icon="bi-clipboard-check"
            :image-version="data?.headerVersion" :image-enabled="!!data && !denied" :image-query-key="key" :read-image="api.header.bind(api)"
            :settings-available="!!data?.capabilities.manageSettings" :settings-disabled="blocked" @settings="editorOpen = true" />
        <div class="card-body">
            <StatusNotice v-if="denied" kind="danger" :retry-at="retryAt" :read-error="list.error.value">{{ messages.t('state.forbidden') }}</StatusNotice>
            <StatusNotice v-else-if="list.error.value" kind="warning" :last-updated-at="data ? list.dataUpdatedAt.value : undefined"
                :retry-at="retryAt" :read-error="list.error.value">{{ messages.t(data ? 'state.stale' : 'state.loadFailed') }}</StatusNotice>
            <div class="d-flex justify-content-end mb-1"><ActionButton variant="outline-secondary" class="btn-sm" :state="readAction"
                :aria-label="messages.t('common.refresh')" :title="messages.t('common.refresh')" @click="refresh"><i class="bi bi-arrow-clockwise" aria-hidden="true"></i></ActionButton></div>
            <LoadingSkeleton v-if="!data && !denied && list.isPending.value" v-bind="route.meta.loadingSkeleton" />
            <template v-if="data">
                <StatusNotice v-if="data.archived" kind="info">{{ messages.t('packing.archived') }}</StatusNotice>
                <!-- Approved Survey correction reveals the saved instructions
                     through the same escaped multiline owner as matching lists. -->
                <EntityDescription :description="data.description" />
                <SurveyBallot :combinations="data.combinations" :answers="answers" :profile-name="data.profileName" :disabled="blocked" :action="ballotAction"
                    @answer="(id, answer) => answers[id] = answer" @submit="submitBallot" />
                <SurveyResults :combinations="data.combinations" :responses="data.responses" />
                <h2 class="text-center mt-5 mb-3"><i class="bi bi-calendar-plus-fill me-2" aria-hidden="true"></i>{{ messages.t('survey.addNewCombination') }}</h2>
                <form id="survey-add-combination" class="row g-3 justify-content.center" @submit.prevent="addCombination">
                    <CombinationFields v-model:weekday="combination.weekday" v-model:nth-week="combination.nthWeek" prefix="survey-add" :disabled="blocked" />
                    <div class="col-12 text-center d-grid mt-3"><ActionButton type="submit" variant="outline-primary" :state="combinationAction"><i class="bi bi-plus-lg me-1" aria-hidden="true"></i>{{ messages.t('survey.add') }}</ActionButton></div>
                </form>
            </template>
        </div>
    </section>
    <SurveySettings v-if="editorOpen && !denied" :key="surveyId" :survey-id="surveyId" :survey-title="data?.title"
        @close="editorOpen = false" @saved="refresh" @access-lost="settingsAccessLost" />
</template>
