/**
 * Admin matrix module - user permission management
 * Handles admin permission matrix UI and operations
 */

import {qs, qsAll} from '../core/dom';
import {del, get, patch, post} from '../core/http';
import {showInlineAlert} from '../shared/alerts';
import {hideSpinner, reloadAfterDelay, showSpinner} from '../shared/ui-helpers';

/**
 * Get the admin card container for an element
 */
function cardFor(el: Element): HTMLElement | null {
    return el.closest('.admin-card') as HTMLElement | null;
}

/**
 * Get the admin matrix container for an element
 */
function matrixFor(el: Element): HTMLElement | null {
    return el.closest('.admin-matrix') as HTMLElement | null;
}

/**
 * Get all permission checkboxes in a scope
 */
function permBoxes(scope: ParentNode): HTMLInputElement[] {
    return qsAll<HTMLInputElement>('input.perm-box', scope);
}

/**
 * Collect checked permission keys from a scope
 */
function collectKeys(scope: ParentNode): string[] {
    return permBoxes(scope).filter(cb => cb.checked).map(cb => cb.value);
}

/**
 * Set all permission checkboxes to a value
 */
function setAll(scope: ParentNode, value: boolean): void {
    permBoxes(scope).forEach(cb => (cb.checked = value));
}

/**
 * Apply a permission mask to checkboxes
 */
function applyMask(scope: ParentNode, mask: number): void {
    permBoxes(scope).forEach(cb => {
        const bit = Number(cb.dataset.bit ?? 0);
        cb.checked = (mask & bit) === bit;
    });
}

/**
 * Handle permission update for a user
 */
async function handleUpdate(btn: HTMLButtonElement): Promise<void> {
    const card = cardFor(btn);
    if (!card) return;
    const matrix = matrixFor(btn);
    if (!matrix) return;
    const userId = btn.dataset.userId!;
    const base = matrix.dataset.apiUpdate!;
    const url = `${base}/${encodeURIComponent(userId)}`;

    showSpinner(btn);
    try {
        const perms = collectKeys(card);
        await patch(url, {perms});
        showInlineAlert('success', 'Permissions updated');
        reloadAfterDelay(1000);
    } catch (err) {
        const error = err as Error;
        showInlineAlert('error', error.message);
    } finally {
        hideSpinner(btn);
    }
}

/**
 * Handle removing an administrator
 */
async function handleRemove(btn: HTMLButtonElement): Promise<void> {
    const card = cardFor(btn);
    if (!card) return;
    const matrix = matrixFor(btn);
    if (!matrix) return;
    const userId = btn.dataset.userId!;
    const base = matrix.dataset.apiRemove!;
    const url = `${base}/${encodeURIComponent(userId)}`;

    if (!confirm('Remove this administrator?')) return;

    showSpinner(btn);
    try {
        await del(url);
        card.remove();
        showInlineAlert('success', 'Admin removed');
        reloadAfterDelay(1000);
    } catch (err) {
        const error = err as Error;
        showInlineAlert('error', error.message);
    } finally {
        hideSpinner(btn);
    }
}

function initTypeahead(modalRoot: HTMLElement) {
    const matrix = matrixFor(modalRoot)!;
    const apiSearch = matrix.dataset.apiSearch || '';
    if (!apiSearch) return;

    const input = qs<HTMLInputElement>('input[type="text"]', modalRoot)!;
    const datalist = qs<HTMLDataListElement>('datalist', modalRoot)!;
    const hiddenId = qs<HTMLInputElement>('input[type="hidden"]#' + modalRoot.id.replace('-add-modal', '-userId'))!;
    let lastQ = '';
    input.addEventListener('input', async () => {
        const q = input.value.trim();
        hiddenId.value = '';
        if (!q || q === lastQ) return;
        lastQ = q;
        try {
            const res = await get(`${apiSearch}?q=${encodeURIComponent(q)}`);
            // Expect: [{ id, username, email }]
            datalist.innerHTML = '';
            if (res.status === 'success') {
                (res.data || []).slice(0, 10).forEach((u: any) => {
                    const opt = document.createElement('option');
                    opt.value = `${u.username || u.id}`;
                    opt.label = u.name ? `${u.name} <${u.username}>` : `${u.username || u.id}`;
                    opt.dataset.userId = String(u.id);
                    datalist.appendChild(opt);
                });
            }
        } catch {
            // ignore
        }
    });

    // When a datalist option is chosen, try to set hiddenId by label match
    input.addEventListener('change', () => {
        const match = Array.from(datalist.options).find(o => o.value === input.value);
        if (match?.dataset.userId) hiddenId.value = match.dataset.userId!;
    });
}

/**
 * Handle adding a new administrator
 */
async function handleAdd(btn: HTMLButtonElement): Promise<void> {
    const modalSel = btn.dataset.modal!;
    const modal = qs<HTMLElement>(modalSel)!;
    const matrix = matrixFor(btn)!;

    const input = qs<HTMLInputElement>('input[type="text"]', modal)!;
    const hiddenId = qs<HTMLInputElement>('input[type="hidden"]', modal)!;
    const presetSel = qs<HTMLSelectElement>('select', modal);
    const userId = hiddenId.value || input.value.trim();

    if (!userId) {
        showInlineAlert('error', 'Please select a user');
        return;
    }

    const api = matrix.dataset.apiAdd!;
    const payload: any = {userId: /^\d+$/.test(userId) ? Number(userId) : userId};
    if (presetSel && presetSel.value) payload.preset = presetSel.value;

    showSpinner(btn);
    try {
        await post(api, payload);

        showInlineAlert('success', 'Admin added');
        reloadAfterDelay(1000);
    } catch (err) {
        const error = err as Error;
        showInlineAlert('error', error.message);
    } finally {
        hideSpinner(btn);
    }
}

export function initAdminMatrix() {
    // Typeahead when modal opens (Bootstrap event)
    document.addEventListener('shown.bs.modal' as any, (ev: any) => {
        const modal = ev.target as HTMLElement;
        if (!modal.matches('.modal.admin-modal')) return;
        initTypeahead(modal);
    });

    document.addEventListener('click', (ev) => {
        const t = ev.target as Element | null;
        if (!t) return;

        // Presets / All / None
        const btnPreset = t.closest<HTMLButtonElement>('.admin-perm-preset');
        const btnAll = t.closest<HTMLButtonElement>('.admin-perm-select-all');
        const btnClear = t.closest<HTMLButtonElement>('.admin-perm-clear');
        const btnUpdate = t.closest<HTMLButtonElement>('.btn-admin-update');
        const btnRemove = t.closest<HTMLButtonElement>('.btn-admin-remove');
        const btnAdd = t.closest<HTMLButtonElement>('.btn-admin-add-submit');

        if (btnPreset) {
            const card = cardFor(btnPreset);
            if (!card) return;
            const mask = Number(btnPreset.dataset.mask ?? '0');
            applyMask(card, mask);
            ev.preventDefault();
            return;
        }
        if (btnAll) {
            const card = cardFor(btnAll);
            if (!card) return;
            setAll(card, true);
            ev.preventDefault();
            return;
        }
        if (btnClear) {
            const card = cardFor(btnClear);
            if (!card) return;
            setAll(card, false);
            ev.preventDefault();
            return;
        }
        if (btnUpdate) {
            ev.preventDefault();
            handleUpdate(btnUpdate);
            return;
        }
        if (btnRemove) {
            ev.preventDefault();
            handleRemove(btnRemove);
            return;
        }
        if (btnAdd) {
            ev.preventDefault();
            handleAdd(btnAdd);
            return;
        }
    });
}
