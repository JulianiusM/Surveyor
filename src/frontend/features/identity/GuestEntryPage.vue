<script setup lang="ts">
import {computed, reactive, ref, watch} from 'vue';
import {useRoute, useRouter, RouterLink} from 'vue-router';
import type {components} from '../../../types/api/v1';
import type {FrontendRequestScope} from '../../../types/FrontendUiTypes';
import {useQuery} from '@tanstack/vue-query';
import {useActionState, useFrontend} from '../../app/context';
import type {FrontendGuestEntryProps} from '../../../types/FrontendGuestEntryTypes';
import {useCommand} from '../../composables/command';
import {useReadRetry, useReadRetryAt} from '../../composables/feedback';
import {useQueryAdmission} from '../../app/queryCache';
import {usePageTitle} from '../../composables/pageTitle';
import {completeIdentityEntry, completePageEntry, useConfirmedNavigation} from '../../composables/pageEntry';
import FormField from '../../components/FormField.vue';
import ActionButton from '../../components/ActionButton.vue';
import AppDialog from '../../components/AppDialog.vue';
import StatusNotice from '../../components/StatusNotice.vue';
import CommandFeedback from '../../components/CommandFeedback.vue';
import LoadingSkeleton from '../../components/LoadingSkeleton.vue';
import {isReadDenial} from '../../app/transport';

const props = withDefaults(defineProps<FrontendGuestEntryProps>(), {presentation: 'generic'});
const context = useFrontend();
const {messages} = context;
// Only the Event caller selects its linked-registration guidance and confirmation.
// Titles and routes never infer this context; admission and commands stay injected.
const eventPresentation = computed(() => props.presentation === 'event');
const route = useRoute();
const router = useRouter();
const completion = useConfirmedNavigation();
const resourceId = computed(() => props.resourceId);
const next = computed(() => props.destination);
const fields = reactive({name: '', email: ''});
const choiceOpen = ref(false);
const checkingEmail = ref(false);
// Registration and modal mail recovery share the command owner. Keep only the
// initiating presentation tag here; admission, drafts and request lifetime stay
// with the existing lookup and command fences.
const registeringGuest = ref(false);
const entryKey = computed(() => props.queryKey);
const readAdmission = useQueryAdmission(context, entryKey,
    computed(() => context.hydrated.value && !props.entry));
const entry = useQuery({
    queryKey: entryKey,
    ...readAdmission,
    queryFn: ({signal}) => props.readEntry(context.capture(), signal),
    initialData: initialGuestEntry,
});
const guestEntry = computed(() => props.entry ?? (isReadDenial(entry.error.value) ? undefined : entry.data.value));
const titleRetryAvailable = useReadRetry(() => entry.error.value);
const titleRetryAt = useReadRetryAt(() => entry.error.value, titleRetryAvailable);
const sessionRetryAvailable = useReadRetry(() => context.sessionRead.value.error);
const command = useCommand(context.refreshSession, true, {
    dirty: isDirty,
    busy: isCheckingEmail,
    unknownMessage: 'auth.leaveUnknown',
    recoveryEligible: () => sessionRetryAvailable.value,
});
const reconciling = command.recovering;

/** Evaluate seed eligibility at use time; a warm visit cannot replay an old
 * document's title after its actor or resource admission has retired. */
function initialGuestEntry(): components['schemas']['GuestEntry'] | undefined {
    const initial = context.initialDocumentFor(route.fullPath)?.guestEntry;
    return props.entry ?? (initial?.id === resourceId.value ? initial : undefined);
}

/** Name-only and email-only drafts receive the same protection as every other identity form. */
function isDirty(): boolean {
    return !!fields.name || !!fields.email;
}

/** The advisory lookup is still in flight and must finish before a form departure is accepted. */
function isCheckingEmail(): boolean {
    return checkingEmail.value;
}
watch(() => [resourceId.value, next.value], () => {
    // Guards have accepted leaving the previous entity. Preserve its unknown outcome until
    // that commitment, then start a clean guest form for the newly selected entity.
    command.acknowledge();
    Object.assign(fields, {name: '', email: ''});
    choiceOpen.value = false;
});
// The guest document uses its Join wording without an application suffix.
// Its admitted title remains text even when the resource name contains markup.
usePageTitle(() => messages.value.t('auth.join', {title: guestEntry.value?.title ?? messages.value.t(props.titleKey)}), true);
const blocked = computed(() => checkingEmail.value || command.action.disabled.value
    || completion.pending.value || completion.target.value !== null);
const submittingGuest = computed(() => checkingEmail.value || command.pending.value && registeringGuest.value);
const titleRetryAction = useActionState({eligible: mayRetryTitle, pending: () => entry.isFetching.value});

function mayRetryTitle(): boolean {
    return !props.entry && context.mayRead() && titleRetryAvailable.value;
}
/** Reconcile identity without assuming a successful title read proves guest creation failed. */
async function refreshIdentityState(): Promise<void> {
    await command.recover(readGuestAuthority);
}

/** The public title read is independent of guest identity commands. Recover only
 * that current query, preserving the mounted name/email and any command receipt. */
async function retryGuestTitle(): Promise<void> {
    if (!titleRetryAction.isAvailable()) return;
    await entry.refetch();
}

/** The shared recovery owner protects the full read. Its actor/document/mount predicate
 * prevents a retired guest form from restarting a query after a held bootstrap completes. */
async function readGuestAuthority(_scope: FrontendRequestScope, isCurrent: () => boolean): Promise<void> {
    await context.refreshSession();
    if (isCurrent()) await entry.refetch({throwOnError: true});
    // An unchanged session and title cannot identify the lost registration's outcome.
    // The command remains unknown until an actor transition or acknowledged departure.
}

/** Submit once and release the draft only after the server confirms the guest identity. */
async function register(): Promise<void> {
    if (blocked.value) return;
    choiceOpen.value = false;
    // Match the order: advisory email discovery/choice comes first, then
    // Event's configured confirmation. Cancel keeps the draft and starts no command.
    if (eventPresentation.value && !window.confirm(messages.value.t('auth.eventGuestConfirmation'))) return;
    const origin = route.fullPath;
    const destination = next.value;
    registeringGuest.value = true;
    try {
        const result = await command.run(registerIdentity, false);
        if (result) {
            Object.assign(fields, {name: '', email: ''});
            // The shared owner retains confirmed identity/navigation across a failed bootstrap;
            // Retry must complete this journey without replaying guest registration.
            await completeIdentityEntry(context, router, result,
                {kind: 'redirect', url: destination, notice: null}, origin, completion);
        }
    } finally { registeringGuest.value = false; }
}

/** Guest names are saved exactly as submitted. Email normalization remains the
 * existing identity rule; command attribution and the list are captured before the request. */
function registerIdentity(scope: FrontendRequestScope): Promise<components['schemas']['IdentityResult']> {
    return props.registerGuest({username: fields.name,
        email: fields.email.trim().toLowerCase() || null}, scope);
}

/** Preserve the advisory email choice; a failed lookup does not block a new guest. */
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
            // The lookup is advisory. A failed read must not prevent creating a new
            // guest, but an obsolete identity must never carry the form into another actor.
            if (!context.isCurrent(scope)) return;
        } finally {
            checkingEmail.value = false;
        }
    }
    await register();
}

/** Confirmed recovery has the same complete message outcome as the form. Pending or
 * unknown mail delivery stays on this form with its entered values and explicit recovery. */
async function recover(): Promise<void> {
    if (blocked.value) return;
    choiceOpen.value = false;
    const scope = context.capture();
    const origin = route.fullPath;
    if (await command.run(requestRecovery, false)) {
        Object.assign(fields, {name: '', email: ''});
        await completePageEntry(context, router, '/guest/recovery',
            'auth.recoverySent', 'success', scope, origin, completion);
    }
}

function requestRecovery(scope: FrontendRequestScope): Promise<components['schemas']['MutationResult']> {
    return context.api.recoverGuest({email: fields.email.trim().toLowerCase(), next: next.value}, scope);
}
</script>

<template>
    <section class="card bg-dark text-white mb-3">
        <h1 class="card-header text-center py-3 mb-0">
            <i class="bi bi-door-open-fill me-2" aria-hidden="true"></i
            >{{ messages.t('auth.join', {title: guestEntry?.title ?? messages.t(props.titleKey)}) }}
        </h1>
        <div class="card-body">
            <!-- The entry title loads independently of the generic identity choices and
                 editable draft. Never replace those mounted fields during a title refresh. -->
            <LoadingSkeleton v-if="!guestEntry && !entry.error.value" :rows="1" />
            <CommandFeedback :feedback="command.feedback" part="error" error-kind="danger" />
            <StatusNotice v-if="entry.error.value && !props.entry" kind="danger"
                :read-error="entry.error.value" :retry-at="titleRetryAt"
                :last-updated-at="guestEntry ? entry.dataUpdatedAt.value : undefined"
                :action="{state: titleRetryAction, label: messages.t('common.retry')}" @action="retryGuestTitle">{{
                messages.t(guestEntry ? 'state.stale' : 'state.loadFailed')
            }}</StatusNotice>
            <CommandFeedback :feedback="command.feedback" part="uncertain"
                :action="{state: command.recoveryAction, label: messages.t('common.refresh'), class: 'ms-2'}"
                @action="refreshIdentityState">
                <template #uncertain>{{ ' ' + messages.t('auth.unconfirmedRequest') }}</template>
            </CommandFeedback>
            <!-- Event guests need the warning about access to their registration
                 and linked planning data; other features retain their generic guidance. -->
            <StatusNotice v-if="eventPresentation" kind="info" class="text-center border-info" :margin-bottom="4">
                <div class="d-flex">
                    <i class="bi bi-info-circle-fill me-2" aria-hidden="true"></i>
                    <div class="flex-grow-1"></div>
                    <div><strong>{{ messages.t('auth.eventAccountRecommendationTitle') }}: </strong>{{
                        messages.t('auth.eventAccountRecommendation')
                    }}</div>
                    <div class="flex-grow-1"></div>
                </div>
            </StatusNotice>
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
            <div class="frontend-action-row justify-content-center mb-4">
                <RouterLink class="btn btn-primary d-inline-flex align-items-center gap-2" :to="{path: '/users/login', query: {next}}"
                    ><i class="bi bi-box-arrow-in-right" aria-hidden="true"></i
                    >{{ messages.t('auth.logIn') }}</RouterLink
                ><RouterLink
                    class="btn btn-outline-warning d-inline-flex align-items-center gap-2"
                    :to="{path: '/users/login', query: {next}}"
                    ><i class="bi bi-envelope" aria-hidden="true"></i
                    >{{ messages.t('auth.recoverGuest') }}</RouterLink
                ><RouterLink
                    class="btn btn-outline-primary d-inline-flex align-items-center gap-2"
                    :to="{path: '/users/register', query: {next}}"
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
                    <div><strong>{{ messages.t('auth.headsUp') }}: </strong>{{
                        messages.t(eventPresentation ? 'auth.eventGuestWarning' : 'auth.guestWarning')
                    }}</div>
                    <div class="flex-grow-1"></div>
                </div>
            </StatusNotice>
            <form class="row gx-3 gy-3 justify-content-center" autocomplete="on" @submit.prevent="submit">
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
                    :pending="submittingGuest"
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
                    :pending="submittingGuest"
                    ><div class="form-text text-bg-dark">{{
                        messages.t(eventPresentation ? 'auth.eventEmailHint' : 'auth.emailHint')
                    }}</div></FormField
                >
                <div class="col-12 col-md-8 mt-2">
                    <div class="d-grid">
                        <ActionButton
                            type="submit"
                            variant="success"
                            class="btn-lg d-inline-flex align-items-center justify-content-center gap-2"
                            :disabled="blocked || !guestEntry"
                            :pending="submittingGuest"
                            ><i class="bi bi-check-lg" aria-hidden="true"></i
                            >{{ messages.t('auth.continueGuest') }}</ActionButton
                        >
                    </div>
                </div>
            </form>
            <div class="text-center mt-4">
                <RouterLink
                    class="text-decoration-none me-3"
                    :to="{path: '/users/login', query: {next}}"
                    ><i class="bi bi-arrow-left-circle me-1" aria-hidden="true"></i>{{ messages.t('auth.backLogin') }}</RouterLink
                ><RouterLink
                    class="text-decoration-none"
                    :to="{path: '/users/register', query: {next}}"
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
