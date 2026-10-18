/**
 * Admin matrix module - user permission management
 * Handles admin permission matrix UI and operations
 */

import {qs, qsAll} from '../core/dom';
import {assertSuccessfulResponse, del, get, patch, post} from '../core/http';
import {beginEntityCommand, reportEntityCommandError} from '../shared/ui-helpers';

const typeaheads = new WeakSet<HTMLElement>();
const initializedDocuments = new WeakSet<Document>();

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
    const keys: string[] = [];
    for (const checkbox of permBoxes(scope)) if (checkbox.checked) keys.push(checkbox.value);
    return keys;
}

/**
 * Set all permission checkboxes to a value
 */
function setAll(scope: ParentNode, value: boolean): void {
    for (const checkbox of permBoxes(scope)) checkbox.checked = value;
}

/**
 * Apply a permission mask to checkboxes
 */
function applyMask(scope: ParentNode, mask: number): void {
    for (const checkbox of permBoxes(scope)) {
        const bit = Number(checkbox.dataset.bit ?? 0);
        checkbox.checked = (mask & bit) === bit;
    }
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

    const command = beginEntityCommand(btn);
    if (!command) return;
    try {
        const perms = collectKeys(card);
        const response = await patch(url, {perms});
        assertSuccessfulResponse(response);
        command.success('Permissions updated');
    } catch (err) {
        command.error(err);
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

    const command = beginEntityCommand(btn);
    if (!command) return;
    try {
        const response = await del(url);
        assertSuccessfulResponse(response);
        command.success('Admin removed');
    } catch (err) {
        command.error(err);
    }
}

/**
 * Bind search only when its editor is first shown. The selected profile ID is separate from the
 * presentation text: typing invalidates it, and only a matching server result can establish it.
 * Request generations also cover A → B → A typing so an older A cannot replace a newer response.
 */
function initTypeahead(modalRoot: HTMLElement): void {
    if (typeaheads.has(modalRoot)) return;
    const matrix = matrixFor(modalRoot)!;
    const apiSearch = matrix.dataset.apiSearch || '';
    if (!apiSearch) return;
    typeaheads.add(modalRoot);

    const input = qs<HTMLInputElement>('input[type="text"]', modalRoot)!;
    const datalist = qs<HTMLDataListElement>('datalist', modalRoot)!;
    const hiddenId = qs<HTMLInputElement>('input[type="hidden"]#' + modalRoot.id.replace('-add-modal', '-userId'))!;
    let lastQ = '';
    let requestGeneration = 0;

    async function searchAdministrators(): Promise<void> {
        if (input.disabled) return;
        const generation = ++requestGeneration;
        const q = input.value.trim();

        let match = matchingUser(datalist, q);
        if (match?.dataset.userId) {
            hiddenId.value = match.dataset.userId!;
            return;
        }

        hiddenId.value = '';
        if (!q || q === lastQ) return;
        try {
            const res = await get(`${apiSearch}?q=${encodeURIComponent(q)}`);
            if (input.disabled || generation !== requestGeneration || input.value.trim() !== q) return;
            // Expect: [{ id, username, email }]
            datalist.replaceChildren();
            if (res.status === 'success') {
                lastQ = q;
                for (const u of (res.data || []).slice(0, 10)) {
                    const opt = document.createElement('option');
                    opt.value = `${u.username || u.id}`;
                    opt.label = u.name ? `${u.name} <${u.username}>` : `${u.username || u.id}`;
                    opt.dataset.userId = String(u.id);
                    datalist.appendChild(opt);
                }

                match = matchingUser(datalist, q);
                if (match?.dataset.userId) {
                    hiddenId.value = match.dataset.userId!;
                }
            }
        } catch {
            // The ID stays empty, so a failed search cannot submit a stale profile. Keep the same
            // query retryable on the next input event rather than caching a failed request.
        }
    }

    function resetSearch(): void {
        // Hidden .value reflects into its defaultValue. Explicitly clear that selection before a
        // native form reset, otherwise Cancel would retain the last profile behind an empty label.
        requestGeneration++;
        lastQ = '';
        hiddenId.value = '';
        datalist.replaceChildren();
    }

    input.addEventListener('input', searchAdministrators);
    input.form?.addEventListener('reset', resetSearch);
}

function matchingUser(datalist: HTMLDataListElement, query: string): HTMLOptionElement | undefined {
    for (const option of datalist.options) if (option.value === query) return option;
    return undefined;
}

/** Typeahead Enter must not submit the parent page; Add is the explicit authorized command. */
function preventEditorSubmit(event: Event): void {
    const form = event.target as HTMLFormElement;
    if (form.closest('.admin-matrix')) event.preventDefault();
}

/**
 * Handle adding a new administrator
 */
async function handleAdd(btn: HTMLButtonElement): Promise<void> {
    const modalSel = btn.dataset.modal!;
    const modal = qs<HTMLElement>(modalSel)!;
    const matrix = matrixFor(btn)!;

    const hiddenId = qs<HTMLInputElement>('input[type="hidden"]', modal)!;
    const presetSel = qs<HTMLSelectElement>('select', modal);
    const userId = hiddenId.value;

    if (!userId) {
        reportEntityCommandError(btn, new Error('Please select a user'));
        return;
    }
    const command = beginEntityCommand(btn);
    if (!command) return;

    const api = matrix.dataset.apiAdd!;
    const payload: any = {profileId: userId};
    if (presetSel?.value) payload.preset = presetSel.value;

    try {
        const response = await post(api, payload);
        assertSuccessfulResponse(response);

        command.success('Admin added');
    } catch (err) {
        command.error(err);
    }
}

export function initAdminMatrix(): void {
    if (initializedDocuments.has(document)) return;
    initializedDocuments.add(document);
    // Typeahead when modal opens (Bootstrap event)
    function openEditor(ev: Event): void {
        const modal = ev.target as HTMLElement;
        if (!modal.matches('.modal.admin-modal, .admin-inline')) return;
        initTypeahead(modal);
    }
    document.addEventListener('shown.bs.modal', openEditor);
    document.addEventListener('shown.bs.collapse', openEditor);
    document.addEventListener('submit', preventEditorSubmit);

    document.addEventListener('click', handleClick);
}

function handleClick(ev: MouseEvent): void {
    const t = ev.target as Element | null;
    if (!t) return;
    if (t.closest<HTMLButtonElement>('button')?.disabled) return;

    // Presets / All / None
    const btnPreset = t.closest<HTMLButtonElement>('.admin-perm-preset');
    const btnAll = t.closest<HTMLButtonElement>('.admin-perm-select-all');
    const btnClear = t.closest<HTMLButtonElement>('.admin-perm-clear');
    const btnUpdate = t.closest<HTMLButtonElement>('.btn-admin-update');
    const btnRemove = t.closest<HTMLButtonElement>('.btn-admin-remove');
    const btnAdd = t.closest<HTMLButtonElement>('.btn-admin-add-submit');
    const btnCancel = t.closest<HTMLButtonElement>('[data-admin-cancel]');

    if (btnCancel) {
        ev.preventDefault();
        const editor = document.querySelector<HTMLElement>(btnCancel.dataset.adminCancel!);
        editor?.querySelector<HTMLFormElement>('form')?.reset();
        if (editor) {
            // Reuse Bootstrap's collapse so inline cancellation leaves the parent modal open.
            (window as any).bootstrap?.Collapse.getOrCreateInstance(editor, {toggle: false}).hide();
            const trigger = matrixFor(btnCancel)?.querySelector<HTMLButtonElement>('.btn-admin-add');
            trigger?.focus();
        }
        return;
    }

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
    }
}
