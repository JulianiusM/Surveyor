import type {components} from './api/v1';
import type {FrontendPlainMessageKey, FrontendRequestScope} from './FrontendUiTypes';
import type {Component} from 'vue';

/** One reviewed submission-access intent; later reads cannot retarget its command. */
export interface FinanceSubmissionAccessReview {
    readonly eventId: string;
    readonly poolId: string;
    readonly poolName: string;
    readonly status: 'OPEN' | 'ORGANIZER_ONLY';
    readonly expectedRevision: number;
    readonly scope: FrontendRequestScope;
}

/** Only the selected saved identity and visible operation context are retained. */
export interface FinanceAdjustmentRemovalReview {
    readonly eventId: string;
    readonly poolId: string;
    readonly adjustmentId: string;
    readonly name: string;
    readonly rebate: boolean;
    readonly scope: FrontendRequestScope;
}

/** Explicit admitted inputs shared by the invoice row and review dialog. */
export interface FinanceInvoiceReviewInput {
    eventId: string;
    invoice: components['schemas']['FinanceInvoice'];
    currentInvoice?: components['schemas']['FinanceInvoice'];
    pool: components['schemas']['FinancePool'];
    action: 'approve' | 'decline' | 'revise' | 'reject' | 'close';
    open: boolean;
    active: boolean;
    inline?: boolean;
    /** Own-history Close uses its existing participant operation only. */
    participant?: boolean;
    refresh: () => Promise<void>;
}

export interface FinanceInvoiceReviewCallbacks {
    close: () => void;
    saved: (notice: FrontendPlainMessageKey) => void;
}

/** The same feature owner is passed explicitly; neither renderer copies it. */
export type FinanceInvoiceReviewOwner = ReturnType<typeof import('../frontend/features/finance/invoiceReview').useFinanceInvoiceReview>;

export interface FinanceHistoryProps {
    invoices: components['schemas']['FinanceInvoice'][];
    admin?: boolean;
    disabled?: boolean;
    readOnly?: boolean;
    refreshing?: boolean;
    eventId?: string;
    pool?: components['schemas']['FinancePool'];
    refreshSaved?: () => Promise<void>;
    /** The parent composes editable review; read-only evidence imports no dialog. */
    reviewComponent?: Component;
}

/** Row-owned review state passes through presentation without a second owner. */
export interface FinanceInvoiceReviewSlot {
    owner: FinanceInvoiceReviewOwner;
    open: boolean;
}

export interface FinanceInvoiceRowProps extends Omit<FinanceHistoryProps, 'invoices' | 'refreshing'> {
    invoice: components['schemas']['FinanceInvoice'];
    visible: boolean;
    recorderName: string;
}
