/**
 * Survey creation functionality
 * Handles dynamic combination row management
 */

import { setCurrentNavLocation } from '../core/navigation';

/**
 * Weekday options for survey combinations
 */
const WEEKDAYS = [
    ['Monday', 'MON'],
    ['Tuesday', 'TUE'],
    ['Wednesday', 'WED'],
    ['Thursday', 'THU'],
    ['Friday', 'FRI'],
    ['Saturday', 'SAT'],
    ['Sunday', 'SUN']
] as const;

/**
 * Week number options for survey combinations
 */
const WEEKS = ['1', '2', '3', '4', 'LAST'] as const;

/**
 * Create a select element for weekday selection
 * @param name Input name
 * @param selectedValue Selected value (optional)
 * @returns HTMLSelectElement
 */
function createWeekdaySelect(name: string, selectedValue?: string): HTMLSelectElement {
    const sel = document.createElement('select');
    sel.className = 'form-select text-bg-dark';
    sel.name = name;
    sel.required = true;
    
    WEEKDAYS.forEach(([label, val]) => {
        const opt = document.createElement('option');
        opt.value = val;
        opt.textContent = label;
        sel.appendChild(opt);
    });
    
    if (selectedValue) {
        sel.value = selectedValue;
    }
    
    return sel;
}

/**
 * Create a select element for week selection
 * @param name Input name
 * @param selectedValue Selected value (optional)
 * @returns HTMLSelectElement
 */
function createWeekSelect(name: string, selectedValue?: string): HTMLSelectElement {
    const sel = document.createElement('select');
    sel.className = 'form-select text-bg-dark';
    sel.name = name;
    sel.required = true;
    
    WEEKS.forEach(val => {
        const opt = document.createElement('option');
        opt.value = val;
        opt.textContent = val === 'LAST' ? 'Last' : val;
        sel.appendChild(opt);
    });
    
    if (selectedValue) {
        sel.value = selectedValue;
    }
    
    return sel;
}

/**
 * Create a remove button for combination row
 * @returns HTMLButtonElement
 */
function createRemoveButton(): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-danger btn-sm remove-combination-btn';
    btn.textContent = 'Remove';
    return btn;
}

/**
 * Add a combination row to the table
 * @param tableBody Table body element
 * @param counter Row ID counter
 * @param weekday Selected weekday (optional)
 * @param week Selected week (optional)
 */
function addCombinationRow(
    tableBody: HTMLTableSectionElement,
    counter: { value: number },
    weekday?: string,
    week?: string
): void {
    const id = counter.value++;
    const tr = document.createElement('tr');
    tr.id = `row-${id}`;

    // Weekday cell
    const tdDay = document.createElement('td');
    tdDay.appendChild(createWeekdaySelect(`combinations[${id}][weekday]`, weekday));

    // Week-of-month cell
    const tdWeek = document.createElement('td');
    tdWeek.appendChild(createWeekSelect(`combinations[${id}][week]`, week));

    // Remove-button cell
    const tdAction = document.createElement('td');
    tdAction.className = 'text-center';
    tdAction.appendChild(createRemoveButton());

    tr.appendChild(tdDay);
    tr.appendChild(tdWeek);
    tr.appendChild(tdAction);

    tableBody.appendChild(tr);
}

/**
 * Initialize combination row management
 */
function initButtons(): void {
    const tableBody = document.getElementById('combinationTable') as HTMLTableSectionElement;
    const addBtn = document.getElementById('addCombinationBtn');
    if (!tableBody || !addBtn) return;

    const counter = { value: 0 };

    // Prefill combinations if available
    // @ts-expect-error TS(2339): Property 'PREFILLED_COMBINATIONS' does not exist
    if (window.PREFILLED_COMBINATIONS) {
        // @ts-expect-error TS(2339): Property 'PREFILLED_COMBINATIONS' does not exist
        window.PREFILLED_COMBINATIONS.forEach((c: any) =>
            addCombinationRow(tableBody, counter, c.weekday, c.nth_week)
        );
    } else {
        // Add the first row
        addCombinationRow(tableBody, counter);
    }

    // Add new row on button click
    addBtn.addEventListener('click', () => addCombinationRow(tableBody, counter));

    // Delegate removal to tbody
    tableBody.addEventListener('click', (e: Event) => {
        // @ts-expect-error TS(2531): Object is possibly 'null'
        if (e.target.matches('.remove-combination-btn')) {
            // @ts-expect-error TS(2531): Object is possibly 'null'
            const row = e.target.closest('tr');
            if (row) row.remove();
        }
    });
}

/**
 * Initialize survey creation page
 */
export function init(): void {
    setCurrentNavLocation();
    initButtons();
}

// Expose to global scope
window.Surveyor.init = init;
