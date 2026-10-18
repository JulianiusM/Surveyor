import type {Ref} from 'vue';
import type {PilotActionState, PilotPlainMessageKey} from './FrontendPilotUiTypes';

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
    errorPresentation: Readonly<Ref<'flash' | 'inline'>>;
    feedbackKind: Readonly<Ref<'danger' | 'info' | 'success'>>;
    feedbackTarget: Readonly<Ref<HTMLElement | null>>;
    notice: Readonly<Ref<PilotPlainMessageKey | null>>;
    noticeKind: Readonly<Ref<'success' | 'warning'>>;
    transientNotice: Readonly<Ref<boolean>>;
    noticeInline: Readonly<Ref<boolean>>;
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

/** The same receipt can occupy separate native locations without changing its owner or lifetime. */
export interface CommandFeedbackProps {
    feedback: PilotCommandPresentation;
    part?: 'all' | 'error' | 'notice' | 'uncertain';
    inline?: boolean;
    /** Null retains the caller's local host; omission uses the captured receipt target. */
    target?: HTMLElement | null;
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
