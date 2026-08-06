import {InvoicePoolDistributions} from "../modules/database/entities/event/EventInvoicePool";

export type InvoicePoolStatus = 'OPEN' | 'CLOSED';

export type InvoicePoolDistribution = (typeof InvoicePoolDistributions)[number];