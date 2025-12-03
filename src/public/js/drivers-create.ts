/* ───── Build JSON & submit ─────────────────────────────── */
import {setCurrentNavLocation} from "./modules/module_functions";
import {DriversItem} from "../../modules/database/entities/drivers/DriversItem";

export function handleSubmit(evt: Event) {
    const form = document.getElementById('packingForm') as HTMLFormElement;
    const hiddenFld = document.getElementById('itemsJson') as HTMLInputElement;
    const tableBody = document.getElementById('itemTable');
    evt.preventDefault();
    const items: Partial<DriversItem>[] = [];

    if (tableBody) {
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
    }

    hiddenFld.value = JSON.stringify(items);
    form.submit();
}

export function initListeners() {
    const form = document.getElementById('packingForm');
    form?.addEventListener('submit', handleSubmit);
}


export function init() {
    setCurrentNavLocation();
    initListeners();
}

// Expose to global scope
window.Surveyor.init = init;