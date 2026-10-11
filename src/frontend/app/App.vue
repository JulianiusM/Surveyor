<script setup lang="ts">
import {computed, onBeforeUnmount, ref, shallowRef} from 'vue';
import {RouterLink, RouterView, useRouter} from 'vue-router';
import type {NavigationFailure, RouteLocationNormalized} from 'vue-router';
import {usePilot} from './context';
import {isPlainMessageKey} from '../../modules/localization/translator';
import {frontendDocumentUrl} from '../../modules/lib/frontendIdentity';
import StatusNotice from '../components/StatusNotice.vue';
import ActionButton from '../components/ActionButton.vue';
import AppHeader from '../components/AppHeader.vue';
import AppFooter from '../components/AppFooter.vue';
import LoadingSkeleton from '../components/LoadingSkeleton.vue';
import {useDraftProtection} from '../composables/command';
import {useReadRetry, useReadRetryAt} from '../composables/feedback';

const context = usePilot();
const {messages, session, epoch, ready, notice} = context;
// The bootstrap owner supplies both failure and receipt. The shared cooldown
// wakeup presents availability without another session request or timer policy.
const sessionRetryAvailable = useReadRetry(() => context.sessionRead.value.error);
const sessionRetryAt = useReadRetryAt(() => context.sessionRead.value.error, sessionRetryAvailable);
const localeError = ref(false);
const router = useRouter();
// Header commands and routed editors share one whole-page departure decision.
// Their fields stay with their own component; this shell contributes no draft.
useDraftProtection({dirty: noShellDraft, unknownMessage: 'draft.leaveUnknown'});
const pendingNavigation = shallowRef<RouteLocationNormalized>();
const pageNoticeText = computed(() => {
    const key = context.pageNotice.value?.messageKey;
    return key ? messages.value.t(isPlainMessageKey(key) ? key : 'common.error') : null;
});
const personalLinkText = computed(() => context.personalLink.value
    ? messages.value.t('auth.personalLink', {link: context.personalLink.value}) : null);

function noShellDraft(): boolean { return false; }

// Lazy route modules resolve before currentRoute commits. Keep that current view
// mounted, including its drafts and focused controls, while indicating delivery.
// These guards are application-owned, never shared between server-rendered requests.
const removeNavigationStart = router.beforeEach(beginNavigation);
const removeNavigationFinish = router.afterEach(finishNavigation);
const removeNavigationError = router.onError(failNavigation);
onBeforeUnmount(() => {
    removeNavigationStart();
    removeNavigationFinish();
    removeNavigationError();
});

function beginNavigation(to: RouteLocationNormalized, from: RouteLocationNormalized): void {
    // Query/fragment updates have their own already mounted resource owners.
    pendingNavigation.value = to.path !== from.path ? to : undefined;
}

function finishNavigation(to: RouteLocationNormalized, from?: RouteLocationNormalized,
                          failure?: NavigationFailure | void): void {
    // A cancelled older import must not clear the newer destination's indicator.
    if (pendingNavigation.value === to) pendingNavigation.value = undefined;
    // Redirect feedback is applied after its destination commits. Clear it on the next
    // accepted visit, never while a cancelled guard keeps the user on the same form.
    const changedDocument = from && frontendDocumentUrl(to.fullPath) !== frontendDocumentUrl(from.fullPath);
    if (!failure && changedDocument) {
        context.pageNotice.value = null;
        context.personalLink.value = null;
        if (notice.value === 'auth.logoutDone') notice.value = null;
    }
    // A command's full message belongs only to its admitted canonical destination.
    // Keep it through that commitment; the next accepted different visit retires it.
    if (!failure && changedDocument && context.pageCompletion.value
        && frontendDocumentUrl(context.pageCompletion.value.destination) !== frontendDocumentUrl(to.fullPath)) {
        context.pageCompletion.value = null;
    }
}

function failNavigation(_error: unknown, to: RouteLocationNormalized): void {
    finishNavigation(to);
}

async function retrySession(): Promise<void> {
    if (!sessionRetryAvailable.value) return;
    try { await context.refreshSession(); }
    // Session recovery shares the authoritative read owner's failure lifetime.
    // Its successful Retry clears this warning without clearing locale failures.
    catch { /* The current bootstrap owner retains its single read failure. */ }
}

function dismissPageNotice(): void { context.pageNotice.value = null; }
function dismissNotice(): void { notice.value = null; }

function dismissPersonalLink(): void {
    context.personalLink.value = null;
}
</script>

<template>
    <div class="pilot-app d-flex flex-column min-vh-100 bg-secondary">
        <AppHeader @locale-error="localeError = true" @locale-recovered="localeError = false" />
        <main id="pilot-main" class="container-fluid flex-grow-1 py-3" tabindex="-1">
            <!-- Initial native flashes precede the sticky inline-alert destination.
                 Keep both in the existing shell owner with their distinct spacing. -->
            <div class="pilot-page-notices">
                <!-- Guest registration delivers the native one-visit transient flash.
                     The matching identity receipt can restore it after failed bootstrap. -->
                <StatusNotice v-if="context.personalLink.value && personalLinkText" kind="success"
                    transient :renewal="context.personalLink.value" @dismiss="dismissPersonalLink">
                    <!-- Native guest feedback is an escaped plain-text sentence.
                         Its private URL shares the flash's expiry and visit lifetime. -->
                    {{ personalLinkText }}
                </StatusNotice>
                <StatusNotice v-if="pageNoticeText" :kind="context.pageNotice.value?.kind === 'error'
                    ? 'danger' : context.pageNotice.value?.kind ?? 'info'"
                    transient :renewal="context.pageNotice.value" @dismiss="dismissPageNotice">
                    {{ pageNoticeText }}
                </StatusNotice>
                <StatusNotice v-if="notice" :kind="notice === 'auth.logoutDone' ? 'success' : 'warning'"
                    :transient="notice === 'auth.logoutDone'" :renewal="notice"
                    :last-updated-at="notice === 'state.stale' && ready ? context.sessionRead.value.updatedAt : undefined"
                    :retry-at="notice === 'state.stale' ? sessionRetryAt : undefined"
                    :read-error="notice === 'state.stale' ? context.sessionRead.value.error : undefined"
                    @dismiss="dismissNotice">{{ messages.t(notice) }}
                    <!-- Ordinary session failure keeps the mounted route and its drafts.
                         Offer the same explicit recovery as the closed identity view. -->
                    <ActionButton v-if="notice === 'state.stale' && ready" class="btn-sm ms-2" variant="outline-light"
                        :pending="context.sessionRead.value.pending" :disabled="!sessionRetryAvailable" @click="retrySession">
                        {{ messages.t('common.retry') }}
                    </ActionButton>
                </StatusNotice>
                <StatusNotice v-if="localeError" kind="danger">{{ messages.t('common.error') }}</StatusNotice>
                <StatusNotice v-if="context.updates.available.value" kind="warning">
                    {{ messages.t('state.updateAvailable') }}
                    <ActionButton class="btn-sm ms-2" variant="outline-light" @click="context.updates.requestReload">
                        {{ messages.t('state.refreshPage') }}
                    </ActionButton>
                </StatusNotice>
                <div id="liveAlerts" class="sticky-top mt-1"></div>
            </div>
            <!-- Delivery progress supplements the current route. Replacing RouterView here
                 would discard mounted edits and turn navigation latency into input loss. -->
            <LoadingSkeleton v-if="ready && pendingNavigation" class="pilot-navigation-loading mb-3" :rows="1" />
            <RouterView v-if="ready" :key="epoch" />
            <section v-else class="card bg-dark text-white p-4">
                <p>{{ messages.t('state.sessionChanged') }}</p>
                <RouterLink class="btn btn-primary align-self-start" to="/frontend-pilot/users/login">
                    {{ messages.t('common.reauthenticate') }}
                </RouterLink>
                <ActionButton class="align-self-start mt-2" variant="outline-light"
                    :pending="context.sessionRead.value.pending" :disabled="!sessionRetryAvailable" @click="retrySession">
                    {{ messages.t('common.retry') }}
                </ActionButton>
            </section>
        </main>
        <AppFooter />
    </div>
</template>
