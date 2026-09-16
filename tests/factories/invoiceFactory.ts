import {randomUUID} from 'node:crypto';
import path from 'node:path';
import settings from '../../src/modules/settings';

export interface InvoiceSubmissionCase {
    amount: number;
    description: string;
    proofPath: string;
    proofOriginalName: string;
    proofMimeType: string;
}

export function createInvoiceSubmissionCase(overrides: Partial<InvoiceSubmissionCase> = {}): InvoiceSubmissionCase {
    return {
        amount: 48.75,
        description: 'Shared groceries',
        // Retention validates this same configured boundary before removing a proof.
        proofPath: path.resolve(process.cwd(), settings.value.invoiceDir, `integration-${randomUUID()}.pdf`),
        proofOriginalName: 'groceries.pdf',
        proofMimeType: 'application/pdf',
        ...overrides,
    };
}
