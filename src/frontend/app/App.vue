<script setup lang="ts">
import {computed, onBeforeUnmount, ref, shallowRef} from 'vue';
import {RouterLink, RouterView, useRouter} from 'vue-router';
import type {NavigationFailure, RouteLocationNormalized} from 'vue-router';
import {usePilot} from './context';
import {isPlainMessageKey} from '../../modules/localization/translator';
import StatusNotice from '../components/StatusNotice.vue';
import ActionButton from '../components/ActionButton.vue';
import AppHeader from '../components/AppHeader.vue';
import AppFooter from '../components/AppFooter.vue';
import LoadingSkeleton from '../components/LoadingSkeleton.vue';

const context = usePilot();
const {messages, session, epoch, ready, notice} = context;
const localeError = ref(false);
const router = useRouter();
const pendingNavigation = shallowRef<RouteLocationNormalized>();
const pageNoticeText = computed(() => {
    const key = context.pageNotice.value?.messageKey;
    return key ? messages.value.t(isPlainMessageKey(key) ? key : 'common.error') : null;
});
const personalLinkText = computed(formatPersonalLink);

/** Keep the native success sentence in one parameterized catalog entry, including word
 * order chosen by each language. Split only the interpolated URL to retain its existing
 * clickable control; Vue escapes both surrounding text and the link without translated HTML. */
function formatPersonalLink(): {before: string; after: string} | null {
    const link = context.personalLink.value;
    if (!link) return null;
    const text = messages.value.t('auth.personalLink', {link});
    const position = text.indexOf(link);
    return {before: text.slice(0, position), after: text.slice(position + link.length)};
}
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
    if (!failure && from && to.fullPath !== from.fullPath) context.pageNotice.value = null;
    // A command's full message belongs only to its admitted canonical destination.
    // Keep it through that commitment; the next accepted different visit retires it.
    if (!failure && from && context.pageCompletion.value?.destination !== to.fullPath) context.pageCompletion.value = null;
}

function failNavigation(_error: unknown, to: RouteLocationNormalized): void {
    finishNavigation(to);
}

async function retrySession(): Promise<void> {
    try { await context.refreshSession(); }
    catch { localeError.value = true; }
}

function dismissPersonalLink(): void {
    context.personalLink.value = null;
}
</script>

<template>
    <div class="pilot-app d-flex flex-column min-vh-100 bg-secondary">
        <AppHeader @locale-error="localeError = true" />
        <main id="pilot-main" class="container-fluid flex-grow-1 py-3" tabindex="-1">
            <div class="pilot-page-notices sticky-top mt-1">
                <!-- Personal edit links remain visible after confirmed guest registration.
                     They belong to the admitted identity and can be dismissed independently. -->
                <StatusNotice v-if="context.personalLink.value && personalLinkText" kind="success">
                    {{ personalLinkText.before }}<a :href="context.personalLink.value" class="text-break">{{ context.personalLink.value }}</a>{{ personalLinkText.after }}
                    <ActionButton class="btn-sm ms-2" variant="outline-light" :aria-label="messages.t('common.close')"
                        @click="dismissPersonalLink">
                        &times;
                    </ActionButton>
                </StatusNotice>
                <StatusNotice v-if="pageNoticeText" :kind="context.pageNotice.value?.kind === 'error'
                    ? 'danger' : context.pageNotice.value?.kind ?? 'info'">
                    {{ pageNoticeText }}
                </StatusNotice>
                <StatusNotice v-if="notice" :kind="notice === 'auth.logoutDone' ? 'success' : 'warning'">{{ messages.t(notice) }}</StatusNotice>
                <StatusNotice v-if="localeError" kind="danger">{{ messages.t('common.error') }}</StatusNotice>
                <StatusNotice v-if="context.updates.available.value" kind="warning">
                    {{ messages.t('state.updateAvailable') }}
                    <ActionButton class="btn-sm ms-2" variant="outline-light" @click="context.updates.requestReload">
                        {{ messages.t('state.refreshPage') }}
                    </ActionButton>
                </StatusNotice>
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
                <ActionButton class="align-self-start mt-2" variant="outline-light" @click="retrySession">
                    {{ messages.t('common.retry') }}
                </ActionButton>
            </section>
        </main>
        <AppFooter />
    </div>
</template>
