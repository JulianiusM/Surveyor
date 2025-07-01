/*  ────────────────────────────────────────────────────────────────
    public/js/packing.js
    Front-End-Skript für Listen‐Ansicht UND Listenerstellung
    ---------------------------------------------------------------
    Erwartet im Template:
       • window.PACK_LIST_ID – ID der Pack-Liste (nur View-Seite)
       • jQuery (Bootstrap-Bundle bindet es ohnehin ein)
   ──────────────────────────────────────────────────────────────── */

/* ========== Helper =========================================== */
async function post(url, payload) {
    const res = await fetch(url, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload),
    });

    let data = {};
    try {
        data = await res.json();
    } catch {
    }

    if (!res.ok || data.status === 'error') {
        throw new Error(data.message || 'Request failed');
    }
    return data;          // { status:'success', message:'…' }
}


function showInlineAlert(status, message) {
    const alertBox = document.getElementById('liveAlerts')
    if (!alertBox) return;
    const cls = {
        success: 'alert-success',
        info: 'alert-info',
        error: 'alert-danger',
    }[status] || 'alert-info';

    alertBox.innerHTML = `
      <div class="alert ${cls} alert-dismissible fade show" role="alert">
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
      </div>`;
}

/* ========== Assign / Unassign ================================ */
function initAssignButtons() {
    const table = document.querySelector('table[data-assignable]');
    if (!table) return;

    table.addEventListener('click', async evt => {
        const btn = evt.target.closest('button[data-action]');
        if (!btn) return;

        const tr = btn.closest('tr');
        const itemId = tr.dataset.itemid;
        const action = btn.dataset.action;

        try {
            await post(`/packing/${window.PACK_LIST_ID}/${action}`, {itemId});

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
            setTimeout(() => location.reload(), 500);
        } catch (e) {
            showInlineAlert('error', e.message);
        }
    });
}

/* -------- inline edit (title, description, maxAssignees) ------------ */
function initInlineEdit() {
    document.querySelectorAll('td[data-edit]').forEach(td => {
        td.addEventListener('dblclick', () => {
            if (td.querySelector('input')) return;                 // schon Editing

            const field = td.dataset.edit;                        // title | description | maxAssignees
            const itemId = td.dataset.itemid;

            /* ---------- alter Wert auslesen --------------------------- */
            let old, countTxt;
            if (field === 'maxAssignees') {
                const cntSpan = td.querySelector('[data-count]');
                countTxt = cntSpan.textContent.trim();
                old = td.querySelector('[data-max]').textContent.trim();
            } else {
                old = td.textContent.trim();
            }

            const type = field === 'maxAssignees' ? 'number' : 'text';
            td.innerHTML =
                `<input class="form-control form-control-sm text-bg-dark" type="${type}" value="${old}">`;
            const inp = td.firstChild;
            inp.focus();
            inp.select();

            const save = async () => {
                const val = inp.value.trim();
                if (val === old) {
                    restore();
                    return;
                }

                const url = field === 'description'
                    ? `/packing/${window.PACK_LIST_ID}/item/${itemId}/description`
                    : `/packing/${window.PACK_LIST_ID}/item/${itemId}/attr`;

                try {
                    await post(url,
                        field === 'description' ? {description: val}
                            : {field, value: val});

                    if (field === 'maxAssignees')
                        td.innerHTML = `<span data-count>${countTxt}</span> / <span data-max>${val}</span>`;
                    else
                        td.textContent = val;

                    showInlineAlert('success', 'Updated');
                } catch (e) {
                    restore();
                    showInlineAlert('error', e.message);
                }
            };

            function restore() {
                if (field === 'maxAssignees')
                    td.innerHTML = `<span data-count>${countTxt}</span> / <span data-max>${old}</span>`;
                else
                    td.textContent = old;
            }

            inp.addEventListener('blur', save);
            inp.addEventListener('keydown', e => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    inp.blur();
                }
                if (e.key === 'Escape') {
                    restore();
                }
            });
        });
    });
}

/* ========== Reorder (Owner) ================================== */
function initReorder() {
    const tbody = document.querySelector('tbody[data-reorderable]');
    if (!tbody) return;
    let dragSrc;

    tbody.addEventListener('dragstart', e => {
        dragSrc = e.target.closest('tr');
        e.dataTransfer.effectAllowed = 'move';
    });

    tbody.addEventListener('dragover', e => {
        e.preventDefault();
        const tr = e.target.closest('tr');
        if (!tr || tr === dragSrc) return;
        const rect = tr.getBoundingClientRect();
        tr.parentNode.insertBefore(
            dragSrc,
            (e.clientY - rect.top) > rect.height / 2 ? tr.nextSibling : tr
        );
    });

    tbody.addEventListener('dragend', async () => {
        const orders = Array.from(tbody.children).map((tr, i) => ({
            itemId: tr.dataset.itemid,
            position: i,
        }));
        try {
            await post(`/packing/${window.PACK_LIST_ID}/reorder`, {orders});
            showInlineAlert('success', 'Order saved');
        } catch (e) {
            /* z.B. "Only the owner can reorder" oder "Login required" */
            showInlineAlert('error', e.message);
            // Reihenfolge visuell zurückrollen (Reload)
            setTimeout(() => location.reload(), 1000);
        }
    });

    tbody.querySelectorAll('tr').forEach(tr => tr.draggable = true);
}

/* ========== Quick-Add ======================================== */
function initQuickAdd() {
    const quickForm = document.getElementById('quickAddForm');
    if (quickForm) {
        quickForm.addEventListener('submit', async e => {
            e.preventDefault();
            const data = Object.fromEntries(new FormData(quickForm).entries());

            try {
                await post(`/packing/${window.PACK_LIST_ID}/items`, data);
                showInlineAlert('success', 'Added');
                setTimeout(() => location.reload(), 500);
            } catch (err) {
                showInlineAlert('error', err.message);
            }
        });
    }
}

/* -------- Owner entfernt Assignee ----------------------------------- */
function initOwnerRemove() {
    document.addEventListener('click', async e => {
        const btn = e.target.closest('button[data-owner-remove]');
        if (!btn) return;
        const assignId = btn.dataset.assignid;
        try {
            await post(`/packing/${window.PACK_LIST_ID}/assignment/${assignId}/delete`, {});
            showInlineAlert('success', 'Removed');
            setTimeout(() => location.reload(), 500);
        } catch (err) {
            showInlineAlert('error', err.message);
        }
    });
}

function init() {
    setCurrentNavLocation();
    if (window.PACK_LIST_ID) {
        initAssignButtons();
        initReorder();          // nur aktiv, wenn tbody[data-reorderable] existiert
        initInlineEdit();
        initQuickAdd();
        initOwnerRemove()
    }
}
