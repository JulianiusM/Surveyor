/* ---------- assign / unassign ------------------------------- */
function initAssign() {
    document.addEventListener('click', async e => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;

        /* NEW — get surrounding .slot, not <td> ------------------ */
        const card = btn.closest('.slot');
        const slotId = card?.dataset.slotid;
        if (!slotId) return;

        const act = btn.dataset.action;
        try {
            await post(`/activity/${ACT_PLAN_ID}/${act}`, {slotId});
            showInlineAlert('success', 'Updated');
            setTimeout(() => location.reload(), 120);
        } catch (err) {
            showInlineAlert('error', err.message);
        }
    });
}

function initInlineEdit() {
    document.addEventListener('dblclick', e => {
        const desc = e.target.closest('[data-edit="planDescription"]');
        if (desc) return startInlineEditArea(desc, `/activity/${ACT_PLAN_ID}/description`);

        const card = e.target.closest('.slot');          // NEW
        if (!card || e.target.closest('button')) return;

        /* choose editable span */
        let span = e.target.closest('[data-edit]');
        if (!span && e.target.closest('.badge'))
            span = card.querySelector('[data-edit="maxAssignees"]');
        if (!span && e.target.closest('small'))
            span = card.querySelector('[data-edit="description"]');
        if (!span)
            span = card.querySelector('[data-edit="title"]');

        startInlineEdit(span, `/activity/${window.ACT_PLAN_ID}/slot`);
    });
}


/* ---------- delete-slot ------------------------------------- */
function initDelete() {
    document.addEventListener('click', async e => {
        const btn = e.target.closest('[data-delete-slot]');
        if (!btn) return;
        if (!confirm('Delete this slot?')) return;
        const id = btn.dataset.slotid;
        try {
            await post(`/activity/${window.ACT_PLAN_ID}/slot/${id}/delete`, {});
            showInlineAlert('success', 'Deleted');
            setTimeout(() => location.reload(), 100);
        } catch (err) {
            showInlineAlert('error', err.message);
        }
    });
}

/* ---------- add-slot (empty row) ----------------------------- */
function initAddSlot() {
    document.addEventListener('click', e => {
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
                await post(`/activity/${window.ACT_PLAN_ID}/slot/add`, {
                    date: dateISO,
                    title: title.value.trim(),
                    description: desc.value.trim(),
                    maxAssignees: max.value,
                });
                showInlineAlert('success', 'Added');
                setTimeout(() => location.reload(), 100);
            } catch (err) {
                showInlineAlert('error', err.message);
            }
        };
    });
}

/* ---------- DRAG & DROP (column-local) ------------------------ */
function initDnD() {
    let dragCard = null;          // the .slot being dragged
    let dragParent = null;        // its .slot-container

    /* start */
    document.addEventListener('dragstart', e => {
        if (e.target.closest('button') || e.target.closest('input')) return;             // ignore buttons

        const card = e.target.closest('.slot');
        if (!card) return;

        dragCard = card;
        dragParent = card.parentElement;                    // .slot-container
        e.dataTransfer.setData('text/plain', '');
        e.dataTransfer.effectAllowed = 'move';
    });

    /* over – only same container */
    document.addEventListener('dragover', e => {
        if (!dragCard) return;

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
            .map((el, i) => ({slotId: el.dataset.slotid, position: i}));

        try {
            await post(`/activity/${window.ACT_PLAN_ID}/slot/reorder`, {order});
            showInlineAlert('success', 'Reordered');
        } catch (err) {
            showInlineAlert('error', err.message);
        }
        dragCard = dragParent = null;
    });
}


/* ---- Owner toggles list flags ------------------------------------ */
function initOwnerFlags() {
    const form = document.getElementById('flagForm');
    if (!form) return;

    form.addEventListener('change', async () => {
        const payload = {
            allowAdd: document.getElementById('allowAddSwitch').checked,
            guestManage: document.getElementById('guestManageSwitch').checked,
        };
        try {
            await post(`/activity/${window.ACT_PLAN_ID}/settings`, payload);
            showInlineAlert('success', 'Settings updated');
            setTimeout(() => location.reload(), 100);
        } catch (err) {
            showInlineAlert('error', err.message);
            /* Reload to force consistent switches */
            setTimeout(() => location.reload(), 800);
        }
    });
}

/* -------- Owner entfernt Assignee ----------------------------------- */
function initOwnerRemove() {
    document.addEventListener('click', async e => {
        const btn = e.target.closest('button[data-owner-remove]');
        if (!btn) return;
        const assignId = btn.dataset.assignid;
        try {
            await post(`/activity/${window.ACT_PLAN_ID}/assignment/${assignId}/delete`, {});
            showInlineAlert('success', 'Removed');
            setTimeout(() => location.reload(), 100);
        } catch (err) {
            showInlineAlert('error', err.message);
        }
    });
}

function initDates() {
    document.querySelectorAll('th[data-date]').forEach(th => {
        const [y, m, day] = th.dataset.date.split('-').map(Number);
        const d = new Date(Date.UTC(y, m - 1, day));
        th.querySelector('.day').textContent =
            d.toLocaleDateString(undefined, {weekday: 'short'});
        th.querySelector('.date').textContent =
            d.toLocaleDateString();
    });
}

function init() {
    setCurrentNavLocation();
    initDates();
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
