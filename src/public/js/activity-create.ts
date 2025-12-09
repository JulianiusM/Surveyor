/**
 * Activity plan creation functionality
 * Handles dynamic slot management with drag-and-drop reordering
 * 
 * Architecture: Uses layered approach with separation of concerns
 * - State layer: ActivityCreateState
 * - Logic layer: ActivityCreateLogic
 */

import {setCurrentNavLocation} from './core/navigation';
import {loadPerms} from './core/permissions';
import type {ActivitySlot} from "../../modules/database/entities/activity/ActivitySlot";
import {formatISODate as fmtISO, getValidDaysInWeek, parseISODate as toDate} from './core/formatting';
import {ActivityCreateState} from './modules/activity-create-state';
import {ActivityCreateLogic} from './modules/activity-create-logic';

// Module-level instances
let state: ActivityCreateState | null = null;
let logic: ActivityCreateLogic | null = null;

/**
 * Initialize state and logic layers
 */
function ensureInitialized(): void {
    if (!state) {
        state = new ActivityCreateState();
        logic = new ActivityCreateLogic(state);
    }
}

/**
 * Clear module state - used for testing
 */
export function clearState(): void {
    if (state) {
        state.reset();
    }
    state = null;
    logic = null;
}

function getPrefilledSlots() {
    return window.Surveyor.prefilledSlots
}

/**
 * Update or add slot object in the map
 * @param dateISO Date in ISO format
 * @param obj Slot object to update/add
 */
export function updateSlotObj(dateISO: string, obj: Partial<ActivitySlot>): void {
    ensureInitialized();
    logic!.upsertSlot(dateISO, obj);
}

/**
 * Get slot object by ID and date
 * @param dateISO Date in ISO format
 * @param id Slot ID
 * @returns Slot object or undefined
 */
export function getSlotObj(dateISO: string, id: string): Partial<ActivitySlot> | undefined {
    ensureInitialized();
    return state!.getSlot(dateISO, id);
}

/**
 * Re-index all slots for a given day
 * @param dateISO Date in ISO format
 */
export function reIndexDay(dateISO: string): void {
    ensureInitialized();
    logic!.reIndexDate(dateISO);
}

/**
 * Build slot row/card element
 * @param dateISO Date in ISO format
 * @param pos Position index
 * @param infoClb Callback to update info display
 * @param pref Prefilled slot data
 * @returns HTMLDivElement
 */
export function buildSlotRow(
    dateISO: string,
    pos: number,
    infoClb: () => void,
    pref: Partial<ActivitySlot> = {}
): HTMLDivElement {
    ensureInitialized();
    
    const rowObj = logic!.createSlot(dateISO, pos, pref);
    const id = rowObj.id!;
    updateSlotObj(dateISO, rowObj);

    /* DOM - flexible card */
    const wrap = document.createElement('div');
    wrap.className = 'd-grid gap-1 mb-2 slot border border-secondary-subtle rounded p-2';
    wrap.dataset.slotDate = dateISO;
    wrap.dataset.slotId = id;
    wrap.draggable = false;

    const title = Object.assign(document.createElement('input'), {
        className: 'form-control form-control-sm text-bg-dark',
        placeholder: 'Title',
        required: true,
        value: pref.title || ''
    });

    const desc = Object.assign(document.createElement('input'), {
        className: 'form-control form-control-sm text-bg-dark',
        placeholder: 'Description',
        value: pref.description || ''
    });

    const startTime = Object.assign(document.createElement('input'), {
        type: 'time',
        className: 'form-control form-control-sm text-bg-dark',
        placeholder: 'Start time',
        value: (pref.startTime || '').slice(0, 5),
    });

    const endTime = Object.assign(document.createElement('input'), {
        type: 'time',
        className: 'form-control form-control-sm text-bg-dark',
        placeholder: 'End time',
        value: (pref.endTime || '').slice(0, 5),
    });

    const max = Object.assign(document.createElement('input'), {
        type: 'number',
        min: '1',
        value: String(pref.maxAssignees || 1),
        className: 'form-control form-control-sm text-bg-dark'
    });

    /* Delete button */
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn btn-sm btn-outline-danger align-self-end';
    delBtn.innerHTML = '<i class="bi bi-x-lg"></i>';

    /* Sync handlers for input changes */
    title.addEventListener('input', () => {
        let obj = getSlotObj(dateISO, id)!;
        obj.title = title.value.trim();
        updateSlotObj(dateISO, obj);
    });
    desc.addEventListener('input', () => {
        let obj = getSlotObj(dateISO, id)!;
        obj.description = desc.value.trim();
        updateSlotObj(dateISO, obj);
    });
    startTime.addEventListener('change', () => {
        let obj = getSlotObj(dateISO, id)!;
        obj.startTime = startTime.value ? `${startTime.value}:00` : null;
        updateSlotObj(dateISO, obj);
    });
    endTime.addEventListener('change', () => {
        let obj = getSlotObj(dateISO, id)!;
        obj.endTime = endTime.value ? `${endTime.value}:00` : null;
        updateSlotObj(dateISO, obj);
    });
    max.addEventListener('change', () => {
        let obj = getSlotObj(dateISO, id)!;
        obj.maxAssignees = parseInt(max.value);
        updateSlotObj(dateISO, obj);
    });

    delBtn.addEventListener('click', () => {
        wrap.remove();
        logic!.deleteSlot(dateISO, rowObj.id!);
        infoClb();
    });

    wrap.append(title, desc, startTime, endTime, max, delBtn);
    return wrap;
}

/**
 * Build day cell with slot container
 * @param slotDate Date for this cell
 * @returns HTMLTableCellElement
 */
export function buildDayCell(slotDate: Date): HTMLTableCellElement {
    const dateISO = fmtISO(slotDate);
    const cell = document.createElement('td');

    // Container for multiple slots
    const container = document.createElement('div');
    container.className = 'slot-container';
    cell.appendChild(container);

    const info = document.createElement('span');
    info.className = 'badge w-100 text-center mb-2';
    info.innerHTML = '<i class="bi bi-info-circle me-2"></i> No slots for this day!';
    container.appendChild(info);

    function infoClb() {
        info.style.display = container.children.length === 1 ? 'block' : 'none';
    }

    // Render existing slots
    ensureInitialized();
    state!.getSlotsByDate(dateISO).forEach((obj, i) =>
        container.appendChild(buildSlotRow(dateISO, obj.pos || i, infoClb, obj))
    );

    infoClb();

    // Add-more button
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn btn-sm btn-outline-info w-100 add-slot';
    addBtn.textContent = '+ Slot';
    addBtn.addEventListener('click', () => {
        const pos = logic!.getSlotCount(dateISO);
        container.appendChild(buildSlotRow(dateISO, pos, infoClb));
        infoClb();
    });
    cell.appendChild(addBtn);

    return cell;
}

/**
 * Create week table for calendar view
 * @param monday Monday of the week
 * @param start Plan start date
 * @param end Plan end date
 * @returns HTMLDivElement containing table
 */
export function createWeekTable(monday: Date, start: Date, end: Date): HTMLDivElement {
    const tbl = document.createElement('table');
    tbl.className = 'table table-dark table-bordered align-middle activity-table';

    const thead = tbl.createTHead();
    const hRow = thead.insertRow();

    // Only render days in valid range
    const validDays = getValidDaysInWeek(monday, start, end);

    validDays.forEach(date => {
        const th = document.createElement('th');
        th.className = 'text-center small';
        th.innerHTML = `${date.toLocaleDateString(undefined, {weekday: 'short'})}<br>${date.toLocaleDateString()}`;
        hRow.appendChild(th);
    });

    const tbody = tbl.createTBody();
    const row = tbody.insertRow();

    validDays.forEach(date => row.appendChild(buildDayCell(date)));

    const wrapper = document.createElement('div');
    wrapper.className = 'table-responsive mb-4';
    wrapper.appendChild(tbl);
    return wrapper;
}

/**
 * Build all slot tables for the date range
 * @param dStart Start date
 * @param dEnd End date
 */
export function buildTables(dStart: Date, dEnd: Date): void {
    const slotArea = document.getElementById('slotArea');
    if (!slotArea) return;
    slotArea.innerHTML = '';

    let weekStart = new Date(dStart);
    weekStart.setDate(weekStart.getDate() - (weekStart.getDay() || 7) + 1); // Monday

    while (weekStart <= dEnd) {
        const tbl = createWeekTable(weekStart, dStart, dEnd);
        slotArea.appendChild(tbl);
        weekStart.setDate(weekStart.getDate() + 7);
    }
}

/**
 * Auto-end-date & table generation on date change
 */
export function maybeGenerate(): void {
    const startInp = document.getElementById('startDate')! as HTMLInputElement;
    const endInp = document.getElementById('endDate')! as HTMLInputElement;

    const sVal = startInp.value;
    const eVal = endInp.value;
    if (!sVal) return;

    if (!eVal) {
        endInp.value = sVal;
    }

    if (!endInp.value) return;

    const dStart = toDate(startInp.value);
    const dEnd = toDate(endInp.value);
    if (dEnd < dStart) {
        endInp.setCustomValidity('End before start');
        return;
    }
    endInp.setCustomValidity('');
    buildTables(dStart, dEnd);
}

/**
 * Initialize date input listeners
 */
export function initListeners(): void {
    const startInp = document.getElementById('startDate')!;
    const endInp = document.getElementById('endDate')!;

    startInp.addEventListener('change', maybeGenerate);
    endInp.addEventListener('change', maybeGenerate);
}

/**
 * Initialize form submit handler
 */
export function initSubmitHandler(): void {
    const form = document.getElementById('planForm')! as HTMLFormElement;
    const hidden = document.getElementById('slotsJson')! as HTMLInputElement;
    const startInp = document.getElementById('startDate')! as HTMLInputElement;
    const endInp = document.getElementById('endDate')! as HTMLInputElement;

    form.addEventListener('submit', (e: Event) => {
        e.preventDefault();
        ensureInitialized();
        
        const startD = toDate(startInp.value);
        const endD = toDate(endInp.value);
        const payload = logic!.preparePayload(startD, endD);

        hidden.value = JSON.stringify(payload);
        form.submit();
    });
}

/**
 * Initialize drag-and-drop ordering (commented out by default)
 */
export function initSlotDnD(): void {
    let dragSrc: HTMLElement | null = null;

    document.addEventListener('dragstart', (e: Event) => {
        const target = e.target as Element | null;
        if (target?.closest('button') || target?.closest('input')) return;

        const slot = target?.closest('.slot');
        if (!slot) return;
        dragSrc = slot as HTMLElement;
        (e as DragEvent).dataTransfer!.effectAllowed = 'move';
    });

    document.addEventListener('dragover', (e: Event) => {
        const slot = (e.target as Element | null)?.closest('.slot');
        if (!slot || slot === dragSrc) return;
        const container = (slot as HTMLElement).parentElement;
        if (container !== dragSrc!.parentElement) return; // only same day
        e.preventDefault(); // allow drop
        const rect = (slot as HTMLElement).getBoundingClientRect();
        container!.insertBefore(
            dragSrc!,
            ((e as MouseEvent).clientY - rect.top) > rect.height / 2 ? (slot as HTMLElement).nextSibling : slot
        );
    });

    document.addEventListener('dragend', () => {
        if (!dragSrc) return;
        const cont = dragSrc.parentElement;
        const firstSlot = cont!.querySelector('.slot') as HTMLElement;
        if (!firstSlot) return;

        const dateISO = firstSlot.dataset.slotDate || '';
        ensureInitialized();
        const dayArr = state!.getSlotsByDate(dateISO);

        // New order based on data-slotId
        Array.from(cont!.querySelectorAll('.slot')).forEach((el, i) => {
            const slotId = (el as HTMLElement).dataset.slotId;
            const obj = dayArr.find((s: any) => s.id === slotId);
            if (obj) {
                obj.pos = i;
                updateSlotObj(dateISO, obj);
            }
        });
        reIndexDay(dateISO);
        dragSrc = null;
    });
}

/**
 * Initialize activity plan creation page
 */
export function init(): void {
    ensureInitialized();
    setCurrentNavLocation();
    loadPerms();
    initListeners();
    initSubmitHandler();
    // initSlotDnD(); // Uncomment to enable drag-and-drop

    const slots = getPrefilledSlots();
    if (slots) {
        logic!.initializeFromPrefilled(slots);
        maybeGenerate();
    }
}

// Expose to global scope
window.Surveyor.init = init;
