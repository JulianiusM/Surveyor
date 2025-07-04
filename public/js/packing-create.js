/*  Packing-Create – Client-Logic (no jQuery)  */
function buildCell(child) {
    const td = document.createElement('td');
    td.appendChild(child);
    return td;
}

/* ───── Row creation / removal ──────────────────────────── */
function createRow(pref = {}, rowIdx = 0) {
    const tableBody = document.getElementById('itemTable');
    const tr = document.createElement('tr');
    tr.dataset.idx = rowIdx;

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

    tableBody.appendChild(tr);
}

/* ───── Prefill (duplicate-mode) ────────────────────────── */
function prefillRows() {
    if (!window.PREFILLED_ITEMS) return;
    window.PREFILLED_ITEMS.forEach((it, i) => createRow(it, i));
}

/* ───── Build JSON & submit ─────────────────────────────── */
function handleSubmit(evt) {
    const form = document.getElementById('packingForm');
    const hiddenFld = document.getElementById('itemsJson');
    const tableBody = document.getElementById('itemTable');
    evt.preventDefault();
    const items = [];

    tableBody.querySelectorAll('tr').forEach(tr => {
        const tVal = tr.querySelector(`input[name^="t_"]`).value.trim();
        if (!tVal) return;
        items.push({
            title: tVal,
            description: tr.querySelector(`input[name^="d_"]`).value.trim(),
            maxAssignees: tr.querySelector(`input[name^="m_"]`).value,
            requiredByAll: tr.querySelector('input[name^="e_"]').checked
        });
    });

    hiddenFld.value = JSON.stringify(items);
    form.submit();
}

function initListeners() {
    const addBtn = document.getElementById('addItemBtn');
    const form = document.getElementById('packingForm');
    addBtn.addEventListener('click', createRow);
    form.addEventListener('submit', handleSubmit);
}


function init() {
    setCurrentNavLocation();
    initListeners();
    // Initial row (or prefill)
    if (window.PREFILLED_ITEMS)
        prefillRows();
    else
        createRow();
}