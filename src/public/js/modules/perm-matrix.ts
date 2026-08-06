/**
 * Permission matrix module - entity permission management
 * Handles permission matrix UI for entities with audience-based permissions
 */

import { post } from '../core/http';
import { qsAll } from '../core/dom';
import { showInlineAlert } from '../shared/alerts';
import { showSpinner, hideSpinner, reloadAfterDelay } from '../shared/ui-helpers';

// Find the matrix root that contains the clicked control
function matrixRootFor(el: Element): HTMLElement | null {
    return el.closest('.perm-matrix') as HTMLElement | null;
}

// Find the audience container inside a specific matrix
function audContainer(matrixRoot: Element, aud: string): HTMLElement | null {
    // Prefer accordion body (new layout); fall back to card body (old layout)
    return (
        matrixRoot.querySelector(`.accordion-body .row[data-aud="${aud}"]`) ||
        matrixRoot.querySelector(`.card-body .row[data-aud="${aud}"]`)
    ) as HTMLElement | null;
}

function setAudience(matrixRoot: Element, aud: string, value: boolean) {
    const scope = audContainer(matrixRoot, aud);
    if (!scope) return;
    qsAll<HTMLInputElement>('input.perm-box', scope).forEach(cb => (cb.checked = value));
}

function applyPreset(matrixRoot: Element, aud: string, mask: number) {
    const scope = audContainer(matrixRoot, aud);
    if (!scope) return;
    qsAll<HTMLInputElement>('input.perm-box', scope).forEach(cb => {
        const bit = Number(cb.dataset.bit ?? 0);
        cb.checked = (mask & bit) === bit;
    });
}

// ---------- NEW: collect matrix into JSON ----------
function collectPerms(matrixRoot: HTMLElement) {
    const fieldBase = matrixRoot.dataset.fieldBase || 'defaultPerms';
    const payload: Record<string, any> = {};
    const byAudience: Record<string, string[]> = {};
    qsAll<HTMLElement>('.row[data-aud]', matrixRoot).forEach(row => {
        const aud = row.dataset.aud!;
        const keys = qsAll<HTMLInputElement>('input.perm-box:checked', row).map(cb => cb.value);
        byAudience[aud] = keys; // empty array => clear perms for that audience
    });
    payload[fieldBase] = byAudience;
    return payload;
}

export function initPermMatrix() {
// Event delegation: resolve matrix root from the clicked button
    document.addEventListener('click', async (ev) => {
        const target = ev.target as Element | null;
        if (!target) return;

        const btnAll = target.closest<HTMLButtonElement>('.perm-select-all');
        const btnClear = target.closest<HTMLButtonElement>('.perm-clear');
        const btnPreset = target.closest<HTMLButtonElement>('.perm-preset');
        const btnUpdate = target.closest<HTMLButtonElement>('.btn-perm-update');

        const btn = btnAll || btnClear || btnPreset || btnUpdate;
        if (!btn) return;

        const matrixRoot = matrixRootFor(btn);
        if (!matrixRoot) return;

        if (btnAll || btnClear || btnPreset) {
            const aud = (btn as HTMLButtonElement).dataset.aud!;
            if (btnAll) setAudience(matrixRoot, aud, true);
            if (btnClear) setAudience(matrixRoot, aud, false);
            if (btnPreset) {
                const mask = Number((btn as HTMLButtonElement).dataset.mask ?? '0');
                applyPreset(matrixRoot, aud, mask);
            }
            ev.preventDefault();
            return;
        }

        if (btnUpdate) {
            ev.preventDefault();
            const api = (btnUpdate as HTMLButtonElement).dataset.api;
            if (!api) return;

            // UI state: disable + spinner
            showSpinner(btnUpdate);

            try {
                const payload = collectPerms(matrixRoot);
                await post(api, payload);

                showInlineAlert('success', 'Permissions updated');
                reloadAfterDelay(1000);
            } catch (err) {
                const error = err as Error;
                showInlineAlert('error', error.message);
            } finally {
                hideSpinner(btnUpdate);
            }
            return;
        }
    });
}