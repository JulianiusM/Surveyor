<script setup lang="ts">
import {DialogRoot, DialogPortal, DialogOverlay, DialogContent, DialogTitle, DialogClose} from 'reka-ui';
import {computed, inject, provide, ref, watch} from 'vue';
import {useFrontend} from '../app/context';
import {noticeTargetKey} from '../composables/feedback';

const props = withDefaults(
    defineProps<{
        open: boolean;
        id?: string;
        title: string;
        subtitle?: string;
        pending?: boolean;
        compact?: boolean;
        // Feature dialogs preserve geometry/type without replacing this
        // shared focus, pending-dismissal and portal owner. Defaults retain Settings.
        standard?: boolean;
        titleClass?: string;
        titleIcon?: string;
        closeClass?: string;
        contentClass?: string;
        footerClass?: string;
        fullscreenOnSmall?: boolean;
        initialFocus?: string;
    }>(),
    {fullscreenOnSmall: true},
);
const emit = defineEmits<{close: []}>();
const {messages} = useFrontend();
// A modal owns a presentation host above its body, using the same notice renderer
// and receipts as the page. Visible receipts reserve space above the scroll body.
const inheritedNoticeTarget = inject(noticeTargetKey, null);
const noticeTarget = ref<HTMLElement | null>(null);
// Persistent feedback can outlive a confirmed dialog close. Move its same node
// back to the enclosing host without remounting its receipt or restarting expiry.
const activeNoticeTarget = computed(() => props.open ? noticeTarget.value : inheritedNoticeTarget?.value ?? null);
provide(noticeTargetKey, activeNoticeTarget);
// Features may open a modal from several buttons instead of one Reka DialogTrigger.
// Remember the actual invoker so Escape/cancel returns keyboard focus to the right control.
let opener: HTMLElement | null = null;
// A picker can stay mounted while closed. Capture each actual opening, rather than the
// element focused when its parent page was first created.
watch(
    () => props.open,
    (open) => {
        if (open && typeof document !== 'undefined' && document.activeElement instanceof HTMLElement)
            opener = document.activeElement;
    },
    {immediate: true, flush: 'sync'},
);

/** Dialogs initially focus their container without highlighting Close.
 * A feature may instead request a field or confirmation Cancel control. Keep
 * Reka's trap and focus return, but do not let its first-control default change that
 * documented initial focus behavior when no usable feature target is present. */
function focusInitial(event: Event): void {
    if (!(event.target instanceof HTMLElement)) return;
    const target = props.initialFocus ? event.target.querySelector<HTMLElement>(props.initialFocus) : null;
    event.preventDefault();
    (target ?? event.target).focus({preventScroll: true});
}

/** The feature owns discard decisions. This wrapper only prevents dismissal while its command is pending. */
function requestOpen(open: boolean): void {
    if (!open && !props.pending) emit('close');
}
function preventPending(event: Event): void {
    if (props.pending) event.preventDefault();
}
function restoreFocus(event: Event): void {
    if (!opener?.isConnected) return;
    event.preventDefault();
    opener.focus({preventScroll: true});
}
</script>

<template>
    <DialogRoot :open="open" @update:open="requestOpen">
        <DialogPortal>
            <DialogOverlay class="frontend-dialog-backdrop" />
            <DialogContent
                :id="id"
                class="frontend-dialog modal-content bg-dark"
                :class="[contentClass ?? 'text-white', {'frontend-dialog-compact': compact, 'frontend-dialog-standard': standard, 'frontend-dialog-fullscreen': fullscreenOnSmall}]"
                :aria-describedby="undefined"
                @escape-key-down="preventPending"
                @pointer-down-outside="preventPending"
                @open-auto-focus="focusInitial"
                @close-auto-focus="restoreFocus"
            >
                <header class="modal-header">
                    <div>
                        <DialogTitle as="h2" class="modal-title" :class="[{'fs-5': !compact}, titleClass]"><i v-if="titleIcon" class="bi me-2" :class="titleIcon" aria-hidden="true"></i>{{ title }}</DialogTitle>
                        <p v-if="subtitle" class="small text-secondary mb-0 text-break">{{ subtitle }}</p>
                    </div>
                    <DialogClose
                        class="btn-close" :class="closeClass ?? 'btn-close-white'"
                        :disabled="pending"
                        :aria-label="messages.t('common.close')"
                    />
                </header>
                <slot name="navigation" />
                <div class="frontend-notice-region">
                    <div ref="noticeTarget" class="frontend-notice-stack" data-frontend-notices></div>
                </div>
                <div class="modal-body">
                    <slot />
                    <!-- Editors may finish within their scroll body.
                         The caller keeps the same actions and operation owners;
                         true confirmation/create footers retain their own slot. -->
                    <div v-if="$slots.bodyActions" class="frontend-action-row justify-content-end mt-3">
                        <slot name="bodyActions" />
                    </div>
                </div>
                <footer v-if="$slots.footer" class="modal-footer" :class="footerClass"><slot name="footer" /></footer>
            </DialogContent>
        </DialogPortal>
        <!-- Commands that finish by closing their dialog keep one feedback
             instance here. Ordinary form bodies retain their existing lifetime. -->
        <slot name="feedback" />
    </DialogRoot>
</template>
