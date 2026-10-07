<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch} from 'vue';
import {RouterLink, onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter} from 'vue-router';
import {usePilot} from '../../app/context';
import {useCommand} from '../../composables/command';
import FormField from '../../components/FormField.vue';
import ActionButton from '../../components/ActionButton.vue';
import StatusNotice from '../../components/StatusNotice.vue';
import PageMessage from '../../components/PageMessage.vue';
import {ApiFailure, ObsoleteRequestError} from '../../app/api';
import type {components} from '../../../types/api/v1';
import {safeFrontendReturn} from '../../../modules/lib/frontendIdentity';
import {isRegistrationPasswordValid, passwordCriteria} from '../../../public/js/core/password-policy';

const context = usePilot();
const {messages} = context;
const route = useRoute();
const router = useRouter();
const mode = computed(
    () => route.meta.identityMode as 'login' | 'register' | 'forgot' | 'reset' | 'activate' | 'guest-login',
);
const next = computed(() => safeFrontendReturn(route.query.next));
const fields = reactive({username: '', password: '', passwordRepeat: '', displayname: '', email: ''});
const finished = ref(false);
const recoveryFinished = ref(false);
const activationNotice = ref(false);
const reconciling = ref(false);
const showPasswordCriteria = ref(false);
const criteria = computed(() => passwordCriteria(fields.password));
const passwordState = computed(() => mode.value === 'register' && fields.password
    ? isRegistrationPasswordValid(fields.password) ? 'valid' as const : 'invalid' as const : undefined);
const repeatState = computed(() => mode.value === 'register' && (fields.password || fields.passwordRepeat)
    ? fields.password === fields.passwordRepeat ? 'valid' as const : 'invalid' as const : undefined);
watch(
    () => [mode.value, route.params.token, route.params.guestId],
    () => {
        Object.assign(fields, {username: '', password: '', passwordRepeat: '', displayname: '', email: ''});
        finished.value = false;
        recoveryFinished.value = false;
        activationNotice.value = false;
        showPasswordCriteria.value = false;
        command.error.value = null;
        command.notice.value = null;
        if (mode.value === 'activate' && context.browser && !identityDenial.value) void submit();
    },
);
const command = useCommand(async () => {
    await context.refreshSession();
});
const bootstrapMatchesRoute = computed(() => context.bootstrap.initialUrl === route.fullPath);
const needsOidc = computed(() => ['login', 'register'].includes(mode.value)
    && !context.session.value?.shell.localLoginEnabled && context.session.value?.shell.oidcEnabled);
const identityDenial = computed(() => {
    const initial = bootstrapMatchesRoute.value ? context.bootstrap.identityProblem : undefined;
    if (initial) return initial.code === 'LOCAL_LOGIN_DISABLED'
        ? messages.value.t('api:errors.LOCAL_LOGIN_DISABLED') : initial.detail;
    if (mode.value !== 'guest-login' && !context.session.value?.shell.localLoginEnabled && !needsOidc.value) {
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
    async (_value, _previous, onCleanup) => {
        const abort = new AbortController();
        let current = true;
        onCleanup(() => { current = false; abort.abort(); });
        resetAdmission.value = null;
        resetReadFailure.value = false;
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
    }, {immediate: true});
const resetAllowed = computed(() => !!resetAdmission.value && 'valid' in resetAdmission.value);
const resetDenial = computed(() => {
    if (resetReadFailure.value) return messages.value.t('state.loadFailed');
    const problem = resetAdmission.value;
    if (!problem || !('code' in problem)) return null;
    return problem.code === 'TOKEN_INVALID' ? messages.value.t('api:errors.TOKEN_INVALID') : problem.detail;
});
const blocked = computed(() => command.pending.value || command.uncertain.value);
function mayLeave(): boolean {
    if (command.uncertain.value) return !command.pending.value && window.confirm(messages.value.t('auth.leaveUnknown'));
    return (
        !blocked.value &&
        (finished.value ||
            (!fields.displayname && !fields.passwordRepeat) ||
            window.confirm(messages.value.t('draft.discard')))
    );
}
async function refreshIdentityState(): Promise<void> {
    if (reconciling.value) return;
    reconciling.value = true;
    try {
        // A changed identity remounts the application. An unchanged session cannot prove
        // registration or mail delivery failed, so retain uncertainty and never replay it.
        await context.refreshSession();
    } catch { command.error.value = messages.value.t('state.loadFailed'); }
    finally { reconciling.value = false; }
}
onBeforeRouteLeave(mayLeave);
onBeforeRouteUpdate(mayLeave);
const removeIdentityGuard = context.registerIdentityGuard(mayLeave);
onBeforeUnmount(removeIdentityGuard);
const title = computed(() =>
    mode.value === 'login' || mode.value === 'guest-login'
        ? messages.value.t('app.login')
        : mode.value === 'register'
          ? messages.value.t('app.register')
          : mode.value === 'forgot'
            ? messages.value.t('auth.forgotTitle')
            : mode.value === 'reset'
              ? messages.value.t('auth.resetTitle')
              : messages.value.t('auth.activationTitle'),
);
const titleIcon = computed(() => mode.value === 'register' ? 'bi-person-plus-fill'
    : mode.value === 'forgot' ? 'bi-lock-fill' : mode.value === 'reset' ? 'bi-shield-lock-fill' : 'bi-box-arrow-in-right');
const submitLabel = computed(() => mode.value === 'forgot' ? messages.value.t('auth.sendReset')
    : mode.value === 'reset' ? messages.value.t('auth.changePassword') : title.value);
const submitIcon = computed(() => mode.value === 'forgot' ? 'bi-send-check'
    : ['register', 'reset'].includes(mode.value) ? 'bi-check-lg' : 'bi-box-arrow-in-right');
async function submit(): Promise<void> {
    if (identityDenial.value || needsOidc.value || mode.value === 'reset' && !resetAllowed.value) return;
    if (mode.value === 'register' && !isRegistrationPasswordValid(fields.password)) {
        showPasswordCriteria.value = true;
        command.error.value = messages.value.t('auth.invalidPassword');
        return;
    }
    if (mode.value === 'register' || mode.value === 'reset') {
        if (fields.password !== fields.passwordRepeat) {
            command.error.value = messages.value.t('auth.passwordMismatch');
            return;
        }
    }
    if (mode.value === 'login' || mode.value === 'guest-login') {
        const result = await command.run(
            (scope) =>
                mode.value === 'guest-login'
                    ? context.api.guestLogin(
                          {guestId: String(route.params.guestId), token: String(route.params.token)},
                          scope,
                      )
                    : context.api.login(
                          {username: fields.username, password: fields.password, next: next.value},
                          scope,
                      ),
            false,
        );
        if (result) {
            fields.password = '';
            await context.acceptIdentity(result);
            await router.push(next.value);
        }
        return;
    }
    const result = await command.run(
        async (scope) =>
            mode.value === 'register'
                ? context.api.register(
                      {
                          username: fields.username,
                          displayname: fields.displayname,
                          email: fields.email,
                          password: fields.password,
                          password_repeat: fields.passwordRepeat,
                          next: next.value,
                      },
                      scope,
                  )
                : mode.value === 'forgot'
                  ? context.api.forgotPassword({username: fields.username, next: next.value}, scope)
                  : mode.value === 'reset'
                    ? context.api.resetPassword({token: String(route.params.token), password: fields.password,
                          confirmPassword: fields.passwordRepeat}, scope).catch(error => {
                          // A different client may consume the token after admission. The
                          // command remains authoritative and immediately closes this form.
                          if (error instanceof ApiFailure && error.problem?.code === 'TOKEN_INVALID' && context.isCurrent(scope)) {
                              resetAdmission.value = error.problem;
                              fields.password = ''; fields.passwordRepeat = '';
                          }
                          throw error;
                      })
                    : context.api.activate({token: String(route.params.token)}, scope),
        false,
    );
    if (result) {
        finished.value = true;
        fields.password = '';
        fields.passwordRepeat = '';
        if (mode.value === 'activate') {
            await router.replace({path: '/frontend-pilot/users/login', query: {next: next.value}});
            activationNotice.value = true;
        }
    }
}
async function recover(): Promise<void> {
    if (
        await command.run(
            (scope) => context.api.recoverGuest({email: fields.email, next: next.value}, scope),
            false,
        )
    )
        recoveryFinished.value = true;
}
onMounted(() => {
    if (mode.value === 'activate' && !identityDenial.value) void submit();
});
</script>

<template>
    <PageMessage v-if="identityDenial || (mode === 'reset' && resetDenial)" kind="error" :message="identityDenial || resetDenial || ''">
        <ActionButton v-if="resetReadFailure && !identityDenial" variant="outline-light" @click="resetAttempt++">{{ messages.t('common.retry') }}</ActionButton>
    </PageMessage>
    <PageMessage v-else-if="finished" :kind="mode === 'register' ? 'info' : 'success'" :message="messages.t(mode === 'register'
        ? 'auth.registered' : mode === 'forgot' ? 'auth.resetSent' : 'auth.resetDone')" />
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
                <StatusNotice v-if="needsOidc || mode === 'reset' && !resetAllowed" kind="info">{{ messages.t('common.loading') }}</StatusNotice>
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
                <form v-if="!needsOidc && (mode !== 'reset' || resetAllowed)" class="row gy-3 justify-content-center" @submit.prevent="submit">
                    <template v-if="context.session.value?.shell.localLoginEnabled || mode === 'guest-login'">
                        <FormField
                            v-if="['login', 'register', 'forgot'].includes(mode)"
                            id="username"
                            v-model="fields.username"
                            class="col-md-6"
                            :label="messages.t(mode === 'login' || mode === 'forgot' ? 'auth.usernameOrEmail' : 'auth.username')"
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
                    <StatusNotice v-if="recoveryFinished" kind="success">{{
                        messages.t('auth.recoverySent')
                    }}</StatusNotice>
                    <form class="row gy-3 justify-content-center" @submit.prevent="recover">
                        <FormField
                            id="recovery-email"
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
