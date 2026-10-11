<script setup lang="ts">
import {computed, inject, onBeforeUnmount, onMounted, ref, shallowRef, watch} from 'vue';
import type {MessageKey} from '../../types/LocalizationTypes';
import {createTranslator, formatReadTime} from '../../modules/localization/translator';
import {pilotContextKey, usePilot} from '../app/context';
import {readFailureMessage, useTransientNotice} from '../composables/feedback';
import {isElementVisible} from '../../public/js/shared/alerts';

// Teleport has no DOM element for automatic fallthrough. Preserve the original
// alert's caller classes, IDs, ARIA attributes and listeners on its actual node.
defineOptions({inheritAttrs: false});

const props = withDefaults(defineProps<{
    kind?: 'info' | 'warning' | 'danger' | 'success';
    noMargin?: boolean;
    marginBottom?: 0 | 3 | 4;
    transient?: boolean;
    inline?: boolean;
    target?: HTMLElement | null;
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
}>(), {kind: 'info', noMargin: false, marginBottom: 3, transient: false, inline: false, disabled: false});
const emit = defineEmits<{dismiss: []}>();
const element = ref<HTMLElement | null>(null);
// Standalone flashes do not require an application context. Mounted pilot notices
// localize Close, read diagnostics and timestamps; standalone callers retain the
// catalog's native English fallback without a second literal owner.
const context = inject(pilotContextKey, null);
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
const inlineNotice = computed(() => props.inline && transientNotice.value);
const liveTarget = shallowRef<HTMLElement | null>(props.target && isElementVisible(props.target) ? props.target : null);
let mounted = false;
let targetObserver: MutationObserver | undefined;

/** A successful authority read may remove the initiating row before confirmation.
 * Never render into its detached host or keep revoked controls alive. The same
 * receipt falls back to its original modal/page slot when that boundary retires. */
function refreshTarget(): void {
    liveTarget.value = props.target && isElementVisible(props.target) ? props.target : null;
}

function observeTarget(): void {
    targetObserver?.disconnect();
    targetObserver = undefined;
    refreshTarget();
    if (!mounted || !inlineNotice.value || !props.target) return;
    targetObserver = new MutationObserver(refreshTarget);
    targetObserver.observe(document.body, {subtree: true, childList: true,
        attributes: true, attributeFilter: ['class', 'style', 'hidden', 'aria-hidden']});
}

watch([() => props.target, inlineNotice], observeTarget, {flush: 'post'});
onMounted(() => { mounted = true; observeTarget(); });
onBeforeUnmount(() => { mounted = false; targetObserver?.disconnect(); });
// The caller owns the message and clears it on dismissal. Never remove Vue's node
// directly, and never expire a durable uncertainty/read/update warning by default.
useTransientNotice(element, () => transientNotice.value, () => props.renewal ?? props.notice, expire, () => inlineNotice.value);

function expire(): void { emit('dismiss'); }

function dismiss(): void {
    // Native pending commands lock every control in their modal, including inline
    // Close. Native timed expiry still clears feedback independently of that lock.
    if (!props.disabled) emit('dismiss');
}
</script>

<template>
    <!-- One state owner renders into the initiating native section after a command.
         SSR and ordinary full-page/flash callers keep their original placement. -->
    <Teleport :to="liveTarget ?? 'body'" :disabled="!inlineNotice || !liveTarget">
        <div v-bind="$attrs" ref="element" :class="[transientNotice ? 'alert' : 'status-notice', `alert-${noticeKind}`, `mb-${noMargin ? 0 : marginBottom}`,
             {'alert-dismissible': inlineNotice, fade: inlineNotice, show: inlineNotice}]"
             :role="transientNotice || noticeKind === 'danger' ? 'alert' : 'status'"
             :tabindex="inlineNotice ? -1 : undefined">
            <slot />
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
            <button v-if="inlineNotice" type="button" class="btn-close" :disabled="disabled"
                :aria-label="dismissLabel" @click="dismiss"></button>
        </div>
    </Teleport>
</template>
