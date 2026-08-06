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
