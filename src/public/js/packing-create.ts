/*  Packing-Create – Client-Logic (no jQuery)  */
import {setCurrentNavLocation} from "./module_functions";

export function buildCell(child: any) {
    const td = document.createElement('td');
    td.appendChild(child);
    return td;
}

/* ───── Row creation / removal ──────────────────────────── */
export function createRow(pref = {}, rowIdx = 0) {
    const tableBody = document.getElementById('itemTable');
    const tr = document.createElement('tr');

    // @ts-expect-error TS(2322): Type 'number' is not assignable to type 'string'.
    tr.dataset.idx = rowIdx;

    // title
    const tInput = document.createElement('input');
    tInput.className = 'form-control text-bg-dark';
    tInput.name = `t_${rowIdx}`;
    tInput.required = true;

    // @ts-expect-error TS(2339): Property 'title' does not exist on type '{}'.
    tInput.value = pref.title || '';
    tr.appendChild(buildCell(tInput));

    // description
    const dInput = document.createElement('input');
    dInput.className = 'form-control text-bg-dark';
    dInput.name = `d_${rowIdx}`;

    // @ts-expect-error TS(2339): Property 'description' does not exist on type '{}'... Remove this comment to see the full error message
    dInput.value = pref.description || '';
    tr.appendChild(buildCell(dInput));

    // maxAssignees
    const mInput = document.createElement('input');
    mInput.className = 'form-control text-bg-dark';
    mInput.type = 'number';
    mInput.min = '1';

    // @ts-expect-error TS(2339): Property 'max_assignees' does not exist on type '{... Remove this comment to see the full error message
    mInput.value = pref.max_assignees || 1;
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
    wrap.className = 'form-check form-switch d-inline-flex align-items-center me-2';
    const sw = document.createElement('input');
    sw.type = 'checkbox';
    sw.className = 'form-check-input';
    sw.name = `e_${rowIdx}`;

    // @ts-expect-error TS(2339): Property 'required_by_all' does not exist on type ... Remove this comment to see the full error message
    sw.checked = !!pref.required_by_all;
    wrap.appendChild(sw);
    tdAct.appendChild(wrap);

    // action remove
    const rmBtn = document.createElement('button');
    rmBtn.type = 'button';
    rmBtn.className = 'btn btn-sm btn-outline-danger';
    rmBtn.innerHTML = '<i class="bi bi-x-lg"></i>';
    rmBtn.addEventListener('click', () => tr.remove());
    tdAct.appendChild(rmBtn);

    tr.appendChild(tdAct);


    // @ts-expect-error TS(2531): Object is possibly 'null'.
    tableBody.appendChild(tr);
}

/* ───── Prefill (duplicate-mode) ────────────────────────── */
export function prefillRows() {

    // @ts-expect-error TS(2339): Property 'PREFILLED_ITEMS' does not exist on type ... Remove this comment to see the full error message
    if (!window.PREFILLED_ITEMS) return;

    // @ts-expect-error TS(2339): Property 'PREFILLED_ITEMS' does not exist on type ... Remove this comment to see the full error message
    window.PREFILLED_ITEMS.forEach((it: any, i: any) => createRow(it, i));
}

/* ───── Build JSON & submit ─────────────────────────────── */
export function handleSubmit(evt: any) {
    const form = document.getElementById('packingForm');
    const hiddenFld = document.getElementById('itemsJson');
    const tableBody = document.getElementById('itemTable');
    evt.preventDefault();
    const items: any = [];


    // @ts-expect-error TS(2531): Object is possibly 'null'.
    tableBody.querySelectorAll('tr').forEach(tr => {

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


    // @ts-expect-error TS(2531): Object is possibly 'null'.
    hiddenFld.value = JSON.stringify(items);

    // @ts-expect-error TS(2531): Object is possibly 'null'.
    form.submit();
}

export function initListeners() {
    const addBtn = document.getElementById('addItemBtn');
    const form = document.getElementById('packingForm');

    // @ts-expect-error TS(2531): Object is possibly 'null'.
    addBtn.addEventListener('click', createRow);

    // @ts-expect-error TS(2531): Object is possibly 'null'.
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
window.Surveyor = {
    init
};