import {computed, ref} from 'vue';
import {useRoute} from 'vue-router';
import type {PilotCreationCollector, PilotCreationOptions} from '../../types/FrontendCreationTypes';
import {frontendDocumentUrl} from '../../modules/lib/frontendIdentity';
import {useActionState, usePilot} from '../app/context';
import {isReadDenial} from '../app/transport';
import {useCommand} from './command';
import {useReadRetry, useReadRetryAt} from './feedback';
import {useConfirmedNavigation} from './pageEntry';

/** Share deliberate creation delivery across admitted feature drafts. Field
 * initialization, native collection and selected bytes remain with each feature;
 * this owner prevents replay and retains only a confirmed navigation receipt. */
export function useCreationCommand<Result>(options: PilotCreationOptions<Result>) {
    const context = usePilot();
    const route = useRoute();
    const destination = useConfirmedNavigation();
    const submitted = ref(false);
    const admittingSubmission = ref(false);
    // Admission Retry and Create share their read fence, but only the initiating
    // action owns pending presentation. Create spans its admission/write handoff.
    const submissionPurpose = ref<'submission' | 'recovery' | null>(null);
    const leavingAfterSubmission = ref(false);
    const submissionAdmissionError = ref<Error | null>(null);
    const submissionAdmittedAt = ref<number>();
    const submissionRetryAvailable = useReadRetry(() => submissionAdmissionError.value);
    const submissionRetryAt = useReadRetryAt(() => submissionAdmissionError.value, submissionRetryAvailable);
    const command = useCommand(context.refreshSession, true, {
        dirty: () => !submitted.value && !leavingAfterSubmission.value && options.dirty(),
        busy: () => admittingSubmission.value,
        unknownMessage: options.unknownMessage,
    });
    const blocked = computed(() => submitted.value || command.action.disabled.value
        || admittingSubmission.value || !submissionRetryAvailable.value);
    const submissionRetryAction = useActionState({eligible: mayAdmitSubmission,
        pending: () => admittingSubmission.value && submissionPurpose.value === 'recovery',
        blocked: () => admittingSubmission.value});
    const createAction = useActionState({eligible: mayCreate,
        pending: () => command.pending.value || submissionPurpose.value === 'submission',
        blocked: () => command.action.disabled.value || admittingSubmission.value});

    function mayAdmitSubmission(): boolean {
        return !submitted.value && context.mayRead() && submissionRetryAvailable.value;
    }

    function mayCreate(): boolean { return mayAdmitSubmission() && options.eligible(); }

    /** Recheck native creation admission independently of duplicate/read access.
     * Recovery reads preserve the draft and require a separate explicit submit. */
    async function admitSubmission(purpose: 'submission' | 'recovery'): Promise<boolean> {
        if (!context.mayRead()) return false;
        const scope = context.capture();
        const expectedRoute = frontendDocumentUrl(route.fullPath);
        admittingSubmission.value = true;
        try {
            const outcome = await options.readEntry(scope, expectedRoute);
            if (!context.isCurrent(scope, true) || frontendDocumentUrl(route.fullPath) !== expectedRoute) return false;
            submissionAdmissionError.value = null;
            if (outcome.kind === 'render') {
                submissionAdmittedAt.value = Date.now();
                return true;
            }
            submissionAdmittedAt.value = undefined;

            // Submitting accepts the native login journey; a read-only Retry
            // retains the ordinary whole-page draft departure decision.
            admittingSubmission.value = false;
            leavingAfterSubmission.value = purpose === 'submission';
            await options.navigateEntry(outcome, scope, expectedRoute);
            return false;
        } catch (failure) {
            if (context.isCurrent(scope, true) && frontendDocumentUrl(route.fullPath) === expectedRoute) {
                submissionAdmissionError.value = failure instanceof Error ? failure : new Error('Admission read failed');
                if (isReadDenial(failure)) submissionAdmittedAt.value = undefined;
            }
            return false;
        } finally {
            admittingSubmission.value = false;
            leavingAfterSubmission.value = false;
        }
    }

    /** Retry only the admission read. The retained draft still needs a separate
     * deliberate Create, while sibling controls keep the same shared read fence. */
    async function retrySubmissionAdmission(): Promise<void> {
        if (!submissionRetryAction.isAvailable()) return;
        // Presentation identifies this read without collecting or submitting.
        submissionPurpose.value = 'recovery';
        try {
            await admitSubmission('recovery');
        } finally {
            submissionPurpose.value = null;
        }
    }

    /** Collect after admission, send once, then transfer only the confirmed
     * destination. Failed lazy delivery cannot make Create available again. */
    async function submit(collect: PilotCreationCollector<Result>): Promise<Result | undefined> {
        // Admission may redirect or wait for another actor. Collect the mounted
        // draft only after that check, using the current feature eligibility.
        if (!createAction.isAvailable()) return;
        submissionPurpose.value = 'submission';
        try {
            if (!(await admitSubmission('submission')) || !options.eligible()) return;
            const operation = collect();
            if (!operation) return;
            const scope = context.capture();
            const origin = route.fullPath;

            // Dispatch once for the captured actor. The initiating presentation
            // spans preflight and write, without adding another command lease.
            // The destination owns the one confirmed success announcement.
            // Validation and unknown outcomes remain with this command owner.
            const result = await command.run(operation, false, undefined, {success: null});
            submissionPurpose.value = null;
            if (result) {
                // Confirmation hands off to the existing destination receipt.
                // Failed lazy delivery must not make Create available again.
                submitted.value = true;
                await destination.navigate(options.destination(result), scope, origin,
                    {kind: 'success', messageKey: options.success});
            }
            return result;
        } finally {
            submissionPurpose.value = null;
        }
    }

    /** Call only after a committed feature-route/actor change. A canceled route
     * retains both its draft and any pending/unknown command protection. */
    function reset(): void {
        command.acknowledge();
        submitted.value = false;
        submissionAdmissionError.value = null;
        submissionAdmittedAt.value = undefined;
    }

    return {command, destination, blocked,
        submissionAdmissionError, submissionAdmittedAt, submissionRetryAt,
        submissionRetryAction, createAction, retrySubmissionAdmission, submit, reset};
}
