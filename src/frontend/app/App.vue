<script setup lang="ts">
import {onBeforeUnmount, ref, shallowRef} from 'vue';
import {RouterLink, RouterView, useRouter} from 'vue-router';
import type {RouteLocationNormalized} from 'vue-router';
import {usePilot} from './context';
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

function finishNavigation(to: RouteLocationNormalized): void {
    // A cancelled older import must not clear the newer destination's indicator.
    if (pendingNavigation.value === to) pendingNavigation.value = undefined;
}

function failNavigation(_error: unknown, to: RouteLocationNormalized): void {
    finishNavigation(to);
}

async function retrySession(): Promise<void> {
    try { await context.refreshSession(); }
    catch { localeError.value = true; }
}
</script>

<template>
    <div class="pilot-app d-flex flex-column min-vh-100 bg-secondary">
        <AppHeader @locale-error="localeError = true" />
        <main id="pilot-main" class="container-fluid flex-grow-1 py-3" tabindex="-1">
            <div class="sticky-top mt-1">
                <StatusNotice v-if="context.personalLink.value" kind="success"><strong class="me-1">{{ messages.t('auth.personalLink') }}</strong><a :href="context.personalLink.value" class="text-break">{{ context.personalLink.value }}</a><ActionButton class="btn-sm ms-2" variant="outline-light" :aria-label="messages.t('common.close')" @click="context.personalLink.value = null">&times;</ActionButton></StatusNotice>
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
