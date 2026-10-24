import type {components} from './api/v1';
import type {PilotPlainMessageKey} from './FrontendPilotUiTypes';

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
    saved: (notice: PilotPlainMessageKey) => void;
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
}

export interface FinanceInvoiceRowProps extends Omit<FinanceHistoryProps, 'invoices' | 'refreshing'> {
    invoice: components['schemas']['FinanceInvoice'];
    visible: boolean;
    recorderName: string;
}
