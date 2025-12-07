/**
 * Activity Slot Editor Module
 * Handles the slot editor modal for creating and editing slots
 */

import {post} from '../core/http';
import {showInlineAlert} from '../shared/alerts';
import {reloadAfterDelay} from '../shared/ui-helpers';
import {requireEntityPerm} from '../core/permissions';
import {getAllRoles, getSlotRolesForSlot, addRoleToGlobal, type RoleSummary} from './activity-roles';

interface BootstrapModal {
    show: () => void;
    hide: () => void;
}

interface BootstrapGlobal {
    Modal: new (element: HTMLElement, options?: { focus?: boolean }) => BootstrapModal;
}

declare const bootstrap: BootstrapGlobal;

type SlotEditorMode = 'create' | 'edit';

/**
 * Format time for display (HH:MM)
 */
function formatTimeLabel(time?: string | null): string {
    if (!time) return "";
    return time.slice(0, 5);
}

/**
 * Convert Date to datetime-local input value
 */
function toDateTimeLocalValue(date?: string | Date | null): string {
    if (!date) return '';
    const d = typeof date === 'string' ? new Date(date) : date;
    if (Number.isNaN(d.getTime())) return '';

    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Convert datetime-local value to ISO string
 */
function toISOStringOrNull(value: string): string | null {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Initialize the slot editor modal (used for both create and edit)
 */
export function initSlotEditorModal(planId: string, describeSlot: (slotId: string) => string): void {
    if (!planId) return;

    const modalEl = document.getElementById('slotEditorModal') as HTMLElement | null;
    const form = document.getElementById('slotEditorForm') as HTMLFormElement | null;
    const titleEl = document.getElementById('slotEditorTitle') as HTMLElement | null;
    const slotIdInput = document.getElementById('slotEditorSlotId') as HTMLInputElement | null;
    const dateInput = document.getElementById('slotEditorDate') as HTMLInputElement | null;
    const titleInput = document.getElementById('slotEditorTitleInput') as HTMLInputElement | null;
    const descInput = document.getElementById('slotEditorDescription') as HTMLTextAreaElement | null;
    const startInput = document.getElementById('slotEditorStartTime') as HTMLInputElement | null;
    const endInput = document.getElementById('slotEditorEndTime') as HTMLInputElement | null;
    const capacityInput = document.getElementById('slotEditorCapacity') as HTMLInputElement | null;
    const metaSpan = document.getElementById('slotEditorMeta') as HTMLElement | null;
    const errorSpan = document.getElementById('slotEditorError') as HTMLElement | null;

    const roleChips = document.getElementById('slotEditorRoleChips') as HTMLElement | null;
    const roleInput = document.getElementById('slotEditorRoleInput') as HTMLInputElement | null;
    const roleSuggestions = document.getElementById('slotEditorRoleSuggestions') as HTMLElement | null;

    if (
        !modalEl ||
        !form ||
        !slotIdInput ||
        !dateInput ||
        !titleInput ||
        !startInput ||
        !endInput ||
        !capacityInput
    ) {
        return;
    }

    const modal = new bootstrap.Modal(modalEl, {focus: true});
    let mode: SlotEditorMode = 'create';
    let selectedRoleIds = new Set<number>();

    const setError = (message?: string) => {
        if (!errorSpan) return;
        if (!message) {
            errorSpan.textContent = '';
            errorSpan.classList.add('d-none');
        } else {
            errorSpan.textContent = message;
            errorSpan.classList.remove('d-none');
        }
    };

    const toTimeInputValue = (dbTime?: string | null): string => {
        if (!dbTime) return '';
        const parts = dbTime.split(':');
        if (parts.length >= 2) {
            const hh = parts[0].padStart(2, '0');
            const mm = parts[1].padStart(2, '0');
            return `${hh}:${mm}`;
        }
        return '';
    };

    const toDbTime = (value?: string | null): string | null => {
        if (!value) return null;
        // HTML time input returns "HH:MM"
        return `${value}:00`;
    };

    const setSelectedRoles = (ids: number[]) => {
        selectedRoleIds = new Set(ids);
        renderRoleChips();
        updateRoleSuggestions();
    };

    const renderRoleChips = () => {
        if (!roleChips) return;
        roleChips.innerHTML = '';

        if (selectedRoleIds.size === 0) {
            const span = document.createElement('span');
            span.className = 'text-secondary';
            span.textContent = 'No roles assigned yet';
            roleChips.appendChild(span);
            return;
        }

        const allRoles = getAllRoles();
        const sorted = Array.from(selectedRoleIds)
            .map((id) => allRoles.find((r) => r.id === id))
            .filter((r) => r !== undefined) as RoleSummary[];

        sorted.forEach((role) => {
            const chip = document.createElement('span');
            chip.className = 'badge bg-primary me-1';
            chip.innerHTML = `
                ${role.name}
                <button type="button" class="btn-close btn-close-white ms-1" data-remove-role="${role.id}" style="font-size:0.7em"></button>
            `;
            roleChips.appendChild(chip);
        });
    };

    const updateRoleSuggestions = () => {
        if (!roleSuggestions) return;
        roleSuggestions.innerHTML = '';

        const query = roleInput?.value?.trim().toLowerCase() || '';
        const allRoles = getAllRoles();

        const filtered = allRoles.filter(
            (r) =>
                !selectedRoleIds.has(r.id) &&
                r.name.toLowerCase().includes(query)
        );

        if (!filtered.length && query) {
            // offer create
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'dropdown-item text-success';
            btn.textContent = `+ Create role "${query}"`;
            btn.dataset.createRole = query;
            roleSuggestions.appendChild(btn);
            return;
        }

        filtered.forEach((role) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'dropdown-item';
            btn.textContent = role.name;
            btn.dataset.addRoleId = String(role.id);
            roleSuggestions.appendChild(btn);
        });
    };

    // handle chip removal
    roleChips?.addEventListener('click', (e: Event) => {
        const btn = (e.target as HTMLElement).closest('[data-remove-role]') as HTMLElement | null;
        if (!btn) return;
        const id = parseInt(btn.dataset.removeRole || '0', 10);
        if (id) {
            selectedRoleIds.delete(id);
            renderRoleChips();
            updateRoleSuggestions();
        }
    });

    // handle role input changes
    roleInput?.addEventListener('input', () => {
        updateRoleSuggestions();
        if (roleSuggestions) {
            roleSuggestions.classList.toggle('d-none', roleSuggestions.children.length === 0);
        }
    });

    // handle suggestion click
    roleSuggestions?.addEventListener('click', async (e: Event) => {
        const btn = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
        if (!btn) return;

        const addId = btn.dataset.addRoleId;
        if (addId) {
            const id = parseInt(addId, 10);
            selectedRoleIds.add(id);
            renderRoleChips();
            if (roleInput) roleInput.value = '';
            updateRoleSuggestions();
            if (roleSuggestions) roleSuggestions.classList.add('d-none');
            return;
        }

        const createName = btn.dataset.createRole;
        if (createName) {
            // Create new role
            try {
                const res = await post(`/api/activity/${planId}/role`, {name: createName});
                const newRole = res?.data?.role;
                if (newRole) {
                    addRoleToGlobal(newRole);
                    selectedRoleIds.add(newRole.id);
                    renderRoleChips();
                    if (roleInput) roleInput.value = '';
                    updateRoleSuggestions();
                    if (roleSuggestions) roleSuggestions.classList.add('d-none');
                }
            } catch (err) {
                const message = err instanceof Error ? err.message : 'Failed to create role';
                setError(message);
            }
        }
    });

    // Handle opening in CREATE mode
    document.addEventListener('click', (e: Event) => {
        const target = e.target as Element | null;
        if (!target) return;

        const btn = target.closest('[data-add-slot]') as HTMLElement | null;
        if (!btn) return;

        try {
            requireEntityPerm('ITEM_CREATE', 'create slots');
        } catch (err) {
            const message = err instanceof Error ? err.message : 'You cannot create slots.';
            showInlineAlert('error', message);
            return;
        }

        const dateStr = btn.dataset.date || '';
        if (!dateStr) return;

        mode = 'create';
        if (titleEl) titleEl.textContent = 'Create Slot';

        slotIdInput.value = '';
        dateInput.value = dateStr;
        titleInput.value = '';
        if (descInput) descInput.value = '';
        startInput.value = '';
        endInput.value = '';
        capacityInput.value = '1';

        setSelectedRoles([]);

        if (metaSpan) metaSpan.textContent = `Creating for ${formatDateLabel(dateStr)}`;
        setError();
        modal.show();
    });

    // Handle opening in EDIT mode
    document.addEventListener('click', async (e: Event) => {
        const target = e.target as Element | null;
        if (!target) return;

        const btn = target.closest('[data-slot-edit]') as HTMLElement | null;
        if (!btn) return;

        const slotId = btn.dataset.slotid || '';
        if (!slotId) return;

        mode = 'edit';
        if (titleEl) titleEl.textContent = 'Edit Slot';

        const slotEl = document.querySelector<HTMLElement>(`.slot[data-slotid="${slotId}"]`);
        if (!slotEl) return;

        const day = slotEl.dataset.day || slotEl.closest<HTMLElement>('.slot-container')?.dataset.date || '';
        const titleText = slotEl.querySelector<HTMLElement>('[data-edit="title"]')?.textContent?.trim() || '';
        const descText = slotEl.querySelector<HTMLElement>('[data-edit="description"]')?.textContent?.trim() || '';
        const start = slotEl.dataset.start || null;
        const end = slotEl.dataset.end || null;
        const capacity = slotEl.dataset.max || '1';

        slotIdInput.value = slotId;
        dateInput.value = day;
        titleInput.value = titleText;
        if (descInput) descInput.value = descText;
        startInput.value = toTimeInputValue(start);
        endInput.value = toTimeInputValue(end);
        capacityInput.value = capacity;

        const currentRoles = getSlotRolesForSlot(slotId);
        setSelectedRoles(currentRoles.map((r) => r.id));

        if (metaSpan) metaSpan.textContent = `Editing: ${describeSlot(slotId)}`;
        setError();
        modal.show();
    });

    form.addEventListener('submit', async (e: Event) => {
        e.preventDefault();
        setError();

        const id = slotIdInput.value;
        const day = dateInput.value;
        const title = titleInput.value.trim();
        const description = descInput?.value?.trim() || '';
        const start = toDbTime(startInput.value || null);
        const end = toDbTime(endInput.value || null);
        const capacity = parseInt(capacityInput.value, 10);

        const payload = {
            id: id || undefined,
            day,
            title,
            description,
            startTime: start,
            endTime: end,
            maxAssignees: capacity,
            roles: Array.from(selectedRoleIds),
        };

        try {
            const endpoint = mode === 'create' ? `/api/activity/${planId}/slot` : `/api/activity/${planId}/slot/${id}`;
            await post(endpoint, payload);
            showInlineAlert('success', mode === 'create' ? 'Slot created' : 'Slot updated');
            modal.hide();
            reloadAfterDelay(150);
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to save slot';
            setError(message);
        }
    });
}

function formatDateLabel(date?: string | null): string {
    if (!date) return '';
    const d = new Date(date);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString();
}
