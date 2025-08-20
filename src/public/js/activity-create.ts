/*  Activity-Create – no jQuery  */
/* ─── utils ───────────────────────────────────────────────── */
import {setCurrentNavLocation} from "./module_functions";

const ONE_DAY = 24 * 3600 * 1000;

export function fmtISO(date: any) {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

export function toDate(val: any) {
    const [y, m, d] = val.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
}

const slotsMap = {};        // dateISO -> array of slot objects

export function updateSlotObj(dateISO: any, obj: any) {

    // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
    let arr = slotsMap[dateISO] ||= [];
    let curr = arr.findIndex((v: any) => v.id === obj.id);
    if (curr !== -1) {
        arr[curr] = obj;
        return;
    }
    arr.push(obj);

    // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
    slotsMap[dateISO].sort((a: any, b: any) => a.position - b.position);
}

export function getSlotObj(dateISO: any, id: any) {

    // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
    return (slotsMap[dateISO] || []).find((v: any) => v.id === id);
}

export function reIndexDay(dateISO: any) {

    // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
    (slotsMap[dateISO] || []).forEach((s: any, i: any) => {
        s.position = i
        updateSlotObj(dateISO, s);
    });

    // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
    slotsMap[dateISO].sort((a: any, b: any) => a.position - b.position);
}

/* ─── build slot table(s) ─────────────────────────────────── */
export function buildTables(dStart: any, dEnd: any) {
    const slotArea = document.getElementById('slotArea');

    // @ts-expect-error TS(2531): Object is possibly 'null'.
    slotArea.innerHTML = '';           // UI reset, Map bleibt!
    let weekStart = new Date(dStart);
    weekStart.setDate(weekStart.getDate() - (weekStart.getDay() || 7) + 1); // monday

    while (weekStart <= dEnd) {
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);            // sunday
        const tbl = createWeekTable(weekStart, weekEnd, dStart, dEnd);

        // @ts-expect-error TS(2531): Object is possibly 'null'.
        slotArea.appendChild(tbl);
        weekStart.setDate(weekStart.getDate() + 7);
    }
}

/* ---------- Slot-Row-Factory ----------------------------------- */

/* ───── slot-row factory incl. delete button ───────────────────── */

/* ===== 1. Slot-Row-Factory  ====================================== */
export function buildSlotRow(dateISO: any, pos: any, infoClb: any, pref = {}) {

    // @ts-expect-error TS(2339): Property 'id' does not exist on type '{}'.
    const id = pref.id || crypto.randomUUID();              // robuste ID

    const rowObj = {
        id,

        // @ts-expect-error TS(2339): Property 'position' does not exist on type '{}'.
        position: pos || pref.position || 0,
        date: dateISO,

        // @ts-expect-error TS(2339): Property 'title' does not exist on type '{}'.
        title: pref.title || '',

        // @ts-expect-error TS(2339): Property 'description' does not exist on type '{}'... Remove this comment to see the full error message
        description: pref.description || '',

        // @ts-expect-error TS(2339): Property 'maxAssignees' does not exist on type '{}... Remove this comment to see the full error message
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

            // @ts-expect-error TS(2339): Property 'title' does not exist on type '{}'.
            placeholder: 'Title', required: true, value: pref.title || ''
        });

    const desc = Object.assign(
        document.createElement('input'),
        {
            className: 'form-control form-control-sm text-bg-dark',

            // @ts-expect-error TS(2339): Property 'description' does not exist on type '{}'... Remove this comment to see the full error message
            placeholder: 'Description', value: pref.description || ''
        });

    const max = Object.assign(
        document.createElement('input'),
        {

            // @ts-expect-error TS(2339): Property 'maxAssignees' does not exist on type '{}... Remove this comment to see the full error message
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
        let obj = getSlotObj(dateISO, id);
        obj.title = title.value.trim();
        updateSlotObj(dateISO, obj);
    });
    desc.addEventListener('input', () => {
        let obj = getSlotObj(dateISO, id);
        obj.description = desc.value.trim();
        updateSlotObj(dateISO, obj);
    });
    max.addEventListener('change', () => {
        let obj = getSlotObj(dateISO, id);
        obj.maxAssignees = max.value;
        updateSlotObj(dateISO, obj);
    });

    delBtn.addEventListener('click', () => {
        wrap.remove();

        // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
        slotsMap[dateISO] = slotsMap[dateISO].filter((s: any) => s.id !== id);
        reIndexDay(dateISO);
        infoClb();
    });

    wrap.append(title, desc, max, delBtn);
    return wrap;
}

/* ----------  Day-Cell ------------------------------------------ */
export function buildDayCell(slotDate: any, prefSlot: any /* or undefined */) {
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

    // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
    (slotsMap[dateISO] || []).forEach((obj: any) => container.appendChild(buildSlotRow(dateISO, obj.position, infoClb, obj)));

    infoClb();

    // add-more button
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn btn-sm btn-outline-info w-100 add-slot';
    addBtn.textContent = '+ Slot';
    addBtn.addEventListener('click', () => {

        // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
        const pos = (slotsMap[dateISO] || []).length;   // next index
        container.appendChild(buildSlotRow(dateISO, pos, infoClb));
        infoClb();
    });
    cell.appendChild(addBtn);

    return cell;
}

/* ---------- Week-Table builder (replace old cell part) --------- */
export function createWeekTable(monday: any, sunday: any, start: any, end: any) {
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


    // @ts-expect-error TS(2554): Expected 2 arguments, but got 1.
    validDays.forEach(date => row.appendChild(buildDayCell(date)));

    const wrapper = document.createElement('div');
    wrapper.className = 'table-responsive mb-4';
    wrapper.appendChild(tbl);
    return wrapper;
}

/* ─── auto-end-date & table generation ───────────────────── */
export function maybeGenerate() {
    const startInp = document.getElementById('start');
    const endInp = document.getElementById('end');

    // @ts-expect-error TS(2531): Object is possibly 'null'.
    const sVal = startInp.value;

    // @ts-expect-error TS(2531): Object is possibly 'null'.
    const eVal = endInp.value;
    if (!sVal) return;

    if (!eVal) {

        // @ts-expect-error TS(2531): Object is possibly 'null'.
        endInp.value = sVal;
    }

    // @ts-expect-error TS(2531): Object is possibly 'null'.
    if (!endInp.value) return;


    // @ts-expect-error TS(2531): Object is possibly 'null'.
    const dStart = toDate(startInp.value);

    // @ts-expect-error TS(2531): Object is possibly 'null'.
    const dEnd = toDate(endInp.value);
    if (dEnd < dStart) {

        // @ts-expect-error TS(2531): Object is possibly 'null'.
        endInp.setCustomValidity('End before start');
        return;
    }

    // @ts-expect-error TS(2531): Object is possibly 'null'.
    endInp.setCustomValidity('');
    buildTables(dStart, dEnd);
}

export function initListeners() {
    const startInp = document.getElementById('start');
    const endInp = document.getElementById('end');


    // @ts-expect-error TS(2531): Object is possibly 'null'.
    startInp.addEventListener('change', maybeGenerate);

    // @ts-expect-error TS(2531): Object is possibly 'null'.
    endInp.addEventListener('change', maybeGenerate);
}

export function initSubmitHandler() {
    const form = document.getElementById('planForm');
    const hidden = document.getElementById('slotsJson');
    const startInp = document.getElementById('start');
    const endInp = document.getElementById('end');

    /* ─── submit → build JSON ----------------------------------- */

    // @ts-expect-error TS(2531): Object is possibly 'null'.
    form.addEventListener('submit', e => {
        e.preventDefault();
        const payload = {};

        // @ts-expect-error TS(2531): Object is possibly 'null'.
        const startD = toDate(startInp.value);

        // @ts-expect-error TS(2531): Object is possibly 'null'.
        const endD = toDate(endInp.value);

        for (const [date, arr] of Object.entries(slotsMap)) {
            const cur = toDate(date);
            if (cur < startD || cur > endD) continue;        // auslassen

            // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
            payload[date] = arr;
        }

        // @ts-expect-error TS(2531): Object is possibly 'null'.
        hidden.value = JSON.stringify(payload);

        // @ts-expect-error TS(2531): Object is possibly 'null'.
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

        // @ts-expect-error TS(2531): Object is possibly 'null'.
        e.dataTransfer.effectAllowed = 'move';
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
        const firstSlot = cont.querySelector('.slot');
        if (!firstSlot) return;

        const dateISO = firstSlot.dataset.slotDate;

        // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
        const dayArr = slotsMap[dateISO] || [];

        // neue Reihenfolge anhand data-slotId
        Array.from(cont.querySelectorAll('.slot')).forEach((el, i) => {

            // @ts-expect-error TS(2571): Object is of type 'unknown'.
            const obj = dayArr.find((s: any) => s.id === el.dataset.slotId);
            if (obj) obj.position = i;
        });

        // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
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
window.Surveyor = {
    init
};
