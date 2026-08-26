/**
 * Unified participant status component.
 * Renders and filters the same information in the Participants and Rules tabs.
 */

import {formatDateLabel} from '../../core/formatting';
import type {ParticipantFilter, RequirementParticipantSummary} from './activity-types';

export interface ParticipantStatusStats {
    total: number;
    assigned: number;
    unassigned: number;
    unstarted: number;
    needsMore: number;
    complete: number;
    noRequirement: number;
}

export function calculateParticipantStatusStats(
    participants: RequirementParticipantSummary[],
): ParticipantStatusStats {
    const assigned = participants.filter((participant) => participant.assignedShifts > 0).length;
    return {
        total: participants.length,
        assigned,
        unassigned: participants.length - assigned,
        unstarted: participants.filter((participant) => participant.requiredShifts > 0 && participant.assignedShifts === 0).length,
        needsMore: participants.filter((participant) => participant.remainingShifts > 0 && participant.assignedShifts > 0).length,
        complete: participants.filter((participant) => participant.requiredShifts > 0 && participant.remainingShifts === 0).length,
        noRequirement: participants.filter((participant) => participant.requiredShifts === 0).length,
    };
}

function appendBadge(target: HTMLElement, text: string, className: string): void {
    const badge = document.createElement('span');
    badge.className = `badge ${className}`;
    badge.textContent = text;
    target.append(badge);
}

function createCell(label: string, className = ''): HTMLDivElement {
    const cell = document.createElement('div');
    cell.className = `participant-status-cell ${className}`.trim();
    const mobileLabel = document.createElement('span');
    mobileLabel.className = 'participant-status-label';
    mobileLabel.textContent = label;
    cell.append(mobileLabel);
    return cell;
}

function renderParticipantRow(
    participant: RequirementParticipantSummary,
    assignmentMode: 'FREE' | 'REQUIRED',
): HTMLDivElement {
    const row = document.createElement('div');
    const assignedShifts = Number(participant.assignedShifts || 0);
    const requiredShifts = Number(participant.requiredShifts || 0);
    const remainingShifts = Number(participant.remainingShifts || 0);
    const mode = participant.assignmentMode || assignmentMode;
    const requirementState = requiredShifts <= 0
        ? 'no-requirement'
        : remainingShifts <= 0
            ? 'complete'
            : assignedShifts <= 0 ? 'unstarted' : 'needs-more';
    row.className = 'participant-status-row';
    row.dataset.participantRow = '';
    row.dataset.participantName = participant.name || participant.participantKey;
    row.dataset.participantKey = participant.participantKey;
    row.dataset.participantAssigned = assignedShifts > 0 ? '1' : '0';
    row.dataset.participantState = requirementState;

    const personCell = createCell('Participant', 'participant-status-person');
    const name = document.createElement('strong');
    name.textContent = participant.name || participant.participantKey;
    personCell.append(name);

    const assignmentCell = createCell('Assignments');
    const assignmentContent = document.createElement('div');
    assignmentContent.className = 'd-flex flex-wrap align-items-center gap-1';
    appendBadge(
        assignmentContent,
        `${assignedShifts} ${assignedShifts === 1 ? 'slot' : 'slots'}`,
        assignedShifts > 0
            ? 'bg-success text-white'
            : requirementState === 'unstarted'
                ? 'bg-danger text-white'
                : 'bg-secondary text-white border border-light-subtle',
    );
    const assignmentState = document.createElement('small');
    assignmentState.className = requirementState === 'unstarted' ? 'text-danger' : 'text-secondary';
    assignmentState.textContent = assignedShifts > 0
        ? 'Assigned'
        : requirementState === 'unstarted' ? 'Not started' : 'Not assigned';
    assignmentContent.append(assignmentState);
    assignmentCell.append(assignmentContent);

    const requirementCell = createCell('Requirement');
    const requirementContent = document.createElement('div');
    requirementContent.className = 'd-flex flex-wrap align-items-center gap-1';
    if (mode === 'REQUIRED' || requiredShifts > 0) {
        appendBadge(requirementContent, `${requiredShifts} required`, 'bg-light text-dark');
        appendBadge(
            requirementContent,
            remainingShifts > 0 ? `${remainingShifts} remaining` : 'Complete',
            remainingShifts > 0
                ? requirementState === 'unstarted' ? 'bg-danger text-white' : 'bg-warning text-dark'
                : 'bg-success text-white',
        );
        if (participant.source !== 'none') {
            appendBadge(requirementContent, participant.source.toUpperCase(), 'bg-info text-white text-uppercase');
        }
    } else {
        appendBadge(requirementContent, 'No minimum', 'bg-secondary text-white');
        const freeMode = document.createElement('small');
        freeMode.className = 'text-secondary';
        freeMode.textContent = 'Free mode';
        requirementContent.append(freeMode);
    }
    requirementCell.append(requirementContent);

    const attendanceCell = createCell('Attendance');
    const attendance = participant.attendance || {};
    const arrival = attendance.arrivalDate ? formatDateLabel(attendance.arrivalDate) : '';
    const departure = attendance.departureDate ? formatDateLabel(attendance.departureDate) : '';
    const attendanceWindow = document.createElement('span');
    attendanceWindow.className = 'small d-block';
    attendanceWindow.textContent = arrival || departure
        ? `${arrival || 'start'} – ${departure || 'end'}`
        : 'Full plan';
    const attendanceDays = document.createElement('small');
    attendanceDays.className = 'text-secondary';
    attendanceDays.textContent = `${participant.attendanceDays || 0} ${participant.attendanceDays === 1 ? 'day' : 'days'}`;
    attendanceCell.append(attendanceWindow, attendanceDays);

    const rolesCell = createCell('Roles');
    const roles = (participant.roles || []).filter((role) => role !== 'default');
    if (roles.length) {
        roles.forEach((role) => appendBadge(rolesCell, role, 'bg-info text-white me-1 mb-1'));
    } else {
        const emptyRoles = document.createElement('span');
        emptyRoles.className = 'text-secondary small';
        emptyRoles.textContent = 'No roles';
        rolesCell.append(emptyRoles);
    }

    row.append(personCell, assignmentCell, requirementCell, attendanceCell, rolesCell);
    return row;
}

function renderSummaryStats(
    component: HTMLElement,
    participants: RequirementParticipantSummary[],
    assignmentMode: 'FREE' | 'REQUIRED',
): void {
    const stats = component.querySelector<HTMLElement>('[data-participant-summary-stats]');
    if (!stats) return;
    stats.innerHTML = '';
    const summary = calculateParticipantStatusStats(participants);
    appendBadge(stats, `Total: ${summary.total}`, 'bg-light text-dark');
    if (assignmentMode === 'REQUIRED') {
        appendBadge(stats, `Not started: ${summary.unstarted}`, 'bg-danger text-white');
        appendBadge(stats, `Needs slots: ${summary.needsMore}`, 'bg-warning text-dark');
        appendBadge(stats, `Complete: ${summary.complete}`, 'bg-success text-white');
        if (summary.noRequirement) {
            appendBadge(stats, `No minimum: ${summary.noRequirement}`, 'bg-secondary text-white border border-light-subtle');
        }
    } else {
        appendBadge(stats, `Assigned: ${summary.assigned}`, 'bg-success text-white');
        appendBadge(stats, `Unassigned: ${summary.unassigned}`, 'bg-secondary text-white border border-light-subtle');
        appendBadge(stats, 'Free mode: no minimum', 'bg-info text-white');
    }
}

export function renderParticipantStatus(
    component: HTMLElement,
    participants: RequirementParticipantSummary[],
    assignmentMode: 'FREE' | 'REQUIRED',
): void {
    const body = component.querySelector<HTMLElement>('[data-participant-status-body]');
    if (!body) return;
    component.dataset.assignmentMode = assignmentMode;
    body.innerHTML = '';
    renderSummaryStats(component, participants, assignmentMode);

    if (!participants.length) {
        const empty = document.createElement('div');
        empty.className = 'participant-status-empty text-center text-secondary p-3';
        empty.dataset.emptyState = 'true';
        empty.textContent = assignmentMode === 'FREE'
            ? 'No participants yet. Free mode has no shift minimum; assignments and attendance will still appear here.'
            : 'No participants yet. Assignment and requirement coverage will appear here.';
        body.append(empty);
    } else {
        participants.forEach((participant) => body.append(renderParticipantRow(participant, assignmentMode)));
    }

    component.dispatchEvent(new CustomEvent('participant-status-updated'));
}

function initParticipantStatusComponent(component: HTMLElement): void {
    const searchInput = component.querySelector<HTMLInputElement>('[data-participant-search]');
    const filterButtons = Array.from(
        component.querySelectorAll<HTMLButtonElement>('[data-participant-filter]'),
    );
    let currentFilter: ParticipantFilter = 'all';
    let currentSearch = '';

    const applyFilters = () => {
        const search = currentSearch.trim().toLowerCase();
        const rows = Array.from(component.querySelectorAll<HTMLElement>('[data-participant-row]'));
        let visibleRows = 0;
        rows.forEach((row) => {
            const name = (row.dataset.participantName || '').toLowerCase();
            const assigned = row.dataset.participantAssigned === '1';
            const participantState = row.dataset.participantState;
            const matchesSearch = !search || name.includes(search);
            const matchesFilter = currentFilter === 'all'
                || (currentFilter === 'assigned' && assigned)
                || (currentFilter === 'unassigned' && !assigned)
                || currentFilter === participantState;
            const visible = matchesSearch && matchesFilter;
            row.classList.toggle('d-none', !visible);
            if (visible) visibleRows += 1;
        });
        component.querySelector('[data-filter-empty]')?.remove();
        if (rows.length && visibleRows === 0) {
            const body = component.querySelector<HTMLElement>('[data-participant-status-body]');
            const empty = document.createElement('div');
            empty.className = 'participant-status-empty text-center text-secondary p-3';
            empty.dataset.filterEmpty = 'true';
            empty.textContent = 'No participants match the current search and filter.';
            body?.append(empty);
        }
    };

    searchInput?.addEventListener('input', () => {
        currentSearch = searchInput.value || '';
        applyFilters();
    });
    filterButtons.forEach((button) => {
        button.addEventListener('click', () => {
            const mode = button.dataset.participantFilter as ParticipantFilter | undefined;
            if (!mode) return;
            currentFilter = mode;
            filterButtons.forEach((entry) => entry.classList.toggle('active', entry === button));
            applyFilters();
        });
    });
    component.addEventListener('participant-status-updated', applyFilters);
    applyFilters();
}

export function initParticipantsTab(): void {
    document.querySelectorAll<HTMLElement>('[data-participant-status]').forEach(initParticipantStatusComponent);
}
