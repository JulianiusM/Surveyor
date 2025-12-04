/**
 * Packing list creation functionality
 * Handles dynamic item row management and form submission
 */

import {setCurrentNavLocation} from './core/navigation';
import {loadPerms} from './core/permissions';
import type {PackingItem} from "../../modules/database/entities/packing/PackingItem";

/**
 * Create a table cell with given content
 * @param child Child element to append
 * @returns HTMLTableCellElement
 */
function buildCell(child: HTMLElement): HTMLTableCellElement {
    const td = document.createElement('td');
    td.appendChild(child);
    return td;
}

/**
 * Create input element for item title
 * @param rowIdx Row index for name attribute
 * @param value Initial value
 * @returns HTMLInputElement
 */
function createTitleInput(rowIdx: number, value: string = ''): HTMLInputElement {
    const input = document.createElement('input');
    input.className = 'form-control text-bg-dark';
    input.name = `t_${rowIdx}`;
    input.required = true;
    input.value = value;
    return input;
}

/**
 * Create input element for item description
 * @param rowIdx Row index for name attribute
 * @param value Initial value
 * @returns HTMLInputElement
 */
function createDescriptionInput(rowIdx: number, value: string = ''): HTMLInputElement {
    const input = document.createElement('input');
    input.className = 'form-control text-bg-dark';
    input.name = `d_${rowIdx}`;
    input.value = value;
    return input;
}

/**
 * Create input element for max assignees
 * @param rowIdx Row index for name attribute
 * @param value Initial value
 * @returns HTMLInputElement
 */
function createMaxAssigneesInput(rowIdx: number, value: number = 1): HTMLInputElement {
    const input = document.createElement('input');
    input.className = 'form-control text-bg-dark';
    input.type = 'number';
    input.min = '1';
    input.value = String(value);
    input.name = `m_${rowIdx}`;
    input.required = true;
    return input;
}

/**
 * Create "everyone brings" switch
 * @param rowIdx Row index for name attribute
 * @param checked Initial checked state
 * @returns HTMLDivElement containing switch
 */
function createEveryoneSwitch(rowIdx: number, checked: boolean = false): HTMLDivElement {
    const wrap = document.createElement('div');
    wrap.className = 'form-check form-switch d-inline-flex align-items-center me-3';

    const sw = document.createElement('input');
    sw.type = 'checkbox';
    sw.className = 'form-check-input';
    sw.name = `e_${rowIdx}`;
    sw.checked = checked;
    wrap.appendChild(sw);

    const lbl = document.createElement('span');
    lbl.className = 'ms-1 small';
    lbl.innerText = 'Everyone';
    wrap.appendChild(lbl);

    return wrap;
}

/**
 * Create remove button
 * @param row Row element to remove on click
 * @returns HTMLButtonElement
 */
function createRemoveButton(row: HTMLTableRowElement): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-sm btn-outline-danger';
    btn.innerHTML = '<i class="bi bi-x-lg"></i>';
    btn.addEventListener('click', () => row.remove());
    return btn;
}

/**
 * Create a new item row in the table
 * @param pref Prefilled item data (optional)
 * @param rowIdx Row index
 */
function createRow(pref: Partial<PackingItem> = {}, rowIdx: number = 0): void {
    const tableBody = document.getElementById('itemTable')!;
    const tr = document.createElement('tr');
    tr.dataset.idx = String(rowIdx);

    // Title input
    tr.appendChild(buildCell(createTitleInput(rowIdx, pref.title || '')));

    // Description input
    tr.appendChild(buildCell(createDescriptionInput(rowIdx, pref.description || '')));

    // Max assignees input
    const tdMax = buildCell(createMaxAssigneesInput(rowIdx, pref.maxAssignees || 1));
    tdMax.style.width = '110px';
    tr.appendChild(tdMax);

    // Action cell with switch and remove button
    const tdAct = document.createElement('td');
    tdAct.className = 'text-center';
    tdAct.appendChild(createEveryoneSwitch(rowIdx, !!pref.requiredByAll));
    tdAct.appendChild(createRemoveButton(tr));
    tr.appendChild(tdAct);

    tableBody.appendChild(tr);
}

function getPrefilledItems() {
    return window.Surveyor.prefilledItems
}

/**
 * Prefill rows from window data (duplicate mode)
 */
function prefillRows(): void {
    const items = getPrefilledItems();
    if (!items) return;

    items.forEach((it: Partial<PackingItem>, i: number) => createRow(it, i));
}

/**
 * Handle form submission - build JSON and submit
 * @param evt Submit event
 */
function handleSubmit(evt: Event): void {
    const form = document.getElementById('packingForm') as HTMLFormElement;
    const hiddenFld = document.getElementById('itemsJson') as HTMLInputElement;
    const tableBody = document.getElementById('itemTable');

    evt.preventDefault();

    const items: Partial<PackingItem>[] = [];

    tableBody?.querySelectorAll('tr').forEach(tr => {
        const titleInput = tr.querySelector<HTMLInputElement>('input[name^="t_"]');
        const descInput = tr.querySelector<HTMLInputElement>('input[name^="d_"]');
        const maxInput = tr.querySelector<HTMLInputElement>('input[name^="m_"]');
        const requiredInput = tr.querySelector<HTMLInputElement>('input[name^="e_"]');

        const tVal = titleInput?.value.trim();
        if (!tVal) return;

        items.push({
            title: tVal,
            description: descInput?.value.trim(),
            maxAssignees: Number.parseInt(maxInput?.value || "1"),
            requiredByAll: !!requiredInput?.checked
        });
    });

    hiddenFld.value = JSON.stringify(items);
    form.submit();
}

/**
 * Initialize event listeners
 */
function initListeners(): void {
    const addBtn = document.getElementById('addItemBtn')!;
    const form = document.getElementById('packingForm')!;

    addBtn.addEventListener('click', () => {
        const tableBody = document.getElementById('itemTable')!;
        const rowCount = tableBody.querySelectorAll('tr').length;
        createRow({}, rowCount);
    });

    form.addEventListener('submit', handleSubmit);
}

/**
 * Initialize packing list creation page
 */
export function init(): void {
    setCurrentNavLocation();
    loadPerms();
    initListeners();

    // Initial row or prefill
    if (getPrefilledItems()) {
        prefillRows();
    } else {
        createRow();
    }
}

// Expose to global scope
window.Surveyor.init = init;
