import {randomUUID} from 'node:crypto';
import path from 'node:path';

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
        proofPath: path.join(process.cwd(), 'uploads', 'invoices', `integration-${randomUUID()}.pdf`),
        proofOriginalName: 'groceries.pdf',
        proofMimeType: 'application/pdf',
        ...overrides,
    };
}
