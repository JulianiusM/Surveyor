<script setup lang="ts">
import {computed, onMounted, reactive, ref, shallowRef, watch} from 'vue';
import {RouterLink, useRoute, useRouter} from 'vue-router';
import type {WatchCallback} from 'vue';
import type {PilotRequestScope} from '../../../types/FrontendPilotUiTypes';
import type {FrontendIdentityOperation} from '../../../types/IdentityTypes';
import {usePilot} from '../../app/context';
import {useCommand} from '../../composables/command';
import {problemMessage, useReadRetry, useReadRetryAt} from '../../composables/feedback';
import {usePageTitle} from '../../composables/pageTitle';
import {completeIdentityEntry, completePageEntry, useConfirmedNavigation} from '../../composables/pageEntry';
import FormField from '../../components/FormField.vue';
import ActionButton from '../../components/ActionButton.vue';
import StatusNotice from '../../components/StatusNotice.vue';
import PageMessage from '../../components/PageMessage.vue';
import NativeContextFields from '../../components/NativeContextFields.vue';
import LoadingSkeleton from '../../components/LoadingSkeleton.vue';
import {ApiFailure, ObsoleteRequestError} from '../../app/transport';
import type {components} from '../../../types/api/v1';
import {frontendDocumentUrl, frontendIdentityMessageFeedback, frontendIdentityPageEntry, frontendIdentityProblemKey, isRegistrationPasswordValid, passwordCriteria, safeFrontendReturn} from '../../../modules/lib/frontendIdentity';
import {isPlainMessageKey} from '../../../modules/localization/translator';

const context = usePilot();
const {messages} = context;
const route = useRoute();
const router = useRouter();
const confirmedNavigation = useConfirmedNavigation();
const mode = computed(
    () => route.meta.identityMode as FrontendIdentityOperation,
);
const next = computed(() => safeFrontendReturn(route.query.next));
const nativeInitial = context.initialDocumentFor(route.fullPath);
// Passwords belong only to this mounted form; neither bootstrap nor persistent recovery stores them.
const fields = reactive({
    username: nativeInitial?.identityFields?.username ?? '',
    password: '',
    passwordRepeat: '',
    displayname: nativeInitial?.identityFields?.displayname ?? '',
    email: nativeInitial?.identityFields?.email ?? '',
});
const finished = ref(!!nativeInitial?.identityFeedback && frontendIdentityMessageFeedback.includes(nativeInitial.identityFeedback));
const identityConfigurationProblem = shallowRef<components['schemas']['Problem'] | null>(null);
// A URL is not evidence that a command succeeded. Enhanced completion is an in-memory
// receipt scoped to its actor and exact destination. Native POST seeds that same receipt
// once, so returning after another committed visit cannot reconstruct an old success.
const pageCompleted = computed(() => {
    const completion = context.pageCompletion.value;
    const messageKey = mode.value === 'recovery' ? 'auth.recoverySent'
        : mode.value === 'reset' ? 'auth.resetDone' : null;
    return messageKey !== null && completion !== null
        && completion.context === context.session.value?.context
        && frontendDocumentUrl(completion.destination) === frontendDocumentUrl(route.fullPath) && completion.messageKey === messageKey;
});
const showPasswordCriteria = ref(false);
const criteria = computed(() => passwordCriteria(fields.password));
const passwordState = computed(() => mode.value === 'register' && fields.password
    ? isRegistrationPasswordValid(fields.password) ? 'valid' as const : 'invalid' as const : undefined);
const repeatState = computed(() => mode.value === 'register' && (fields.password || fields.passwordRepeat)
    ? fields.password === fields.passwordRepeat ? 'valid' as const : 'invalid' as const : undefined);
const command = useCommand(context.refreshSession, true, {dirty: isDirty,
    unknownMessage: 'auth.leaveUnknown', problemKey: identityProblemKey});
const reconciling = command.recovering;
const formLocation = computed(() => {
    // A new return destination is a new native form visit, even when Vue reuses its
    // component. Locale presentation and fragment movement retain the current draft.
    const {locale: _locale, ...query} = route.query;
    return router.resolve({path: route.path, query}).fullPath;
});
watch(() => [mode.value, formLocation.value], resetForm);

/** Every entered field participates in the same leave/reload policy, including password-only drafts. */
function isDirty(): boolean {
    return !finished.value && !pageCompleted.value && Object.values(fields).some(Boolean);
}

/** A committed route change releases the old draft; a cancelled guard never reaches this watcher. */
function resetForm(): void {
    command.acknowledge();
    clearFields();
    finished.value = false;
    identityConfigurationProblem.value = null;
    showPasswordCriteria.value = false;
    if (mode.value === 'activate' && context.browser && !identityDenial.value) void submit();
}

/** Clear secrets and other form values together after committed departure or confirmed submission. */
function clearFields(): void {
    Object.assign(fields, {username: '', password: '', passwordRepeat: '', displayname: '', email: ''});
}

/** Native rejected forms never redisplay credentials. Release only secrets after an actual
 * server rejection; local validation and unknown delivery retain the user's mounted input. */
function acceptIdentityRejection(failure: unknown, scope: PilotRequestScope): void {
    if (!(failure instanceof ApiFailure) || !failure.confirmedRejection || !context.isCurrent(scope)) return;
    fields.password = '';
    fields.passwordRepeat = '';
    if (failure.problem?.code === 'LOCAL_LOGIN_DISABLED') identityConfigurationProblem.value = failure.problem;
}
if (nativeInitial?.identityFormProblem) {
    command.setError(new ApiFailure(nativeInitial.identityFormProblem.status, nativeInitial.identityFormProblem));
}
const initialDocument = computed(() => context.initialDocumentFor(route.fullPath));
const configuredEntry = computed(() => context.session.value
    ? frontendIdentityPageEntry(mode.value, context.session.value.shell, next.value) : {kind: 'render' as const});
// A trusted document denial belongs to this visit. Do not redirect a rejected native POST
// merely because its GET counterpart normally enters the external provider.
const needsOidc = computed(() => initialDocument.value?.pageEntry?.kind !== 'denied'
    && !initialDocument.value?.identityProblem && configuredEntry.value.kind === 'redirect');
// Native document/command denials take precedence over a shell's configured GET
// entry. This keeps a rejected POST on its complete error presentation instead
// of redirecting it to a provider or reopening a form under different settings.
const identityDenial = computed(() => {
    const entry = initialDocument.value?.pageEntry;
    if (entry?.kind === 'denied') {
        return messages.value.t(isPlainMessageKey(entry.messageKey) ? entry.messageKey : 'common.error');
    }
    const initial = initialDocument.value?.identityProblem;
    if (initial) return problemMessage(messages.value, initial, identityProblemKey);
    // Configuration may change after the page shell was read. Its validated command
    // rejection still owns the same complete native Error instead of an inline form.
    if (identityConfigurationProblem.value) {
        return problemMessage(messages.value, identityConfigurationProblem.value, identityProblemKey);
    }
    if (mode.value === 'error') return messages.value.t('common.error');
    if (configuredEntry.value.kind === 'denied') return messages.value.t(
        isPlainMessageKey(configuredEntry.value.messageKey) ? configuredEntry.value.messageKey : 'common.error');
    return null;
});
/** OIDC entry is a document navigation, preserving the native configured-provider owner. */
function enterConfiguredProvider(redirect: boolean): void {
    const entry = configuredEntry.value;
    if (redirect && context.browser && entry.kind === 'redirect') window.location.assign(entry.url);
}
watch(needsOidc, enterConfiguredProvider, {immediate: true});

const resetAdmission = shallowRef<components['schemas']['PasswordResetCheck'] | components['schemas']['Problem'] | null>(null);
// Keep the actual read failure so server cooldowns and validated diagnostics survive
// presentation. A boolean would allow enabled Retry while the transport still waits.
const resetReadFailure = shallowRef<Error | null>(null);
const resetRetryAvailable = useReadRetry(() => resetReadFailure.value);
const resetRetryAt = useReadRetryAt(() => resetReadFailure.value, resetRetryAvailable);
const resetAttempt = ref(0);
let usedInitialReset = false;
// Only this exact initial route may consume the server admission. Reused Vue routes
// must obtain their own read, and an obsolete token response cannot reveal a form.
watch(() => [mode.value, route.params.token, initialDocument.value, context.epoch.value, context.ready.value, resetAttempt.value, pageCompleted.value],
    refreshResetAdmission, {immediate: true});

/** A reused reset route gets fresh admission; cleanup prevents an old token read reopening its form. */
async function refreshResetAdmission(_value: unknown, _previous: unknown, onCleanup: Parameters<WatchCallback>[2]): Promise<void> {
    const abort = new AbortController();
    let current = true;
    function cancelRead(): void {
        current = false;
        abort.abort();
    }
    onCleanup(cancelRead);
    resetAdmission.value = null;
    resetReadFailure.value = null;

    // Use bootstrap only for its own first route. Later tokens and retry attempts read again.
    // A confirmed native POST has already consumed the token. Its exact message receipt
    // is the presentation authority; a new token check would incorrectly replace Success.
    if (mode.value !== 'reset' || identityDenial.value || pageCompleted.value) return;
    if (!usedInitialReset && initialDocument.value?.passwordReset) {
        usedInitialReset = true;
        resetAdmission.value = initialDocument.value.passwordReset;
        return;
    }
    if (!context.browser || !context.ready.value) return;

    const scope = context.capture();
    try {
        const admission = await context.api.checkPasswordReset(String(route.params.token), scope, abort.signal);
        if (current && context.isCurrent(scope)) resetAdmission.value = admission;
    } catch (error) {
        if (!current || error instanceof ObsoleteRequestError || !context.isCurrent(scope)) return;
        if (error instanceof ApiFailure && error.confirmedRejection && error.problem && error.status !== 429) resetAdmission.value = error.problem;
        else resetReadFailure.value = error instanceof Error ? error : new Error('Password reset admission was unavailable.');
    }
}

const resetAllowed = computed(() => !!resetAdmission.value && 'valid' in resetAdmission.value);
const resetDenial = computed(() => {
    if (resetReadFailure.value) return messages.value.t('state.loadFailed');
    const problem = resetAdmission.value;
    if (!problem || !('code' in problem)) return null;
    return problemMessage(messages.value, problem, identityProblemKey);
});
const blocked = computed(() => command.pending.value || reconciling.value || command.uncertain.value || !!confirmedNavigation.target.value);

/** Checking a token is read-only. Honor its existing cooldown and current actor before
 * requesting another admission; never consume the token or replay password submission. */
function retryResetAdmission(): void {
    if (context.ready.value && resetRetryAvailable.value && resetReadFailure.value) resetAttempt.value++;
}

/** Check identity authority without replaying mail, registration or sign-in commands. */
async function refreshIdentityState(): Promise<void> {
    await command.recover();
}

/** API codes remain stable while each native form selects its established wording.
 * Both bootstrap denials and enhanced commands use the same validated projection. */
function identityProblemKey(problem: components['schemas']['Problem']) {
    return frontendIdentityProblemKey(mode.value, problem.code);
}
// Page and submit presentation share one definition per existing native identity form.
// Keeping label/icon choices together makes later form migrations explicit and reviewable.
const signInPresentation = {title: 'app.login', icon: 'bi-box-arrow-in-right',
    submit: 'app.login', submitIcon: 'bi-box-arrow-in-right'} as const;
const presentations = {
    login: signInPresentation,
    'guest-login': signInPresentation,
    register: {title: 'app.register', icon: 'bi-person-plus-fill', submit: 'app.register', submitIcon: 'bi-check-lg'},
    forgot: {title: 'auth.forgotTitle', icon: 'bi-lock-fill', submit: 'auth.sendReset', submitIcon: 'bi-send-check'},
    reset: {title: 'auth.resetTitle', icon: 'bi-shield-lock-fill', submit: 'auth.changePassword', submitIcon: 'bi-check-lg'},
    activate: {title: 'auth.activationTitle', icon: 'bi-box-arrow-in-right',
        submit: 'auth.activationTitle', submitIcon: 'bi-box-arrow-in-right'},
    error: {title: 'common.errorTitle', icon: 'bi-box-arrow-in-right',
        submit: 'common.errorTitle', submitIcon: 'bi-box-arrow-in-right'},
    oidc: signInPresentation,
    recovery: {title: 'common.successTitle', icon: 'bi-check-circle',
        submit: 'common.successTitle', submitIcon: 'bi-check-circle'},
} as const;
const presentation = computed(() => presentations[mode.value]);

// Confirmed completion owns the success page; a current validated denial owns
// Error. Ordinary form labels are the fallback only while neither result applies.
const title = computed(() => {
    if (identityDenial.value || mode.value === 'reset' && resetDenial.value) return messages.value.t('common.errorTitle');
    if (pageCompleted.value) return messages.value.t('common.successTitle');
    if (finished.value) return messages.value.t(mode.value === 'register' ? 'common.infoTitle' : 'common.successTitle');
    return messages.value.t(presentation.value.title);
});
// Semantic denial identity renews a full message; translation alone changes its
// presentation. Initial page entries, configured denial and reset checks retain
// their existing owners instead of comparing translated text or inventing receipts.
const denialReceipt = computed(() => {
    const initial = initialDocument.value;
    if (initial?.pageEntry?.kind === 'denied') return initial.pageEntry.messageKey;
    if (initial?.identityProblem) return initial.identityProblem.code;
    if (identityConfigurationProblem.value) return identityConfigurationProblem.value.code;
    if (configuredEntry.value.kind === 'denied') return configuredEntry.value.messageKey;
    const reset = resetAdmission.value;
    return reset && 'code' in reset ? reset.code : mode.value;
});
usePageTitle(title);
const titleIcon = computed(() => presentation.value.icon);
const submitLabel = computed(() => messages.value.t(presentation.value.submit));
const submitIcon = computed(() => presentation.value.submitIcon);

/** Dispatch the current form through one command owner after local, native-equivalent validation. */
async function submit(source?: Event): Promise<void> {
    // A confirmed command awaiting destination delivery can only retry navigation.
    // The shared receipt survives the private view's identity-driven remount.
    if (blocked.value) return;
    if (identityDenial.value || needsOidc.value || mode.value === 'reset' && !resetAllowed.value) return;
    if (mode.value === 'register' && (!isRegistrationPasswordValid(fields.password)
        || fields.password !== fields.passwordRepeat)) {
        // Native registration's browser validation uses one global inline alert
        // for policy or repetition failure. Its field warning stays independent.
        // Reset has no such browser handler: its controller owns rejection and
        // native redisplay, including clearing both submitted password fields.
        showPasswordCriteria.value = !isRegistrationPasswordValid(fields.password);
        command.captureFeedback(source);
        command.setError('auth.invalidPassword', 'transient', 'inline');
        return;
    }
    if (mode.value === 'login' || mode.value === 'guest-login') {
        const origin = route.fullPath;
        const destination = next.value;
        const result = await command.run(signIn, false);
        if (result) {
            clearFields();
            await completeIdentityEntry(context, router, result,
                {kind: 'redirect', url: destination, notice: {kind: 'success', messageKey: 'auth.loginDone'}}, origin, confirmedNavigation);
        }
        return;
    }
    const result = await command.run(submitIdentityForm, false);
    if (result) {
        finished.value = mode.value !== 'activate';
        clearFields();
        if (mode.value === 'activate') {
            // Activation consumes a token. Delivery failure can retry the confirmed
            // login destination only; it must never run activation a second time.
            const destination = router.resolve({path: '/frontend-pilot/users/login', query: {next: next.value}}).fullPath;
            await confirmedNavigation.navigate(destination, context.capture(), route.fullPath,
                {kind: 'success', messageKey: 'auth.activated'});
        }
    }
}

/** Sign-in commands keep the entered credentials within the captured request scope. */
async function signIn(scope: PilotRequestScope): Promise<components['schemas']['IdentityResult']> {
    try {
        if (mode.value === 'guest-login') {
            return await context.api.guestLogin({guestId: String(route.params.guestId), token: String(route.params.token)}, scope);
        }
        return await context.api.login({username: fields.username, password: fields.password, next: next.value}, scope);
    } catch (failure) {
        acceptIdentityRejection(failure, scope);
        throw failure;
    }
}

/** Dispatch registration, reset-mail, activation or password reset in the captured
 * actor scope. Await rejection here to preserve native secret-clearing behavior;
 * invalid reset tokens retire admission, while unconfirmed delivery remains unknown. */
async function submitIdentityForm(scope: PilotRequestScope) {
    try {
        // Await inside this boundary so every confirmed server rejection releases secrets.
        // Returning an unawaited promise would bypass the native redisplay handling below.
        if (mode.value === 'register') {
            return await context.api.register({
                username: fields.username,
                displayname: fields.displayname,
                email: fields.email,
                password: fields.password,
                password_repeat: fields.passwordRepeat,
                next: next.value,
            }, scope);
        }
        if (mode.value === 'forgot') {
            return await context.api.forgotPassword({username: fields.username, next: next.value}, scope);
        }
        if (mode.value !== 'reset') return await context.api.activate({token: String(route.params.token)}, scope);

        // Another client may consume the token after admission. A known denial immediately
        // closes this form, while transport failures keep the command's outcome unknown.
        return await context.api.resetPassword({token: String(route.params.token), password: fields.password,
            confirmPassword: fields.passwordRepeat}, scope);
    } catch (failure) {
        if (failure instanceof ApiFailure && failure.problem?.code === 'TOKEN_INVALID' && context.isCurrent(scope)) {
            resetAdmission.value = failure.problem;
        }
        acceptIdentityRejection(failure, scope);
        throw failure;
    }
}

/** Native recovery completes on the full message surface. Unknown delivery preserves the
 * mounted form and its values; only confirmation releases those values and departure guards. */
async function recover(): Promise<void> {
    if (blocked.value) return;
    const scope = context.capture();
    const origin = route.fullPath;
    if (await command.run(requestRecovery, false)) {
        clearFields();
        await completePageEntry(context, router, '/frontend-pilot/guest/recovery',
            'auth.recoverySent', 'success', scope, origin, confirmedNavigation);
    }
}

function requestRecovery(scope: PilotRequestScope): Promise<components['schemas']['MutationResult']> {
    return context.api.recoverGuest({email: fields.email, next: next.value}, scope);
}
onMounted(() => {
    if (mode.value === 'activate' && !identityDenial.value) void submit();
});
/** Reused route components need the same admission as first mounts. A URL alone cannot
 * restore a completed command; only trusted POST feedback or the scoped receipt can. */
function admitRecovery(): void {
    if (context.browser && context.ready.value && mode.value === 'recovery' && !pageCompleted.value && !identityDenial.value) {
        void router.replace('/frontend-pilot/users/login');
    }
}
watch(() => [mode.value, route.fullPath, identityDenial.value, pageCompleted.value, context.ready.value],
    admitRecovery, {immediate: true});
</script>

<template>
    <PageMessage v-if="identityDenial || (mode === 'reset' && resetDenial)" kind="error"
        :renewal="denialReceipt"
        :message="identityDenial || resetDenial || ''" :transient="!!identityDenial || !resetReadFailure"
        :read-error="identityDenial ? undefined : resetReadFailure" :retry-at="identityDenial ? undefined : resetRetryAt">
        <ActionButton v-if="resetReadFailure && !identityDenial" variant="outline-light"
            :disabled="!resetRetryAvailable" @click="retryResetAdmission">{{ messages.t('common.retry') }}</ActionButton>
    </PageMessage>
    <PageMessage v-else-if="finished" :kind="mode === 'register' ? 'info' : 'success'" :message="messages.t(mode === 'register'
         ? 'auth.registered' : mode === 'forgot' ? 'auth.resetSent' : 'auth.resetDone')" />
    <PageMessage v-else-if="pageCompleted" kind="success" :renewal="context.pageCompletion.value"
        :message="messages.t(mode === 'reset' ? 'auth.resetDone' : 'auth.recoverySent')" />
    <LoadingSkeleton v-else-if="mode === 'recovery'" variant="form" />
    <template v-else>
        <!-- A delivered command stays confirmed even if its destination cannot load.
             Retry belongs to the shared receipt and never resubmits credentials or mail. -->
        <StatusNotice v-if="confirmedNavigation.target.value" kind="success">
            {{ messages.t('state.saved') }}
            <ActionButton class="btn-sm ms-2" variant="outline-light"
                :pending="confirmedNavigation.pending.value" @click="confirmedNavigation.retry">
                {{ messages.t('common.retry') }}
            </ActionButton>
        </StatusNotice>
        <!-- Identity validation and activation feedback occupy the same shared region
             above the form card as native account pages. Keep it outside the form. -->
        <StatusNotice v-if="command.error.value" kind="danger"
            :inline="command.errorPresentation.value === 'inline'" :target="command.feedbackTarget.value"
            :disabled="command.pending.value || command.recovering.value"
            :transient="command.transientError.value" :renewal="command.errorRenewal.value"
            @dismiss="command.setError(null)">{{ command.error.value }}</StatusNotice>
        <section class="card bg-dark text-white mb-3">
            <h1 class="card-header text-center">
                <i class="bi me-2" :class="titleIcon" aria-hidden="true"></i>{{ title }}
            </h1>
            <div class="card-body">
                <!-- Only admission-dependent fields wait. The known card title and ordinary
                     identity forms render immediately; errors retain their existing owner. -->
                <LoadingSkeleton v-if="needsOidc || mode === 'reset' && !resetAllowed"
                    :variant="needsOidc ? 'lines' : 'form'" :rows="2" />
                <StatusNotice v-if="command.uncertain.value" kind="warning"
                    >{{ messages.t('state.unknownOutcome')
                    }} {{ messages.t('auth.unconfirmedRequest') }}<ActionButton class="ms-2" variant="outline-light" :pending="reconciling" :disabled="reconciling" @click="refreshIdentityState">{{
                        messages.t('common.refresh')
                    }}</ActionButton></StatusNotice
                >
                <template v-if="mode === 'login' && !needsOidc"
                    ><h2 class="text-center">{{ messages.t('auth.loginIntroTitle') }}</h2>
                    <p class="text-center">{{ messages.t('auth.loginIntro') }}</p></template
                >
                <p v-if="mode === 'forgot'" class="lead text-center mb-4"><i class="bi bi-envelope-at-fill me-1" aria-hidden="true"></i>{{ messages.t('auth.forgotIntro') }}</p>
                <form v-if="!needsOidc && (mode !== 'reset' || resetAllowed)" class="row gy-3 justify-content-center"
                    method="post" :action="route.path" @submit.prevent="submit">
                    <NativeContextFields :next="next" />
                    <template v-if="context.session.value?.shell.localLoginEnabled || mode === 'guest-login'">
                        <FormField
                            v-if="['login', 'register', 'forgot'].includes(mode)"
                            id="username"
                            v-model="fields.username"
                            class="col-md-6"
                            :label="messages.t(mode === 'forgot' ? 'auth.recoveryUsernameOrEmail' : mode === 'login' ? 'auth.usernameOrEmail' : 'auth.username')"
                            label-icon="bi-person-circle"
                            :placeholder="messages.t(mode === 'register' ? 'auth.chooseUsername' : mode === 'forgot' ? 'auth.forgotUsernamePlaceholder' : 'auth.usernamePlaceholder')"
                            required
                            :max-length="mode === 'forgot' ? undefined : 100"
                            autocomplete="username"
                            :disabled="blocked"
                        />
                        <FormField
                            v-if="mode === 'register'"
                            id="displayname"
                            v-model="fields.displayname"
                            class="col-md-6"
                            :label="messages.t('auth.displayName')"
                            label-icon="bi-person-circle"
                            :placeholder="messages.t('auth.chooseDisplayName')"
                            required
                            :max-length="100"
                            autocomplete="nickname"
                            :disabled="blocked"
                        />
                        <FormField
                            v-if="mode === 'register'"
                            id="email"
                            v-model="fields.email"
                            class="col-md-6"
                            :label="messages.t('auth.email')"
                            label-icon="bi-envelope"
                            :placeholder="messages.t('auth.accountEmailPlaceholder')"
                            type="email"
                            required
                            :max-length="100"
                            autocomplete="email"
                            :disabled="blocked"
                        />
                        <FormField
                            v-if="['login', 'register', 'reset'].includes(mode)"
                            id="password"
                            v-model="fields.password"
                            class="col-md-6"
                            :label="messages.t(mode === 'reset' ? 'auth.newPassword' : 'auth.password')"
                            :label-icon="mode === 'reset' ? 'bi-key-fill' : 'bi-shield-lock'"
                            :placeholder="mode === 'login' ? undefined : messages.t('auth.passwordPlaceholder')"
                            :state="passwordState"
                            :described-by="showPasswordCriteria ? 'password-info' : undefined"
                            @focus="showPasswordCriteria = mode === 'register'"
                            @blur="showPasswordCriteria = mode === 'register' && !isRegistrationPasswordValid(fields.password)"
                            type="password"
                            required
                            :min-length="8"
                            :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
                            :disabled="blocked"
                        >
                            <small v-if="mode === 'register' && showPasswordCriteria" id="password-info" class="form-text">
                                <ul class="list-unstyled mb-0 mt-1">
                                    <li v-for="criterion in (['length', 'letter', 'digit'] as const)" :key="criterion" class="small" :class="criteria[criterion] ? 'text-success' : 'text-danger'">
                                        <i class="bi" :class="criteria[criterion] ? 'bi-check-circle-fill' : 'bi-x-circle'" aria-hidden="true"></i>
                                        {{ messages.t(criterion === 'length' ? 'auth.passwordLength' : criterion === 'letter' ? 'auth.passwordLetter' : 'auth.passwordDigit') }}
                                    </li>
                                </ul>
                            </small>
                        </FormField>
                        <FormField
                            v-if="['register', 'reset'].includes(mode)"
                            id="password-repeat"
                            :name="mode === 'reset' ? 'confirmPassword' : 'password_repeat'"
                            v-model="fields.passwordRepeat"
                            class="col-md-6"
                            :label="messages.t(mode === 'reset' ? 'auth.confirmPassword' : 'auth.repeatPassword')"
                            :label-icon="mode === 'reset' ? 'bi-key' : 'bi-shield-lock'"
                            :placeholder="mode === 'reset' ? messages.t('auth.repeatPlaceholder') : undefined"
                            :state="repeatState"
                            :described-by="repeatState === 'invalid' ? 'password-repeat-info' : undefined"
                            type="password"
                            required
                            :min-length="8"
                            autocomplete="new-password"
                            :disabled="blocked"
                        ><div v-if="repeatState === 'invalid'" id="password-repeat-info" class="invalid-feedback d-block">{{ messages.t('auth.passwordMismatch') }}</div></FormField>
                        <div v-if="mode === 'register'" class="col-md-6"></div>
                        <div class="d-grid mt-2" :class="['forgot', 'reset'].includes(mode) ? 'col-12' : 'col-6'">
                            <ActionButton
                                type="submit"
                                variant="success"
                                :pending="command.pending.value"
                                :disabled="blocked"
                                ><i class="bi me-1" :class="submitIcon" aria-hidden="true"></i>{{ submitLabel }}</ActionButton
                            >
                        </div>
                        <div v-if="['forgot', 'reset'].includes(mode)" class="col-12 text-center mt-3">
                            <RouterLink class="text-decoration-none" :to="{path: '/frontend-pilot/users/login', query: {next}}"><i class="bi bi-arrow-left-circle me-1" aria-hidden="true"></i>{{ messages.t('auth.backLogin') }}</RouterLink>
                        </div>
                    </template>
                    <p v-else class="text-center">{{ messages.t('auth.loginDisabled') }}</p>
                    <div
                        v-if="context.session.value?.shell.oidcEnabled && ['login', 'register'].includes(mode)"
                        class="col-6 d-grid mt-2"
                    >
                        <a
                            class="btn btn-primary"
                            :href="'/frontend-pilot/users/oidc/login?next=' + encodeURIComponent(next)"
                            ><i class="bi bi-person-vcard me-1" aria-hidden="true"></i>{{
                                messages.t('auth.oidcLogin', {provider: context.session.value.shell.oidcName})
                            }}</a
                        >
                    </div>
                    <div
                        v-if="mode === 'login' && context.session.value?.shell.localLoginEnabled"
                        class="col-6 text-center mt-3"
                    >
                        <RouterLink
                            class="text-decoration-none"
                            :to="{path: '/frontend-pilot/users/forgot-password', query: {next}}"
                            ><i class="bi bi-arrow-left-circle me-1" aria-hidden="true"></i
                            >{{ messages.t('auth.forgotPassword') }}</RouterLink
                        >
                    </div>
                </form>
                <template v-if="mode === 'login' && !needsOidc"
                    ><hr />
                    <h2 class="text-center">{{ messages.t('auth.recoveryTitle') }}</h2>
                    <p class="text-center">{{ messages.t('auth.recoveryIntro') }}</p>
                    <form class="row gy-3 justify-content-center" method="post" action="/frontend-pilot/guest/recovery" @submit.prevent="recover">
                        <NativeContextFields :next="next" />
                        <FormField
                            id="recovery-email"
                            name="email"
                            v-model="fields.email"
                            class="col-md-6"
                            :label="messages.t('auth.email')"
                            label-icon="bi-envelope"
                            type="email"
                            required
                            autocomplete="email"
                            :disabled="blocked"
                        />
                        <div class="col-md-6 mt-auto">
                            <div class="d-grid">
                                <ActionButton type="submit" variant="outline-primary" :disabled="blocked"><i class="bi bi-box-arrow-in-right me-1" aria-hidden="true"></i>{{
                                    messages.t('auth.requestAccess')
                                }}</ActionButton>
                            </div>
                        </div>
                    </form>
                </template>
                <p v-if="finished" class="text-center mt-3">
                    <RouterLink :to="{path: '/frontend-pilot/users/login', query: {next}}">{{
                        messages.t('auth.backLogin')
                    }}</RouterLink>
                </p>
            </div>
        </section>
    </template>
</template>
