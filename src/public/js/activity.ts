import {
    getSelectValues,
    post,
    setCurrentNavLocation,
    showInlineAlert,
    startInlineEdit,
    startInlineEditArea
} from "./modules/module_functions";

/* ---------- assign / unassign ------------------------------- */
export function initAssign() {
    document.addEventListener('click', async e => {

        // @ts-ignore
        const btn = e.target?.closest('[data-action]');
        if (!btn) return;

        /* NEW — get surrounding .slot, not <td> ------------------ */
        const card = btn.closest('.slot');
        const slotId = card?.dataset.slotid;
        if (!slotId) return;

        const act = btn.dataset.action;
        const role = btn.dataset.role;
        try {

            // @ts-expect-error TS(2304): Cannot find name 'ACT_PLAN_ID'.
            await post(`/activity/${window.ACT_PLAN_ID}/${act}`, {slotId, role});
            showInlineAlert('success', 'Updated');
            setTimeout(() => location.reload(), 120);
        } catch (err) {

            // @ts-expect-error TS(2571): Object is of type 'unknown'.
            showInlineAlert('error', err.message);
        }
    });
}

export function initSelectBox() {

    $('.multiSelect').select2({
        placeholder: 'Add Roles',
        width: '100%',

        //@ts-ignore
        selectionCssClass: 'text-bg-dark',
        dropdownCssClass: 'text-bg-dark',
    });

    document.addEventListener('click', async e => {

        // @ts-expect-error TS(2531): Object is possibly 'null'.
        const btn = e.target.closest('[data-addRoles]');
        if (!btn) return;

        const div = btn.closest('.role-assignment')
        if (!div) return;

        const sel = div.querySelector('select');
        if (!sel) return;

        const slot = sel.dataset.id;
        const vals = getSelectValues(sel);

        try {

            // @ts-expect-error TS(2304): Cannot find name 'ACT_PLAN_ID'.
            await post(`/activity/${window.ACT_PLAN_ID}/slot/${slot}/addRole`, {roles: vals});
            showInlineAlert('success', 'Updated');
            setTimeout(() => location.reload(), 120);
        } catch (err) {

            // @ts-expect-error TS(2571): Object is of type 'unknown'.
            showInlineAlert('error', err.message);
        }
    });
}

export function initInlineEdit() {
    document.addEventListener('dblclick', e => {

        // @ts-expect-error TS(2531): Object is possibly 'null'.
        const desc = e.target.closest('[data-edit="planDescription"]');

        // @ts-expect-error TS(2304): Cannot find name 'ACT_PLAN_ID'.
        if (desc) return startInlineEditArea(desc, `/activity/${window.ACT_PLAN_ID}/description`);


        // @ts-expect-error TS(2531): Object is possibly 'null'.
        const card = e.target.closest('.slot');          // NEW

        // @ts-expect-error TS(2531): Object is possibly 'null'.
        if (!card || e.target.closest('button')) return;

        /* choose editable span */

        // @ts-expect-error TS(2531): Object is possibly 'null'.
        let span = e.target.closest('[data-edit]');

        // @ts-expect-error TS(2531): Object is possibly 'null'.
        if (!span && e.target.closest('.badge'))
            span = card.querySelector('[data-edit="maxAssignees"]');

        // @ts-expect-error TS(2531): Object is possibly 'null'.
        if (!span && e.target.closest('small'))
            span = card.querySelector('[data-edit="description"]');
        if (!span)
            span = card.querySelector('[data-edit="title"]');


        // @ts-expect-error TS(2339): Property 'ACT_PLAN_ID' does not exist on type 'Win... Remove this comment to see the full error message
        startInlineEdit(span, `/activity/${window.ACT_PLAN_ID}/slot`);
    });
}


/* ---------- delete-slot ------------------------------------- */
export function initDelete() {
    document.addEventListener('click', async e => {

        // @ts-expect-error TS(2531): Object is possibly 'null'.
        const btn = e.target.closest('[data-delete-slot]');
        if (!btn) return;
        if (!confirm('Delete this slot?')) return;
        const id = btn.dataset.slotid;
        try {

            // @ts-expect-error TS(2339): Property 'ACT_PLAN_ID' does not exist on type 'Win... Remove this comment to see the full error message
            await post(`/activity/${window.ACT_PLAN_ID}/slot/${id}/delete`, {});
            showInlineAlert('success', 'Deleted');
            setTimeout(() => location.reload(), 100);
        } catch (err) {

            // @ts-expect-error TS(2571): Object is of type 'unknown'.
            showInlineAlert('error', err.message);
        }
    });
}

/* ---------- add-slot (empty row) ----------------------------- */
export function initAddSlot() {
    document.addEventListener('click', e => {

        // @ts-expect-error TS(2531): Object is possibly 'null'.
        const btn = e.target.closest('[data-add-slot]');
        if (!btn) return;

        // hide button, replace by small inline form
        const dateISO = btn.dataset.date;
        const cell = btn.parentElement;
        btn.remove();

        const wrap = document.createElement('div');
        wrap.className = 'd-grid gap-1';

        const title = document.createElement('input');
        title.className = 'form-control form-control-sm text-bg-dark';
        title.placeholder = 'Title';
        title.required = true;

        const desc = document.createElement('input');
        desc.className = 'form-control form-control-sm text-bg-dark';
        desc.placeholder = 'Description';

        const max = document.createElement('input');
        max.type = 'number';
        max.min = '1';
        max.value = '1';
        max.className = 'form-control form-control-sm text-bg-dark';

        const save = document.createElement('button');
        save.className = 'btn btn-sm btn-success mt-1';
        save.textContent = 'Add';

        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'btn btn-sm btn-outline-secondary mt-1';
        cancel.textContent = '×';

        wrap.append(title, desc, max, save, cancel);
        cell.appendChild(wrap);

        cancel.onclick = () => {
            wrap.remove();
            cell.appendChild(btn);
        };

        save.onclick = async () => {
            try {

                // @ts-expect-error TS(2339): Property 'ACT_PLAN_ID' does not exist on type 'Win... Remove this comment to see the full error message
                await post(`/activity/${window.ACT_PLAN_ID}/slot/add`, {
                    date: dateISO,
                    title: title.value.trim(),
                    description: desc.value.trim(),
                    maxAssignees: max.value,
                });
                showInlineAlert('success', 'Added');
                setTimeout(() => location.reload(), 100);
            } catch (err) {

                // @ts-expect-error TS(2571): Object is of type 'unknown'.
                showInlineAlert('error', err.message);
            }
        };
    });
}

/* ---------- DRAG & DROP (column-local) ------------------------ */
export function initDnD() {
    let dragCard: any = null;          // the .slot being dragged
    let dragParent: any = null;        // its .slot-container

    /* start */
    document.addEventListener('dragstart', e => {

        // @ts-expect-error TS(2531): Object is possibly 'null'.
        if (e.target.closest('button') || e.target.closest('input')) return;             // ignore buttons


        // @ts-expect-error TS(2531): Object is possibly 'null'.
        const card = e.target.closest('.slot');
        if (!card) return;

        dragCard = card;
        dragParent = card.parentElement;                    // .slot-container

        // @ts-expect-error TS(2531): Object is possibly 'null'.
        e.dataTransfer.setData('text/plain', '');

        // @ts-expect-error TS(2531): Object is possibly 'null'.
        e.dataTransfer.effectAllowed = 'move';
    });

    /* over – only same container */
    document.addEventListener('dragover', e => {
        if (!dragCard) return;


        // @ts-expect-error TS(2531): Object is possibly 'null'.
        const overCard = e.target.closest('.slot');
        if (!overCard || overCard === dragCard) return;
        if (overCard.parentElement !== dragParent) return;  // stay in column

        e.preventDefault();                                 // allow drop

        const rect = overCard.getBoundingClientRect();
        dragParent.insertBefore(
            dragCard,
            (e.clientY - rect.top) > rect.height / 2 ? overCard.nextSibling : overCard
        );
    });

    /* end – send new order for that day only */
    document.addEventListener('dragend', async () => {
        if (!dragCard) return;

        const order = [...dragParent.querySelectorAll('.slot')]
            .map((el, i) => ({slotId: el.dataset.slotid, pos: i}));

        try {

            // @ts-expect-error TS(2339): Property 'ACT_PLAN_ID' does not exist on type 'Win... Remove this comment to see the full error message
            await post(`/activity/${window.ACT_PLAN_ID}/slot/reorder`, {order});
            showInlineAlert('success', 'Reordered');
        } catch (err) {

            // @ts-expect-error TS(2571): Object is of type 'unknown'.
            showInlineAlert('error', err.message);
        }
        dragCard = dragParent = null;
    });
}


/* ---- Owner toggles list flags ------------------------------------ */
export function initOwnerFlags() {
    const form = document.getElementById('flagForm');
    if (!form) return;

    form.addEventListener('change', async () => {
        const payload = {

            // @ts-expect-error TS(2531): Object is possibly 'null'.
            allowAdd: document.getElementById('allowAddSwitch').checked,

            // @ts-expect-error TS(2531): Object is possibly 'null'.
            guestManage: document.getElementById('guestManageSwitch').checked,
        };
        try {

            // @ts-expect-error TS(2339): Property 'ACT_PLAN_ID' does not exist on type 'Win... Remove this comment to see the full error message
            await post(`/activity/${window.ACT_PLAN_ID}/settings`, payload);
            showInlineAlert('success', 'Settings updated');
            setTimeout(() => location.reload(), 100);
        } catch (err) {

            // @ts-expect-error TS(2571): Object is of type 'unknown'.
            showInlineAlert('error', err.message);
            /* Reload to force consistent switches */
            setTimeout(() => location.reload(), 800);
        }
    });
}

/* -------- Owner entfernt Assignee ----------------------------------- */
export function initOwnerRemove() {
    document.addEventListener('click', async e => {

        // @ts-expect-error TS(2531): Object is possibly 'null'.
        const btn = e.target.closest('button[data-owner-remove]');
        if (!btn) return;
        const assignId = btn.dataset.assignid;
        try {

            // @ts-expect-error TS(2339): Property 'ACT_PLAN_ID' does not exist on type 'Win... Remove this comment to see the full error message
            await post(`/activity/${window.ACT_PLAN_ID}/assignment/${assignId}/delete`, {});
            showInlineAlert('success', 'Removed');
            setTimeout(() => location.reload(), 100);
        } catch (err) {

            // @ts-expect-error TS(2571): Object is of type 'unknown'.
            showInlineAlert('error', err.message);
        }
    });
}

export function initDates() {
    document.querySelectorAll('th[data-date]').forEach(th => {

        // @ts-expect-error TS(2339): Property 'dataset' does not exist on type 'Element... Remove this comment to see the full error message
        const [y, m, day] = th.dataset.date.split('-').map(Number);
        const d = new Date(Date.UTC(y, m - 1, day));

        // @ts-expect-error TS(2531): Object is possibly 'null'.
        th.querySelector('.day').textContent =
            d.toLocaleDateString(undefined, {weekday: 'short'});

        // @ts-expect-error TS(2531): Object is possibly 'null'.
        th.querySelector('.date').textContent =
            d.toLocaleDateString();
    });
}

export function init() {
    setCurrentNavLocation();
    initDates();
    initSelectBox();

    // @ts-expect-error TS(2339): Property 'ACT_PLAN_ID' does not exist on type 'Win... Remove this comment to see the full error message
    if (window.ACT_PLAN_ID) {
        initAssign();
        initInlineEdit();
        initDelete();
        initAddSlot();
        initDnD();
        initOwnerFlags();
        initOwnerRemove();
    }
}

// Expose to global scope
window.Surveyor.init = init;
