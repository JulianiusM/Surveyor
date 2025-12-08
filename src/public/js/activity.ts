/**
 * Activity plan view functionality
 * Handles slot management, assignments, inline editing, and owner operations
 */

import {setCurrentNavLocation} from './core/navigation';
import {initAssignmentRemoval} from './shared/list-actions';
import {loadPerms} from './core/permissions';
import {initParticipantsTab} from './modules/activity-participants';
import {
    addRoleToGlobal as addRole,
    getAllRoles as getRoles,
    getSlotRolesForSlot as getSlotRoles,
    initSlotRoleAdminModal
} from './modules/activity-roles';
import {buildWarningModal, describeWarning as descWarn, initAssign} from './modules/activity-assignments';
import {initDates, initSlotFilters} from './modules/activity-filters';
import {initDelete, initDnD, initInlineEdit} from './modules/activity-slot-operations';
import {initSlotEditorModal} from './modules/activity-slot-editor';
import {initRequirementPanel} from './modules/activity-requirements';
import {initRecommendationScheduleView} from './modules/activity-recommendations-schedule';
import type {AssignmentWarning, RecommendationRow} from "./modules/activity-types";


// Assignment warning types moved to modules/activity-assignments.ts

function formatTimeLabel(time?: string | null): string {
    if (!time) return "";
    return time.slice(0, 5);
}

function describeSlot(slotId: string): string {
    const slotEl = document.querySelector<HTMLElement>(`.slot[data-slotid="${slotId}"]`);
    if (!slotEl) return `slot ${slotId}`;

    const title = slotEl.querySelector<HTMLElement>('[data-edit="title"]')?.textContent?.trim();
    const day = slotEl.dataset.day
        || slotEl.closest<HTMLElement>('.slot-container')?.dataset.date
        || '';
    const start = formatTimeLabel(slotEl.dataset.start || null);
    const end = formatTimeLabel(slotEl.dataset.end || null);

    const timePart = start || end ? ` (${start || '–'}-${end || '–'})` : '';
    return `${title || 'Slot'}${day ? ` on ${day}` : ''}${timePart}`;
}

function formatSlotLabel(slot: RecommendationRow['slot']): string {
    const day = slot.day ? ` on ${slot.day}` : '';
    const start = formatTimeLabel(slot.startTime || null);
    const end = formatTimeLabel(slot.endTime || null);
    const time = start || end ? ` (${start || '–'}-${end || '–'})` : '';
    return `${slot.title || 'Slot'}${day}${time}`;
}

// describeWarning moved to modules/activity-assignments.ts
function describeWarning(warning: AssignmentWarning): string {
    return descWarn(warning, describeSlot);
}

// Role functions moved to modules/activity-roles.ts
const getAllRoles = getRoles;
const getSlotRolesForSlot = getSlotRoles;
const addRoleToGlobal = addRole;

function toDateTimeLocalValue(date?: string | Date | null): string {
    if (!date) return '';
    const d = typeof date === 'string' ? new Date(date) : date;
    if (Number.isNaN(d.getTime())) return '';

    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toISOStringOrNull(value: string): string | null {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// buildWarningModal moved to modules/activity-assignments.ts

/**
 * Get the activity plan ID from the window object
 */
function getActivityPlanId(): string {
    return window.Surveyor.entityId ?? '';
}

// initAssign moved to modules/activity-assignments.ts

// Slot operations (inline edit, delete, editor modal) moved to modules/activity-slot-operations.ts and activity-slot-editor.ts

// Requirements panel moved to modules/activity-requirements.ts

// Recommendations panel moved to modules/activity-recommendations.ts

/**
 * Initialize all activity plan functionality
 */
export function init(): void {
    setCurrentNavLocation();
    loadPerms();
    initDates();
    
    // Restore active tab from session storage after page reload
    const savedTabId = sessionStorage.getItem('activity-active-tab');
    if (savedTabId) {
        sessionStorage.removeItem('activity-active-tab');
        const tabTrigger = document.querySelector(`[data-bs-target="${savedTabId}"]`);
        if (tabTrigger) {
            const bootstrap = (window as any).bootstrap;
            if (bootstrap && bootstrap.Tab) {
                const tab = new bootstrap.Tab(tabTrigger);
                tab.show();
            }
        }
    }

    const planId = getActivityPlanId();
    if (planId) {
        const warningModal = buildWarningModal(describeSlot);
        initAssign(planId, warningModal);
        initInlineEdit(planId);
        initDelete(planId);
        initSlotEditorModal(planId);
        initDnD(planId);
        initRequirementPanel(planId);
        initRecommendationScheduleView(planId, describeSlot);
        initSlotFilters();
        initParticipantsTab();
        initSlotRoleAdminModal(planId, describeSlot);

        initAssignmentRemoval({
            baseUrl: `/api/activity/${planId}`,
        });
    }
}

// Expose to global scope
window.Surveyor.init = init;
