/**
 * Registration links management module
 * Handles creation, copying, and revoking of registration links
 */

import { qs, qsAll } from '../core/dom';
import { http } from '../core/http';
import { formatDateTime } from '../core/formatting';
import { createBadge, showSpinner, hideSpinner, copyWithFeedback, reloadAfterDelay, confirmAction } from '../shared/ui-helpers';
import { showInlineAlert } from '../shared/alerts';

/**
 * Render registration link rows in the table
 * @param root Root element
 * @param rows Link data
 */
function renderRows(root: HTMLElement, rows: any[]): void {
    const tb = qs<HTMLTableSectionElement>('tbody.js-rows', root)!;
    const cnt = qs<HTMLElement>('.js-count', root)!;
    tb.innerHTML = '';

    if (!rows.length) {
        const tr = document.createElement('tr');
        tr.className = 'js-empty';
        tr.innerHTML = `<td colspan="5"><div class="text-secondary small">No links yet.</div></td>`;
        tb.appendChild(tr);
        cnt.textContent = '0';
        return;
    }

    rows.forEach((r: any) => {
        const tr = document.createElement('tr');
        tr.dataset.id = r.id;

        const tokenCell = `<code class="text-wrap">${r.token}</code>`;
        const created = formatDateTime(r.createdAt);
        const expires = formatDateTime(r.expiresAt);
        const status = r.status || 'active';

        // Build full URL for copy
        const eventId = root.dataset.eventId!;
        const fullUrl = `${location.origin}/event/${encodeURIComponent(eventId)}?regToken=${encodeURIComponent(r.token)}`;

        const disabled = status !== 'active' ? 'disabled' : '';
        tr.innerHTML = `
      <td>${tokenCell}</td>
      <td>${created}</td>
      <td>${expires}</td>
      <td>${createBadge(status)}</td>
      <td class="text-end">
        <div class="btn-group btn-group-sm" role="group">
          <button class="btn btn-outline-light btn-copy" type="button" data-url="${fullUrl}" ${disabled}>
            <i class="bi bi-clipboard"></i> Copy
          </button>
          <button class="btn btn-outline-danger btn-revoke" type="button" ${status === 'revoked' ? 'disabled' : ''}>
            <i class="bi bi-x-circle"></i> Revoke
          </button>
        </div>
      </td>
    `;
        tb.appendChild(tr);
    });

    cnt.textContent = String(rows.length);
}

/**
 * Refresh the registration links list from the API
 * @param root Root element
 */
async function refreshList(root: HTMLElement): Promise<void> {
    try {
        const res = await http('GET', root.dataset.apiList!);
        renderRows(root, res.data || []);
    } catch (e: any) {
        console.error(e);
    }
}

/**
 * Handle registration link creation
 * @param btn Create button element
 */
async function handleCreate(btn: HTMLButtonElement): Promise<void> {
    const modalSel = btn.dataset.modal!;
    const modal = qs<HTMLElement>(modalSel)!;
    const root = btn.closest('.reg-links') as HTMLElement;
    const api = root.dataset.apiCreate!;
    const usesEl = qs<HTMLInputElement>('input[type="number"]', modal)!;
    const expEl = qs<HTMLInputElement>('input[type="datetime-local"]', modal)!;

    const maxUses = Math.max(1, Number(usesEl.value || 1));
    const expiresAt = expEl.value ? new Date(expEl.value) : null;

    showSpinner(btn);
    try {
        const payload: any = { maxUses };
        if (expiresAt) payload.expiresAt = expiresAt.toISOString();
        const data = await http('POST', api, payload); // { id, token }
        // Optionally auto-copy the new link
        const eventId = root.dataset.eventId!;
        const url = `${location.origin}/event/${encodeURIComponent(eventId)}?regToken=${encodeURIComponent(data.token)}`;
        await copyWithFeedback(url).catch(() => {
        });
        // Close modal (if bootstrap present)
        window.bootstrap?.Modal.getOrCreateInstance(modal)?.hide();
        await refreshList(root);
    } catch (e: any) {
        alert(`Create failed: ${e?.message || e}`);
    } finally {
        hideSpinner(btn);
    }
}

/**
 * Handle registration link revocation
 * @param btn Revoke button element
 */
async function handleRevoke(btn: HTMLButtonElement): Promise<void> {
    const tr = btn.closest('tr')!;
    const root = btn.closest('.reg-links') as HTMLElement;
    const id = tr.dataset.id!;
    const api = root.dataset.apiRevoke!;
    if (!confirmAction('Revoke this link? It cannot be used afterwards.')) return;

    showSpinner(btn);
    try {
        await http('DELETE', `${api}/${encodeURIComponent(id)}`);
        await refreshList(root);
        showInlineAlert('success', 'Link revoked');
    } catch (e: any) {
        showInlineAlert('error', e?.message || 'Revoke failed');
    } finally {
        hideSpinner(btn);
    }
}

/**
 * Initialize registration links module
 * Sets up list rendering and link operations
 */
export function initRegLinks(): void {
    const roots = qsAll<HTMLElement>('.reg-links');
    roots.forEach(refreshList);

    document.addEventListener('click', (ev) => {
        const t = ev.target as Element | null;
        if (!t) return;

        const btnCreate = t.closest<HTMLButtonElement>('.btn-create-submit');
        if (btnCreate) {
            ev.preventDefault();
            handleCreate(btnCreate);
            return;
        }

        const btnCopy = t.closest<HTMLButtonElement>('.btn-copy');
        if (btnCopy) {
            ev.preventDefault();
            const url = btnCopy.dataset.url!;
            copyWithFeedback(url, btnCopy).catch(() => {
            }); // silent
            return;
        }

        const btnRevoke = t.closest<HTMLButtonElement>('.btn-revoke');
        if (btnRevoke) {
            ev.preventDefault();
            handleRevoke(btnRevoke);
            return;
        }
    });
}
