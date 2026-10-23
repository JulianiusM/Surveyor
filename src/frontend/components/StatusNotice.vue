<script setup lang="ts">
import {computed, inject, ref} from 'vue';
import type {MessageKey} from '../../types/LocalizationTypes';
import type {PilotNoticeAction} from '../../types/FrontendFeedbackTypes';
import {createTranslator, formatReadTime} from '../../modules/localization/translator';
import {pilotContextKey, useClientInitialization, usePilot} from '../app/context';
import {noticeTargetKey, readFailureMessage, useTransientNotice} from '../composables/feedback';
import ActionButton from './ActionButton.vue';

// Teleport has no DOM element for automatic fallthrough. Preserve the original
// alert's caller classes, IDs, ARIA attributes and listeners on its actual node.
defineOptions({inheritAttrs: false});

const props = withDefaults(defineProps<{
    kind?: 'info' | 'warning' | 'danger' | 'success' | 'secondary';
    noMargin?: boolean;
    marginBottom?: 0 | 3 | 4;
    transient?: boolean;
    // The shell's own initial receipts already occupy its shared host on SSR.
    // Descendant commands use notification to reach their nearest injected host.
    placement?: 'content' | 'notification' | 'hosted';
    disabled?: boolean;
    renewal?: unknown;
    notice?: MessageKey | null;
    // Only a retained, readable projection supplies this successful-read receipt.
    // Pending/failed reads and command confirmation never manufacture freshness.
    lastUpdatedAt?: number;
    // The read owner passes its existing server deadline only while retry is closed.
    // This notice presents that decision without starting another timer or request.
    retryAt?: number;
    // A current read can add its validated issue to the generic stale/cold warning.
    // The transport remains the trust boundary; arbitrary exception text is hidden.
    readError?: Error | null;
    // Existing plain notices may deliberately omit a live-region role. Undefined
    // keeps the shared feedback default; null preserves that caller's semantics.
    role?: 'alert' | 'status' | null;
    // The caller retains dispatch, admission and cooldown. Only the repeated
    // in-notice action layout belongs here, before the read diagnostics below.
    action?: PilotNoticeAction;
}>(), {kind: 'info', noMargin: false, marginBottom: 3, transient: false, placement: 'content', disabled: false});
const emit = defineEmits<{dismiss: []; action: [source: MouseEvent]}>();
const element = ref<HTMLElement | null>(null);
// The nearest shared dialog overrides the page host. No feature captures DOM
// invokers or moves focus/scroll when an asynchronous result arrives.
const notificationTarget = inject(noticeTargetKey, null);
// Standalone flashes do not require an application context. Mounted pilot notices
// localize Close, read diagnostics and timestamps; standalone callers retain the
// catalog's native English fallback without a second literal owner.
const context = inject(pilotContextKey, null);
const initialized = useClientInitialization();
// Contextual notices use the same selected Vue binding as every feature. Its
// resource-event dependency updates cached labels/diagnostics during catalog HMR;
// the raw fixed translator would react only to a language change. Standalone
// native flashes retain their no-context fallback without a second adapter.
const messages = context ? usePilot().messages : computed(() => createTranslator('en'));
const dismissLabel = computed(() => messages.value.t('common.dismissNotification'));
const lastRefresh = computed(() => readTime(props.lastUpdatedAt, 'state.lastSuccessfulRefresh'));
const retryDeadline = computed(() => readTime(props.retryAt, 'state.retryAvailableAt'));
const readIssue = computed(() => readFailureMessage(messages.value, props.readError));

/** One validated timestamp presentation serves successful reads and server cooldowns.
 * Invalid/missing instants must never imply freshness or a usable retry deadline. */
function readTime(timestamp: number | undefined, key: 'state.lastSuccessfulRefresh' | 'state.retryAvailableAt'):
    {datetime: string; label: string} | undefined {
    if (!timestamp || !Number.isFinite(timestamp)) return;
    const instant = new Date(timestamp);
    if (!Number.isFinite(instant.getTime())) return;
    return {datetime: instant.toISOString(),
        label: messages.value.t(key, {time: formatReadTime(timestamp, messages.value.locale)})};
}

// All command consumers share this classification. Confirmed save feedback is
// transient success; unknown outcomes and failed follow-up reads remain durable.
const transientNotice = computed(() => props.transient || props.notice === 'state.saved');
const noticeKind = computed(() => props.notice === 'state.saved' ? 'success' : props.kind);
const notification = computed(() => props.placement !== 'content' && transientNotice.value);
// The caller owns the message and clears it on dismissal. Never remove Vue's node
// directly, and never expire a durable uncertainty/read/update warning by default.
useTransientNotice(element, () => transientNotice.value, () => props.renewal ?? props.notice, expire);

function expire(): void { emit('dismiss'); }

function dismiss(): void {
    // A pending owner can lock dismissal. Timed expiry remains independent of
    // that interaction guard and never acknowledges command uncertainty.
    if (!props.disabled && initialized.value) emit('dismiss');
}
</script>

<template>
    <!-- Before the scope host mounts, SSR/first hydration reserve notice height
         locally. The shared host retains that natural space after relocation.
         Ordinary durable/content notices keep display:contents at this boundary. -->
    <div class="pilot-notice-origin" :class="{'pilot-notice-region': placement === 'notification' && notification && !notificationTarget}">
        <Teleport :to="notificationTarget ?? 'body'" :disabled="!notification || placement === 'hosted' || !notificationTarget">
            <div v-bind="$attrs" ref="element" :class="[transientNotice ? 'alert' : 'status-notice', `alert-${noticeKind}`, `mb-${noMargin ? 0 : marginBottom}`,
                 {'pilot-notification': notification, 'alert-dismissible': notification, fade: notification, show: notification}]"
                 :role="role === null ? undefined : role ?? (transientNotice || noticeKind === 'danger' ? 'alert' : 'status')">
                <slot /><ActionButton v-if="action" :class="action.class ?? 'btn-sm ms-2'" variant="outline-light"
                    :state="action.state" @click="emit('action', $event)">{{ action.label }}</ActionButton>
                <div v-if="readIssue" class="mt-2" data-read-issue>{{ readIssue }}</div>
                <!-- This is the last successful read, not the time of the failed retry.
                     Its owner omits it after actor/resource changes or confirmed denial. -->
                <div v-if="lastRefresh" class="small mt-2" data-last-successful-refresh>
                    <time :datetime="lastRefresh.datetime">{{ lastRefresh.label }}</time>
                </div>
                <!-- Availability and this deadline share the read owner's single cooldown.
                     Its existing wakeup removes the timing line when retry becomes available. -->
                <div v-if="retryDeadline" class="small mt-2" data-read-retry-at>
                    <time :datetime="retryDeadline.datetime">{{ retryDeadline.label }}</time>
                </div>
                <!-- Vue owns removal. Bootstrap's data-bs-dismiss would remove the node
                     independently and leave the reactive message/timer state behind. -->
                <button v-if="notification" type="button" class="btn-close" :disabled="disabled || !initialized"
                    :aria-label="dismissLabel" @click="dismiss"></button>
            </div>
        </Teleport>
    </div>
</template>
