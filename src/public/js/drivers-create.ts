/* ───── Build JSON & submit ─────────────────────────────── */
import {setCurrentNavLocation} from "./module_functions";

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
            maxAssignees: tr.querySelector(`input[name^="m_"]`).value
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
}

// Expose to global scope
window.Surveyor = {
    init
};