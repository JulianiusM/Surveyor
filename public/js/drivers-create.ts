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
            maxAssignees: tr.querySelector(`input[name^="m_"]`).value
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
}