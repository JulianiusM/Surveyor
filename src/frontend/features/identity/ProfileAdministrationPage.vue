<script setup lang="ts">
import {computed, nextTick, onBeforeUnmount, reactive, ref, shallowRef, watch} from 'vue';
import {RouterLink, useRoute, useRouter} from 'vue-router';
import {useQuery} from '@tanstack/vue-query';
import type {QueryFunctionContext} from '@tanstack/vue-query';
import type {components} from '../../../types/api/v1';
import type {PilotRequestScope} from '../../../types/FrontendPilotUiTypes';
import {useActionState, usePilot, refreshInterval} from '../../app/context';
import {isReadDenial} from '../../app/transport';
import {evictQueryFamilies, refetchFreshQuery, retireQueryFamily, useQueryAdmission} from '../../app/queryCache';
import {useCommand} from '../../composables/command';
import {completeIdentityEntry, useConfirmedNavigation, usePageEntry} from '../../composables/pageEntry';
import {useReadRetry, useReadRetryAt} from '../../composables/feedback';
import {usePageTitle} from '../../composables/pageTitle';
import {isPlainMessageKey} from '../../../modules/localization/translator';
import {frontendOverviewPath} from '../../../modules/lib/frontendIdentity';
import {IdentityAdministrationApi} from './administrationApi';
import {identityAdministrationKeys} from '../../app/queryKeys';
import FormField from '../../components/FormField.vue';
import ActionButton from '../../components/ActionButton.vue';
import StatusNotice from '../../components/StatusNotice.vue';
import CommandFeedback from '../../components/CommandFeedback.vue';
import PageMessage from '../../components/PageMessage.vue';
import LoadingSkeleton from '../../components/LoadingSkeleton.vue';
import RefreshButton from '../../components/RefreshButton.vue';
import PageHeading from '../../components/PageHeading.vue';

type Profile = components['schemas']['ProfileSettings'];
type Projection = Profile | components['schemas']['ProfileManagement'];
const context = usePilot();
const {messages} = context;
const route = useRoute();
const router = useRouter();
const api = new IdentityAdministrationApi(context.api);
const completion = useConfirmedNavigation();
const mode = computed(() => route.meta.profileMode as 'edit' | 'manage' | 'create');
const fields = reactive({name: '', isDefault: false});
const baseline = shallowRef<Profile | null>(null);
const finished = ref(false);
// Alternate between two local observer slots after confirmed saves. The old
// family is evicted first, so repeated saves cannot accumulate stale snapshots.
const projectionSlot = ref(false);
const projectionRetired = ref(false);
let active = true;
let switchTarget = '';
const initialEntry = context.initialDocumentFor(route.fullPath)?.pageEntry;
const pageAdmission = usePageEntry({
    key: computed(() => identityAdministrationKeys.entry(context.session.value?.context, mode.value)),
    initial: initialEntry ? {entry: initialEntry} : undefined,
    read: readEntry,
    onDenied: retireEntryProjection,
});
const entryRetryAvailable = pageAdmission.retryAvailable;
const entryRetryAt = useReadRetryAt(() => pageAdmission.error.value, entryRetryAvailable);
const entryFailure = computed(entryFailureText);
onBeforeUnmount(() => { active = false; });
const family = computed(() => mode.value === 'edit'
    ? identityAdministrationKeys.current(context.session.value?.context)
    : identityAdministrationKeys.profiles(context.session.value?.context));
const key = computed(() => [...family.value, {confirmation: projectionSlot.value}]);
const admission = useQueryAdmission(context, key,
    computed(() => !finished.value && context.hydrated.value && context.visible.value && pageAdmission.outcome.value?.kind === 'render'));
const projection = useQuery({
    queryKey: key,
    ...admission,
    queryFn: readProjection,
    refetchInterval(query) {
        return context.mayRead() && context.visible.value
            ? refreshInterval(query.state.error, query.state.fetchFailureCount, 0) : false;
    },
    refetchIntervalInBackground: false,
});
// Validated denial removes protected content. Ordinary refresh failures retain the
// last admitted form/roster and its local draft instead of replacing focused input.
const denied = computed(() => isReadDenial(projection.error.value));
const data = computed(() => denied.value || pageAdmission.outcome.value?.kind !== 'render' ? undefined : projection.data.value);
const profile = computed(() => data.value && !('profiles' in data.value) ? data.value : null);
const profiles = computed(() => data.value && 'profiles' in data.value ? data.value.profiles : []);
const retryAvailable = useReadRetry(() => projection.error.value);
const retryAt = useReadRetryAt(() => projection.error.value, retryAvailable);
const command = useCommand(refreshProjection, true, {dirty: isDirty, unknownMessage: 'auth.leaveUnknown'});
const blocked = computed(() => finished.value || command.action.disabled.value || completion.target.value !== null);
const resourceRecovery = useActionState({eligible: mayRecoverProjection,
    pending: () => command.recovering.value || projection.isFetching.value,
    blocked: () => command.recoveryAction.disabled.value});
const title = computed(() => mode.value === 'edit'
    ? messages.value.t('profile.profileTitle', {name: profile.value?.name ?? context.session.value?.activeProfile?.name ?? ''})
    : messages.value.t(mode.value === 'manage' ? 'profile.manageTitle' : 'profile.createTitle'));
const remoteChanged = computed(() => !!baseline.value && !!profile.value
    && (baseline.value.name !== profile.value.name || baseline.value.isDefault !== profile.value.isDefault));
// Native browser titles differ from these visible form headings. The existing
// title owner still follows the admitted profile and reactive interface locale.
usePageTitle(() => mode.value === 'edit'
    ? messages.value.t('profile.documentTitle', {name: profile.value?.name ?? context.session.value?.activeProfile?.name ?? ''})
    : messages.value.t(mode.value === 'manage' ? 'profile.manageDocumentTitle' : 'profile.createTitle'));
watch(profile, receiveProfile, {immediate: true});
watch([mode, context.epoch], resetVisit, {flush: 'sync'});
watch(() => projection.error.value, retireDeniedProfile, {flush: 'sync'});
watch([completion.target, completion.pending, projectionRetired], releaseConfirmedEditor);

/** Wrap only the generated admission value required by the shared entry/navigation owner. */
async function readEntry(scope: PilotRequestScope, signal: AbortSignal) {
    return {entry: await api.entry(mode.value, route.fullPath, scope, signal)};
}

/** Admission denial removes all private administration snapshots for this actor, not the entry receipt. */
async function retireEntryProjection(_entry: {readonly status: number}, scope: PilotRequestScope): Promise<void> {
    // Private queries may have been cached by another administration visit. Retire
    // them without canceling the read that owns this new admission decision.
    fields.name = '';
    fields.isDefault = false;
    baseline.value = null;
    await evictQueryFamilies(context.queryClient, [identityAdministrationKeys.current(scope.context),
        identityAdministrationKeys.profiles(scope.context)]);
}

/** Keep server-owned native denial wording separate from a recoverable admission read failure. */
function entryFailureText(): string | undefined {
    const entry = pageAdmission.outcome.value;
    if (entry?.kind === 'denied') {
        return messages.value.t(isPlainMessageKey(entry.messageKey) ? entry.messageKey : 'common.error');
    }
    // A failed locale/bootstrap recheck retains a previously admitted draft.
    return pageAdmission.error.value && entry?.kind !== 'render' ? messages.value.t('state.loadFailed') : undefined;
}

/** A confirmed read denial retires private fields/cache while keeping the command's outcome protected. */
function retireDeniedProfile(failure: Error | null): void {
    if (!isReadDenial(failure)) return;
    // No private draft or prior query value remains usable after admission is lost.
    // The shared command owner independently retains any unresolved delivery status.
    fields.name = '';
    fields.isDefault = false;
    baseline.value = null;
    void retireQueryFamily(context.queryClient, key.value, failure);
}

/** Keep the actor and cancellation signal on the actual private read, including its decoder. */
function readProjection({signal}: QueryFunctionContext): Promise<Projection> {
    return mode.value === 'edit' ? api.current(context.capture(), signal) : api.profiles(context.capture(), signal);
}

/** Native names have no new browser length policy. Default false is an explicit submitted value. */
function isDirty(): boolean {
    if (finished.value || mode.value === 'manage') return false;
    return mode.value === 'create' ? fields.name !== '' : !!baseline.value
        && (fields.name !== baseline.value.name || fields.isDefault !== baseline.value.isDefault);
}

/** Fresh snapshots update clean fields only; a dirty form keeps its original values for review. */
function receiveProfile(current: Profile | null): void {
    if (mode.value !== 'edit' || !current || finished.value || isDirty()) return;
    // Copy the admitted baseline instead of editing QueryClient's readonly projection.
    baseline.value = {...current};
    fields.name = current.name;
    fields.isDefault = current.isDefault;
}

/** Accepted route/actor replacement releases this visit; locale and fragment changes retain it. */
function resetVisit(): void {
    command.acknowledge();
    fields.name = '';
    fields.isDefault = false;
    baseline.value = null;
    finished.value = false;
    projectionRetired.value = false;
    switchTarget = '';
}

/** A deliberate read certifies current admission without posting or replaying an uncertain command. */
async function refreshProjection(): Promise<void> {
    // Capture before cancellation yields; a retired actor cannot resume this read.
    const scope = context.capture();
    const currentKey = key.value;
    await refetchFreshQuery<Projection>(context.queryClient, currentKey, refetchProjection, mayRead);

    function mayRead(): boolean { return active && context.mayRead(scope); }
}

function refetchProjection(): Promise<unknown> { return projection.refetch({throwOnError: true}); }

/** Read recovery retains input and command uncertainty; a roster cannot prove creation failed. */
async function recover(): Promise<void> {
    if (!resourceRecovery.isAvailable()) return;
    await command.recover();
}

function mayRecoverProjection(): boolean {
    return active && context.mayRead() && retryAvailable.value;
}

/** A same-route save releases its old form only after its observer was retired.
 * The fresh read retains the normal loader/retry owner; a failed display read
 * cannot recreate submitted fields or change a confirmed write into uncertainty. */
function releaseConfirmedEditor(): void {
    if (!finished.value || !projectionRetired.value || completion.target.value || completion.pending.value) return;
    finished.value = false;
    baseline.value = null;
    receiveProfile(profile.value);
}

/** Explicitly discard local edits before adopting another tab's latest profile settings. */
function reloadProfile(): void {
    if (blocked.value || !profile.value || isDirty() && !window.confirm(messages.value.t('draft.discard'))) return;
    // Discard was accepted. Release the old baseline before the normal clean-form adoption.
    baseline.value = null;
    receiveProfile(profile.value);
}

/** Confirmed commands release their fields once, then recover session display and navigation separately. */
async function submit(): Promise<void> {
    if (blocked.value || !data.value || mode.value === 'manage') return;
    const origin = route.fullPath;
    const scope = context.capture();
    const editing = mode.value === 'edit';
    const result = await command.run(saveProfile, false, true);
    if (!result) return;

    // Confirmation belongs to the unchanged native operation. Retire affected
    // reads while the common receipt retains session/navigation delivery; Retry
    // can then repeat only display reads and navigation, never this command.
    finished.value = true;
    fields.name = '';
    fields.isDefault = false;
    baseline.value = null;
    projectionRetired.value = false;
    const retirement = evictQueryFamilies(context.queryClient,
        [identityAdministrationKeys.current(scope.context), identityAdministrationKeys.profiles(scope.context)]);
    const delivery = completion.navigate(editing ? '/frontend-pilot/users/profile' : '/frontend-pilot/users/profile/manage',
        scope, origin, {kind: 'success', messageKey: editing ? 'profile.profileUpdated' : 'profile.profileCreated'}, true);
    await retirement;
    if (!active || !context.isCurrent(scope)) return;
    projectionSlot.value = !projectionSlot.value;
    await nextTick();
    projectionRetired.value = true;
    await delivery;
}

function saveProfile(scope: PilotRequestScope): Promise<components['schemas']['MutationResult']> {
    return mode.value === 'edit' ? api.update({name: fields.name, isDefault: fields.isDefault}, scope)
        : api.create(fields.name, scope);
}

/** Reuse the existing profile switch; ownership and resulting session remain server decisions. */
async function switchProfile(id: string): Promise<void> {
    if (blocked.value || !context.mayChangeIdentity()) return;
    // Keep only the selected handle; the existing operation checks account ownership.
    switchTarget = id;
    const origin = route.fullPath;
    const result = await command.run(changeProfile, false);
    if (!result) return;
    // Bootstrap and private-cache retirement follow the same path as login and logout.
    finished.value = true;
    await completeIdentityEntry(context, router, result,
        {kind: 'redirect', url: frontendOverviewPath, notice: null}, origin, completion);
}

function changeProfile(scope: PilotRequestScope): Promise<components['schemas']['IdentityResult']> {
    return context.api.switchProfile(switchTarget, scope);
}
</script>

<template>
    <PageMessage v-if="entryFailure" kind="error" :message="entryFailure" :read-error="pageAdmission.error.value"
        :retry-at="entryRetryAt" :transient="pageAdmission.outcome.value?.kind === 'denied'"
        :action="pageAdmission.error.value ? {state: pageAdmission.retryAction, label: messages.t('common.retry')} : undefined"
        @action="pageAdmission.retry" />
    <LoadingSkeleton v-else-if="pageAdmission.outcome.value?.kind !== 'render'" v-bind="route.meta.loadingSkeleton" page />
    <PageMessage v-else-if="denied" kind="error" :message="messages.t('common.notAllowed')"
        :read-error="projection.error.value" :retry-at="retryAt" :transient="false"
        :action="{state: resourceRecovery, label: messages.t('common.retry')}" @action="recover">
        <CommandFeedback :feedback="command.feedback" part="uncertain">
            <template #uncertain>{{ ' ' + messages.t('auth.unconfirmedRequest') }}</template>
        </CommandFeedback>
    </PageMessage>
    <section v-else class="card bg-dark text-white mb-3">
        <PageHeading class="card-header" :title="title" :icon="mode === 'create' ? 'bi-person-plus-fill' : 'bi-archive-fill'">
            <template #actions><RefreshButton v-if="mode !== 'create'" :state="resourceRecovery" @refresh="recover" /></template>
        </PageHeading>
        <div class="card-body">
            <!-- Read and command receipts retain independent recovery, pending and uncertainty lifetimes. -->
            <StatusNotice v-if="pageAdmission.error.value" kind="warning" :read-error="pageAdmission.error.value"
                :retry-at="entryRetryAt" :last-updated-at="pageAdmission.admittedAt.value"
                :action="{state: pageAdmission.retryAction, label: messages.t('common.retry'), class: 'ms-2'}"
                @action="pageAdmission.retry">
                {{ messages.t('state.stale') }}
            </StatusNotice>
            <StatusNotice v-if="projection.error.value" kind="warning" :read-error="projection.error.value"
                :retry-at="retryAt" :last-updated-at="data ? projection.dataUpdatedAt.value : undefined"
                :action="{state: resourceRecovery, label: messages.t('common.retry'), class: 'ms-2'}" @action="recover">
                {{ messages.t(data ? 'state.stale' : 'state.loadFailed') }}
            </StatusNotice>
            <CommandFeedback :feedback="command.feedback" part="error" error-kind="danger" />
            <CommandFeedback :feedback="command.feedback" part="uncertain"
                :action="{state: resourceRecovery, label: messages.t('common.refresh'), class: 'ms-2'}" @action="recover">
                <template #uncertain>{{ ' ' + messages.t('auth.unconfirmedRequest') }}</template>
            </CommandFeedback>
            <LoadingSkeleton v-if="!data && !projection.error.value" v-bind="route.meta.loadingSkeleton" />
            <template v-if="data">
                <!-- The account roster is projected explicitly; each action adopts the existing switch command. -->
                <ul v-if="mode === 'manage'" class="list-group">
                    <li v-for="owned in profiles" :key="owned.id" class="list-group-item pilot-action-row justify-content-between align-items-start">
                        <span class="ms-2 me-auto my-auto">{{ owned.name }}</span>
                        <ActionButton variant="primary" :disabled="blocked" :pending="command.pending.value && switchTarget === owned.id" @click="switchProfile(owned.id)">
                            <i class="bi bi-arrow-left-right me-1" aria-hidden="true"></i>{{ messages.t('profile.switchProfile') }}
                        </ActionButton>
                    </li>
                </ul>
                <template v-else>
                    <p class="lead text-center mb-4"><i class="bi bi-exclamation-diamond-fill me-1" aria-hidden="true"></i>{{ messages.t(mode === 'edit' ? 'profile.profileIntro' : 'profile.createIntro') }}</p>
                    <StatusNotice v-if="remoteChanged" kind="warning">{{ messages.t('profile.remoteChanged') }}
                        <template #actions>
                            <ActionButton variant="outline-light" :disabled="blocked" @click="reloadProfile">{{ messages.t('profile.reloadSettings') }}</ActionButton>
                        </template>
                    </StatusNotice>
                    <!-- Feature-owned text and checkbox values survive reads; confirmation releases both together. -->
                    <form class="row gy-3 justify-content-center" @submit.prevent="submit">
                        <FormField id="name" v-model="fields.name" class="col-md-6" required :disabled="blocked"
                            :pending="command.pending.value && !switchTarget"
                            :label="messages.t('profile.profileName')" :label-icon="mode === 'edit' ? 'bi-key' : 'bi-person-circle'"
                            :placeholder="messages.t('profile.profileNamePlaceholder')" />
                        <div v-if="mode === 'edit'" class="col-md-6">
                            <i class="bi bi-info-square me-2" aria-hidden="true"></i>{{ messages.t('profile.defaultExplanation') }}
                            <div class="form-check mt-2">
                                <input id="isDefault" v-model="fields.isDefault" name="isDefault" type="checkbox" class="form-check-input text-bg-dark" :disabled="blocked" />
                                <label class="form-check-label mb-1" for="isDefault">{{ messages.t('profile.defaultProfile') }}</label>
                            </div>
                        </div>
                        <div class="col-12 d-grid mt-2">
                            <ActionButton type="submit" variant="primary" :state="command.action" :disabled="blocked">
                                <i class="bi me-1" :class="mode === 'edit' ? 'bi-binoculars' : 'bi-plus-circle'" aria-hidden="true"></i>{{ messages.t(mode === 'edit' ? 'profile.saveProfile' : 'profile.createProfile') }}
                            </ActionButton>
                        </div>
                        <div v-if="mode === 'create'" class="col-12 text-center mt-3">
                            <RouterLink class="text-decoration-none" to="/frontend-pilot/users/profile/manage"><i class="bi bi-arrow-left-circle me-1" aria-hidden="true"></i>{{ messages.t('profile.backHome') }}</RouterLink>
                        </div>
                        <template v-else>
                            <div class="col-md-4 d-grid text-center mt-3"><RouterLink class="btn btn-outline-primary" to="/frontend-pilot"><i class="bi bi-arrow-left-circle me-1" aria-hidden="true"></i>{{ messages.t('profile.backHome') }}</RouterLink></div>
                            <div class="col-md-4 d-grid text-center mt-3"><RouterLink class="btn btn-outline-warning" :to="{path: '/frontend-pilot/users/profile/migrate/request', state: {profileTokenRequest: true}}"><i class="bi bi-archive me-1" aria-hidden="true"></i>{{ messages.t('profile.showMigrationToken') }}</RouterLink></div>
                            <div class="col-md-4 d-grid text-center mt-3"><RouterLink class="btn btn-outline-danger" to="/frontend-pilot/users/profile/delete"><i class="bi bi-trash me-1" aria-hidden="true"></i>{{ messages.t('profile.deleteProfile') }}</RouterLink></div>
                        </template>
                    </form>
                </template>
                <!-- Ordinary migrated entry stays in the SPA. RouterLink retains
                     real hrefs for modified clicks and new browser documents. -->
                <div v-if="mode === 'manage'" class="mt-2 row justify-content-center">
                    <div class="col-md-4 d-grid text-center mt-3"><RouterLink class="btn btn-primary" to="/frontend-pilot"><i class="bi bi-arrow-left-circle me-1" aria-hidden="true"></i>{{ messages.t('profile.backHome') }}</RouterLink></div>
                    <div class="col-md-4 d-grid text-center mt-3"><RouterLink class="btn btn-secondary" to="/frontend-pilot/users/profile/migrate/show"><i class="bi bi-archive me-1" aria-hidden="true"></i>{{ messages.t('profile.migrateToAccount') }}</RouterLink></div>
                    <div class="col-md-4 d-grid text-center mt-3"><RouterLink class="btn btn-success" to="/frontend-pilot/users/profile/create"><i class="bi bi-plus-circle me-1" aria-hidden="true"></i>{{ messages.t('profile.createProfile') }}</RouterLink></div>
                </div>
            </template>
        </div>
    </section>
</template>
