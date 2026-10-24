import {computed, reactive, ref, useId, watch} from 'vue';
import type {components} from '../../../types/api/v1';
import type {PilotPlainMessageKey, PilotRequestScope} from '../../../types/FrontendPilotUiTypes';
import type {FinanceInvoiceReviewInput, FinanceInvoiceReviewCallbacks} from '../../../types/FrontendFinanceReviewTypes';
import {useActionState, usePilot} from '../../app/context';
import {useCommand} from '../../composables/command';
import {useFinanceApi} from './api';
import {financeDecimal} from './numbers';

/** Own one invoice's lexical draft, captured review and existing command lifetime.
 * Inline rows and dialog editors use the same owner; callers supply only their
 * admitted source and local close/receipt callbacks, never a second draft. */
export function useFinanceInvoiceReview(props: FinanceInvoiceReviewInput, callbacks: FinanceInvoiceReviewCallbacks) {
    // Keep the existing command/admission/feedback collaborators scoped to this
    // mounted invoice. Filtering can hide its row without creating another owner.
    const context = usePilot();
    const api = useFinanceApi(context);
    const id = useId();
    const form = ref<HTMLFormElement | null>(null);
    // Unselected rows retain their admitted props, not a second saved DTO.
    // Only an explicitly selected review freezes evidence for its command.
    const capturedInvoice = ref<components['schemas']['FinanceInvoice'] | null>(props.inline ? null : {...props.invoice});
    const invoice = computed(() => capturedInvoice.value ?? props.invoice);
    const closedPool = ref(props.pool.status === 'CLOSED');
    const operation = ref(props.action);
    const reviewing = ref(false);
    const inspected = ref(false);
    const completed = ref(false);
    const draft = reactive(initialDraft());
    const baseline = ref(JSON.stringify(draft));
    const capturedRevision = ref<components['schemas']['FinanceRevisionInput'] | null>(null);
    const capturedRejection = ref<components['schemas']['FinanceAcceptedRejectionInput'] | null>(null);
    const capturedNew = ref<{action: 'approve'; amount: string; description: string} | {action: 'decline'; reason: string} | null>(null);
    const retroactive = computed(() => operation.value === 'revise' || operation.value === 'reject');
    const rejection = computed(() => operation.value === 'decline' || operation.value === 'reject');
    const command = useCommand(props.refresh, true, {dirty: () => JSON.stringify(draft) !== baseline.value,
        unknownMessage: 'draft.leaveUnknown', recoveryEligible: () => props.active});
    const actionState = useActionState({eligible: () => props.active && !completed.value
        && (!props.inline || props.invoice.status === 'NEW')
        // Participant recovery keeps read admission after status changes; only
        // another Close dispatch depends on this current own-row capability.
        && (!props.participant || operation.value === 'close' && props.currentInvoice?.id === invoice.value.id
            && props.currentInvoice.canClose), blocked: () => command.action.disabled.value});
    const recovery = useActionState({eligible: () => props.active, blocked: () => command.recoveryAction.disabled.value,
        pending: () => command.recovering.value});
    const title = computed(() => props.inline || operation.value === 'close' ? 'finance.confirmInvoiceAction' : reviewing.value ? 'finance.confirmInvoiceChange' : operation.value === 'revise'
        ? 'finance.correctInvoice' : operation.value === 'reject' ? 'finance.rejectInvoiceFromPool'
            : operation.value === 'approve' ? 'finance.accept' : operation.value === 'decline' ? 'finance.reject' : 'finance.close');
    const effectiveAmount = computed(() => props.inline && capturedNew.value
        ? capturedNew.value.action === 'approve' ? capturedNew.value.amount || invoice.value.amount : invoice.value.amount
        : draft.amount ? draft.amount : invoice.value.correctedAmount ?? invoice.value.amount);
    watch([() => props.invoice.id, () => props.action], resetSelection);
    watch([() => props.invoice.status, () => props.open, command.pending, command.recovering, command.uncertain], releaseInlineReview);

    function initialDraft() {
        // Saved wire precision must not change the former clean form spelling.
        // Subsequent edits retain their exact lexical value until explicit reset.
        return {amount: props.action === 'revise' ? financeDecimal(props.invoice.correctedAmount ?? props.invoice.amount) : '',
            description: props.action === 'revise' ? props.invoice.correctedDescription ?? props.invoice.description ?? '' : '', reason: ''};
    }

    /** A different row or action starts a distinct review. Revalidation of the same
     * selected row preserves the original capture and all unfinished lexical input. */
    function resetSelection(): void {
        capturedInvoice.value = props.inline ? null : {...props.invoice};
        operation.value = props.action; closedPool.value = props.pool.status === 'CLOSED';
        Object.assign(draft, initialDraft()); baseline.value = JSON.stringify(draft);
        reviewing.value = false; inspected.value = false; completed.value = false;
        capturedRevision.value = null; capturedRejection.value = null;
        capturedNew.value = null;
    }

    /** Release an abandoned capture and obsolete unsent fields only after its gate
     * and command settle. A status read cannot discard pending or unknown work. */
    function releaseInlineReview(): void {
        if (!props.inline || props.open || command.pending.value || command.recovering.value || command.uncertain.value) return;
        // Cancel preserves a still-NEW row's lexical inputs. External acceptance
        // retires inputs no longer rendered, avoiding an invisible dirty blocker.
        capturedInvoice.value = null;
        capturedNew.value = null;
        if (props.invoice.status !== 'NEW') {
            Object.assign(draft, initialDraft());
            baseline.value = JSON.stringify(draft);
        }
        // Command feedback/outcome belong to the persistent row owner and are
        // deliberately untouched, including a confirmed write's failed read.
    }
    function close(): void {
        // Canceling an inline confirmation leaves its row and unsaved fields in
        // place. It is not a departure from their existing draft owner.
        if (props.inline && !command.pending.value && !command.recovering.value && !command.uncertain.value) {
            callbacks.close();
            return;
        }
        if (!command.mayLeave()) return;
        if (command.uncertain.value) command.acknowledge();
        callbacks.close();
    }

    /** Capture the native NEW row's relevant values before its final gate.
     * Missing rejection text stops here; approval retains its native optional
     * positive-number validation in the existing transport/controller owners. */
    function beginInline(selected: 'approve' | 'decline'): boolean {
        if (!props.inline || !actionState.isAvailable()) return false;
        // Each click captures the latest admitted row identity, while the local
        // lexical draft itself survives ordinary saved reads and filtering.
        if (selected === 'decline' && !draft.reason.trim()) {
            command.setError('finance.enterARejectionReasonBeforeRejectingThisInvoice');
            return false;
        }
        command.setError(null);
        capturedInvoice.value = {...props.invoice};
        closedPool.value = props.pool.status === 'CLOSED';
        operation.value = selected;
        capturedNew.value = selected === 'approve'
            ? {action: selected, amount: draft.amount.trim(), description: draft.description.trim()}
            : {action: selected, reason: draft.reason.trim()};
        return true;
    }

    /** Freeze a retroactive change for its distinct final confirmation. Both review
     * stages keep the original pool revision rather than adopting a refresh token. */
    async function submit(): Promise<void> {
        if (!actionState.isAvailable() || !form.value) return;
        if (props.inline && !capturedNew.value) return;
        // Native NEW acceptance reads optional numeric corrections from a row's
        // button, without HTML step/min validation. Preserve its positive-number
        // contract; generated validation and the shared controller decide admission.
        if (!props.inline && operation.value !== 'approve' && !form.value.reportValidity()) return;
        if (!props.inline && rejection.value && !draft.reason.trim()) {
            command.setError('finance.enterARejectionReasonBeforeRejectingThisInvoice');
            return;
        }
        if (retroactive.value && !reviewing.value) {
            // Blank correction text restores the original description. Rejection
            // carries only its own required reason and cannot leak a correction.
            capturedRevision.value = {confirmed: true, expectedRevision: invoice.value.revision,
                correctedAmount: financeDecimal(draft.amount), correctedDescription: draft.description.trim() || null};
            capturedRejection.value = {confirmed: true, expectedRevision: invoice.value.revision, rejectionReason: draft.reason.trim()};
            reviewing.value = true;
            return;
        }
        await save();
    }

    /** Dispatch exactly the reviewed operation once. Original evidence stays in the
     * server audit record; neither correction nor invoice closure settles a share. */
    async function save(): Promise<void> {
        const row = invoice.value;
        const selected = operation.value;
        // This audience never adopts organizer review authority. Its captured
        // Close reuses the existing participant endpoint and server admission.
        if (props.participant && selected !== 'close') return;
        // Inline confirmation freezes the relevant payload before its await.
        // The hidden row cannot change that reviewed command after the gate.
        const amount = capturedNew.value?.action === 'approve' ? capturedNew.value.amount : draft.amount;
        const description = capturedNew.value?.action === 'approve' ? capturedNew.value.description : draft.description.trim();
        const acceptance = {...(amount ? {correctedAmount: financeDecimal(amount)} : {}),
            ...(description ? {correctedDescription: description} : {})};
        const decline = {rejectionReason: capturedNew.value?.action === 'decline' ? capturedNew.value.reason : draft.reason.trim()};
        const revision = capturedRevision.value;
        const rejected = capturedRejection.value;
        if (selected === 'revise' && !revision || selected === 'reject' && !rejected) return;
        inspected.value = false;
        // All fields, action and revision were captured before pending disables the
        // form. Refresh may fail after confirmation without changing that outcome.
        const notice = successNotice(selected);
        const result = await command.run(dispatch, true, true, {success: notice});
        if (!result) return;
        // Retain a failed-read warning with its actual command owner. The completed
        // fields remain visible and locked; closing cannot offer the saved write again.
        baseline.value = JSON.stringify(draft);
        completed.value = true;
        if (command.outcome.value?.refresh !== 'failed') {
            // The dialog retires on normal confirmation. Its parent receives the
            // completed notice for the persistent common host before this unmounts.
            callbacks.saved(notice);
            callbacks.close();
        }

        /** Select one authored transport operation from the captured review. */
        function dispatch(scope: PilotRequestScope) {
            // Every branch receives only the fields admitted for its reviewed action.
            if (props.participant) return api.close(props.eventId, row.poolId, row.id, scope);
            if (selected === 'approve') return api.approve(props.eventId, row.poolId, row.id, acceptance, scope);
            if (selected === 'decline') return api.decline(props.eventId, row.poolId, row.id, decline, scope);
            if (selected === 'revise') return api.revise(props.eventId, row.poolId, row.id, revision!, scope);
            if (selected === 'reject') return api.rejectAccepted(props.eventId, row.poolId, row.id, rejected!, scope);
            return api.organizerClose(props.eventId, row.poolId, row.id, scope);
        }
    }

    /** Report the existing action-specific receipt, including the closed-pool
     * distinction that changing source inputs leaves saved shares unchanged. */
    function successNotice(action: typeof props.action): PilotPlainMessageKey {
        if (action === 'approve') return 'finance.invoiceAccepted2';
        if (action === 'decline') return 'finance.invoiceRejected2';
        if (action === 'close') return 'finance.invoiceClosed2';
        // Retroactive source changes have a separate recalculation reminder.
        if (action === 'revise') return closedPool.value ? 'finance.invoiceCorrectedClosed' : 'finance.invoiceCorrected';
        return closedPool.value ? 'finance.invoiceRejectedClosed' : 'finance.invoiceRejectedFromThePool';
    }

    /** A stale review must be explicitly abandoned and reopened from current data.
     * Inspection alone never upgrades this review's captured calculation revision. */
    async function inspectSaved(): Promise<void> {
        if (recovery.isAvailable() && await command.reconcileSafely(props.refresh)) inspected.value = true;
    }
    function acknowledge(): void {
        if (!inspected.value || command.pending.value || command.recovering.value) return;
        command.acknowledge();
        callbacks.close();
    }

    return {id, form, invoice, closedPool, operation, reviewing, inspected, completed, draft,
        capturedRevision, capturedRejection, capturedNew, retroactive, rejection, command, actionState, recovery,
        title, effectiveAmount, submit, close, inspectSaved, acknowledge, beginInline};
}
