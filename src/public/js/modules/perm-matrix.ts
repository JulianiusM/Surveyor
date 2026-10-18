/**
 * Permission matrix module - entity permission management
 * Handles permission matrix UI for entities with audience-based permissions
 */

import {assertSuccessfulResponse, post} from '../core/http';
import { qsAll } from '../core/dom';
import {beginEntityCommand} from '../shared/ui-helpers';

const initializedDocuments = new WeakSet<Document>();

// Find the matrix root that contains the clicked control
function matrixRootFor(el: Element): HTMLElement | null {
    return el.closest('.perm-matrix') as HTMLElement | null;
}

// Scope by the stable audience hook rather than layout: grouping and collapsed help are presentation.
function audContainer(matrixRoot: Element, aud: string): HTMLElement | null {
    return matrixRoot.querySelector<HTMLElement>(`[data-permission-audience="${aud}"]`);
}

function setAudience(matrixRoot: Element, aud: string, value: boolean): void {
    const scope = audContainer(matrixRoot, aud);
    if (!scope) return;
    for (const checkbox of qsAll<HTMLInputElement>('input.perm-box', scope)) checkbox.checked = value;
}

function applyPreset(matrixRoot: Element, aud: string, mask: number): void {
    const scope = audContainer(matrixRoot, aud);
    if (!scope) return;
    for (const checkbox of qsAll<HTMLInputElement>('input.perm-box', scope)) {
        const bit = Number(checkbox.dataset.bit ?? 0);
        checkbox.checked = (mask & bit) === bit;
    }
}

// Every audience participates in a save, including hidden panels and intentionally empty masks.
function collectPerms(matrixRoot: HTMLElement): Record<string, Record<string, string[]>> {
    const fieldBase = matrixRoot.dataset.fieldBase || 'defaultPerms';
    const byAudience: Record<string, string[]> = {};
    for (const panel of qsAll<HTMLElement>('[data-permission-audience]', matrixRoot)) {
        const keys: string[] = [];
        for (const checkbox of qsAll<HTMLInputElement>('input.perm-box:checked', panel)) keys.push(checkbox.value);
        byAudience[panel.dataset.permissionAudience!] = keys;
    }
    return {[fieldBase]: byAudience};
}

/** Presentation changes never reset another audience's draft or masquerade as a saved edit. */
function changeAudience(event: Event): void {
    const selector = event.target as HTMLSelectElement;
    if (!selector.matches('.perm-audience')) return;
    const matrix = matrixRootFor(selector);
    if (!matrix) return;
    for (const panel of matrix.querySelectorAll<HTMLElement>('[data-permission-audience]')) {
        panel.hidden = panel.dataset.permissionAudience !== selector.value;
    }
}

export function initPermMatrix(): void {
    if (initializedDocuments.has(document)) return;
    initializedDocuments.add(document);
    document.addEventListener('change', changeAudience);
    // One delegated binding also covers permission editors revealed after the modal opens.
    document.addEventListener('click', handleClick);
}

async function handleClick(ev: MouseEvent): Promise<void> {
    const target = ev.target as Element | null;
    if (!target) return;

    const btnAll = target.closest<HTMLButtonElement>('.perm-select-all');
    const btnClear = target.closest<HTMLButtonElement>('.perm-clear');
    const btnPreset = target.closest<HTMLButtonElement>('.perm-preset');
    const btnUpdate = target.closest<HTMLButtonElement>('.btn-perm-update');

    const btn = btnAll || btnClear || btnPreset || btnUpdate;
    if (!btn || btn.disabled) return;

    const matrixRoot = matrixRootFor(btn);
    if (!matrixRoot) return;

    // Bulk edits affect only the control's audience. The hidden panels retain their drafts so a
    // later save can send the complete API contract without rebuilding defaults in browser code.
    if (btnAll || btnClear || btnPreset) {
        const aud = btn.dataset.aud!;
        if (btnAll) setAudience(matrixRoot, aud, true);
        if (btnClear) setAudience(matrixRoot, aud, false);
        if (btnPreset) {
            const mask = Number(btn.dataset.mask ?? '0');
            applyPreset(matrixRoot, aud, mask);
        }
        ev.preventDefault();
        return;
    }

    if (!btnUpdate) return;
    ev.preventDefault();
    const api = btnUpdate.dataset.api;
    if (!api) return;

    // The enclosing settings dialog owns locking, draft-discard confirmation and local feedback.
    // Read all masks even while that host has disabled the controls for this request.
    const command = beginEntityCommand(btnUpdate);
    if (!command) return;

    try {
        const payload = collectPerms(matrixRoot);
        const response = await post(api, payload);
        assertSuccessfulResponse(response);

        command.success('Permissions updated');
    } catch (err) {
        command.error(err);
    }
}
