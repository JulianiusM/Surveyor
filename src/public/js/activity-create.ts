/*  Activity-Create – no jQuery  */
/* ─── utils ───────────────────────────────────────────────── */
import {setCurrentNavLocation} from "./modules/module_functions";
import {ActivitySlot} from "../../modules/database/entities/activity/ActivitySlot";

const ONE_DAY = 24 * 3600 * 1000;

export function fmtISO(date: Date) {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

export function toDate(val: string) {
    const [y, m, d] = val.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
}

const slotsMap: Record<string, Partial<ActivitySlot>[]> = {};        // dateISO -> array of slot objects

const sortSlotFn = (a: Partial<ActivitySlot>, b: Partial<ActivitySlot>) => (a.pos || 0) - (b.pos || 0);

export function updateSlotObj(dateISO: string, obj: Partial<ActivitySlot>) {

    let arr = slotsMap[dateISO] || [];
    let curr = arr.findIndex((v) => v.id === obj.id);
    if (curr !== -1) {
        arr[curr] = obj;
        return;
    }
    arr.push(obj);
    slotsMap[dateISO] = arr.sort(sortSlotFn);
}

export function getSlotObj(dateISO: string, id: string) {
    return (slotsMap[dateISO] || []).find((v) => v.id === id);
}

export function reIndexDay(dateISO: string) {
    (slotsMap[dateISO] || []).forEach((s, i) => {
        s.pos = i
        updateSlotObj(dateISO, s);
    });
    slotsMap[dateISO].sort(sortSlotFn);
}

/* ─── build slot table(s) ─────────────────────────────────── */
export function buildTables(dStart: Date, dEnd: Date) {
    const slotArea = document.getElementById('slotArea');

    // @ts-expect-error TS(2531): Object is possibly 'null'.
    slotArea.innerHTML = '';           // UI reset, Map bleibt!
    let weekStart = new Date(dStart);
    weekStart.setDate(weekStart.getDate() - (weekStart.getDay() || 7) + 1); // monday

    while (weekStart <= dEnd) {
        const tbl = createWeekTable(weekStart, dStart, dEnd);

        // @ts-expect-error TS(2531): Object is possibly 'null'.
        slotArea.appendChild(tbl);
        weekStart.setDate(weekStart.getDate() + 7);
    }
}

/* ---------- Slot-Row-Factory ----------------------------------- */

/* ───── slot-row factory incl. delete button ───────────────────── */

/* ===== 1. Slot-Row-Factory  ====================================== */
export function buildSlotRow(dateISO: string, pos: number, infoClb: () => void, pref: Partial<ActivitySlot> = {}) {

    const id = pref.id || crypto.randomUUID();              // robuste ID

    const rowObj: Partial<ActivitySlot> = {
        id,
        pos: pos || pref.pos || 0,
        day: dateISO,
        title: pref.title || '',
        description: pref.description || '',
        maxAssignees: pref.maxAssignees || 1
    };
    updateSlotObj(dateISO, rowObj);                            // → slotsMap

    /* DOM — flexibles „Kärtchen“ */
    const wrap = document.createElement('div');
    wrap.className = 'd-grid gap-1 mb-2 slot border border-secondary-subtle rounded p-2';
    wrap.dataset.slotDate = dateISO;
    wrap.dataset.slotId = id;                             //  ← wichtig
    wrap.draggable = false; //true;

    const title = Object.assign(
        document.createElement('input'),
        {
            className: 'form-control form-control-sm text-bg-dark',
            placeholder: 'Title', required: true, value: pref.title || ''
        });

    const desc = Object.assign(
        document.createElement('input'),
        {
            className: 'form-control form-control-sm text-bg-dark',
            placeholder: 'Description', value: pref.description || ''
        });

    const max = Object.assign(
        document.createElement('input'),
        {
            type: 'number', min: '1', value: pref.maxAssignees || 1,
            className: 'form-control form-control-sm text-bg-dark'
        });

    /* — delete button — */
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn btn-sm btn-outline-danger align-self-end';
    delBtn.innerHTML = '<i class="bi bi-x-lg"></i>';

    /* Sync-Handler bei Eingaben */
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
    max.addEventListener('change', () => {
        let obj = getSlotObj(dateISO, id)!;
        obj.maxAssignees = max.value;
        updateSlotObj(dateISO, obj);
    });

    delBtn.addEventListener('click', () => {
        wrap.remove();
        slotsMap[dateISO] = slotsMap[dateISO].filter((s: any) => s.id !== id);
        reIndexDay(dateISO);
        infoClb();
    });

    wrap.append(title, desc, max, delBtn);
    return wrap;
}

/* ----------  Day-Cell ------------------------------------------ */
export function buildDayCell(slotDate: Date) {
    const dateISO = fmtISO(slotDate);
    const cell = document.createElement('td');

    // container for multiple slots
    const container = document.createElement('div');
    container.className = 'slot-container';
    cell.appendChild(container);

    const info = document.createElement('span')
    info.className = 'badge w-100 text-center mb-2'
    info.innerHTML = '<i class="bi bi-info-circle me-2"></i> No slots for this day!';
    container.appendChild(info);

    function infoClb() {
        if (container.children.length === 1) {
            info.style.display = 'block';
        } else {
            info.style.display = 'none';
        }
    }

    // Vorhandene Slots rendern
    (slotsMap[dateISO] || []).forEach((obj, i) => container.appendChild(buildSlotRow(dateISO, obj.pos || i, infoClb, obj)));

    infoClb();

    // add-more button
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn btn-sm btn-outline-info w-100 add-slot';
    addBtn.textContent = '+ Slot';
    addBtn.addEventListener('click', () => {
        const pos = (slotsMap[dateISO] || []).length;   // next index
        container.appendChild(buildSlotRow(dateISO, pos, infoClb));
        infoClb();
    });
    cell.appendChild(addBtn);

    return cell;
}

/* ---------- Week-Table builder (replace old cell part) --------- */
export function createWeekTable(monday: any, start: any, end: any) {
    const tbl = document.createElement('table');
    tbl.className = 'table table-dark table-bordered align-middle activity-table';

    const thead = tbl.createTHead();
    const hRow = thead.insertRow();

    // Nur Tage im gültigen Bereich rendern
    const validDays = [];
    for (let d = 0; d < 7; d++) {
        const cur = new Date(monday);
        cur.setDate(cur.getDate() + d);
        if (cur < start || cur > end) continue;
        validDays.push(cur);           // sammeln
    }

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

/* ─── auto-end-date & table generation ───────────────────── */
export function maybeGenerate() {
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

export function initListeners() {
    const startInp = document.getElementById('startDate')!;
    const endInp = document.getElementById('endDate')!;

    startInp.addEventListener('change', maybeGenerate);
    endInp.addEventListener('change', maybeGenerate);
}

export function initSubmitHandler() {
    const form = document.getElementById('planForm')! as HTMLFormElement;
    const hidden = document.getElementById('slotsJson')! as HTMLInputElement;
    const startInp = document.getElementById('startDate')! as HTMLInputElement;
    const endInp = document.getElementById('endDate')! as HTMLInputElement;

    /* ─── submit → build JSON ----------------------------------- */
    form.addEventListener('submit', e => {
        e.preventDefault();
        const payload: Record<string, Partial<ActivitySlot>[]> = {};
        const startD = toDate(startInp.value);
        const endD = toDate(endInp.value);

        for (const [date, arr] of Object.entries(slotsMap)) {
            const cur = toDate(date);
            if (cur < startD || cur > endD) continue;        // auslassen
            payload[date] = arr;
        }

        hidden.value = JSON.stringify(payload);
        form.submit();
    });
}

/* ========  DRAG-&-DROP ORDERING  ================================= */
export function initSlotDnD() {
    let dragSrc: any = null;

    document.addEventListener('dragstart', e => {

        // @ts-expect-error TS(2531): Object is possibly 'null'.
        if (e.target.closest('button') || e.target.closest('input')) return;

        // @ts-expect-error TS(2531): Object is possibly 'null'.
        const slot = e.target.closest('.slot');
        if (!slot) return;
        dragSrc = slot;
        e.dataTransfer!.effectAllowed = 'move';
    });

    document.addEventListener('dragover', e => {

        // @ts-expect-error TS(2531): Object is possibly 'null'.
        const slot = e.target.closest('.slot');
        if (!slot || slot === dragSrc) return;
        const container = slot.parentElement;
        if (container !== dragSrc.parentElement) return; // only same day
        e.preventDefault();                               // allow drop
        const rect = slot.getBoundingClientRect();
        container.insertBefore(
            dragSrc,
            (e.clientY - rect.top) > rect.height / 2 ? slot.nextSibling : slot
        );
    });

    document.addEventListener('dragend', () => {
        if (!dragSrc) return;
        const cont = dragSrc.parentElement;
        const firstSlot = cont.querySelector('.slot') as HTMLElement;
        if (!firstSlot) return;

        const dateISO = firstSlot.dataset.slotDate || '';
        const dayArr = slotsMap[dateISO] || [];

        // neue Reihenfolge anhand data-slotId
        Array.from(cont.querySelectorAll('.slot') as HTMLElement[]).forEach((el, i) => {
            const obj = dayArr.find((s: any) => s.id === el.dataset.slotId);
            if (obj) obj.pos = i;
        });
        slotsMap[dateISO] = dayArr;

        reIndexDay(dateISO);

        dragSrc = null;
    });
}

export function init() {
    setCurrentNavLocation()
    initListeners();
    initSubmitHandler();
    //initSlotDnD();


    // @ts-expect-error TS(2339): Property 'PREFILLED_SLOTS' does not exist on type ... Remove this comment to see the full error message
    if (window.PREFILLED_SLOTS) {

        // @ts-expect-error TS(2339): Property 'PREFILLED_SLOTS' does not exist on type ... Remove this comment to see the full error message
        Object.assign(slotsMap, window.PREFILLED_SLOTS);
        maybeGenerate();
    }
}

// Expose to global scope
window.Surveyor.init = init;
