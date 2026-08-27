import type {DriversItem} from '../../src/modules/database/entities/drivers/DriversItem';
import type {PackingItem} from '../../src/modules/database/entities/packing/PackingItem';
import type {SurveyCombination} from '../../src/modules/database/entities/surveys/SurveyCombination';

export interface InputLike extends Pick<HTMLInputElement, 'value' | 'checked'> {}

export interface RowLike {
    querySelector<T>(selector: string): T | null;
}

export interface TableLike {
    querySelectorAll(selector: string): RowLike[];
}

export interface InvoiceLedgerControl {
    value: string;
    disabled: boolean;
    textContent: string;
    addEventListener(eventName: string, handler: EventListener): void;
    trigger(eventName: string): void;
}

export interface InvoiceLedgerRow {
    dataset: {invoiceSearch: string; invoiceStatus: string};
    hidden: boolean;
}

export interface InvoiceLedgerFixture {
    ledger: HTMLElement;
    rows: InvoiceLedgerRow[];
    search: InvoiceLedgerControl;
    status: InvoiceLedgerControl;
    pageSize: InvoiceLedgerControl;
    previous: InvoiceLedgerControl;
    next: InvoiceLedgerControl;
    summary: InvoiceLedgerControl;
    empty: InvoiceLedgerControl;
}

export function createInput(value: string, checked = false): InputLike {
    return {value, checked};
}

export function createItemTable(rows: Partial<PackingItem | DriversItem>[]): TableLike {
    return {
        querySelectorAll: () => rows.map((row) => ({
            querySelector: <T>(selector: string): T | null => {
                if (selector.includes('t_')) return createInput(row.title ?? '') as T;
                if (selector.includes('d_')) return createInput(row.description ?? '') as T;
                if (selector.includes('m_')) return createInput(String(row.maxAssignees ?? 1)) as T;
                if (selector.includes('e_')) return createInput('', 'requiredByAll' in row ? !!row.requiredByAll : false) as T;
                return null;
            },
        })),
    };
}

export function createSurveyTable(rows: Partial<SurveyCombination>[]): TableLike {
    return {
        querySelectorAll: () => rows.map((row) => ({
            querySelector: <T>(selector: string): T | null => {
                if (selector.includes('[weekday]')) return createInput(row.weekday ?? 'MON') as T;
                if (selector.includes('[week]')) return createInput(row.nthWeek ?? '1') as T;
                return null;
            },
        })),
    };
}

export function createInvoiceLedger(rowCount: number): InvoiceLedgerFixture {
    const createControl = (value = ''): InvoiceLedgerControl => {
        const listeners = new Map<string, EventListener>();
        return {
            value,
            disabled: false,
            textContent: '',
            addEventListener: (eventName, handler) => listeners.set(eventName, handler),
            trigger: (eventName) => listeners.get(eventName)?.({} as Event),
        };
    };
    const rows = Array.from({length: rowCount}, (_, index) => ({
        dataset: {
            invoiceSearch: `invoice ${index + 1}`,
            invoiceStatus: (index + 1) % 5 === 0 ? 'REJECTED' : 'APPROVED',
        },
        hidden: false,
    }));
    const search = createControl();
    const status = createControl();
    const pageSize = createControl('25');
    const previous = createControl();
    const next = createControl();
    const summary = createControl();
    const empty = createControl();
    const controls = new Map<string, InvoiceLedgerControl>([
        ['[data-invoice-search-input]', search],
        ['[data-invoice-status-filter]', status],
        ['[data-invoice-page-size]', pageSize],
        ['[data-invoice-page-previous]', previous],
        ['[data-invoice-page-next]', next],
        ['[data-invoice-page-summary]', summary],
        ['[data-invoice-empty]', empty],
    ]);
    const ledger = {
        querySelectorAll: () => rows,
        querySelector: (selector: string) => controls.get(selector) ?? null,
    } as unknown as HTMLElement;
    return {ledger, rows, search, status, pageSize, previous, next, summary, empty};
}
