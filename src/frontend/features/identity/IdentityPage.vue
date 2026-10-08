<script setup lang="ts">
import {computed, onMounted, reactive, ref, shallowRef, watch} from 'vue';
import {RouterLink, useRoute, useRouter} from 'vue-router';
import type {WatchCallback} from 'vue';
import type {PilotRequestScope} from '../../../types/FrontendPilotUiTypes';
import {usePilot} from '../../app/context';
import {useCommand} from '../../composables/command';
import {problemMessage} from '../../composables/feedback';
import {usePageTitle} from '../../composables/pageTitle';
import {completeIdentityEntry, completePageEntry} from '../../composables/pageEntry';
import FormField from '../../components/FormField.vue';
import ActionButton from '../../components/ActionButton.vue';
import StatusNotice from '../../components/StatusNotice.vue';
import PageMessage from '../../components/PageMessage.vue';
import NativeContextFields from '../../components/NativeContextFields.vue';
import LoadingSkeleton from '../../components/LoadingSkeleton.vue';
import {ApiFailure, ObsoleteRequestError} from '../../app/transport';
import type {components} from '../../../types/api/v1';
import {frontendIdentityMessageFeedback, safeFrontendReturn} from '../../../modules/lib/frontendIdentity';
import {isPlainMessageKey} from '../../../modules/localization/translator';
import {isRegistrationPasswordValid, passwordCriteria} from '../../../public/js/core/password-policy';

const context = usePilot();
const {messages} = context;
const route = useRoute();
const router = useRouter();
const mode = computed(
    () => route.meta.identityMode as 'login' | 'register' | 'forgot' | 'reset' | 'activate' | 'guest-login' | 'recovery' | 'error',
);
const next = computed(() => safeFrontendReturn(route.query.next));
const nativeInitial = context.bootstrap.initialUrl === route.fullPath
    && context.bootstrap.session.context === context.session.value?.context ? context.bootstrap : undefined;
// Passwords belong only to this mounted form; neither bootstrap nor persistent recovery stores them.
const fields = reactive({
    username: nativeInitial?.identityFields?.username ?? '',
    password: '',
    passwordRepeat: '',
    displayname: nativeInitial?.identityFields?.displayname ?? '',
    email: nativeInitial?.identityFields?.email ?? '',
});
const finished = ref(!!nativeInitial?.identityFeedback && frontendIdentityMessageFeedback.includes(nativeInitial.identityFeedback));
// A URL is not evidence that mail was sent. Enhanced completion is an in-memory
// receipt scoped to its actor and exact destination. Native POST seeds that same receipt
// once, so returning after another committed visit cannot reconstruct an old success.
const recoveryCompleted = computed(() => {
    const completion = context.pageCompletion.value;
    return mode.value === 'recovery' && completion !== null
        && completion.context === context.session.value?.context
        && completion.destination === route.fullPath && completion.messageKey === 'auth.recoverySent';
});
const activationNotice = ref(nativeInitial?.identityFeedback === 'auth.activated');
const reconciling = ref(false);
const showPasswordCriteria = ref(false);
const criteria = computed(() => passwordCriteria(fields.password));
const passwordState = computed(() => mode.value === 'register' && fields.password
    ? isRegistrationPasswordValid(fields.password) ? 'valid' as const : 'invalid' as const : undefined);
const repeatState = computed(() => mode.value === 'register' && (fields.password || fields.passwordRepeat)
    ? fields.password === fields.passwordRepeat ? 'valid' as const : 'invalid' as const : undefined);
const command = useCommand(context.refreshSession, true, {dirty: isDirty, unknownMessage: 'auth.leaveUnknown'});
watch(() => [mode.value, route.params.token, route.params.guestId], resetForm);

/** Every entered field participates in the same leave/reload policy, including password-only drafts. */
function isDirty(): boolean {
    return !finished.value && !recoveryCompleted.value && Object.values(fields).some(Boolean);
}

/** A committed route change releases the old draft; a cancelled guard never reaches this watcher. */
function resetForm(): void {
    command.acknowledge();
    clearFields();
    finished.value = false;
    activationNotice.value = false;
    showPasswordCriteria.value = false;
    if (mode.value === 'activate' && context.browser && !identityDenial.value) void submit();
}

/** Clear secrets and other form values together after committed departure or confirmed submission. */
function clearFields(): void {
    Object.assign(fields, {username: '', password: '', passwordRepeat: '', displayname: '', email: ''});
}
if (nativeInitial?.identityFormProblem) {
    command.setError(new ApiFailure(nativeInitial.identityFormProblem.status, nativeInitial.identityFormProblem));
}
const bootstrapMatchesRoute = computed(() => context.bootstrap.initialUrl === route.fullPath);
const needsOidc = computed(() => ['login', 'register'].includes(mode.value)
    && !context.session.value?.shell.localLoginEnabled && context.session.value?.shell.oidcEnabled);
const identityDenial = computed(() => {
    const entry = bootstrapMatchesRoute.value ? context.bootstrap.pageEntry : undefined;
    if (entry?.kind === 'denied') {
        return messages.value.t(isPlainMessageKey(entry.messageKey) ? entry.messageKey : 'common.error');
    }
    const initial = bootstrapMatchesRoute.value ? context.bootstrap.identityProblem : undefined;
    if (initial) return problemMessage(messages.value, initial);
    if (mode.value === 'error') return messages.value.t('common.error');
    if (!['guest-login', 'recovery'].includes(mode.value)
        && !context.session.value?.shell.localLoginEnabled && !needsOidc.value) {
        return messages.value.t('api:errors.LOCAL_LOGIN_DISABLED');
    }
    return null;
});
watch(needsOidc, redirect => {
    if (redirect && context.browser) window.location.assign(`/frontend-pilot/users/oidc/login?next=${encodeURIComponent(next.value)}`);
}, {immediate: true});

const resetAdmission = shallowRef<components['schemas']['PasswordResetCheck'] | components['schemas']['Problem'] | null>(null);
const resetReadFailure = ref(false);
const resetAttempt = ref(0);
let usedInitialReset = false;
// Only this exact initial route may consume the server admission. Reused Vue routes
// must obtain their own read, and an obsolete token response cannot reveal a form.
watch(() => [mode.value, route.params.token, context.epoch.value, context.ready.value, resetAttempt.value],
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
    resetReadFailure.value = false;

    // Use bootstrap only for its own first route. Later tokens and retry attempts read again.
    if (mode.value !== 'reset' || identityDenial.value) return;
    if (!usedInitialReset && bootstrapMatchesRoute.value && context.bootstrap.passwordReset) {
        usedInitialReset = true;
        resetAdmission.value = context.bootstrap.passwordReset;
        return;
    }
    if (!context.browser || !context.ready.value) return;

    const scope = context.capture();
    try {
        const admission = await context.api.checkPasswordReset(String(route.params.token), scope, abort.signal);
        if (current && context.isCurrent(scope)) resetAdmission.value = admission;
    } catch (error) {
        if (!current || error instanceof ObsoleteRequestError || !context.isCurrent(scope)) return;
        if (error instanceof ApiFailure && error.problem && error.status < 500) resetAdmission.value = error.problem;
        else resetReadFailure.value = true;
    }
}

const resetAllowed = computed(() => !!resetAdmission.value && 'valid' in resetAdmission.value);
const resetDenial = computed(() => {
    if (resetReadFailure.value) return messages.value.t('state.loadFailed');
    const problem = resetAdmission.value;
    if (!problem || !('code' in problem)) return null;
    return problemMessage(messages.value, problem);
});
const blocked = computed(() => command.pending.value || command.uncertain.value);

/** Check identity authority without replaying mail, registration or sign-in commands. */
async function refreshIdentityState(): Promise<void> {
    if (reconciling.value) return;
    reconciling.value = true;
    try {
        // A changed identity remounts the application. An unchanged session cannot prove
        // registration or mail delivery failed, so retain uncertainty and never replay it.
        await context.refreshSession();
    } catch {
        command.setError('state.loadFailed');
    } finally {
        reconciling.value = false;
    }
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
    recovery: {title: 'common.successTitle', icon: 'bi-check-circle',
        submit: 'common.successTitle', submitIcon: 'bi-check-circle'},
} as const;
const presentation = computed(() => presentations[mode.value]);
const title = computed(() => {
    if (identityDenial.value || mode.value === 'reset' && resetDenial.value) return messages.value.t('common.errorTitle');
    if (recoveryCompleted.value) return messages.value.t('common.successTitle');
    if (finished.value) return messages.value.t(mode.value === 'register' ? 'common.infoTitle' : 'common.successTitle');
    return messages.value.t(presentation.value.title);
});
usePageTitle(title);
const titleIcon = computed(() => presentation.value.icon);
const submitLabel = computed(() => messages.value.t(presentation.value.submit));
const submitIcon = computed(() => presentation.value.submitIcon);

/** Dispatch the current form through one command owner after local, native-equivalent validation. */
async function submit(): Promise<void> {
    if (identityDenial.value || needsOidc.value || mode.value === 'reset' && !resetAllowed.value) return;
    if (mode.value === 'register' && !isRegistrationPasswordValid(fields.password)) {
        showPasswordCriteria.value = true;
        command.setError('auth.invalidPassword');
        return;
    }
    if (mode.value === 'register' || mode.value === 'reset') {
        if (fields.password !== fields.passwordRepeat) {
            command.setError('auth.passwordMismatch');
            return;
        }
    }
    if (mode.value === 'login' || mode.value === 'guest-login') {
        const origin = route.fullPath;
        const destination = next.value;
        const result = await command.run(signIn, false);
        if (result) {
            clearFields();
            await completeIdentityEntry(context, router, result,
                {kind: 'redirect', url: destination, notice: null}, origin);
        }
        return;
    }
    const result = await command.run(submitIdentityForm, false);
    if (result) {
        finished.value = true;
        clearFields();
        if (mode.value === 'activate') {
            await router.replace({path: '/frontend-pilot/users/login', query: {next: next.value}});
            activationNotice.value = true;
        }
    }
}

/** Sign-in commands keep the entered credentials within the captured request scope. */
function signIn(scope: PilotRequestScope): Promise<components['schemas']['IdentityResult']> {
    if (mode.value === 'guest-login') {
        return context.api.guestLogin({guestId: String(route.params.guestId), token: String(route.params.token)}, scope);
    }
    return context.api.login({username: fields.username, password: fields.password, next: next.value}, scope);
}

/** Keep each identity operation readable rather than hiding policy in a nested conditional expression. */
async function submitIdentityForm(scope: PilotRequestScope) {
    if (mode.value === 'register') {
        return context.api.register({
            username: fields.username,
            displayname: fields.displayname,
            email: fields.email,
            password: fields.password,
            password_repeat: fields.passwordRepeat,
            next: next.value,
        }, scope);
    }
    if (mode.value === 'forgot') {
        return context.api.forgotPassword({username: fields.username, next: next.value}, scope);
    }
    if (mode.value !== 'reset') return context.api.activate({token: String(route.params.token)}, scope);

    // Another client may consume the token after admission. A known denial immediately
    // closes this form, while transport failures keep the command's outcome unknown.
    try {
        return await context.api.resetPassword({token: String(route.params.token), password: fields.password,
            confirmPassword: fields.passwordRepeat}, scope);
    } catch (failure) {
        if (failure instanceof ApiFailure && failure.problem?.code === 'TOKEN_INVALID' && context.isCurrent(scope)) {
            resetAdmission.value = failure.problem;
            fields.password = '';
            fields.passwordRepeat = '';
        }
        throw failure;
    }
}

/** Native recovery completes on the full message surface. Unknown delivery preserves the
 * mounted form and its values; only confirmation releases those values and departure guards. */
async function recover(): Promise<void> {
    const scope = context.capture();
    const origin = route.fullPath;
    if (await command.run(requestRecovery, false)) {
        clearFields();
        await completePageEntry(context, router, '/frontend-pilot/guest/recovery',
            'auth.recoverySent', 'success', scope, origin);
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
    if (context.browser && mode.value === 'recovery' && !recoveryCompleted.value && !identityDenial.value) {
        void router.replace('/frontend-pilot/users/login');
    }
}
watch(mode, admitRecovery, {immediate: true});
</script>

<template>
    <PageMessage v-if="identityDenial || (mode === 'reset' && resetDenial)" kind="error" :message="identityDenial || resetDenial || ''">
        <ActionButton v-if="resetReadFailure && !identityDenial" variant="outline-light" @click="resetAttempt++">{{ messages.t('common.retry') }}</ActionButton>
    </PageMessage>
    <PageMessage v-else-if="finished" :kind="mode === 'register' ? 'info' : 'success'" :message="messages.t(mode === 'register'
         ? 'auth.registered' : mode === 'forgot' ? 'auth.resetSent' : 'auth.resetDone')" />
    <PageMessage v-else-if="recoveryCompleted" kind="success" :message="messages.t('auth.recoverySent')" />
    <LoadingSkeleton v-else-if="mode === 'recovery'" variant="form" />
    <template v-else>
        <!-- Identity validation and activation feedback occupy the same shared region
             above the form card as native account pages. Keep it outside the form. -->
        <StatusNotice v-if="activationNotice" kind="success">{{ messages.t('auth.activated') }}</StatusNotice>
        <StatusNotice v-if="command.error.value" kind="danger">{{ command.error.value }}</StatusNotice>
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
                            :max-length="100"
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
                            :max-length="1000"
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
                            :max-length="1000"
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
                            :max-length="100"
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
