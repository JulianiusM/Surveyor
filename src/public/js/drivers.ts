/*  ────────────────────────────────────────────────────────────────
    public/js/packing.js
    Front-End-Skript für Listen‐Ansicht UND Listenerstellung
    ---------------------------------------------------------------
    Erwartet im Template:
       • window.PACK_LIST_ID – ID der Pack-Liste (nur View-Seite)
       • jQuery (Bootstrap-Bundle bindet es ohnehin ein)
   ──────────────────────────────────────────────────────────────── */

/* ========== Assign / Unassign ================================ */
import {setCurrentNavLocation, showInlineAlert} from "./module_functions";

export function initAssignButtons() {
    const table = document.querySelector('table[data-assignable]');
    if (!table) return;

    table.addEventListener('click', async evt => {

        // @ts-expect-error TS(2531): Object is possibly 'null'.
        const btn = evt.target.closest('button[data-action]');
        if (!btn) return;

        const tr = btn.closest('tr');
        const itemId = tr.dataset.itemid;
        const action = btn.dataset.action;

        try {

            // @ts-expect-error TS(2339): Property 'DRIVERS_LIST_ID' does not exist on type ... Remove this comment to see the full error message
            await post(`/drivers/${window.DRIVERS_LIST_ID}/${action}`, {itemId});

            /* --- Count / Max sauber aktualisieren ------------------- */
            const cntSpan = tr.querySelector('[data-count]');
            const maxSpan = tr.querySelector('[data-max]');
            if (!cntSpan || !maxSpan) return location.reload();

            const cur = parseInt(cntSpan.textContent, 10);
            const max = parseInt(maxSpan.textContent, 10);
            const newCur = action === 'assign' ? cur + 1 : cur - 1;
            cntSpan.textContent = newCur;

            /* ------- Button & Badge ------------------------------------- */
            const cellAction = tr.querySelector('td:last-child');
            let badge = cellAction.querySelector('.badge');

            if (action === 'assign') {
                /* Button wird zu “Remove” */
                btn.dataset.action = 'unassign';
                btn.classList.remove('btn-outline-success');
                btn.classList.add('btn-outline-danger');
                btn.textContent = 'Remove';

                /* Row ist jetzt voll → Badge einblenden */
                if (newCur === max) {
                    if (!badge) {
                        badge = document.createElement('span');
                        badge.className = 'badge bg-secondary ms-1';
                        badge.textContent = 'Full';
                        cellAction.appendChild(badge);
                    }
                }
            } else { /* action === 'unassign' */
                /* Button zurück zu “Take” */
                btn.dataset.action = 'assign';
                btn.classList.remove('btn-outline-danger');
                btn.classList.add('btn-outline-success');
                btn.textContent = 'Take';

                /* Platz frei geworden → Badge entfernen */
                if (newCur < max && badge) badge.remove();
            }

            showInlineAlert('success',
                `Item ${action === 'assign' ? 'assigned' : 'unassigned'}`);
            setTimeout(() => location.reload(), 100);
        } catch (e) {

            // @ts-expect-error TS(2571): Object is of type 'unknown'.
            showInlineAlert('error', e.message);
        }
    });
}

/* -------- inline edit (title, description, maxAssignees) ------------ */
export function initInlineEdit() {
    document.querySelectorAll('td[data-edit]').forEach(td => {
        td.addEventListener('dblclick', () => {

            // @ts-expect-error TS(2339): Property 'DRIVERS_LIST_ID' does not exist on type ... Remove this comment to see the full error message
            startInlineEdit(td, `/drivers/${window.DRIVERS_LIST_ID}/item`);
        });
    });

    document.querySelectorAll('[data-edit="planDescription"]').forEach(elem => {
        elem.addEventListener('dblclick', () => {

            // @ts-expect-error TS(2339): Property 'DRIVERS_LIST_ID' does not exist on type ... Remove this comment to see the full error message
            startInlineEditArea(elem, `/drivers/${window.DRIVERS_LIST_ID}/description`);
        })
    })
}

/* ========== Reorder (Owner) ================================== */
export function initReorder() {
    const tbody = document.querySelector('tbody[data-reorderable]');
    if (!tbody) return;
    let dragSrc: any;

    tbody.addEventListener('dragstart', e => {

        // @ts-expect-error TS(2531): Object is possibly 'null'.
        if (e.target.closest('button') || e.target.closest('input')) return;


        // @ts-expect-error TS(2531): Object is possibly 'null'.
        dragSrc = e.target.closest('tr');
        if (!dragSrc) return;


        // @ts-expect-error TS(2339): Property 'dataTransfer' does not exist on type 'Ev... Remove this comment to see the full error message
        e.dataTransfer.effectAllowed = 'move';
    });

    tbody.addEventListener('dragover', e => {
        if (!dragSrc) return;

        e.preventDefault();

        // @ts-expect-error TS(2531): Object is possibly 'null'.
        const tr = e.target.closest('tr');
        if (!tr || tr === dragSrc) return;
        const rect = tr.getBoundingClientRect();
        tr.parentNode.insertBefore(
            dragSrc,

            // @ts-expect-error TS(2339): Property 'clientY' does not exist on type 'Event'.
            (e.clientY - rect.top) > rect.height / 2 ? tr.nextSibling : tr
        );
    });

    tbody.addEventListener('dragend', async () => {
        if (!dragSrc) return;

        const orders = Array.from(tbody.children).map((tr, i) => ({

            // @ts-expect-error TS(2339): Property 'dataset' does not exist on type 'Element... Remove this comment to see the full error message
            itemId: tr.dataset.itemid,
            position: i,
        }));
        try {

            // @ts-expect-error TS(2339): Property 'DRIVERS_LIST_ID' does not exist on type ... Remove this comment to see the full error message
            await post(`/drivers/${window.DRIVERS_LIST_ID}/reorder`, {orders});
            showInlineAlert('success', 'Order saved');
        } catch (e) {
            /* z.B. "Only the owner can reorder" oder "Login required" */

            // @ts-expect-error TS(2571): Object is of type 'unknown'.
            showInlineAlert('error', e.message);
            // Reihenfolge visuell zurückrollen (Reload)
            setTimeout(() => location.reload(), 1000);
        }
    });

    tbody.querySelectorAll('tr').forEach(tr => tr.draggable = true);
}

/* ========== Quick-Add ======================================== */
export function initQuickAdd() {
    const quickForm = document.getElementById('quickAddForm');
    if (quickForm) {
        quickForm.addEventListener('submit', async e => {
            e.preventDefault();

            // @ts-expect-error TS(2550): Property 'fromEntries' does not exist on type 'Obj... Remove this comment to see the full error message
            const data = Object.fromEntries(new FormData(quickForm).entries());

            try {

                // @ts-expect-error TS(2339): Property 'DRIVERS_LIST_ID' does not exist on type ... Remove this comment to see the full error message
                await post(`/drivers/${window.DRIVERS_LIST_ID}/items`, data);
                showInlineAlert('success', 'Added');
                setTimeout(() => location.reload(), 100);
            } catch (err) {

                // @ts-expect-error TS(2571): Object is of type 'unknown'.
                showInlineAlert('error', err.message);
            }
        });
    }
}

/* -------- Owner entfernt Assignee ----------------------------------- */
export function initOwnerRemove() {
    document.addEventListener('click', async e => {

        // @ts-expect-error TS(2531): Object is possibly 'null'.
        const btn = e.target.closest('button[data-owner-remove]');
        if (!btn) return;
        const assignId = btn.dataset.assignid;
        try {

            // @ts-expect-error TS(2339): Property 'DRIVERS_LIST_ID' does not exist on type ... Remove this comment to see the full error message
            await post(`/drivers/${window.DRIVERS_LIST_ID}/assignment/${assignId}/delete`, {});
            showInlineAlert('success', 'Removed');
            setTimeout(() => location.reload(), 100);
        } catch (err) {

            // @ts-expect-error TS(2571): Object is of type 'unknown'.
            showInlineAlert('error', err.message);
        }
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

            // @ts-expect-error TS(2339): Property 'DRIVERS_LIST_ID' does not exist on type ... Remove this comment to see the full error message
            await post(`/drivers/${window.DRIVERS_LIST_ID}/settings`, payload);
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

/* -------- owner deletes item ----------------------------------- */
export function initOwnerDeleteItem() {
    document.addEventListener('click', async e => {

        // @ts-expect-error TS(2531): Object is possibly 'null'.
        const btn = e.target.closest('[data-delete-item]');
        if (!btn) return;

        if (!confirm('Delete this driver permanently?')) return;

        const itemId = btn.dataset.itemid;
        try {

            // @ts-expect-error TS(2339): Property 'DRIVERS_LIST_ID' does not exist on type ... Remove this comment to see the full error message
            await post(`/drivers/${window.DRIVERS_LIST_ID}/item/${itemId}/delete`, {});
            showInlineAlert('success', 'Driver deleted');
            setTimeout(() => location.reload(), 100);
        } catch (err) {

            // @ts-expect-error TS(2571): Object is of type 'unknown'.
            showInlineAlert('error', err.message);
        }
    });
}


export function init() {
    setCurrentNavLocation();

    // @ts-expect-error TS(2339): Property 'DRIVERS_LIST_ID' does not exist on type ... Remove this comment to see the full error message
    if (window.DRIVERS_LIST_ID) {
        initAssignButtons();
        initReorder();          // nur aktiv, wenn tbody[data-reorderable] existiert
        initInlineEdit();
        initQuickAdd();
        initOwnerRemove();
        initOwnerFlags();
        initOwnerDeleteItem();
    }
}

// Expose to global scope
window.Surveyor = {
    init
};
