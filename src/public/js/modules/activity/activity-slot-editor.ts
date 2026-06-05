/**
 * Activity Slot Editor Module
 * Handles the slot editor modal for creating and editing slots
 */

import {post} from '../../core/http';
import {getPerms, requireEntityPerm, requireItemPerm} from '../../core/permissions';
import {showInlineAlert} from '../../shared/alerts';
import {reloadAfterDelay} from '../../shared/ui-helpers';
import {addRoleToGlobal, getAllRoles, getSlotRolesForSlot} from './activity-roles';
import type {BootstrapGlobal, RoleSummary, SlotEditorMode} from './activity-types';

declare const bootstrap: BootstrapGlobal;

/**
 * Initialize the slot editor modal (used for both create and edit)
 */
export function initSlotEditorModal(planId: string): void {
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

    const getEditCapabilities = (slotId: string) => {
        const perms = getPerms();
        const allowMeta = perms?.itemAllow(slotId, 'EDIT_META', 'ITEM_EDIT') ?? false;
        const allowDesc = perms?.itemAllow(slotId, 'EDIT_DESC', ['ITEM_EDIT', 'ITEM_EDIT_DESC']) ?? false;

        return {allowMeta, allowDesc};
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

    const titleGroup = titleInput?.closest<HTMLElement>('.mb-3') ?? undefined;
    const timeRow = startInput?.closest<HTMLElement>('.row') ?? undefined;
    const capacityGroup = capacityInput?.closest<HTMLElement>('.mb-3') ?? undefined;
    const descGroup = descInput?.closest<HTMLElement>('.mb-3') ?? undefined;
    const roleGroup = roleChips?.closest<HTMLElement>('.mb-3') ?? undefined;

    const setSelectedRoles = (ids: number[]) => {
        selectedRoleIds = new Set(ids);
        renderRoleChips();
        updateRoleSuggestions();
    };

    const applyEditMode = (allowMeta: boolean, allowDesc: boolean) => {
        const descOnly = allowDesc && !allowMeta;

        const toggleHidden = (el: HTMLElement | undefined, hidden: boolean) => {
            if (!el) return;
            el.classList.toggle('d-none', hidden);
        };

        if (titleInput) {
            titleInput.required = allowMeta;
            titleInput.readOnly = !allowMeta;
        }
        [startInput, endInput, capacityInput, roleInput].forEach((el) => {
            if (el) el.disabled = !allowMeta;
        });
        if (descInput) {
            descInput.readOnly = !(allowDesc || allowMeta);
        }

        toggleHidden(titleGroup, descOnly);
        toggleHidden(timeRow, descOnly);
        toggleHidden(capacityGroup, descOnly);
        toggleHidden(roleGroup, descOnly);
        toggleHidden(descGroup, !(allowDesc || allowMeta));
    };

    const renderRoleChips = () => {
        if (!roleChips) return;

        roleChips.innerHTML = '';
        if (selectedRoleIds.size === 0) {
            const span = document.createElement('span');
            span.className = 'text-secondary small';
            span.textContent = 'No roles assigned yet.';
            roleChips.appendChild(span);
            return;
        }

        const allRoles = getAllRoles();
        const frag = document.createDocumentFragment();

        selectedRoleIds.forEach((id) => {
            const role = allRoles.find((r) => r.id === id);
            const label = role?.name ?? `Role #${id}`;

            const badge = document.createElement('span');
            badge.className =
                'badge text-bg-secondary me-1 mb-1 d-inline-flex align-items-center gap-1';

            const textSpan = document.createElement('span');
            textSpan.textContent = label;

            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'btn btn-sm btn-outline-light px-1 py-0';
            removeBtn.dataset.roleChipRemove = '1';
            removeBtn.dataset.roleId = String(id);
            removeBtn.title = 'Remove role from this slot';
            removeBtn.innerHTML = '<i class="bi bi-x"></i>';

            badge.append(textSpan, removeBtn);
            frag.appendChild(badge);
        });

        roleChips.appendChild(frag);
    };

    const clearRoleInput = () => {
        if (roleInput) {
            roleInput.value = '';
        }
    };

    const hideRoleSuggestions = () => {
        if (!roleSuggestions) return;
        roleSuggestions.innerHTML = '';
        roleSuggestions.classList.add('d-none');
    };

    const updateRoleSuggestions = () => {
        if (!roleInput || !roleSuggestions) return;

        const termRaw = roleInput.value || '';
        const term = termRaw.trim();
        roleSuggestions.innerHTML = '';

        // If no search term, don't show anything – but DO NOT hide on blur, only when empty.
        if (!term) {
            roleSuggestions.classList.add('d-none');
            return;
        }

        const allRoles = getAllRoles();
        const lower = term.toLowerCase();

        const available = allRoles.filter(
            (r) =>
                !selectedRoleIds.has(r.id) &&
                (r.name.toLowerCase().includes(lower) ||
                    (r.description ?? '').toLowerCase().includes(lower)),
        );

        const frag = document.createDocumentFragment();

        if (available.length > 0) {
            available.slice(0, 10).forEach((role) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className =
                    'list-group-item list-group-item-action d-flex align-items-center justify-content-between text-bg-dark';
                btn.dataset.roleId = String(role.id);

                const labelSpan = document.createElement('span');
                labelSpan.textContent = `Add role "${role.name}" to this slot`;

                const icon = document.createElement('i');
                icon.className = 'bi bi-plus-circle';

                btn.append(labelSpan, icon);
                frag.appendChild(btn);
            });
        } else {
            // No existing roles match – suggest creating a new one
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className =
                'list-group-item list-group-item-action d-flex align-items-center justify-content-between text-bg-dark';
            btn.dataset.createRole = '1';

            const labelSpan = document.createElement('span');
            labelSpan.textContent = `Create new role "${term}"`;

            const icon = document.createElement('i');
            icon.className = 'bi bi-magic';

            btn.append(labelSpan, icon);
            frag.appendChild(btn);
        }

        roleSuggestions.appendChild(frag);
        roleSuggestions.classList.remove('d-none');
    };

    const openCreate = (dateISO: string) => {
        mode = 'create';
        slotIdInput.value = '';
        dateInput.value = dateISO;
        titleInput.value = '';
        if (descInput) descInput.value = '';
        startInput.value = '';
        endInput.value = '';
        capacityInput.value = '1';
        setSelectedRoles([]);

        setError();

        if (titleEl) titleEl.textContent = 'Create slot';
        if (metaSpan) metaSpan.textContent = `Day: ${dateISO}`;

        clearRoleInput();
        hideRoleSuggestions();

        applyEditMode(true, true);

        modal.show();
        titleInput.focus();
    };

    const openEdit = (slotEl: HTMLElement) => {
        mode = 'edit';

        const slotId = slotEl.dataset.slotid;
        const date = slotEl.closest<HTMLElement>('.slot-container')?.dataset.date || '';
        if (!slotId || !date) return;

        slotIdInput.value = slotId;
        dateInput.value = date;

        const {allowMeta, allowDesc} = getEditCapabilities(slotId);
        if (!allowMeta && !allowDesc) {
            showInlineAlert('error', 'You are not allowed to edit this slot.');
            return;
        }

        const titleSpan = slotEl.querySelector<HTMLElement>('[data-edit="title"]');
        const descSpan = slotEl.querySelector<HTMLElement>('[data-edit="description"]');
        const maxSpan = slotEl.querySelector<HTMLElement>('[data-edit="maxAssignees"]');

        titleInput.value = titleSpan?.textContent?.trim() || '';
        if (descInput) descInput.value = descSpan?.textContent?.trim() || '';

        const startRaw = slotEl.dataset.start || '';
        const endRaw = slotEl.dataset.end || '';
        startInput.value = toTimeInputValue(startRaw);
        endInput.value = toTimeInputValue(endRaw);
        capacityInput.value = maxSpan?.textContent?.trim() || '1';

        // Load current roles from window.Surveyor.slotRoles
        const currentRoles = getSlotRolesForSlot(slotId);
        setSelectedRoles(currentRoles.map((r) => r.id));

        setError();

        if (titleEl) titleEl.textContent = 'Edit slot';
        if (metaSpan) {
            const parts: string[] = [];
            if (startInput.value) parts.push(startInput.value);
            if (endInput.value) parts.push(endInput.value);
            const range = parts.length ? ` (${parts.join(' – ')})` : '';
            metaSpan.textContent = `Day: ${date}${range}`;
        }

        clearRoleInput();
        hideRoleSuggestions();

        applyEditMode(allowMeta, allowDesc);

        modal.show();
        (allowMeta ? titleInput : descInput)?.focus();
    };

    const createRoleOnServer = async (name: string): Promise<RoleSummary> => {
        const trimmed = name.trim();
        if (!trimmed) {
            throw new Error('Role name must not be empty.');
        }

        // if it already exists, just return existing
        const existing = getAllRoles().find(
            (r) => r.name.toLowerCase() === trimmed.toLowerCase(),
        );
        if (existing) return existing;

        requireEntityPerm('EDIT_META', 'create roles for this plan');

        const res = await post(`/api/activity/${planId}/roles`, {
            name: trimmed,
        });

        const role: RoleSummary | undefined = (res?.data ?? [undefined])[0];
        if (!role) {
            throw new Error('Server did not return the created role.');
        }

        addRoleToGlobal(role);
        return role;
    };

    form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        setError();

        const titleValue = titleInput.value.trim();
        if (!titleValue) {
            setError('Title is required.');
            titleInput.focus();
            return;
        }

        const startVal = toDbTime(startInput.value);
        const endVal = toDbTime(endInput.value);
        const roleIds = Array.from(selectedRoleIds);

        try {
            if (mode === 'create') {
                requireEntityPerm('ITEM_ADD', 'add slots');
                await post(`/api/activity/${planId}/slot/add`, {
                    date: dateInput.value,
                    title: titleValue,
                    description: descInput?.value?.trim() || '',
                    startTime: startVal,
                    endTime: endVal,
                    maxAssignees: capacityInput.value,
                    roles: roleIds,
                });
                showInlineAlert('success', 'Slot created');
            } else {
                const slotId = slotIdInput.value;
                const {allowMeta, allowDesc} = getEditCapabilities(slotId);

                if (allowMeta) {
                    requireItemPerm(slotId, 'EDIT_META', 'edit slots', 'ITEM_EDIT');
                    await post(`/api/activity/${planId}/slot/${slotId}/attr`, {
                        title: titleValue,
                        description: descInput?.value?.trim() || '',
                        startTime: startVal,
                        endTime: endVal,
                        maxAssignees: capacityInput.value,
                        roles: roleIds,
                    });
                } else if (allowDesc) {
                    requireItemPerm(slotId, 'EDIT_DESC', 'edit slot descriptions', ['ITEM_EDIT', 'ITEM_EDIT_DESC']);
                    await post(`/api/activity/${planId}/slot/${slotId}/description`, {
                        description: descInput?.value?.trim() || '',
                    });
                } else {
                    throw new Error('Permission denied');
                }
                showInlineAlert('success', 'Slot updated');
            }

            modal.hide();
            reloadAfterDelay(150);
        } catch (err) {
            const message =
                err instanceof Error ? err.message : 'Failed to save slot.';
            setError(message);
        }
    });

    if (roleChips) {
        roleChips.addEventListener('click', (ev) => {
            const btn = (ev.target as HTMLElement | null)?.closest<HTMLButtonElement>(
                '[data-role-chip-remove]',
            );
            if (!btn) return;
            const id = Number(btn.dataset.roleId || '');
            if (!id) return;
            selectedRoleIds.delete(id);
            renderRoleChips();
            updateRoleSuggestions();
        });
    }

    if (roleInput) {
        roleInput.addEventListener('input', () => {
            setError();
            updateRoleSuggestions();
        });

        roleInput.addEventListener('keydown', async (ev: KeyboardEvent) => {
            if (ev.key === 'Enter') {
                ev.preventDefault();
                if (!roleSuggestions || !roleSuggestions.firstElementChild) {
                    return;
                }
                const btn = roleSuggestions
                    .firstElementChild as HTMLButtonElement | null;
                if (!btn) return;

                if (btn.dataset.roleId) {
                    const id = Number(btn.dataset.roleId);
                    if (id && !selectedRoleIds.has(id)) {
                        selectedRoleIds.add(id);
                        renderRoleChips();
                    }
                    clearRoleInput();
                    hideRoleSuggestions(); // explicit choice
                } else if (btn.dataset.createRole) {
                    try {
                        const role = await createRoleOnServer(roleInput.value);
                        selectedRoleIds.add(role.id);
                        renderRoleChips();
                        clearRoleInput();
                        hideRoleSuggestions();
                    } catch (err) {
                        const message =
                            err instanceof Error
                                ? err.message
                                : 'Unable to create role.';
                        setError(message);
                    }
                }
            } else if (ev.key === 'Escape') {
                // ESC clears search + suggestions, but does NOT close the modal
                clearRoleInput();
                hideRoleSuggestions();
            }
        });
    }

    if (roleSuggestions) {
        roleSuggestions.addEventListener('click', async (ev) => {
            const btn = (ev.target as HTMLElement | null)?.closest<HTMLButtonElement>(
                'button',
            );
            if (!btn) return;

            if (btn.dataset.roleId) {
                const id = Number(btn.dataset.roleId);
                if (id && !selectedRoleIds.has(id)) {
                    selectedRoleIds.add(id);
                    renderRoleChips();
                }
                clearRoleInput();
                hideRoleSuggestions();
            } else if (btn.dataset.createRole) {
                try {
                    const role = await createRoleOnServer(roleInput?.value || '');
                    selectedRoleIds.add(role.id);
                    renderRoleChips();
                    clearRoleInput();
                    hideRoleSuggestions();
                } catch (err) {
                    const message =
                        err instanceof Error
                            ? err.message
                            : 'Unable to create role.';
                    setError(message);
                }
            }
        });
    }

    // IMPORTANT: we DO NOT hide suggestions when the input loses focus.
    // No click-outside handler here on purpose – suggestions remain usable
    // while the modal is open, until the user clears the input or selects something.

    // Open in "create" mode from +Slot buttons
    document.addEventListener('click', (ev) => {
        const btn = (ev.target as HTMLElement | null)?.closest<HTMLElement>(
            '[data-add-slot]',
        );
        if (!btn) return;

        const date = btn.dataset.date;
        if (!date) return;
        openCreate(date);
    });

    // Open in "edit" mode from pencil buttons on slots
    document.addEventListener('click', (ev) => {
        const btn = (ev.target as HTMLElement | null)?.closest<HTMLElement>(
            '[data-slot-edit]',
        );
        if (!btn) return;

        const slot = btn.closest<HTMLElement>('.slot');
        if (!slot) return;

        openEdit(slot);
    });
}