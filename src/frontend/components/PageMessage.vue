<script setup lang="ts">
import {computed, ref, watch} from 'vue';
import {RouterLink, useRoute} from 'vue-router';
import {usePilot} from '../app/context';
import {frontendDocumentUrl} from '../../modules/lib/frontendIdentity';
import type {PilotNoticeAction} from '../../types/FrontendFeedbackTypes';
import StatusNotice from './StatusNotice.vue';

const props = withDefaults(defineProps<{
    kind: 'info' | 'success' | 'warning' | 'error';
    message: string;
    // Some native message severities supply a heading without an alert body.
    // The admitted presenter selects that shape without changing notice lifetimes.
    displayMessage?: boolean;
    transient?: boolean;
    renewal?: unknown;
    // Recoverable admission reads can keep this native Error/Home layout while
    // the same notice owns their safe diagnostic and server retry deadline.
    retryAt?: number;
    readError?: Error | null;
    action?: PilotNoticeAction;
    // Common document messages return Home to the landing page. Existing feature
    // outcomes retain their established Overview destination unless explicitly supplied.
    homeUrl?: string;
}>(), {transient: true, displayMessage: true, homeUrl: '/frontend-pilot'});
const emit = defineEmits<{action: [source: MouseEvent]}>();
const {messages} = usePilot();
const route = useRoute();
const documentUrl = computed(() => frontendDocumentUrl(route.fullPath));
// Document visits and explicit outcome receipts own renewal. Translated message
// text never resurrects an expired body or extends an already visible outcome.
const messageReceipt = computed(() => ({document: documentUrl.value, kind: props.kind,
    transient: props.transient, renewal: props.renewal}));
const messageVisible = ref(true);
const title = computed(() => messages.value.t(props.kind === 'info' ? 'common.infoTitle'
    : props.kind === 'success' ? 'common.successTitle'
        : props.kind === 'warning' ? 'common.warningTitle' : 'common.errorTitle'));

// Native full message pages expire their alert body, while the heading and Home remain.
// Expiry is presentation only: never clear a command receipt or restart token admission.
// Callers explicitly preserve unresolved read warnings; no translated key determines policy.
watch(messageReceipt, revealMessage);

function revealMessage(): void { messageVisible.value = true; }
function dismissMessage(): void { messageVisible.value = false; }
</script>

<template>
    <!-- Admitted full-page outcomes share the heading, message and Home layout.
         Their content notice uses the common renderer and receipt lifetime. -->
    <section class="pilot-page-message card bg-dark text-white mb-3">
        <h1 class="card-header text-center bg-dark text-light">
            <i class="bi me-2" :class="kind === 'error' ? 'bi-exclamation-triangle-fill'
                : kind === 'success' ? 'bi-check-circle-fill'
                    : kind === 'warning' ? 'bi-exclamation-circle-fill' : 'bi-info-circle-fill'" aria-hidden="true"></i>{{ title }}
        </h1>
        <div class="card-body">
            <StatusNotice v-if="displayMessage && messageVisible" :kind="kind === 'error' ? 'danger' : kind"
                :retry-at="retryAt" :read-error="readError" :action="action" @action="emit('action', $event)"
                :transient="transient" :renewal="messageReceipt" @dismiss="dismissMessage">{{ message }}</StatusNotice>
            <slot />
            <div class="pilot-action-row justify-content-center gap-3 mt-4">
                <RouterLink class="btn btn-primary" :to="homeUrl">
                    <i class="bi bi-house-door-fill me-1" aria-hidden="true"></i>{{ messages.t('app.home') }}
                </RouterLink>
            </div>
        </div>
    </section>
</template>
