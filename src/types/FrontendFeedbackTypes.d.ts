import type {Ref} from 'vue';
import type {PilotActionState, PilotPlainMessageKey} from './FrontendPilotUiTypes';

/** Feature-owned field identity for safe generated-input feedback. Draft values
 * and parser text are deliberately absent; collection positions identify controls. */
export interface PilotInputField {
    label: PilotPlainMessageKey;
    row?: {label: PilotPlainMessageKey; number: number; day?: string};
}

/** A notice presents an existing operation's action without owning its admission or retry policy. */
export interface PilotNoticeAction {
    /** Omitted when the existing action uses only shared initialization and its handler's guards. */
    state?: PilotActionState;
    label: string;
    /** Existing callers distinguish ordinary and compact notice buttons. */
    class?: string;
}

/** An existing error receipt may retain only the failed read's identity.
 * The query remains the owner of its data, freshness and retry deadline. */
export interface PilotReadFailureDescriptor {
    messageKey: PilotPlainMessageKey;
    readError: Error;
}

/** Mounted notice prop readers coordinate presentation only. They retain no
 * query state, request lifetime, submitted values or recovery callback. */
export interface PilotNoticePresentationSource {
    readError(): Error | null | undefined;
    common(): boolean;
    presented(): boolean;
    lastUpdatedAt(): number | undefined;
    retryAt(): number | undefined;
}

/** Read-only presentation of the command owner's existing receipts and status.
 * No draft, endpoint, mutation callback or authorization crosses this boundary. */
export interface PilotCommandPresentation {
    error: Readonly<Ref<string | null>>;
    transientError: Readonly<Ref<boolean>>;
    errorRenewal: Readonly<Ref<unknown>>;
    feedbackKind: Readonly<Ref<'danger' | 'info' | 'success'>>;
    notice: Readonly<Ref<PilotPlainMessageKey | null>>;
    noticeKind: Readonly<Ref<'success' | 'warning'>>;
    transientNotice: Readonly<Ref<boolean>>;
    noticeRenewal: Readonly<Ref<unknown>>;
    uncertain: Readonly<Ref<boolean>>;
    errorReadError: Readonly<Ref<Error | null>>;
    noticeReadError: Readonly<Ref<Error | null>>;
    /** Read recovery uses the same command owner and never repeats a write or
     * acknowledges an uncertain creation. Ordinary feature actions remain explicit. */
    readRecoveryAction: PilotActionState;
    reconcileRead(): Promise<boolean>;
    dismissError(): void;
    dismissNotice(): void;
}

/** Features retain whether an uncertain creation needs review, its wording and
 * the read action. Feedback shares only the repeated paragraph/button rendering;
 * an emitted review request never acknowledges or retries a command itself. */
export interface PilotCreationReviewPresentation {
    required: boolean;
    message: PilotPlainMessageKey;
    state: PilotActionState;
    paragraphClass?: string;
}

/** Shared presentation keeps transient notifications and durable recovery with one receipt owner. */
export interface CommandFeedbackProps {
    feedback: PilotCommandPresentation;
    part?: 'all' | 'error' | 'notice' | 'uncertain';
    disabled?: boolean;
    noMargin?: boolean;
    errorKind?: 'danger' | 'info' | 'success';
    noticeLastUpdatedAt?: number;
    noticeRetryAt?: number;
    noticeReadError?: Error | null;
    unknownMessage?: PilotPlainMessageKey;
    action?: PilotNoticeAction;
    creationReview?: PilotCreationReviewPresentation;
}
