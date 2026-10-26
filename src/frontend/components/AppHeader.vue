<script setup lang="ts">
import {computed, onBeforeUnmount, ref, watch} from 'vue';
import {RouterLink, useRoute, useRouter} from 'vue-router';
import type {RouteLocationNormalized} from 'vue-router';
import {useActionState, useFrontend} from '../app/context';
import {localeManifest} from '../../common/localization/translator';
import {frontendOverviewPath, safeFrontendReturn} from '../../common/lib/frontendIdentity';
import {frontendHelpUrl, resolveContextualHelpUrl} from '../../common/lib/helpNavigation';
import {completeIdentityEntry, useConfirmedNavigation} from '../composables/pageEntry';
import {useCommand} from '../composables/command';
import {useReadRetry} from '../composables/feedback';
import {observePageNavigation} from '../composables/pageNavigation';
import {usePendingFocus} from '../composables/pendingFocus';
import type {FrontendRequestScope} from '../../types/FrontendUiTypes';
import type {Locale} from '../../types/LocalizationTypes';
import AppNavigationDropdown from './AppNavigationDropdown.vue';
import ActionButton from './ActionButton.vue';
import StatusNotice from './StatusNotice.vue';
import CommandFeedback from './CommandFeedback.vue';

// All feature creation and identity destinations use the shared Vue router.
// Their existing backend owners retain admission and business decisions.
const emit = defineEmits<{localeError: []; localeRecovered: []}>();
const context = useFrontend();
const {messages, session, locale, ready, hydrated} = context;
const route = useRoute();
const router = useRouter();
const completion = useConfirmedNavigation();
const sessionRetryAvailable = useReadRetry(() => context.sessionRead.value.error);
const logoutCommand = useCommand(context.refreshSession, true, {dirty: noHeaderDraft,
    unknownMessage: 'auth.leaveUnknown', recoveryEligible: () => sessionRetryAvailable.value});
const identityBlocked = computed(() => logoutCommand.action.disabled.value || completion.target.value !== null);
const expanded = ref(false);
const changingLocale = ref(false);
const localeAction = useActionState({eligible: () => ready.value, pending: () => changingLocale.value});
const localeControl = ref<HTMLSelectElement | null>(null);
// A confirmed language change retains this same selector. Its existing pending
// preference lifetime shares focus recovery without changing locale ownership,
// serialized requests or the user's current reading position.
usePendingFocus({element: localeControl, pending: localeAction.pending, isAvailable: localeAction.isAvailable});
let localeUrlNeedsSync = false;
let active = true;
const removeUpdateGuard = context.updates.registerGuard(() => !changingLocale.value);
// currentRoute changes only after a lazy destination finishes loading. Observe the
// earlier navigation phase so a late locale response cannot replace the old help
// URL and cancel the user's pending destination. Each completion clears only itself.
const navigation = observePageNavigation(router, {scope: 'all', finished: finishNavigation});
onBeforeUnmount(() => {
    active = false;
    removeUpdateGuard();
    navigation.dispose();
});
// One contextual target supplies route activation and locale-aware delivery.
// The URL adapter moves article paths into a doc query.
const contextualHelpTarget = computed(() => resolveContextualHelpUrl(route.path));
const helpRoute = computed(() => frontendHelpUrl(contextualHelpTarget.value, locale.value));
// Highlight contextual Help on Packing and Drivers pages. Feature precedence
// also applies when an article path contains another feature's name.
const contextualHelpActive = computed(function contextualHelpActivation() {
    const currentPath = route.path.toLowerCase();
    if (currentPath.includes('/survey')) return false;
    if (currentPath.includes('/packing')) return contextualHelpTarget.value.includes('/packing');
    return !currentPath.includes('/activity') && currentPath.includes('/drivers') && contextualHelpTarget.value.includes('/drivers');
});
// Header links prefer an explicit return destination, otherwise their current page.
// Apply the return boundary before using either value in forms or navigation.
const next = computed(() => safeFrontendReturn(typeof route.query.next === 'string' ? route.query.next : route.fullPath));
const profileLabel = computed(() =>
    session.value?.kind === 'guest'
        ? messages.value.t('app.guestLabel', {name: session.value.activeProfile?.name ?? ''})
        : (session.value?.activeProfile?.name ?? ''),
);
watch(
    () => route.fullPath,
    () => {
        expanded.value = false;
    },
);

function finishNavigation(_to: RouteLocationNormalized): void {
    // Let Vue Router finish notifying the destination before a query-only update.
    if (localeUrlNeedsSync) queueMicrotask(synchronizeHelpLocale);
}

function synchronizeHelpLocale(): void {
    if (!active || !localeUrlNeedsSync || changingLocale.value || navigation.pending()) return;
    localeUrlNeedsSync = false;
    const current = router.currentRoute.value;
    if (!current.meta.helpPage || current.query.locale === locale.value) return;
    // Help also supports locale-bearing links. Normalize the settled help
    // destination, preserving its article/search/fragment for a later reload.
    void router.replace({path: current.path, query: {...current.query, locale: locale.value}, hash: current.hash})
        .catch(() => { if (active) emit('localeError'); });
}

/** Change language through the shared serialized cookie command without changing
 * the active actor or discarding mounted drafts. Report the command's outcome,
 * then let the settled Help URL owner preserve article/query/fragment navigation. */
async function selectLocale(event: Event): Promise<void> {
    if (!localeAction.isAvailable()) return;
    changingLocale.value = true;
    try {
        // Confirm the shared serialized preference command before marking the
        // locale-bearing Help URL dirty; other mounted drafts keep their actor.
        await context.changeLocale((event.target as HTMLSelectElement).value as Locale);
        emit('localeRecovered');
        localeUrlNeedsSync = true;
    } catch {
        // A rejected/unavailable preference reports its failure without inventing
        // a confirmed language change or replacing the current article URL.
        emit('localeError');
    } finally {
        // Release the local command fence before attempting URL synchronization.
        // Its owner still checks confirmed intent and settled route navigation,
        // including an earlier successful change whose URL delivery was delayed.
        changingLocale.value = false;
        synchronizeHelpLocale();
    }
}

async function logout(): Promise<void> {
    if (identityBlocked.value || !context.mayChangeIdentity()) return;
    await logoutCommand.run(logoutIdentity, false);
}

/** Header state has no editable fields, but its identity recovery read is part of
 * the shared departure decision while a lost logout response remains unresolved. */
function noHeaderDraft(): boolean { return false; }

/** Protect one logout request and its authoritative identity completion together.
 * The shared identity owner retains delivery across bootstrap failure; a confirmed
 * actor transition retires this old command scope without inviting another logout. */
async function logoutIdentity(scope: FrontendRequestScope) {
    const origin = route.fullPath;
    const destination = next.value;
    const result = await context.api.logout(scope);
    // Next takes precedence over the provider's fallback logout URL.
    // Retry completes only this destination after the new actor is admitted.
    await completeIdentityEntry(context, router, result,
        {kind: 'redirect', url: destination, notice: {kind: 'success', messageKey: 'auth.logoutDone'}}, origin, completion);
    return result;
}

/** An authoritative session read can discover completed logout, but an unchanged
 * session cannot prove a lost request failed. Preserve uncertainty without replay. */
async function refreshLogoutState(): Promise<void> {
    await logoutCommand.recover();
}

/** Retry only the retained read/navigation delivery of a confirmed command.
 * One shell surface serves mounted and retired forms without replaying the write. */
async function retryCompletion(): Promise<void> {
    await completion.retryRecovery();
}

</script>

<template>
    <header class="frontend-app-header">
        <nav class="navbar navbar-expand-lg navbar-dark bg-dark shadow-sm">
            <div class="container">
                <RouterLink class="navbar-brand d-flex align-items-center" to="/">
                    <img :src="'/img/logo.png'" :alt="messages.t('app.title')" height="30" class="me-2" />
                    <span class="fw-semibold">{{ messages.t('app.title') }}</span>
                    <!-- Reserve a small header slot so lazy delivery never inserts
                         a false page skeleton or shifts the brand/navigation. -->
                    <span class="frontend-navigation-indicator" aria-hidden="true">
                        <span v-if="navigation.destination.value" class="spinner-border"></span>
                    </span>
                </RouterLink>
                <!-- Before initialization the ordinary navigation stays expanded,
                     including on mobile. Its collapse button requires JavaScript. -->
                <button v-if="hydrated"
                    class="navbar-toggler"
                    type="button"
                    aria-controls="frontend-navbar-main"
                    :aria-expanded="expanded"
                    :aria-label="messages.t('app.toggleNavigation')"
                    @click="expanded = !expanded"
                >
                    <span class="navbar-toggler-icon"></span>
                </button>
                <div id="frontend-navbar-main" class="collapse navbar-collapse" :class="{show: expanded || !hydrated}">
                    <ul class="navbar-nav me-auto mb-2 mb-lg-0">
                        <li class="nav-item">
                            <RouterLink class="nav-link" to="/"
                                ><i class="bi bi-house-fill me-1" aria-hidden="true"></i
                                >{{ messages.t('app.home') }}</RouterLink
                            >
                        </li>
                        <AppNavigationDropdown :label="messages.t('app.new')" icon="bi-plus-circle">
                            <li>
                                <h6 class="dropdown-header">{{ messages.t('app.planDecide') }}</h6>
                            </li>
                            <li>
                                <RouterLink class="dropdown-item" to="/survey/create"
                                    ><i class="bi bi-bar-chart-steps me-2" aria-hidden="true"></i
                                    >{{ messages.t('app.survey') }}</RouterLink
                                >
                            </li>
                            <li>
                                <RouterLink class="dropdown-item" to="/activity/create"
                                    ><i class="bi bi-calendar2-check me-2" aria-hidden="true"></i
                                    >{{ messages.t('app.activity') }}</RouterLink
                                >
                            </li>
                            <li>
                                <RouterLink class="dropdown-item" to="/event/create"
                                    ><i class="bi bi-calendar2-event me-2" aria-hidden="true"></i
                                    >{{ messages.t('app.event') }}</RouterLink
                                >
                            </li>
                            <li><hr class="dropdown-divider" /></li>
                            <li>
                                <h6 class="dropdown-header">{{ messages.t('app.organizeShare') }}</h6>
                            </li>
                            <li>
                                <RouterLink class="dropdown-item" to="/packing/create"
                                    ><i class="bi bi-bag-plus me-2" aria-hidden="true"></i
                                    >{{ messages.t('app.packing') }}</RouterLink
                                >
                            </li>
                            <li>
                                <RouterLink class="dropdown-item" to="/drivers/create"
                                    ><i class="bi bi-car-front me-2" aria-hidden="true"></i
                                    >{{ messages.t('app.drivers') }}</RouterLink
                                >
                            </li>
                        </AppNavigationDropdown>
                        <AppNavigationDropdown :label="messages.t('app.overview')" icon="bi-collection">
                            <li>
                                <RouterLink class="dropdown-item" :to="frontendOverviewPath"
                                    ><i class="bi bi-speedometer2 me-2" aria-hidden="true"></i
                                    >{{ messages.t('app.yourOverview') }}</RouterLink
                                >
                            </li>
                        </AppNavigationDropdown>
                        <li class="nav-item">
                            <RouterLink
                                class="nav-link"
                                :class="{active: contextualHelpActive}"
                                :to="helpRoute"
                                :aria-label="messages.t('app.helpForPage')"
                                :title="messages.t('app.openHelpForPage')"
                            >
                                <i class="bi bi-question-circle me-1" aria-hidden="true"></i
                                >{{ messages.t('app.help') }}
                            </RouterLink>
                        </li>
                    </ul>
                    <ul class="navbar-nav ms-auto">
                        <AppNavigationDropdown
                            v-if="ready && session?.activeProfile && hydrated"
                            :label="profileLabel"
                            icon="bi-person-circle"
                            align-end
                        >
                            <!-- The menu dismisses after Logout is clicked.
                                 Keep that same command's progress visible on
                                 its retained profile trigger while it settles. -->
                            <template #trigger>
                                <span v-if="logoutCommand.pending.value" class="spinner-border spinner-border-sm me-1" aria-hidden="true"></span>
                                <i v-else class="bi bi-person-circle me-1" aria-hidden="true"></i>{{ profileLabel }}
                            </template>
                            <li>
                                <RouterLink class="dropdown-item" :to="frontendOverviewPath"
                                    ><i class="bi bi-speedometer2 me-1" aria-hidden="true"></i
                                    >{{ messages.t('app.yourOverview') }}</RouterLink
                                >
                            </li>
                            <li>
                                <RouterLink class="dropdown-item" to="/users/profile"
                                    ><i class="bi bi-gear-fill me-1" aria-hidden="true"></i
                                    >{{ messages.t('app.profileSettings') }}</RouterLink
                                >
                            </li>
                            <li v-if="session.kind === 'account'">
                                <RouterLink class="dropdown-item" to="/users/profile/manage"
                                    ><i class="bi bi-person-lines-fill me-1" aria-hidden="true"></i
                                    >{{ messages.t('app.yourProfiles') }}</RouterLink
                                >
                            </li>
                            <li><hr class="dropdown-divider" /></li>
                            <li>
                                <form @submit.prevent="logout">
                                    <ActionButton unstyled
                                        class="dropdown-item text-danger"
                                        type="submit"
                                        :disabled="identityBlocked"
                                        :pending="logoutCommand.pending.value"
                                        @click.prevent="logout"
                                    >
                                        <i class="bi bi-box-arrow-right me-1" aria-hidden="true"></i
                                        >{{ messages.t('app.logout') }}
                                    </ActionButton>
                                </form>
                            </li>
                            <li>
                                <RouterLink class="dropdown-item text-danger" to="/users/account/delete"
                                    ><i class="bi bi-trash me-1" aria-hidden="true"></i
                                    >{{ messages.t('app.deleteAccount') }}</RouterLink
                                >
                            </li>
                        </AppNavigationDropdown>
                        <!-- Profile actions change browser-owned identity. Keep only
                             its readable label until those handlers initialize. -->
                        <li v-else-if="ready && session?.activeProfile" class="nav-item">
                            <span class="nav-link"><i class="bi bi-person-circle me-1" aria-hidden="true"></i>{{ profileLabel }}</span>
                        </li>
                        <template v-else>
                            <li class="nav-item me-1">
                                <RouterLink
                                    class="nav-link"
                                    :to="{path: '/users/login', query: {next}}"
                                    ><i class="bi bi-box-arrow-in-right me-1" aria-hidden="true"></i
                                    >{{ messages.t('app.login') }}</RouterLink
                                >
                            </li>
                            <li class="nav-item">
                                <RouterLink
                                    class="nav-link"
                                    :to="{path: '/users/register', query: {next}}"
                                    ><i class="bi bi-person-plus me-1" aria-hidden="true"></i
                                    >{{ messages.t('app.register') }}</RouterLink
                                >
                            </li>
                        </template>
                        <li class="nav-item d-flex align-items-center ms-lg-2">
                            <label class="visually-hidden" for="frontend-locale">{{
                                messages.t('app.locale')
                            }}</label>
                            <select
                                id="frontend-locale"
                                ref="localeControl"
                                class="form-select form-select-sm frontend-locale"
                                :value="locale"
                                :disabled="localeAction.disabled.value"
                                @change="selectLocale"
                            >
                                <option
                                    v-for="available in localeManifest"
                                    :key="available.locale"
                                    :value="available.locale"
                                    :lang="available.locale"
                                    :selected="available.locale === locale"
                                >
                                    {{ available.nativeName }}
                                </option>
                            </select>
                        </li>
                    </ul>
                </div>
            </div>
            <!-- A rejected logout owns one feedback receipt. Translating its body must
                 keep the original expiry; a repeated rejection supplies a new receipt. -->
            <CommandFeedback :feedback="logoutCommand.feedback" part="error" error-kind="danger" no-margin />
            <CommandFeedback :feedback="logoutCommand.feedback" part="uncertain" no-margin
                :action="{state: logoutCommand.recoveryAction, label: messages.t('common.refresh'), class: 'ms-2'}"
                @action="refreshLogoutState" />
        </nav>
        <!-- A confirmed write supplies one success receipt. Only failed delivery
             adds this durable warning; its explicit action retries no command. -->
        <StatusNotice v-if="!completion.pending.value && completion.recoveryTarget.value" kind="warning" no-margin
            placement="notification" :retry-at="completion.recoveryRetryAt.value"
            :read-error="completion.recoveryReadError.value"
            :action="{state: completion.recoveryAction, label: messages.t('common.retry')}" @action="retryCompletion">
            {{ messages.t('state.deliveryFailed') }}
        </StatusNotice>
    </header>
</template>
