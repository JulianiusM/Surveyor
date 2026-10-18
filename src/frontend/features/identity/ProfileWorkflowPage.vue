<script setup lang="ts">
import {computed, onBeforeUnmount, ref, shallowRef, watch} from 'vue';
import {RouterLink, useRoute, useRouter} from 'vue-router';
import {useActionState, usePilot} from '../../app/context';
import {identityAdministrationKeys} from '../../app/queryKeys';
import {ObsoleteRequestError} from '../../app/transport';
import {useCommand} from '../../composables/command';
import {completeIdentityEntry, useConfirmedNavigation, usePageEntry} from '../../composables/pageEntry';
import {useReadRetry, useReadRetryAt} from '../../composables/feedback';
import {usePageTitle} from '../../composables/pageTitle';
import type {FrontendCommonPage, FrontendProfileWorkflow} from '../../../types/FrontendPilotTypes';
import type {PilotRequestScope} from '../../../types/FrontendPilotUiTypes';
import type {components, operations} from '../../../types/api/v1';
import {frontendDocumentUrl} from '../../../modules/lib/frontendIdentity';
import {IdentityAdministrationApi} from './administrationApi';
import ActionButton from '../../components/ActionButton.vue';
import CommandFeedback from '../../components/CommandFeedback.vue';
import FormField from '../../components/FormField.vue';
import PageMessage from '../../components/PageMessage.vue';
import StatusNotice from '../../components/StatusNotice.vue';
import LoadingSkeleton from '../../components/LoadingSkeleton.vue';
import CommonPage from '../common/CommonPage.vue';

type WorkflowKind = operations['getProfileWorkflowEntry']['parameters']['query']['kind'];
type Presentation = FrontendProfileWorkflow | components['schemas']['ProfileMigrationPreview'];
const context = usePilot();
const {messages} = context;
const route = useRoute();
const router = useRouter();
const api = new IdentityAdministrationApi(context.api);
const completion = useConfirmedNavigation();
const routeKind = computed(() => route.meta.profileWorkflow as WorkflowKind);
const documentUrl = computed(() => frontendDocumentUrl(route.fullPath));
const initial = context.initialDocumentFor(route.fullPath);
const initialWorkflow = initial?.profileWorkflow;
const value = ref(initialWorkflow && 'value' in initialWorkflow ? initialWorkflow.value : '');
const baseline = ref(value.value);
const issuedToken = ref(initialWorkflow?.kind === 'token' ? initialWorkflow.token : '');
const previewHash = computed(() => route.meta.profilePreviewHash as string | undefined);
const preview = shallowRef<components['schemas']['ProfileMigrationPreviewOutcome']>();
const reading = ref(false);
const readError = shallowRef<Error | null>(null);
const readRetryAvailable = useReadRetry(() => readError.value);
const readRetryAt = useReadRetryAt(() => readError.value, readRetryAvailable);
const finished = ref(false);
let active = true;
let acceptingInput = false;
let previewController: AbortController | undefined;
// This nonsecret navigation flag represents an actual Show token click. Consume
// it before dispatch so Back/Forward cannot issue another token or retry a failure.
let requestedToken = consumeTokenIntent() && !issuedToken.value;
const admission = usePageEntry<components['schemas']['ProfileWorkflowEntry']>({
    key: computed(() => identityAdministrationKeys.workflow(context.session.value?.context, routeKind.value)),
    initial: initialWorkflow ? {entry: initial?.pageEntry ?? {kind: 'render'}}
        : initial?.pageEntry ? {entry: initial.pageEntry} : undefined,
    read: readWorkflowEntry,
});
const admissionRetryAt = useReadRetryAt(() => admission.error.value, admission.retryAvailable);
const command = useCommand(refreshAdmission, true, {dirty: isDirty, busy: () => reading.value,
    unknownMessage: 'auth.leaveUnknown', problemKey: workflowProblemKey});
const previewAction = useActionState({eligible: mayReadPreview, pending: () => reading.value});
const workflowAction = useActionState({eligible: maySubmitWorkflow,
    pending: () => reading.value || command.pending.value,
    blocked: () => finished.value || command.uncertain.value || completion.target.value !== null});
const previewVisit = computed(() => routeKind.value === 'entry' && route.hash === previewHash.value ? preview.value : undefined);
const denied = computed(() => previewVisit.value?.kind === 'denied' ? previewVisit.value : undefined);
const workflow = computed<Presentation | undefined>(workflowPresentation);
const kind = computed(() => workflow.value?.kind ?? routeKind.value);
const denialPage = computed<FrontendCommonPage | undefined>(() => denied.value ? {kind: 'message', severity: 'error',
    status: denied.value.status, messageKey: denied.value.messageKey, message: ''} : undefined);
const heading = computed(() => messages.value.t(kind.value === 'token' ? 'profile.tokenHeading'
    : kind.value === 'entry' || kind.value === 'preview' ? 'profile.transferHeading'
        : kind.value === 'deactivate' ? 'profile.deactivateHeading' : 'profile.deleteAccountHeading'));
const title = computed(() => denied.value ? undefined : messages.value.t(kind.value === 'token' ? 'profile.tokenTitle'
    : kind.value === 'entry' || kind.value === 'preview' ? 'profile.transferTitle'
        : kind.value === 'deactivate' ? 'profile.deactivateTitle' : 'profile.deleteAccountTitle'));
const destructive = computed(() => kind.value === 'deactivate' || kind.value === 'delete-account');
const field = computed(() => kind.value === 'entry'
    ? {name: 'token', label: 'profile.migrationToken', placeholder: 'profile.tokenPlaceholder', icon: 'bi-key'} as const
    : kind.value === 'deactivate'
        ? {name: 'name', label: 'profile.profileName', placeholder: 'profile.profileNamePlaceholder', icon: 'bi-person-circle'} as const
        : {name: 'username', label: 'auth.username', placeholder: 'profile.usernamePlaceholder', icon: 'bi-person-circle'} as const);
const submitLabel = computed(() => messages.value.t(kind.value === 'entry' ? 'profile.showMigrationProfile'
    : kind.value === 'preview' ? 'profile.executeMigration'
        : kind.value === 'deactivate' ? 'profile.executeDeactivation' : 'profile.executeAccountDeletion'));
const back = computed(() => kind.value === 'deactivate' ? '/frontend-pilot/users/profile'
    : kind.value === 'delete-account' ? '/frontend-pilot' : '/frontend-pilot/users/profile/manage');
usePageTitle(title);
watch([documentUrl, context.epoch], retireVisit, {flush: 'sync'});
watch([() => admission.outcome.value?.kind, context.readsReady, context.hydrated], issueRequestedToken, {immediate: true});
onBeforeUnmount(retirePreviewRead);

/** Query owns read-only admission; it never issues tokens or runs a legacy mutation. */
function readWorkflowEntry(scope: PilotRequestScope, signal: AbortSignal) {
    return api.workflowEntry(routeKind.value, route.fullPath, scope, signal);
}

/** Present cold SSR and warm admitted visits through the same form markup.
 * Secret output remains mounted feature state rather than a Query snapshot. */
function workflowPresentation(): Presentation | undefined {
    if (admission.outcome.value?.kind !== 'render') return;
    if (previewVisit.value?.kind === 'preview') return previewVisit.value;
    if (routeKind.value === 'token') return {kind: 'token', token: issuedToken.value};
    if (routeKind.value === 'entry') return {kind: 'entry'};
    return {kind: routeKind.value, value: value.value};
}

/** Consume only the public intent flag; never put the issued bearer in history. */
function consumeTokenIntent(): boolean {
    if (!context.browser || window.history.state?.profileTokenRequest !== true) return false;
    window.history.replaceState({...window.history.state, profileTokenRequest: false}, '', window.location.href);
    return true;
}

/** An explicit navigation can wait for admission, but cannot dispatch twice. */
function issueRequestedToken(): void {
    if (!requestedToken || routeKind.value !== 'token' || !maySubmitWorkflow()) return;
    requestedToken = false;
    void requestToken();
}

/** Explicit token issuance shares pending, unknown and retained-status handling.
 * Read refresh, locale changes and browser history never call this operation. */
async function requestToken(): Promise<void> {
    if (!workflowAction.isAvailable() || issuedToken.value) return;
    const result = await command.run(api.migrationToken.bind(api), false);
    if (result) issuedToken.value = result.token;
}

/** Retain readable input during a paused read; actual actor/visit retirement
 * releases fields and private preview/token output, never a running mutation. */
function retireVisit(): void {
    previewController?.abort();
    preview.value = undefined;
    readError.value = null;
    issuedToken.value = '';
    value.value = '';
    baseline.value = '';
    finished.value = false;
    requestedToken = consumeTokenIntent();
}

function retirePreviewRead(): void {
    active = false;
    previewController?.abort();
}
function isDirty(): boolean { return !acceptingInput && !finished.value && routeKind.value !== 'token' && value.value !== baseline.value; }
function mayReadPreview(): boolean {
    return active && !finished.value && readRetryAvailable.value && context.mayRead() && !!previewHash.value
        && admission.outcome.value?.kind === 'render' && routeKind.value === 'entry';
}
function maySubmitWorkflow(): boolean {
    return active && !finished.value && context.mayRead() && admission.outcome.value?.kind === 'render'
        && !command.pending.value && !command.uncertain.value && !reading.value;
}
function workflowProblemKey(problem: components['schemas']['Problem']) {
    if (problem.code !== 'VALIDATION_FAILED') return;
    if (routeKind.value === 'deactivate') return 'profile.invalidDeactivation' as const;
    if (routeKind.value === 'delete-account') return 'profile.invalidAccountDeletion' as const;
}

/** Browser constraints remain local; every actual mutation uses the shared command owner. */
async function submitWorkflow(event: Event): Promise<void> {
    if (event.defaultPrevented) return;
    event.preventDefault();
    const element = event.currentTarget;
    if (!(element instanceof HTMLFormElement) || !element.checkValidity() || !workflowAction.isAvailable()) return;
    if (workflow.value?.kind === 'entry') return requestPreview();

    // Obtain whole-page departure consent before irreversible work, including
    // sibling drafts. A rejected write releases consent; confirmed delivery keeps it.
    // This form accepts its own confirmation text. Only sibling drafts need
    // discard consent; do not ask to discard the exact input being submitted.
    acceptingInput = true;
    const releaseDeparture = command.prepareDeparture();
    acceptingInput = false;
    if (!releaseDeparture) return;
    const origin = route.fullPath;
    const submitted = workflow.value;
    const submittedKind = submitted?.kind;
    const submittedValue = submitted?.kind === 'preview' ? submitted.token : value.value;
    async function performWorkflow(scope: PilotRequestScope) {
        if (submittedKind === 'preview') return api.transfer(submittedValue ?? '', scope);
        if (submittedKind === 'deactivate') return api.deactivate(submittedValue ?? '', scope);
        return api.deleteAccount(submittedValue ?? '', scope);
    }
    try {
        const result = await command.run(performWorkflow, false);
        if (!result) return;
        // Only confirmation releases entered values. A partial legacy failure or
        // lost response remains unknown and cannot fall through to this completion.
        finished.value = true;
        value.value = '';
        preview.value = undefined;
        issuedToken.value = '';
        command.acknowledge();
        if (result.redirect) {
            // The existing provider logout destination is the sole external handoff.
            window.location.assign(result.redirect);
            return;
        }
        // Keep the semantic notice receipt so the shared shell can translate its
        // exact completion detail without renewing feedback or replaying work.
        await completeIdentityEntry(context, router, {session: {context: result.resultingContext}, personalLink: null},
            {kind: 'redirect', url: result.destination, notice: result.notice}, origin, completion);
    } finally {
        // Shared confirmed navigation retains its own receipt after failure or
        // actor remount. This originating consent is idempotent and is never replay.
        releaseDeparture();
    }
}

/** Refresh only authority after an unknown result; unchanged reads cannot prove
 * that a transfer, deletion, token issuance or mail operation failed. */
async function refreshAdmission(): Promise<void> {
    // Cookie-changing legacy operations can have completed despite lost delivery.
    // Let the sole authoritative session reader retire that actor before recovery.
    await context.refreshSession(true);
    if (!active || !context.mayRead() || !admission.retryAction.isAvailable()) throw new ObsoleteRequestError();
    await admission.retry();
    // The generic UI retry resolves even when its query fails. Recovery must
    // positively require a new admitted read, never interpret that void as proof.
    if (admission.error.value) throw admission.error.value;
    if (admission.outcome.value?.kind !== 'render' || admission.admittedAt.value === undefined) throw new ObsoleteRequestError();
}
async function reviewUnknown(): Promise<void> {
    // Reading cannot prove that an irreversible legacy operation failed. Keep
    // uncertainty until deliberate guarded departure; never reopen submission here.
    await command.recover();
}

/** Read one token-holder preview and retain its private result for this mounted
 * nonsecret Back/Forward marker. Neither history movement nor reload repeats it. */
async function requestPreview(): Promise<void> {
    if (!previewAction.isAvailable() || !value.value) return;
    const scope = context.capture();
    const origin = documentUrl.value;
    const controller = new AbortController();
    previewController = controller;
    const submittedToken = value.value;
    reading.value = true;
    readError.value = null;
    try {
        // Remove an expired public marker before recording another explicit preview.
        if (route.hash === previewHash.value && !preview.value) await router.replace(origin);
        if (!ownsPreviewRead(scope, controller, origin)) return;
        const result = await api.preview(submittedToken, scope, controller.signal);
        if (!ownsPreviewRead(scope, controller, origin)) return;
        preview.value = result;
        await router.push(origin + previewHash.value);
    } catch (failure) {
        if (ownsPreviewRead(scope, controller, origin)) readError.value = failure instanceof Error ? failure : new Error('The profile preview could not be read.');
    } finally {
        if (previewController === controller) {
            previewController = undefined;
            reading.value = false;
        }
    }
}
function ownsPreviewRead(scope: PilotRequestScope, controller: AbortController, origin: string): boolean {
    return active && !controller.signal.aborted && previewController === controller && context.isCurrent(scope)
        && documentUrl.value === origin && routeKind.value === 'entry';
}
</script>

<template>
    <!-- Warm router visits have no document-owned secret or POST result. Offer an
         explicit real request rather than issuing a token or repeating a preview. -->
    <PageMessage v-if="admission.outcome.value?.kind === 'denied'" kind="error" :message="messages.t('common.notAllowed')" :renewal="admission.outcome.value" />
    <StatusNotice v-else-if="admission.error.value" kind="warning" :read-error="admission.error.value" :retry-at="admissionRetryAt"
        :action="{state: admission.retryAction, label: messages.t('common.retry')}" @action="admission.retry">{{ messages.t('state.loadFailed') }}</StatusNotice>
    <LoadingSkeleton v-else-if="!workflow" variant="form" :rows="3" />
    <CommonPage v-else-if="denialPage" :page="denialPage" />
    <template v-else-if="workflow">
        <StatusNotice v-if="readError" kind="danger" :read-error="readError" :retry-at="readRetryAt"
            :action="{state: previewAction, label: messages.t('common.retry'), class: 'ms-2'}" @action="requestPreview">
            {{ messages.t('state.loadFailed') }}
        </StatusNotice>
        <CommandFeedback :feedback="command.feedback" part="error" :inline="false" />
        <CommandFeedback :feedback="command.feedback" part="uncertain"
            :action="{state: command.recoveryAction, label: messages.t('common.refresh')}" @action="reviewUnknown">
            <template #uncertain>{{ ' ' + messages.t('auth.unconfirmedRequest') }}</template>
        </CommandFeedback>
        <StatusNotice v-if="completion.target.value" kind="success"
            :action="{state: completion.retryAction, label: messages.t('common.retry')}" @action="completion.retry">{{ messages.t('state.saved') }}</StatusNotice>
        <section class="card bg-dark text-white mb-3">
            <h1 class="card-header text-center"><i class="bi me-2" :class="destructive ? 'bi-trash-fill' : 'bi-archive-fill'" aria-hidden="true"></i>{{ heading }}</h1>
            <div class="card-body">
                <template v-if="workflow.kind === 'token'">
                    <div class="text-center mb-4">
                        <p class="lead">{{ messages.t('profile.tokenIntro', {name: context.session.value?.activeProfile?.name ?? ''}) }}</p>
                        <p>{{ messages.t('profile.tokenOwnerWarning') }}</p>
                        <p>{{ messages.t('profile.tokenPrivacyWarning') }}</p>
                    </div>
                    <hr />
                    <h2 class="text-center">{{ messages.t('profile.tokenLabel') }}</h2>
                    <h3 v-if="workflow.token" class="text-center">{{ workflow.token }}</h3>
                    <div v-else class="text-center"><ActionButton :state="workflowAction" @click="requestToken">{{ messages.t('profile.showMigrationToken') }}</ActionButton></div>
                </template>
                <template v-else>
                    <p v-if="workflow.kind === 'entry'" class="lead text-center mb-4"><i class="bi bi-exclamation-diamond-fill me-1" aria-hidden="true"></i>{{ messages.t('profile.transferIntro') }}</p>
                    <template v-else-if="workflow.kind === 'preview'">
                        <p class="lead text-center">{{ messages.t('profile.previewIntro') }}</p>
                        <p class="text-center">{{ messages.t('profile.previewOwnerWarning') }}</p>
                        <!-- The token holder sees exactly the native explicit owner
                             projection. Plain interpolation escapes every supplied field. -->
                        <div class="row gy-3 justify-content-center">
                            <div class="col-md-6"><h4>{{ messages.t('profile.previewName') }}</h4><p>{{ workflow.profile.name }}</p></div>
                            <div class="col-md-6"><h4>{{ messages.t('profile.previewId') }}</h4><p>{{ workflow.profile.id }}</p></div>
                            <div class="col-md-6">
                                <h4>{{ messages.t('profile.previewOwner') }}</h4>
                                <p v-if="workflow.profile.owner?.kind === 'account'">{{ workflow.profile.owner.name }} ({{ workflow.profile.owner.username }} | {{ workflow.profile.owner.email }})</p>
                                <p v-else-if="workflow.profile.owner?.kind === 'guest'">{{ workflow.profile.owner.username }} ({{ workflow.profile.owner.email || '-' }})</p>
                                <p v-else>{{ messages.t('profile.previewNoOwner') }}</p>
                            </div>
                            <div class="col-md-6"></div>
                        </div>
                    </template>
                    <p v-else class="lead text-center mb-4"><i class="bi bi-exclamation-diamond-fill me-1" aria-hidden="true"></i>{{ messages.t(workflow.kind === 'deactivate' ? 'profile.deactivateIntro' : 'profile.deleteAccountIntro') }}</p>
                    <!-- Native field names and layout remain; JSON commands retain the same mounted document. -->
                    <form id="forgotForm" class="row gy-3 justify-content-center" @submit="submitWorkflow">
                        <div v-if="workflow.kind === 'preview'" class="col-md-6">
                            <input id="token" class="form-control text-bg-dark" type="text" name="token" :value="workflow.token" hidden />
                        </div>
                        <FormField v-else :id="field.name" v-model="value" class="col-md-6" :name="field.name" required
                            :label="messages.t(field.label)" :label-icon="field.icon" :placeholder="messages.t(field.placeholder)" />
                        <div class="col-12 d-grid mt-2">
                            <ActionButton type="submit" :variant="destructive ? 'danger' : workflow.kind === 'preview' ? 'warning' : 'primary'" :state="workflowAction">
                                <i class="bi me-1" :class="destructive ? 'bi-trash' : workflow.kind === 'preview' ? 'bi-exclamation-triangle' : 'bi-binoculars'" aria-hidden="true"></i>{{ submitLabel }}
                            </ActionButton>
                        </div>
                        <div class="col-12 text-center mt-3"><RouterLink class="text-decoration-none" :to="back"><i class="bi bi-arrow-left-circle me-1" aria-hidden="true"></i>{{ messages.t('profile.backHome') }}</RouterLink></div>
                    </form>
                </template>
            </div>
        </section>
    </template>
</template>
