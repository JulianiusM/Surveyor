import type {EntityManager} from 'typeorm';
import type {InvoiceProofFile} from '../backend/modules/database/entities/event/InvoiceProofFile';
import type {invoiceProofReconciliationActions} from '../backend/modules/invoice/requests';

/** Durable lifecycle state is independent of invoice cascades. */
export type InvoiceProofFileState = 'STAGED' | 'ATTACHED' | 'DELETING' | 'QUARANTINING' | 'QUARANTINED' | 'RESTORING' | 'PRESERVED';

/** Business decisions execute while the DBAL retains this proof's row lock. */
export type InvoiceProofOperation<Result> = (manager: EntityManager, row: InvoiceProofFile | null) => Promise<Result>;

/** An explicitly selected inventory identifies bytes, target and database without credentials. */
export interface InvoiceProofReconciliationEntry {
    path: string;
    size: number;
    mtimeMs: number;
    device: string;
    inode: string;
    sha256: string;
}

export interface InvoiceProofReconciliationManifest {
    version: 1;
    id: string;
    createdAt: string;
    root: string;
    database: string;
    recoveryDays: number;
    files: InvoiceProofReconciliationEntry[];
    ignored: string[];
}

export interface InvoiceProofReconciliationResult {
    processed: number;
    skipped: number;
}

export type InvoiceProofReconciliationAction = (typeof invoiceProofReconciliationActions)[number];
