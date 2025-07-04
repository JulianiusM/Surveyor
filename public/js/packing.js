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
            setTimeout(() => location.reload(), 100);
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
                setTimeout(() => location.reload(), 100);
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
            setTimeout(() => location.reload(), 100);
        } catch (err) {
            showInlineAlert('error', err.message);
        }
    });
}

function initMarkEveryone() {
    /* Toggle „everyone brings“ --------------------------------------- */
    document.addEventListener('change', async e => {
        const sw = e.target.closest('[data-required-toggle]');
        if (!sw) return;
        const itemId = sw.dataset.itemid;
        try {
            await post(`/packing/${window.PACK_LIST_ID}/item/${itemId}/required`,
                {flag: sw.checked});
            // Visuelle Hervorhebung an/aus
            const row = document.querySelector(`tr[data-itemid="${itemId}"]`);
            if (row) row.classList.toggle('table-info', sw.checked);
            reorderRequiredRows()
            showInlineAlert('success', 'Updated');
            setTimeout(() => location.reload(), 100);
        } catch (err) {
            sw.checked = !sw.checked;                  // rollback
            showInlineAlert('error', err.message);
        }
    });

}

/* ─── Sortiert Rows: „Everyone“ zuerst, danach original position —— */
function reorderRequiredRows() {
    // Tabelle mit „data-assignable“ suchen
    const table = document.querySelector('table[data-assignable]');
    if (!table) return;

    // Tbody ist immer das erste Kind der Tabelle
    const tbody = table.querySelector('tbody');
    if (!tbody) return;

    const rows = Array.from(tbody.children);
    rows.sort((a, b) => {
        const aReq = a.classList.contains('table-info') ? 0 : 1;
        const bReq = b.classList.contains('table-info') ? 0 : 1;
        if (aReq !== bReq) return aReq - bReq;              // Required zuerst
        return Number(a.dataset.pos) - Number(b.dataset.pos); // Original‐Reihenfolge
    });
    rows.forEach(r => tbody.appendChild(r));               // neue Reihenfolge anwenden
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
            await post(`/packing/${window.PACK_LIST_ID}/settings`, payload);
            showInlineAlert('success', 'Settings updated');
            setTimeout(() => location.reload(), 100);
        } catch (err) {
            showInlineAlert('error', err.message);
            /* Reload to force consistent switches */
            setTimeout(() => location.reload(), 800);
        }
    });
}

/* ============ Packed-Status (lokal) ========================== */
function initPackedToggle() {
    const prefix = `packed_${window.PACK_LIST_ID}_`;

    document.querySelectorAll('[data-packed]').forEach(cb => {
        const itemId = cb.dataset.itemid;
        const row = cb.closest('tr');
        const stored = localStorage.getItem(prefix + itemId) === '1';

        if (stored) markPacked(row, cb, true);

        cb.addEventListener('change', () => {
            markPacked(row, cb, cb.checked);
        });
    });

    function markPacked(row, cb, packed) {
        const required = row.dataset.required == 'true';
        cb.checked = packed;

        if (packed) {
            localStorage.setItem(prefix + row.dataset.itemid, '1');
            row.classList.add('table-success');      // grün
            row.classList.remove('table-info');      // blau ggf. entfernen
        } else {
            localStorage.removeItem(prefix + row.dataset.itemid);
            row.classList.remove('table-success');
            if (required) row.classList.add('table-info'); // ursprüngl. Farbe zurück
        }
    }
}

/* -------- owner deletes item ----------------------------------- */
function initOwnerDeleteItem() {
    document.addEventListener('click', async e => {
        const btn = e.target.closest('[data-delete-item]');
        if (!btn) return;

        if (!confirm('Delete this item permanently?')) return;

        const itemId = btn.dataset.itemid;
        try {
            await post(`/packing/${window.PACK_LIST_ID}/item/${itemId}/delete`, {});
            showInlineAlert('success', 'Item deleted');
            setTimeout(() => location.reload(), 100);
        } catch (err) {
            showInlineAlert('error', err.message);
        }
    });
}


function init() {
    setCurrentNavLocation();
    reorderRequiredRows();
    if (window.PACK_LIST_ID) {
        initPackedToggle();
        initAssignButtons();
        initReorder();          // nur aktiv, wenn tbody[data-reorderable] existiert
        initInlineEdit();
        initQuickAdd();
        initOwnerRemove();
        initMarkEveryone();
        initOwnerFlags();
        initOwnerDeleteItem();
    }
}
