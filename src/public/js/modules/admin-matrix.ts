// src/public/js/admin-matrix.ts
import {showInlineAlert} from "./module_functions";

function qs<T extends Element>(sel: string, scope: ParentNode | Document = document): T | null {
    return scope.querySelector(sel) as T | null;
}

function qsAll<T extends Element>(sel: string, scope: ParentNode | Document = document): T[] {
    return Array.from(scope.querySelectorAll(sel)) as T[];
}

function cardFor(el: Element): HTMLElement | null {
    return el.closest('.admin-card') as HTMLElement | null;
}

function matrixFor(el: Element): HTMLElement | null {
    return el.closest('.admin-matrix') as HTMLElement | null;
}

function permBoxes(scope: ParentNode): HTMLInputElement[] {
    return qsAll<HTMLInputElement>('input.perm-box', scope);
}

function collectKeys(scope: ParentNode): string[] {
    return permBoxes(scope).filter(cb => cb.checked).map(cb => cb.value);
}

async function http(method: string, url: string, body?: any) {
    const res = await fetch(url, {
        method,
        headers: {'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest'},
        body: body ? JSON.stringify(body) : undefined,
        credentials: 'same-origin',
    });
    const text = await res.text();
    let data: any = null;
    try {
        data = text ? JSON.parse(text) : null;
    } catch {
    }
    if (!res.ok) {
        const msg = (data && (data.message || data.error)) || `HTTP ${res.status}`;
        throw new Error(msg);
    }
    return data;
}

function setAll(scope: ParentNode, value: boolean) {
    permBoxes(scope).forEach(cb => (cb.checked = value));
}

function applyMask(scope: ParentNode, mask: number) {
    permBoxes(scope).forEach(cb => {
        const bit = Number(cb.dataset.bit ?? 0);
        cb.checked = (mask & bit) === bit;
    });
}

function spinnerOn(btn: HTMLButtonElement) {
    btn.disabled = true;
    const sp = btn.querySelector('.spinner-border') as HTMLElement | null;
    if (sp) sp.classList.remove('d-none');
}

function spinnerOff(btn: HTMLButtonElement) {
    btn.disabled = false;
    const sp = btn.querySelector('.spinner-border') as HTMLElement | null;
    if (sp) sp.classList.add('d-none');
}

async function handleUpdate(btn: HTMLButtonElement) {
    const card = cardFor(btn);
    if (!card) return;
    const matrix = matrixFor(btn);
    if (!matrix) return;
    const userId = btn.dataset.userId!;
    const base = matrix.dataset.apiUpdate!;
    const url = `${base}/${encodeURIComponent(userId)}`;

    spinnerOn(btn);
    try {
        const perms = collectKeys(card);
        await http('PATCH', url, {perms}); // backend should map keys → mask
        showInlineAlert('success', 'Permissions updated');
        setTimeout(() => location.reload(), 1000);
    } catch (err) {
        // @ts-expect-error TS(2571): Object is of type 'unknown'.
        showInlineAlert('error', err.message);
    } finally {
        spinnerOff(btn);
    }
}

async function handleRemove(btn: HTMLButtonElement) {
    const card = cardFor(btn);
    if (!card) return;
    const matrix = matrixFor(btn);
    if (!matrix) return;
    const userId = btn.dataset.userId!;
    const base = matrix.dataset.apiRemove!;
    const url = `${base}/${encodeURIComponent(userId)}`;

    if (!confirm('Remove this administrator?')) return;

    spinnerOn(btn);
    try {
        await http('DELETE', url);
        card.remove();
        showInlineAlert('success', 'Admin removed');
        setTimeout(() => location.reload(), 1000);
    } catch (err) {
        // @ts-expect-error TS(2571): Object is of type 'unknown'.
        showInlineAlert('error', err.message);
    } finally {
        spinnerOff(btn);
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
            const res = await http('GET', `${apiSearch}?q=${encodeURIComponent(q)}`);
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

async function handleAdd(btn: HTMLButtonElement) {
    const modalSel = btn.dataset.modal!;
    const modal = qs<HTMLElement>(modalSel)!;
    const matrix = matrixFor(btn)!;

    const input = qs<HTMLInputElement>('input[type="text"]', modal)!;
    const hiddenId = qs<HTMLInputElement>('input[type="hidden"]', modal)!;
    const presetSel = qs<HTMLSelectElement>('select', modal);
    const userId = hiddenId.value || input.value.trim();

    if (!userId) {
        alert('Please select a user');
        return;
    }

    const api = matrix.dataset.apiAdd!;
    const payload: any = {userId: /^\d+$/.test(userId) ? Number(userId) : userId};
    if (presetSel && presetSel.value) payload.preset = presetSel.value;

    spinnerOn(btn);
    try {
        await http('POST', api, payload);

        showInlineAlert('success', 'Admin added');
        setTimeout(() => location.reload(), 1000);
    } catch (err) {
        // @ts-expect-error TS(2571): Object is of type 'unknown'.
        showInlineAlert('error', err.message);
    } finally {
        spinnerOff(btn);
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
