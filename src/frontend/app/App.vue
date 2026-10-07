<script setup lang="ts">
import {ref} from 'vue';
import {RouterLink, RouterView} from 'vue-router';
import {usePilot} from './context';
import StatusNotice from '../components/StatusNotice.vue';
import ActionButton from '../components/ActionButton.vue';
import AppHeader from '../components/AppHeader.vue';
import AppFooter from '../components/AppFooter.vue';

const context = usePilot();
const {messages, session, epoch, ready, notice} = context;
const localeError = ref(false);
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
                <StatusNotice v-if="context.personalLink.value" kind="success"><strong>{{ messages.t('auth.personalLink') }} </strong><a :href="context.personalLink.value" class="text-break">{{ context.personalLink.value }}</a><ActionButton class="btn-sm ms-2" variant="outline-light" :aria-label="messages.t('common.close')" @click="context.personalLink.value = null">&times;</ActionButton></StatusNotice>
                <StatusNotice v-if="notice" kind="warning">{{ messages.t(notice) }}</StatusNotice>
                <StatusNotice v-if="localeError" kind="danger">{{ messages.t('common.error') }}</StatusNotice>
            </div>
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
