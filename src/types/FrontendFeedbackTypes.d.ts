import type {Ref} from 'vue';
import type {PilotActionState, PilotPlainMessageKey} from './FrontendPilotUiTypes';

/** Feature-owned field identity for safe generated-input feedback. Draft values
 * and parser text are deliberately absent; collection positions identify controls. */
export interface PilotInputField {
    label: PilotPlainMessageKey;
    row?: {label: PilotPlainMessageKey; number: number; day?: string};
}

/** The generated schema owns these rules and their limits. Presentation only
 * retains enough metadata to explain a rejection across locale changes. */
export interface PilotInputDiagnostic {
    field: PilotInputField;
    rule: string;
    limit?: number;
    type?: string;
}

/** A notice presents an existing operation's action without owning its admission or retry policy. */
export interface PilotNoticeAction {
    /** Omitted when the existing action uses only shared initialization and its handler's guards. */
    state?: PilotActionState;
    label: string;
    /** Existing callers distinguish ordinary and compact notice buttons. */
    class?: string;
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
