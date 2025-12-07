/**
 * Activity plan view functionality
 * Handles slot management, assignments, inline editing, and owner operations
 */

import {setCurrentNavLocation} from './core/navigation';
import {get, post} from './core/http';
import {showInlineAlert} from './shared/alerts';
import {initCardReorder} from './shared/drag-drop';
import {initAssignmentRemoval} from './shared/list-actions';
import {reloadAfterDelay} from './shared/ui-helpers';
import {loadPerms, requireEntityPerm} from './core/permissions';
import {initParticipantsTab} from './modules/activity-participants';
import {initSlotRoleAdminModal, getAllRoles as getRoles, getSlotRolesForSlot as getSlotRoles, addRoleToGlobal as addRole, type RoleSummary as RoleType} from './modules/activity-roles';
import {buildWarningModal, initAssign, describeWarning as descWarn, type AssignmentWarning, type WarningModal} from './modules/activity-assignments';
import {initDates, initSlotFilters} from './modules/activity-filters';
import {initInlineEdit, initDelete} from './modules/activity-slot-operations';
import {initSlotEditorModal} from './modules/activity-slot-editor';
import {initRequirementPanel} from './modules/activity-requirements';
import {initRecommendationPanel} from './modules/activity-recommendations';

interface BootstrapModal {
    show: () => void;
    hide: () => void;
}

interface BootstrapGlobal {
    Modal: new (element: HTMLElement, options?: { focus?: boolean }) => BootstrapModal;
}

declare const bootstrap: BootstrapGlobal;

// Re-export RoleSummary from modules for backward compatibility
type RoleSummary = RoleType;


type SlotEditorMode = 'create' | 'edit';

// Assignment warning types moved to modules/activity-assignments.ts

interface RequirementConfiguration {
    plan: {
        assignmentMode?: 'FREE' | 'REQUIRED';
        generalRequiredShifts?: number | null;
        roundingMode?: 'CEIL' | 'ROUND' | 'FLOOR' | null;
        bindingDeadline?: string | Date | null;
        allowOverfillAfterFull?: boolean;
        allowArrivalDayEvening?: boolean;
        allowDepartureDayMorning?: boolean;
    };
    roleRequirements: { roleId: number; requiredShifts: number }[];
    overrides: {
        id?: number;
        roleId?: number | null;
        role?: RoleSummary | null;
        userId?: number | null;
        user?: { username: string } | null;
        guestId?: number | null;
        guest?: { username: string } | null;
        requiredShifts: number;
    }[];
    participants?: RequirementParticipantSummary[];
}

interface RecommendationRow {
    id?: string;
    slot: { id: string; title: string; day?: string; startTime?: string | null; endTime?: string | null };
    user?: { id: number; username: string } | null;
    guest?: { id: number; username: string } | null;
    status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'APPLIED';
}

interface RecommendationWarning {
    recommendation: { slotId: string; userId?: number | null; guestId?: number | null };
    warnings: AssignmentWarning[];
}

interface RequirementParticipantSummary {
    participantKey: string;
    name?: string | null;
    requiredShifts: number;
    assignedShifts: number;
    remainingShifts: number;
    source: 'none' | 'general' | 'role' | 'override';
    attendance?: { arrivalDate?: string | null; departureDate?: string | null };
}

interface RecommendationSlotOption {
    id: string;
    title: string;
    day?: string;
    startTime?: string | null;
    endTime?: string | null;
}

interface RecommendationParticipantOption {
    key: string;
    label: string;
    userId?: number | null;
    guestId?: number | null;
    arrivalDate?: string | null;
    departureDate?: string | null;
}

type SlotRolesMap = Record<string, RoleSummary[]>;

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

function formatDateLabel(date?: string | null): string {
    if (!date) return '';
    const d = new Date(date);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString();
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

    const planId = getActivityPlanId();
    if (planId) {
        const warningModal = buildWarningModal(describeSlot);
        initAssign(planId, warningModal);
        initInlineEdit(planId);
        initDelete(planId);
        initSlotEditorModal(planId, describeSlot);
        initDnD();
        initRequirementPanel(planId);
        initRecommendationPanel(planId, describeSlot);
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
