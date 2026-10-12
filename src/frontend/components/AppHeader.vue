<script setup lang="ts">
import {computed, onBeforeUnmount, ref, watch} from 'vue';
import {RouterLink, useRoute, useRouter} from 'vue-router';
import type {RouteLocationNormalized} from 'vue-router';
import {usePilot} from '../app/context';
import {localeManifest} from '../../modules/localization/translator';
import {safeFrontendReturn} from '../../modules/lib/frontendIdentity';
import {pilotHelpUrl, resolveContextualHelpUrl} from '../../modules/lib/helpNavigation';
import {completeIdentityEntry, useConfirmedNavigation} from '../composables/pageEntry';
import {useCommand} from '../composables/command';
import type {PilotRequestScope} from '../../types/FrontendPilotUiTypes';
import type {Locale} from '../../types/LocalizationTypes';
import AppNavigationDropdown from './AppNavigationDropdown.vue';
import NativeContextFields from './NativeContextFields.vue';
import ActionButton from './ActionButton.vue';
import StatusNotice from './StatusNotice.vue';

// TODO (docs/frontend-migration/FRONTEND_PILOT.md): Migrate the remaining creation, profile-management and
// account-administration destinations in their feature increments. Keep their native links
// until those workflows have pilot owners; the current help/packing iteration does not replace them.
const emit = defineEmits<{localeError: []; localeRecovered: []}>();
const context = usePilot();
const {messages, session, locale, ready} = context;
const route = useRoute();
const router = useRouter();
const completion = useConfirmedNavigation();
const logoutCommand = useCommand(context.refreshSession, true, {dirty: noHeaderDraft,
    unknownMessage: 'auth.leaveUnknown'});
const reconcilingIdentity = logoutCommand.recovering;
const identityBlocked = computed(() => logoutCommand.pending.value || logoutCommand.uncertain.value
    || reconcilingIdentity.value || completion.target.value !== null);
const expanded = ref(false);
const changingLocale = ref(false);
let pendingNavigation: RouteLocationNormalized | undefined;
let localeUrlNeedsSync = false;
let active = true;
const removeUpdateGuard = context.updates.registerGuard(() => !changingLocale.value);
// currentRoute changes only after a lazy destination finishes loading. Observe the
// earlier navigation phase so a late locale response cannot replace the old help
// URL and cancel the user's pending destination. Each completion clears only itself.
const removeNavigationStart = router.beforeEach(to => { pendingNavigation = to; });
const removeNavigationFinish = router.afterEach(finishNavigation);
const removeNavigationError = router.onError((_error, to) => { finishNavigation(to); });
onBeforeUnmount(() => {
    active = false;
    removeUpdateGuard();
    removeNavigationStart();
    removeNavigationFinish();
    removeNavigationError();
});
// Retain the native contextual target as the shared source for route activation and
// enhanced delivery. The pilot URL adapter moves article paths into a doc query.
const nativeHelpTarget = computed(() => resolveContextualHelpUrl(route.path));
const helpRoute = computed(() => pilotHelpUrl(nativeHelpTarget.value, locale.value));
// Native navigation highlights its first route-matching nav-link. On Packing pages
// that match is contextual Help. Article paths can contain the same route fragment,
// but activation also requires a matching Help target. Normalize only the pilot prefix
// and retain native Survey-before-Packing order without changing other nav entries.
const packingHelpActive = computed(function nativePackingHelpActivation() {
    const nativePath = route.path.replace(/^\/frontend-pilot(?=\/|$)/u, '');
    return !nativePath.includes('/survey') && nativePath.includes('/packing') && nativeHelpTarget.value.includes('/packing');
});
// Native header links prefer an explicit return destination, otherwise their current page.
// Apply the existing pilot return boundary before using either value in forms or navigation.
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

function finishNavigation(to: RouteLocationNormalized): void {
    if (pendingNavigation === to) pendingNavigation = undefined;
    // Let Vue Router finish notifying the destination before a query-only update.
    if (localeUrlNeedsSync) queueMicrotask(synchronizeHelpLocale);
}

function synchronizeHelpLocale(): void {
    if (!active || !localeUrlNeedsSync || changingLocale.value || pendingNavigation) return;
    localeUrlNeedsSync = false;
    const current = router.currentRoute.value;
    if ((current.path !== '/frontend-pilot/help' && !current.path.startsWith('/frontend-pilot/help/'))
        || current.query.locale === locale.value) return;
    // Help also supports native locale-bearing links. Normalize the settled help
    // destination, preserving its article/search/fragment for a later reload.
    void router.replace({path: current.path, query: {...current.query, locale: locale.value}, hash: current.hash})
        .catch(() => { if (active) emit('localeError'); });
}

/** Change language through the shared serialized cookie command without changing
 * the active actor or discarding mounted drafts. Report the command's outcome,
 * then let the settled Help URL owner preserve article/query/fragment navigation. */
async function selectLocale(event: Event): Promise<void> {
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
async function logoutIdentity(scope: PilotRequestScope) {
    const origin = route.fullPath;
    const destination = next.value;
    const result = await context.api.logout(scope);
    // Native next takes precedence over the provider's fallback logout URL.
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

/** The form/dialog normally owns delivery Retry. After a private subtree retires, the
 * shell presents only its orphaned canonical destination, without reviving private controls. */
async function retryCompletion(): Promise<void> {
    if (completion.target.value) await completion.retry();
    else await completion.retryFallback();
}

</script>

<template>
    <header>
        <nav class="navbar navbar-expand-lg navbar-dark bg-dark shadow-sm">
            <div class="container">
                <RouterLink class="navbar-brand d-flex align-items-center" to="/frontend-pilot">
                    <img :src="'/img/logo.png'" :alt="messages.t('app.title')" height="30" class="me-2" />
                    <span class="fw-semibold">{{ messages.t('app.title') }}</span>
                </RouterLink>
                <button
                    class="navbar-toggler"
                    type="button"
                    aria-controls="pilot-navbar-main"
                    :aria-expanded="expanded"
                    :aria-label="messages.t('app.toggleNavigation')"
                    @click="expanded = !expanded"
                >
                    <span class="navbar-toggler-icon"></span>
                </button>
                <div id="pilot-navbar-main" class="collapse navbar-collapse" :class="{show: expanded}">
                    <ul class="navbar-nav me-auto mb-2 mb-lg-0">
                        <li class="nav-item">
                            <RouterLink class="nav-link" to="/frontend-pilot"
                                ><i class="bi bi-house-fill me-1" aria-hidden="true"></i
                                >{{ messages.t('app.home') }}</RouterLink
                            >
                        </li>
                        <AppNavigationDropdown :label="messages.t('app.new')" icon="bi-plus-circle">
                            <li>
                                <h6 class="dropdown-header">{{ messages.t('app.planDecide') }}</h6>
                            </li>
                            <li>
                                <a class="dropdown-item" href="/survey/create"
                                    ><i class="bi bi-bar-chart-steps me-2" aria-hidden="true"></i
                                    >{{ messages.t('app.survey') }}</a
                                >
                            </li>
                            <li>
                                <a class="dropdown-item" href="/activity/create"
                                    ><i class="bi bi-calendar2-check me-2" aria-hidden="true"></i
                                    >{{ messages.t('app.activity') }}</a
                                >
                            </li>
                            <li>
                                <a class="dropdown-item" href="/event/create"
                                    ><i class="bi bi-calendar2-event me-2" aria-hidden="true"></i
                                    >{{ messages.t('app.event') }}</a
                                >
                            </li>
                            <li><hr class="dropdown-divider" /></li>
                            <li>
                                <h6 class="dropdown-header">{{ messages.t('app.organizeShare') }}</h6>
                            </li>
                            <li>
                                <RouterLink class="dropdown-item" to="/frontend-pilot/packing/create"
                                    ><i class="bi bi-bag-plus me-2" aria-hidden="true"></i
                                    >{{ messages.t('app.packing') }}</RouterLink
                                >
                            </li>
                            <li>
                                <a class="dropdown-item" href="/drivers/create"
                                    ><i class="bi bi-car-front me-2" aria-hidden="true"></i
                                    >{{ messages.t('app.drivers') }}</a
                                >
                            </li>
                        </AppNavigationDropdown>
                        <AppNavigationDropdown :label="messages.t('app.overview')" icon="bi-collection">
                            <li>
                                <RouterLink class="dropdown-item" to="/frontend-pilot"
                                    ><i class="bi bi-speedometer2 me-2" aria-hidden="true"></i
                                    >{{ messages.t('app.yourOverview') }}</RouterLink
                                >
                            </li>
                        </AppNavigationDropdown>
                        <li class="nav-item">
                            <RouterLink
                                class="nav-link"
                                :class="{active: packingHelpActive}"
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
                            v-if="ready && session?.activeProfile"
                            :label="profileLabel"
                            icon="bi-person-circle"
                            align-end
                        >
                            <li>
                                <RouterLink class="dropdown-item" to="/frontend-pilot"
                                    ><i class="bi bi-speedometer2 me-1" aria-hidden="true"></i
                                    >{{ messages.t('app.yourOverview') }}</RouterLink
                                >
                            </li>
                            <li>
                                <a class="dropdown-item" href="/users/profile"
                                    ><i class="bi bi-gear-fill me-1" aria-hidden="true"></i
                                    >{{ messages.t('app.profileSettings') }}</a
                                >
                            </li>
                            <li v-if="session.kind === 'account'">
                                <a class="dropdown-item" href="/users/profile/manage"
                                    ><i class="bi bi-person-lines-fill me-1" aria-hidden="true"></i
                                    >{{ messages.t('app.yourProfiles') }}</a
                                >
                            </li>
                            <li><hr class="dropdown-divider" /></li>
                            <li>
                                <form method="post" action="/frontend-pilot/users/logout" @submit.prevent="logout">
                                <NativeContextFields :next="next" />
                                <button
                                    class="dropdown-item text-danger"
                                    type="submit"
                                    :disabled="identityBlocked"
                                    @click.prevent="logout"
                                >
                                    <i class="bi bi-box-arrow-right me-1" aria-hidden="true"></i
                                    >{{ messages.t('app.logout') }}
                                </button>
                                </form>
                            </li>
                            <li>
                                <a class="dropdown-item text-danger" href="/users/account/delete"
                                    ><i class="bi bi-trash me-1" aria-hidden="true"></i
                                    >{{ messages.t('app.deleteAccount') }}</a
                                >
                            </li>
                        </AppNavigationDropdown>
                        <template v-else>
                            <li class="nav-item me-1">
                                <RouterLink
                                    class="nav-link"
                                    :to="{path: '/frontend-pilot/users/login', query: {next}}"
                                    ><i class="bi bi-box-arrow-in-right me-1" aria-hidden="true"></i
                                    >{{ messages.t('app.login') }}</RouterLink
                                >
                            </li>
                            <li class="nav-item">
                                <RouterLink
                                    class="nav-link"
                                    :to="{path: '/frontend-pilot/users/register', query: {next}}"
                                    ><i class="bi bi-person-plus me-1" aria-hidden="true"></i
                                    >{{ messages.t('app.register') }}</RouterLink
                                >
                            </li>
                        </template>
                        <li class="nav-item d-flex align-items-center ms-lg-2">
                            <label class="visually-hidden" for="pilot-locale">{{
                                messages.t('app.locale')
                            }}</label>
                            <select
                                id="pilot-locale"
                                class="form-select form-select-sm pilot-locale"
                                :value="locale"
                                :disabled="changingLocale || !ready"
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
            <StatusNotice v-if="logoutCommand.error.value" kind="danger" no-margin
                :transient="logoutCommand.transientError.value" :renewal="logoutCommand.errorRenewal.value"
                @dismiss="logoutCommand.setError(null)">{{ logoutCommand.error.value }}</StatusNotice>
            <StatusNotice v-if="logoutCommand.uncertain.value" kind="warning" no-margin>
                {{ messages.t('state.unknownOutcome') }}
                <ActionButton class="ms-2" variant="outline-light" :pending="reconcilingIdentity"
                    @click="refreshLogoutState">{{ messages.t('common.refresh') }}</ActionButton>
            </StatusNotice>
        </nav>
        <!-- Confirmed commands keep their own feedback. This shared recovery surface appears
             only for header-owned navigation or after its originating form has unmounted. -->
        <StatusNotice v-if="!completion.pending.value && (completion.target.value || completion.fallbackTarget.value)" kind="warning" class="mb-0">
            {{ messages.t('state.loadFailed') }}
            <ActionButton class="ms-2" variant="outline-light" :pending="completion.pending.value" @click="retryCompletion">
                {{ messages.t('common.retry') }}
            </ActionButton>
        </StatusNotice>
    </header>
</template>
