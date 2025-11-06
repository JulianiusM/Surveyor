/*  Packing-Create – Client-Logic (no jQuery)  */
import {setCurrentNavLocation} from "./module_functions";
import {PackingItem} from "../../modules/database/entities/packing/PackingItem";

export function buildCell(child: any) {
    const td = document.createElement('td');
    td.appendChild(child);
    return td;
}

/* ───── Row creation / removal ──────────────────────────── */
export function createRow(pref: Partial<PackingItem> = {}, rowIdx = 0) {
    const tableBody = document.getElementById('itemTable')!;
    const tr = document.createElement('tr');

    tr.dataset.idx = String(rowIdx);

    // title
    const tInput = document.createElement('input');
    tInput.className = 'form-control text-bg-dark';
    tInput.name = `t_${rowIdx}`;
    tInput.required = true;
    tInput.value = pref.title || '';
    tr.appendChild(buildCell(tInput));

    // description
    const dInput = document.createElement('input');
    dInput.className = 'form-control text-bg-dark';
    dInput.name = `d_${rowIdx}`;
    dInput.value = pref.description || '';
    tr.appendChild(buildCell(dInput));

    // maxAssignees
    const mInput = document.createElement('input');
    mInput.className = 'form-control text-bg-dark';
    mInput.type = 'number';
    mInput.min = '1';
    mInput.value = String(pref.maxAssignees || 1);
    mInput.name = `m_${rowIdx}`;
    mInput.required = true;
    const tdMax = buildCell(mInput);
    tdMax.style.width = '110px';
    tr.appendChild(tdMax);

    /* --- Action: Switch + Remove --------------------------------- */
    const tdAct = document.createElement('td');
    tdAct.className = 'text-center';

    // Bootstrap-Switch
    const wrap = document.createElement('div');
    wrap.className = 'form-check form-switch d-inline-flex align-items-center me-3';

    const sw = document.createElement('input');
    sw.type = 'checkbox';
    sw.className = 'form-check-input';
    sw.name = `e_${rowIdx}`;
    sw.checked = !!pref.requiredByAll;
    wrap.appendChild(sw);

    const lbl = document.createElement('span');
    lbl.className = 'ms-1 small';
    lbl.innerText = 'Everyone';
    wrap.appendChild(lbl);
    tdAct.appendChild(wrap);

    // action remove
    const rmBtn = document.createElement('button');
    rmBtn.type = 'button';
    rmBtn.className = 'btn btn-sm btn-outline-danger';
    rmBtn.innerHTML = '<i class="bi bi-x-lg"></i>';
    rmBtn.addEventListener('click', () => tr.remove());
    tdAct.appendChild(rmBtn);

    tr.appendChild(tdAct);

    tableBody.appendChild(tr);
}

/* ───── Prefill (duplicate-mode) ────────────────────────── */
export function prefillRows() {

    // @ts-expect-error TS(2339): Property 'PREFILLED_ITEMS' does not exist on type ... Remove this comment to see the full error message
    if (!window.PREFILLED_ITEMS) return;

    // @ts-expect-error TS(2339): Property 'PREFILLED_ITEMS' does not exist on type ... Remove this comment to see the full error message
    window.PREFILLED_ITEMS.forEach((it, i) => createRow(it, i));
}

/* ───── Build JSON & submit ─────────────────────────────── */
export function handleSubmit(evt: Event) {
    const form = document.getElementById('packingForm') as HTMLFormElement;
    const hiddenFld = document.getElementById('itemsJson') as HTMLInputElement;
    const tableBody = document.getElementById('itemTable');
    evt.preventDefault();
    const items: Partial<PackingItem>[] = [];

    tableBody?.querySelectorAll('tr').forEach(tr => {

        // @ts-expect-error TS(2531): Object is possibly 'null'.
        const tVal = tr.querySelector(`input[name^="t_"]`).value.trim();
        if (!tVal) return;
        items.push({
            title: tVal,

            // @ts-expect-error TS(2531): Object is possibly 'null'.
            description: tr.querySelector(`input[name^="d_"]`).value.trim(),

            // @ts-expect-error TS(2531): Object is possibly 'null'.
            maxAssignees: tr.querySelector(`input[name^="m_"]`).value,

            // @ts-expect-error TS(2531): Object is possibly 'null'.
            requiredByAll: tr.querySelector('input[name^="e_"]').checked
        });
    });

    hiddenFld.value = JSON.stringify(items);
    form.submit();
}

export function initListeners() {
    const addBtn = document.getElementById('addItemBtn')!;
    const form = document.getElementById('packingForm')!;

    addBtn.addEventListener('click', (e) => createRow());
    form.addEventListener('submit', handleSubmit);
}


export function init() {
    setCurrentNavLocation();
    initListeners();
    // Initial row (or prefill)

    // @ts-expect-error TS(2339): Property 'PREFILLED_ITEMS' does not exist on type ... Remove this comment to see the full error message
    if (window.PREFILLED_ITEMS)
        prefillRows();
    else
        createRow();
}

// Expose to global scope
window.Surveyor.init = init;