<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, provide, ref} from 'vue';
import {RouterLink, RouterView, useRoute, useRouter} from 'vue-router';
import type {NavigationFailure, RouteLocationNormalized} from 'vue-router';
import {useActionState, usePilot} from './context';
import {isPlainMessageKey} from '../../modules/localization/translator';
import {frontendDocumentUrl} from '../../modules/lib/frontendIdentity';
import StatusNotice from '../components/StatusNotice.vue';
import ActionButton from '../components/ActionButton.vue';
import AppHeader from '../components/AppHeader.vue';
import AppFooter from '../components/AppFooter.vue';
import LoadingSkeleton from '../components/LoadingSkeleton.vue';
import CommonPage from '../features/common/CommonPage.vue';
import {useDraftProtection} from '../composables/command';
import {noticeTargetKey, useReadRetry, useReadRetryAt} from '../composables/feedback';
import {observePageNavigation} from '../composables/pageNavigation';

const context = usePilot();
const noticeTarget = ref<HTMLElement | null>(null);
provide(noticeTargetKey, noticeTarget);
const {messages, session, epoch, ready, notice} = context;
// The bootstrap owner supplies both failure and receipt. The shared cooldown
// wakeup presents availability without another session request or timer policy.
const sessionRetryAvailable = useReadRetry(() => context.sessionRead.value.error);
const sessionRetryAt = useReadRetryAt(() => context.sessionRead.value.error, sessionRetryAvailable);
const sessionRetryAction = useActionState({eligible: () => sessionRetryAvailable.value,
    pending: () => context.sessionRead.value.pending});
const localeError = ref(false);
const router = useRouter();
const route = useRoute();
// SSR and the first browser render contain the identical skeleton. Feature owners
// mount only after initialization; later lazy navigation preserves mounted drafts.
const interactiveContent = computed(() => context.requiresClientInitialization(route));
const initialLoading = computed(() => !context.hydrated.value && !context.initialContentReady.value && interactiveContent.value);
// A document error can belong to an otherwise valid interactive route. Render its
// admitted outcome without mounting private editors; retirement follows the same
// initial-document/actor boundary as every other bootstrap projection.
const commonPage = computed(() => context.initialDocumentFor(route.fullPath)?.commonPage);
// Header commands and routed editors share one whole-page departure decision.
// Their fields stay with their own component; this shell contributes no draft.
useDraftProtection({dirty: noShellDraft, unknownMessage: 'draft.leaveUnknown'});
// The shared observer owns subscriptions and overlapping delivery. The shell
// contributes only its path-progress boundary and feedback commitment policy.
const navigation = observePageNavigation(router, {scope: 'path', finished: finishNavigation});
const pendingNavigation = navigation.destination;
const pageNoticeText = computed(() => {
    // Retain the receipt while translating its key reactively. Locale changes
    // update wording without renewing expiry or changing workflow authority.
    const key = context.pageNotice.value?.messageKey;
    return key ? messages.value.t(isPlainMessageKey(key) ? key : 'common.error') : null;
});
const personalLinkText = computed(() => context.personalLink.value
    ? messages.value.t('auth.personalLink', {link: context.personalLink.value}) : null);

function noShellDraft(): boolean { return false; }

// Lazy route modules resolve before currentRoute commits. Keep that current view
// mounted, including its drafts and focused controls, while indicating delivery.
// These guards are application-owned, never shared between server-rendered requests.
onBeforeUnmount(() => {
    navigation.dispose();
    document.removeEventListener('click', keepInitialNativeNavigation, true);
    document.removeEventListener('submit', keepInitialNativeSubmission, true);
});
onMounted(() => {
    // A partially initialized tree can already have Vue handlers attached. Capture
    // first so readable Help/anchors keep their real browser behavior until success.
    document.addEventListener('click', keepInitialNativeNavigation, true);
    document.addEventListener('submit', keepInitialNativeSubmission, true);
});

/** Preserve ordinary href navigation before initialization and after startup
 * failure. Do not prevent browser defaults or bypass its existing leave guards. */
function keepInitialNativeNavigation(event: MouseEvent): void {
    if (context.hydrated.value || !(event.target instanceof Element) || !event.target.closest('a[href]')) return;
    event.stopImmediatePropagation();
}

/** Only explicitly declared HTML GET forms are usable without initialized JS.
 * Client-only forms have no native submit contract; their omitted method must
 * never turn partially mounted credentials into a browser-default GET request. */
function keepInitialNativeSubmission(event: Event): void {
    if (context.hydrated.value || !(event.target instanceof HTMLFormElement)) return;
    // Stop Vue's prevent/submit handler while retaining real Help GET behavior.
    // Every other submission waits for the same successful readiness boundary.
    event.stopImmediatePropagation();
    if (event.target.getAttribute('method')?.toLowerCase() !== 'get') event.preventDefault();
}

/** Commit shell feedback only for an accepted path/query change. Fragment-only
 * movement keeps the current receipt, and an obsolete or canceled lazy navigation
 * cannot consume a command's destination-specific success message. */
function finishNavigation(to: RouteLocationNormalized, from?: RouteLocationNormalized,
                          failure?: NavigationFailure | void): void {
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

async function retrySession(): Promise<void> {
    if (!sessionRetryAction.isAvailable()) return;
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
        <main id="pilot-main" class="container-fluid flex-grow-1 py-3" tabindex="-1"
            :data-pilot-interactive="interactiveContent ? '' : undefined">
            <!-- The shared sticky host reserves space for visible results at its
                 origin. Receipt changes never focus a control or request a scroll. -->
            <div class="pilot-notice-region">
                <div ref="noticeTarget" class="pilot-notice-stack" data-pilot-notices>
                    <!-- Guest registration delivers the native one-visit transient flash.
                         The matching identity receipt can restore it after failed bootstrap. -->
                    <StatusNotice v-if="context.personalLink.value && personalLinkText" kind="success"
                        transient placement="hosted" :renewal="context.personalLink.value" @dismiss="dismissPersonalLink">
                        <!-- Native guest feedback is an escaped plain-text sentence.
                             Its private URL shares the flash's expiry and visit lifetime. -->
                        {{ personalLinkText }}
                    </StatusNotice>
                    <StatusNotice v-if="pageNoticeText" :kind="context.pageNotice.value?.kind === 'error'
                        ? 'danger' : context.pageNotice.value?.kind ?? 'info'"
                        transient placement="hosted" :renewal="context.pageNotice.value" @dismiss="dismissPageNotice">
                        {{ pageNoticeText }}
                    </StatusNotice>
                    <StatusNotice v-if="notice === 'auth.logoutDone'" kind="success" transient placement="hosted"
                        :renewal="notice" @dismiss="dismissNotice">{{ messages.t(notice) }}</StatusNotice>
                </div>
            </div>
            <div class="pilot-page-notices">
                <StatusNotice v-if="notice && notice !== 'auth.logoutDone'" kind="warning"
                    :renewal="notice"
                    :last-updated-at="notice === 'state.stale' && ready ? context.sessionRead.value.updatedAt : undefined"
                    :retry-at="notice === 'state.stale' ? sessionRetryAt : undefined"
                    :read-error="notice === 'state.stale' ? context.sessionRead.value.error : undefined"
                    :action="notice === 'state.stale' && ready
                        ? {state: sessionRetryAction, label: messages.t('common.retry')} : undefined"
                    @action="retrySession"
                    @dismiss="dismissNotice">{{ messages.t(notice) }}
                    <!-- Ordinary session failure keeps the mounted route and its drafts.
                         Offer the same explicit recovery as the closed identity view. -->
                </StatusNotice>
                <StatusNotice v-if="localeError" kind="danger">{{ messages.t('common.error') }}</StatusNotice>
                <StatusNotice v-if="context.updates.available.value" kind="warning"
                    :action="{label: messages.t('state.refreshPage')}" @action="context.updates.requestRecoveryReload">
                    {{ messages.t('state.updateAvailable') }}
                </StatusNotice>
            </div>
            <!-- Pending navigation belongs to the header indicator, not a page
                 skeleton. Keep the mounted route and announce progress once. -->
            <span v-if="ready && pendingNavigation" class="pilot-navigation-loading visually-hidden" role="status">{{ messages.t('common.loading') }}</span>
            <!-- Route presentation selects the same public layout for SSR and hydration.
                 The renderer owns shared geometry; no private read or command is implied. -->
            <LoadingSkeleton v-if="ready && initialLoading" data-pilot-initial-loading v-bind="route.meta.loadingSkeleton" page />
            <CommonPage v-else-if="ready && commonPage" :page="commonPage" />
            <RouterView v-else-if="ready" :key="epoch" />
            <section v-else class="card bg-dark text-white p-4">
                <p>{{ messages.t('state.sessionChanged') }}</p>
                <RouterLink class="btn btn-primary align-self-start" to="/frontend-pilot/users/login">
                    {{ messages.t('common.reauthenticate') }}
                </RouterLink>
                <ActionButton class="align-self-start mt-2" variant="outline-light"
                    :state="sessionRetryAction" @click="retrySession">
                    {{ messages.t('common.retry') }}
                </ActionButton>
            </section>
        </main>
        <AppFooter />
    </div>
</template>
