<script setup lang="ts">
import {computed, onBeforeUnmount, ref, shallowRef, watch} from 'vue';
import {useRoute, useRouter} from 'vue-router';
import {apiCompatibility} from '../../../../.generated/api/v1/policy.mjs';
import {useActionState, usePilot} from '../../app/context';
import {useDocumentForm, useDraftProtection} from '../../composables/command';
import {useReadRetry, useReadRetryAt} from '../../composables/feedback';
import {usePageTitle} from '../../composables/pageTitle';
import type {FrontendCommonPage, FrontendProfileWorkflow} from '../../../types/FrontendPilotTypes';
import type {PilotRequestScope} from '../../../types/FrontendPilotUiTypes';
import type {components} from '../../../types/api/v1';
import {frontendDocumentUrl} from '../../../modules/lib/frontendIdentity';
import {IdentityAdministrationApi} from './administrationApi';
import ActionButton from '../../components/ActionButton.vue';
import FormField from '../../components/FormField.vue';
import PageMessage from '../../components/PageMessage.vue';
import StatusNotice from '../../components/StatusNotice.vue';
import CommonPage from '../common/CommonPage.vue';

const context = usePilot();
const {messages} = context;
const route = useRoute();
const router = useRouter();
const api = new IdentityAdministrationApi(context.api);
// Route metadata owns the nonsecret history marker and its scroll semantics.
const previewHash = route.meta.profilePreviewHash as string | undefined;
const preview = shallowRef<components['schemas']['ProfileMigrationPreviewOutcome']>();
const reading = ref(false);
const readError = shallowRef<Error | null>(null);
const readRetryAvailable = useReadRetry(() => readError.value);
const readRetryAt = useReadRetryAt(() => readError.value, readRetryAvailable);
let active = true;
let previewController: AbortController | undefined;
// The initial document owns this presentation. A later actor or accepted visit
// retires it; no query, persisted draft or warm navigation may reconstruct a token.
const documentWorkflow = computed(() => context.initialDocumentFor(route.fullPath)?.profileWorkflow);
const previewVisit = computed(() => documentWorkflow.value?.kind === 'entry' && route.hash === previewHash ? preview.value : undefined);
const workflow = computed(() => previewVisit.value?.kind === 'preview' ? previewVisit.value : documentWorkflow.value);
const denied = computed(() => previewVisit.value?.kind === 'denied' ? previewVisit.value : undefined);
// The validated outcome owns this receipt. CommonPage translates its known key;
// a locale change must not recreate the page and renew an expired native alert.
const denialPage = computed<FrontendCommonPage | undefined>(() => denied.value ? {kind: 'message', severity: 'error',
    status: denied.value.status, messageKey: denied.value.messageKey, message: ''} : undefined);
const initial = documentWorkflow.value;
const kind = computed(() => workflow.value?.kind ?? route.meta.profileWorkflow as FrontendProfileWorkflow['kind']);
const value = ref(initial && 'value' in initial ? initial.value : '');
const baseline = value.value;
const validationDismissed = ref(false);
// Hidden transport proof belongs to the admitted document, not a later reactive
// session. Replacing the actor must never authorize an old form under the new one.
const admittedSession = context.initialDocumentFor(route.fullPath)?.session;
const proof = {context: admittedSession?.context ?? '', csrf: admittedSession?.csrfToken ?? '', compatibility: apiCompatibility};
const form = useDocumentForm({dirty: isDirty});
const previewAction = useActionState({eligible: mayReadPreview, pending: () => reading.value});
const workflowAction = useActionState({eligible: maySubmitWorkflow,
    pending: () => reading.value || form.pending.value});
// The preview is a read, not an uncertain mutation. Its busy lease shares the
// page's existing departure guard while editable input stays with the form owner.
useDraftProtection({dirty: noReadDraft, busy: () => reading.value, unknownMessage: 'draft.leaveUnknown'});
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
const action = computed(formAction);
const back = computed(() => kind.value === 'deactivate' ? '/frontend-pilot/users/profile'
    : kind.value === 'delete-account' ? '/frontend-pilot' : '/frontend-pilot/users/profile/manage');
const validationError = computed(() => workflow.value && 'error' in workflow.value ? workflow.value.error : undefined);
usePageTitle(title);
watch(documentWorkflow, retireFields, {flush: 'sync'});
onBeforeUnmount(retirePreviewRead);

function noReadDraft(): boolean { return false; }

/** Mirror dispatch admission without replacing native required-field validation. */
function mayReadPreview(): boolean {
    return active && readRetryAvailable.value && context.mayRead() && !!previewHash
        && documentWorkflow.value?.kind === 'entry';
}

function maySubmitWorkflow(): boolean {
    return workflow.value?.kind === 'entry' ? previewAction.isAvailable() : form.action.isAvailable();
}

/** Actor/visit retirement removes private editable text with its admitted projection. */
function retireFields(current: FrontendProfileWorkflow | undefined): void {
    if (current) return;
    // A local history marker never retains authority after its document/actor
    // retires. Abort only this read; no entered token is persisted for restoration.
    value.value = '';
    preview.value = undefined;
    readError.value = null;
    previewController?.abort();
}

/** Dispose this component's read without canceling an already submitted native mutation. */
function retirePreviewRead(): void {
    active = false;
    previewController?.abort();
}

/** Only editable text belongs to this visit's draft; preview/token values are admitted output. */
function isDirty(): boolean {
    return !!workflow.value && kind.value !== 'token' && kind.value !== 'preview' && value.value !== baseline;
}

/** Keep preview on this mounted draft; only explicit execution/deletion leaves by browser POST. */
function submitWorkflow(event: Event): void {
    if (event.defaultPrevented) return;
    if (workflow.value?.kind !== 'entry') return form.submit(event);
    event.preventDefault();
    const element = event.currentTarget;
    if (!(element instanceof HTMLFormElement) || !element.checkValidity()) return;
    void requestPreview();
}

/** Read one token-holder preview, then record a secret-free Back/Forward location.
 * A failed read retains the exact draft, and Forward can use only this mounted
 * component's validated result. Reload has no result and never repeats the read. */
async function requestPreview(): Promise<void> {
    if (!previewAction.isAvailable() || !value.value) return;
    const scope = context.capture();
    const documentUrl = frontendDocumentUrl(route.fullPath);
    const controller = new AbortController();
    previewController = controller;
    const submittedToken = value.value;
    reading.value = true;
    readError.value = null;

    try {
        // A reload can retain the public marker but cannot retain its private
        // result. Restore an entry location before adding this explicit visit.
        if (route.hash === previewHash && !preview.value) await router.replace(documentUrl);
        if (!ownsPreviewRead(scope, controller, documentUrl)) return;
        const result = await api.preview(submittedToken, scope, controller.signal);
        if (!ownsPreviewRead(scope, controller, documentUrl)) return;
        preview.value = result;
        // Keep the captured document's exact query bytes: object locations can
        // drop or re-encode that query and become a different admitted document.
        // Only the fixed, nonsecret marker is appended to its existing URL.
        await router.push(documentUrl + previewHash);
    } catch (failure) {
        if (ownsPreviewRead(scope, controller, documentUrl)) {
            readError.value = failure instanceof Error ? failure : new Error('The profile preview could not be read.');
        }
    } finally {
        if (previewController === controller) {
            previewController = undefined;
            reading.value = false;
        }
    }
}

/** Scope asynchronous reads to the original document, actor and still-mounted reader. */
function ownsPreviewRead(scope: PilotRequestScope, controller: AbortController, documentUrl: string): boolean {
    return active && !controller.signal.aborted && previewController === controller && context.isCurrent(scope)
        && frontendDocumentUrl(route.fullPath) === documentUrl && documentWorkflow.value?.kind === 'entry';
}

/** Select only an application-owned native POST adapter and the current presentation language. */
function formAction(): string {
    // No entered token, profile or confirmation value enters the URL. The native
    // operation receives its exact input in the ordinary form body instead.
    const destination = kind.value === 'preview' ? '/users/profile/migrate/execute'
        : kind.value === 'deactivate' ? '/users/profile/delete' : '/users/account/delete';
    return `/frontend-pilot${destination}?locale=${encodeURIComponent(context.locale.value)}`;
}
</script>

<template>
    <!-- Warm router visits have no document-owned secret or POST result. Offer an
         explicit real request rather than issuing a token or repeating a preview. -->
    <PageMessage v-if="!workflow" kind="info" :message="messages.t('profile.workflowReload')" :transient="false">
        <div class="text-center"><a class="btn btn-primary" :href="route.fullPath">{{ messages.t('common.refresh') }}</a></div>
    </PageMessage>
    <CommonPage v-else-if="denialPage" :page="denialPage" />
    <template v-else>
        <!-- Native confirmation validation redisplays the same submitted value
             and alert. It is presentation, never a stronger backend completion receipt. -->
        <StatusNotice v-if="validationError && !validationDismissed" kind="danger" transient
            :renewal="validationError" @dismiss="validationDismissed = true">{{ messages.t(validationError) }}</StatusNotice>
        <StatusNotice v-if="readError" kind="danger" :read-error="readError" :retry-at="readRetryAt"
            :action="{state: previewAction, label: messages.t('common.retry'), class: 'ms-2'}" @action="requestPreview">
            {{ messages.t('state.loadFailed') }}
        </StatusNotice>
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
                    <h3 class="text-center">{{ workflow.token }}</h3>
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
                    <!-- Preview reads retain the entry draft in this component.
                         Actual mutations remain deliberate browser POSTs; their
                         successful text controls stay enabled while submitting. -->
                    <form id="forgotForm" class="row gy-3 justify-content-center" method="post"
                        :action="workflow.kind === 'entry' ? undefined : action" @submit="submitWorkflow">
                        <input type="hidden" name="_context" :value="proof.context" />
                        <input type="hidden" name="_csrf" :value="proof.csrf" />
                        <input type="hidden" name="_compat" :value="proof.compatibility" />
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
                        <div class="col-12 text-center mt-3"><a class="text-decoration-none" :href="back"><i class="bi bi-arrow-left-circle me-1" aria-hidden="true"></i>{{ messages.t('profile.backHome') }}</a></div>
                    </form>
                </template>
            </div>
        </section>
    </template>
</template>
