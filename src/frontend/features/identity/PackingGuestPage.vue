<script setup lang="ts">
import {computed, reactive, ref, watch} from 'vue';
import {useRoute, useRouter, RouterLink} from 'vue-router';
import type {components} from '../../../types/api/v1';
import type {PilotRequestScope} from '../../../types/FrontendPilotUiTypes';
import {useQuery} from '@tanstack/vue-query';
import {usePilot} from '../../app/context';
import {usePackingApi} from '../packing/api';
import {useCommand} from '../../composables/command';
import {useReadRetry, useReadRetryAt} from '../../composables/feedback';
import {packingKeys} from '../../app/queryKeys';
import {usePageTitle} from '../../composables/pageTitle';
import {completeIdentityEntry, completePageEntry, useConfirmedNavigation} from '../../composables/pageEntry';
import FormField from '../../components/FormField.vue';
import ActionButton from '../../components/ActionButton.vue';
import AppDialog from '../../components/AppDialog.vue';
import StatusNotice from '../../components/StatusNotice.vue';
import NativeContextFields from '../../components/NativeContextFields.vue';
import LoadingSkeleton from '../../components/LoadingSkeleton.vue';
import {ApiFailure, isReadDenial} from '../../app/transport';

const props = defineProps<{entry?: components['schemas']['GuestEntry']}>();
const context = usePilot();
const api = usePackingApi(context);
const {messages} = context;
const route = useRoute();
const router = useRouter();
const completion = useConfirmedNavigation();
const listId = computed(() => String(route.params.listId).toLowerCase());
const next = computed(() => '/frontend-pilot/packing/' + listId.value);
const nativeInitial = context.initialDocumentFor(route.fullPath);
const fields = reactive({name: nativeInitial?.identityFields?.username ?? '', email: nativeInitial?.identityFields?.email ?? ''});
const choiceOpen = ref(false);
const checkingEmail = ref(false);
const entry = useQuery({
    queryKey: computed(() => packingKeys.guest(context.session.value?.context, listId.value)),
    enabled: computed(() => context.ready.value && context.hydrated.value && !props.entry),
    queryFn: ({signal}) => api.guestEntry(listId.value, context.capture(), signal),
    initialData: () => props.entry ?? (nativeInitial?.guestEntry?.id === listId.value ? nativeInitial.guestEntry : undefined),
});
const guestEntry = computed(() => props.entry ?? (isReadDenial(entry.error.value) ? undefined : entry.data.value));
const titleRetryAvailable = useReadRetry(() => entry.error.value);
const titleRetryAt = useReadRetryAt(() => entry.error.value, titleRetryAvailable);
const command = useCommand(context.refreshSession, true, {
    dirty: isDirty,
    busy: isCheckingEmail,
    unknownMessage: 'auth.leaveUnknown',
});
const reconciling = command.recovering;

/** Name-only and email-only drafts receive the same protection as every other identity form. */
function isDirty(): boolean {
    return !!fields.name || !!fields.email;
}

/** The advisory lookup is still in flight and must finish before a form departure is accepted. */
function isCheckingEmail(): boolean {
    return checkingEmail.value;
}
watch(listId, () => {
    // Guards have accepted leaving the previous entity. Preserve its unknown outcome until
    // that commitment, then start a clean guest form for the newly selected entity.
    command.acknowledge();
    Object.assign(fields, {name: '', email: ''});
    choiceOpen.value = false;
});
if (nativeInitial?.identityFormProblem) {
    command.setError(new ApiFailure(nativeInitial.identityFormProblem.status, nativeInitial.identityFormProblem));
}
usePageTitle(() => guestEntry.value?.title || messages.value.t('app.packing'));
const blocked = computed(() => checkingEmail.value || reconciling.value || command.pending.value || command.uncertain.value
    || completion.pending.value || completion.target.value !== null);
/** Reconcile identity without assuming a successful title read proves guest creation failed. */
async function refreshIdentityState(): Promise<void> {
    await command.recover(readGuestAuthority);
}

/** The public title read is independent of guest identity commands. Recover only
 * that current query, preserving the mounted name/email and any command receipt. */
async function retryGuestTitle(): Promise<void> {
    if (props.entry || !context.ready.value || !context.hydrated.value || !titleRetryAvailable.value || entry.isFetching.value) return;
    await entry.refetch();
}

/** The shared recovery owner protects the full read. Its actor/document/mount predicate
 * prevents a retired guest form from restarting a query after a held bootstrap completes. */
async function readGuestAuthority(_scope: PilotRequestScope, isCurrent: () => boolean): Promise<void> {
    await context.refreshSession();
    if (isCurrent()) await entry.refetch({throwOnError: true});
    // An unchanged session and title cannot identify the lost registration's outcome.
    // The command remains unknown until an actor transition or acknowledged departure.
}

/** Submit once and release the draft only after the server confirms the guest identity. */
async function register(): Promise<void> {
    if (blocked.value) return;
    choiceOpen.value = false;
    const origin = route.fullPath;
    const destination = next.value;
    const result = await command.run(registerIdentity, false);
    if (result) {
        Object.assign(fields, {name: '', email: ''});
        // The shared owner retains confirmed identity/navigation across a failed bootstrap;
        // Retry must complete this journey without replaying guest registration.
        await completeIdentityEntry(context, router, result,
            {kind: 'redirect', url: destination, notice: null}, origin, completion);
    }
}

/** Native guest names are saved exactly as submitted. Email normalization remains the
 * existing identity rule; command attribution and the list are captured before the request. */
function registerIdentity(scope: PilotRequestScope): Promise<components['schemas']['IdentityResult']> {
    return api.registerGuest(listId.value, {username: fields.name,
        email: fields.email.trim().toLowerCase() || null}, scope);
}

/** Preserve the native advisory email choice; a failed lookup does not block a new guest. */
async function submit(): Promise<void> {
    if (blocked.value) return;
    if (fields.email.trim()) {
        const scope = context.capture();
        checkingEmail.value = true;
        try {
            const result = await context.api.guestEmailExists({email: fields.email.trim().toLowerCase()}, scope);
            if (!context.isCurrent(scope)) return;
            if (result.exists) {
                choiceOpen.value = true;
                return;
            }
        } catch {
            // The native lookup is advisory. A failed read must not prevent creating a new
            // guest, but an obsolete identity must never carry the form into another actor.
            if (!context.isCurrent(scope)) return;
        } finally {
            checkingEmail.value = false;
        }
    }
    await register();
}

/** Confirmed recovery has the same complete message outcome as the native form. Pending or
 * unknown mail delivery stays on this form with its entered values and explicit recovery. */
async function recover(): Promise<void> {
    if (blocked.value) return;
    choiceOpen.value = false;
    const scope = context.capture();
    const origin = route.fullPath;
    if (await command.run(requestRecovery, false)) {
        Object.assign(fields, {name: '', email: ''});
        await completePageEntry(context, router, '/frontend-pilot/guest/recovery',
            'auth.recoverySent', 'success', scope, origin, completion);
    }
}

function requestRecovery(scope: PilotRequestScope): Promise<components['schemas']['MutationResult']> {
    return context.api.recoverGuest({email: fields.email.trim().toLowerCase(), next: next.value}, scope);
}
</script>

<template>
    <section class="card bg-dark text-white mb-3">
        <h1 class="card-header text-center py-3 mb-0">
            <i class="bi bi-door-open-fill me-2" aria-hidden="true"></i
            >{{ messages.t('auth.join', {title: guestEntry?.title ?? messages.t('app.packing')}) }}
        </h1>
        <div class="card-body">
            <!-- The entry title loads independently of the generic identity choices and
                 editable draft. Never replace those mounted fields during a title refresh. -->
            <LoadingSkeleton v-if="!guestEntry && !entry.error.value" :rows="1" />
            <StatusNotice v-if="command.error.value" kind="danger"
                :transient="!!command.error.value && command.transientError.value" :renewal="command.errorRenewal.value" @dismiss="command.setError(null)">{{
                command.error.value
            }}</StatusNotice>
            <StatusNotice v-if="entry.error.value && !props.entry" kind="danger"
                :read-error="entry.error.value" :retry-at="titleRetryAt"
                :last-updated-at="guestEntry ? entry.dataUpdatedAt.value : undefined">{{
                messages.t(guestEntry ? 'state.stale' : 'state.loadFailed')
            }}<ActionButton class="btn-sm ms-2" variant="outline-light" :pending="entry.isFetching.value"
                :disabled="!titleRetryAvailable" @click="retryGuestTitle">{{ messages.t('common.retry') }}</ActionButton></StatusNotice>
            <!-- A confirmed identity/mail result is never submitted again because a route
                 chunk failed. Keep delivery Retry with this mounted form when it owns it. -->
            <StatusNotice v-if="completion.target.value" kind="warning">
                {{ messages.t('state.loadFailed') }}
                <ActionButton class="ms-2" variant="outline-light" :pending="completion.pending.value" @click="completion.retry">
                    {{ messages.t('common.retry') }}
                </ActionButton>
            </StatusNotice>
            <StatusNotice v-if="command.uncertain.value" kind="warning">{{
                messages.t('state.unknownOutcome')
            }} {{ messages.t('auth.unconfirmedRequest') }}<ActionButton class="ms-2" variant="outline-light" :pending="reconciling" :disabled="reconciling" @click="refreshIdentityState">{{ messages.t('common.refresh') }}</ActionButton></StatusNotice>
            <div class="text-center mb-4">
                <h3 class="mb-2">{{ messages.t('auth.guestIntro') }}</h3>
                <ul class="list-unstyled small d-inline-block text-start mb-0">
                    <li
                        v-for="key in ['benefitCreate', 'benefitLogin', 'benefitProfiles', 'benefitManage']"
                        :key="key"
                        :class="{'mb-1': key !== 'benefitManage'}"
                    >
                        <i class="bi bi-check-circle-fill me-2" aria-hidden="true"></i
                        >{{ messages.t(('auth.' + key) as 'auth.benefitCreate') }}
                    </li>
                </ul>
            </div>
            <div class="d-flex flex-wrap justify-content-center gap-2 mb-4">
                <RouterLink class="btn btn-primary d-inline-flex align-items-center gap-2" :to="{path: '/frontend-pilot/users/login', query: {next}}"
                    ><i class="bi bi-box-arrow-in-right" aria-hidden="true"></i
                    >{{ messages.t('auth.logIn') }}</RouterLink
                ><RouterLink
                    class="btn btn-outline-warning d-inline-flex align-items-center gap-2"
                    :to="{path: '/frontend-pilot/users/login', query: {next}}"
                    ><i class="bi bi-envelope" aria-hidden="true"></i
                    >{{ messages.t('auth.recoverGuest') }}</RouterLink
                ><RouterLink
                    class="btn btn-outline-primary d-inline-flex align-items-center gap-2"
                    :to="{path: '/frontend-pilot/users/register', query: {next}}"
                    ><i class="bi bi-person-plus" aria-hidden="true"></i
                    >{{ messages.t('auth.createAccount') }}</RouterLink
                >
            </div>
            <div class="position-relative text-center my-4">
                <hr />
                <span
                    class="position-absolute top-50 start-50 translate-middle px-3 bg-body-tertiary rounded-pill text-muted small"
                    >{{ messages.t('auth.orGuest') }}</span
                >
            </div>
            <StatusNotice kind="warning" class="text-center border-warning" :margin-bottom="4">
                <div class="d-flex">
                    <i class="bi bi-exclamation-triangle-fill me-2" aria-hidden="true"></i>
                    <div class="flex-grow-1"></div>
                    <div><strong>{{ messages.t('auth.headsUp') }}: </strong>{{ messages.t('auth.guestWarning') }}</div>
                    <div class="flex-grow-1"></div>
                </div>
            </StatusNotice>
            <form class="row gx-3 gy-3 justify-content-center" autocomplete="on" method="post"
                :action="'/frontend-pilot/packing/' + listId + '/guest'" @submit.prevent="submit">
                <NativeContextFields :next="next" />
                <FormField
                    id="guest-name"
                    name="username"
                    v-model="fields.name"
                    class="col-12 col-md-8"
                    :label="messages.t('auth.displayName')"
                    label-icon="bi-person-circle"
                    input-icon="bi-person"
                    large-group
                    :placeholder="messages.t('auth.yourName')"
                    required
                    :max-length="100"
                    autocomplete="nickname"
                    :disabled="blocked"
                    ><div class="form-text text-bg-dark">{{ messages.t('auth.nameHint') }}</div></FormField
                >
                <FormField
                    id="guest-email"
                    name="email"
                    v-model="fields.email"
                    class="col-12 col-md-8"
                    :label="messages.t('auth.emailOptional')"
                    label-icon="bi-envelope-at"
                    input-icon="bi-envelope"
                    large-group
                    :placeholder="messages.t('auth.guestEmailPlaceholder')"
                    input-mode="email"
                    type="email"
                    :max-length="100"
                    autocomplete="email"
                    :disabled="blocked"
                    ><div class="form-text text-bg-dark">{{ messages.t('auth.emailHint') }}</div></FormField
                >
                <div class="col-12 col-md-8 mt-2">
                    <div class="d-grid">
                        <ActionButton
                            type="submit"
                            variant="success"
                            class="btn-lg d-inline-flex align-items-center justify-content-center gap-2"
                            :disabled="blocked || !guestEntry"
                            :pending="command.pending.value || checkingEmail"
                            ><i class="bi bi-check-lg" aria-hidden="true"></i
                            >{{ messages.t('auth.continueGuest') }}</ActionButton
                        >
                    </div>
                </div>
            </form>
            <div class="text-center mt-4">
                <RouterLink
                    class="text-decoration-none me-3"
                    :to="{path: '/frontend-pilot/users/login', query: {next}}"
                    ><i class="bi bi-arrow-left-circle me-1" aria-hidden="true"></i>{{ messages.t('auth.backLogin') }}</RouterLink
                ><RouterLink
                    class="text-decoration-none"
                    :to="{path: '/frontend-pilot/users/register', query: {next}}"
                    ><i class="bi bi-person-plus me-1" aria-hidden="true"></i>{{ messages.t('auth.fullAccount') }}</RouterLink
                >
            </div>
        </div>
    </section>
    <AppDialog
        v-if="choiceOpen"
        :open="true"
        :title="messages.t('auth.guestFound')"
        :pending="blocked"
        compact
        @close="choiceOpen = false"
        ><p class="mb-0">{{ messages.t('auth.guestFoundHint') }}</p>
        <template #footer
            ><ActionButton variant="outline-secondary" @click="register">{{
                messages.t('auth.newGuest')
            }}</ActionButton
            ><ActionButton variant="warning" @click="recover">{{
                messages.t('auth.recoverGuest')
            }}</ActionButton></template
        ></AppDialog
    >
</template>
