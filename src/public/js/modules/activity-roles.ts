/**
 * Activity Roles Module
 * Handles role management and role admin modal functionality
 */

import {post} from '../core/http';
import {showInlineAlert} from '../shared/alerts';
import {reloadAfterDelay} from '../shared/ui-helpers';
import {requireEntityPerm} from '../core/permissions';

interface BootstrapModal {
    show: () => void;
    hide: () => void;
}

interface BootstrapGlobal {
    Modal: new (element: HTMLElement, options?: { focus?: boolean }) => BootstrapModal;
}

declare const bootstrap: BootstrapGlobal;

export interface RoleSummary {
    id: number;
    name: string;
    description?: string | null;
}

interface SlotRolesMap {
    [slotId: string]: RoleSummary[];
}

interface SlotParticipant {
    id: string;
    name: string;
}

interface SlotRoleRow {
    roleName: string;
    roleLabel: string;
    assignmentId: string | null;
}

/**
 * Get all roles from global window object
 */
export function getAllRoles(): RoleSummary[] {
    return (window.Surveyor?.allRoles || []) as RoleSummary[];
}

/**
 * Get roles for a specific slot
 */
export function getSlotRolesForSlot(slotId: string): RoleSummary[] {
    const map = (window.Surveyor?.slotRoles || {}) as SlotRolesMap;
    return map[slotId] || [];
}

/**
 * Add a role to the global roles list
 */
export function addRoleToGlobal(role: RoleSummary): void {
    const list = getAllRoles();
    if (!list.some((r) => r.id === role.id)) {
        list.push(role);
    }
    // keep window.Surveyor in sync
    if (!window.Surveyor) {
        window.Surveyor = {} as any;
    }
    window.Surveyor.allRoles = list;
}

/**
 * Initialize role admin modal for managing slot role assignments
 */
export function initSlotRoleAdminModal(planId: string, describeSlot: (slotId: string) => string): void {
    if (!planId) return;

    const modalEl = document.getElementById('slotRoleAdminModal') as HTMLElement | null;
    const bodyEl = document.getElementById('slotRoleAdminBody') as HTMLElement | null;
    const titleEl = document.getElementById('slotRoleAdminTitle') as HTMLElement | null;
    const slotIdInput = document.getElementById('slotRoleAdminSlotId') as HTMLInputElement | null;
    const errorEl = document.getElementById('slotRoleAdminError') as HTMLElement | null;
    const saveBtn = document.getElementById('slotRoleAdminSave') as HTMLButtonElement | null;

    if (!modalEl || !bodyEl || !slotIdInput || !saveBtn) return;

    const modal: BootstrapModal | null =
        typeof bootstrap !== 'undefined'
            ? new bootstrap.Modal(modalEl, {focus: true})
            : null;

    let currentSlotId: string | null = null;

    const setError = (message?: string) => {
        if (!errorEl) return;
        if (!message) {
            errorEl.textContent = '';
            errorEl.classList.add('d-none');
        } else {
            errorEl.textContent = message;
            errorEl.classList.remove('d-none');
        }
    };

    const collectParticipants = (slotEl: HTMLElement): SlotParticipant[] => {
        const result: SlotParticipant[] = [];
        const lis = slotEl.querySelectorAll<HTMLLIElement>('ul.list-unstyled li');
        lis.forEach((li) => {
            const btn = li.querySelector<HTMLElement>('[data-assignid]');
            const nameSpan = li.querySelector<HTMLElement>('span.flex-grow-1');
            const id = btn?.dataset.assignid || '';
            const name = nameSpan?.textContent?.trim() || '';
            if (!id || !name) return;
            result.push({id, name});
        });
        return result;
    };

    const collectRoles = (slotEl: HTMLElement): SlotRoleRow[] => {
        const rows: SlotRoleRow[] = [];
        const roleEls = slotEl.querySelectorAll<HTMLElement>('.role-assignment[data-role-name]');
        roleEls.forEach((el) => {
            const roleName = el.dataset.roleName;
            if (!roleName) return;
            const roleLabel = el.dataset.roleLabel || roleName;
            const assignmentId = el.dataset.assignmentId || null;
            rows.push({roleName, roleLabel, assignmentId});
        });
        return rows;
    };

    const renderTable = (participants: SlotParticipant[], roles: SlotRoleRow[]) => {
        bodyEl.innerHTML = '';

        if (!roles.length) {
            const tr = document.createElement('tr');
            tr.dataset.emptyState = '1';

            const td = document.createElement('td');
            td.colSpan = 2;
            td.className = 'text-center text-secondary pt-3';
            td.textContent = 'No roles for this slot.';

            tr.appendChild(td);
            bodyEl.appendChild(tr);
            saveBtn.disabled = true;
            return;
        }

        saveBtn.disabled = false;

        roles.forEach((role) => {
            const tr = document.createElement('tr');
            tr.dataset.roleName = role.roleName;

            const tdRole = document.createElement('td');
            tdRole.className = 'align-middle';
            tdRole.textContent = role.roleLabel;

            const tdParticipant = document.createElement('td');
            const select = document.createElement('select');
            select.className = 'form-select form-select-sm text-bg-dark';
            select.dataset.slotRoleAdminSelect = '1';
            select.dataset.roleName = role.roleName;

            const optNone = document.createElement('option');
            optNone.value = '';
            optNone.textContent = '-- None --';
            select.appendChild(optNone);

            participants.forEach((p) => {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = p.name;
                if (role.assignmentId && role.assignmentId === p.id) {
                    opt.selected = true;
                }
                select.appendChild(opt);
            });

            tdParticipant.appendChild(select);
            tr.append(tdRole, tdParticipant);
            bodyEl.appendChild(tr);
        });
    };

    document.addEventListener('click', (e: Event) => {
        const target = e.target as Element | null;
        if (!target) return;

        const btn = target.closest<HTMLElement>('[data-slot-role-admin]');
        if (!btn) return;

        const slotId = btn.dataset.slotid;
        if (!slotId) return;

        const slotEl = document.querySelector<HTMLElement>(`.slot[data-slotid="${slotId}"]`);
        if (!slotEl) return;

        currentSlotId = slotId;
        slotIdInput.value = slotId;
        setError();

        const title = describeSlot(slotId);
        if (titleEl) {
            titleEl.textContent = `Manage role assignments – ${title}`;
        }

        const participants = collectParticipants(slotEl);
        const roles = collectRoles(slotEl);

        renderTable(participants, roles);
        modal?.show();
    });

    saveBtn.addEventListener('click', async () => {
        if (!currentSlotId) return;
        setError();

        const selects = bodyEl.querySelectorAll<HTMLSelectElement>(
            'select[data-slot-role-admin-select]',
        );
        const assignments: { role: string; assignmentId: string | null }[] = [];

        selects.forEach((select) => {
            const roleName = select.dataset.roleName;
            if (!roleName) return;
            const value = select.value || '';
            assignments.push({
                role: roleName,
                assignmentId: value || null,
            });
        });

        try {
            requireEntityPerm('MANAGE_ASSIGNMENTS', 'manage role assignments');
            await post(`/api/activity/${planId}/slot/${currentSlotId}/roles/admin`, {
                assignments,
            });
            showInlineAlert('success', 'Role assignments updated');
            modal?.hide();
            reloadAfterDelay(150);
        } catch (err) {
            const message =
                err instanceof Error ? err.message : 'Failed to update role assignments.';
            setError(message);
            showInlineAlert('error', message);
        }
    });
}
