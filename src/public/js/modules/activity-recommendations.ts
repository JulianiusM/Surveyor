/**
 * Activity Recommendations Panel Module
 * Handles the assignment recommendations panel
 */

import {formatDateLabel, formatTimeLabel} from "../core/formatting";
import {get, post} from '../core/http';
import {showInlineAlert} from '../shared/alerts';
import {reloadAfterDelay} from '../shared/ui-helpers';
import {describeWarning} from './activity-assignments';
import type {
    AssignmentWarning,
    RecommendationParticipantOption,
    RecommendationRow,
    RecommendationSlotOption,
    RecommendationWarning
} from './activity-types';

function formatSlotLabel(slot: RecommendationRow['slot']): string {
    const day = slot.day ? ` on ${slot.day}` : '';
    const start = formatTimeLabel(slot.startTime || null);
    const end = formatTimeLabel(slot.endTime || null);
    const time = start || end ? ` (${start || '–'}-${end || '–'})` : '';
    return `${slot.title || 'Slot'}${day}${time}`;
}

/**
 * Initialize the recommendations panel
 */
export function initRecommendationPanel(planId: string, describeSlot: (slotId: string) => string): void {

    const panel = document.getElementById('recommendationPanel');
    const rows = panel?.querySelector<HTMLElement>('#recommendationRows');
    const alertBox = panel?.querySelector<HTMLElement>('[data-recommendations-alert]');
    const refreshBtn = panel?.querySelector<HTMLButtonElement>('[data-recommendations-refresh]');
    const autoBtn = panel?.querySelector<HTMLButtonElement>('[data-recommendations-auto]');
    const saveBtn = panel?.querySelector<HTMLButtonElement>('[data-recommendations-save]');
    const applyBtn = panel?.querySelector<HTMLButtonElement>('[data-recommendations-apply]');
    const summaryStats = panel?.querySelector<HTMLElement>('#recommendationSummaryStats');

    if (!planId || !panel || !rows) return;

    let warnings: RecommendationWarning[] = [];

    const setAlert = (message?: string, variant: 'info' | 'danger' = 'info') => {
        if (!alertBox) return;
        const target = alertBox.querySelector('span') || alertBox;
        if (!message) {
            alertBox.classList.add('d-none');
            target.textContent = '';
            return;
        }

        alertBox.classList.remove('d-none', 'alert-info', 'alert-danger');
        alertBox.classList.add(variant === 'danger' ? 'alert-danger' : 'alert-info');
        target.textContent = message;
    };

    const warningKey = (slotId: string, userId?: number | null, guestId?: number | null) => {
        if (userId) return `${slotId}:u${userId}`;
        if (guestId) return `${slotId}:g${guestId}`;
        return `${slotId}:unknown`;
    };

    const buildWarningMap = () => {
        const map = new Map<string, AssignmentWarning[]>();
        warnings.forEach((entry) => {
            const key = warningKey(entry.recommendation.slotId, entry.recommendation.userId, entry.recommendation.guestId);
            map.set(key, entry.warnings);
        });
        return map;
    };

    let slotOptions: RecommendationSlotOption[] = [];
    let participantOptions: RecommendationParticipantOption[] = [];

    const formatParticipantLabel = (option: RecommendationParticipantOption) => {
        const arrival = formatDateLabel(option.arrivalDate ?? null);
        const departure = formatDateLabel(option.departureDate ?? null);
        const attendance = arrival || departure ? ` (${arrival || 'start'} – ${departure || 'end'})` : '';
        return `${option.label}${attendance}`;
    };

    const participantValue = (option: RecommendationParticipantOption) =>
        option.userId ? `user:${option.userId}` : `guest:${option.guestId}`;

    const setParticipantDataset = (row: HTMLElement, value: string) => {
        delete row.dataset.userId;
        delete row.dataset.guestId;
        if (value.startsWith('user:')) {
            row.dataset.userId = value.replace('user:', '');
        } else if (value.startsWith('guest:')) {
            row.dataset.guestId = value.replace('guest:', '');
        }
    };

    const currentRecKey = (row: HTMLElement) => warningKey(
        row.dataset.slotId || '',
        row.dataset.userId ? Number(row.dataset.userId) : null,
        row.dataset.guestId ? Number(row.dataset.guestId) : null,
    );

    const markDirty = (row: HTMLElement) => {
        row.dataset.dirty = 'true';
        row.classList.add('table-warning');
    };

    const renderWarningCell = (row: HTMLElement, warningMap: Map<string, AssignmentWarning[]>) => {
        const warningCell = row.querySelector<HTMLElement>('td[data-warning]');
        if (!warningCell) return;
        warningCell.innerHTML = '';

        const warningList = warningMap.get(row.dataset.recKey || '');
        if (warningList && warningList.length) {
            const list = document.createElement('ul');
            list.className = 'mb-0 small ps-3';
            warningList.forEach((warn) => {
                const li = document.createElement('li');
                li.textContent = describeWarning(warn, describeSlot);
                list.append(li);
            });
            warningCell.append(list);
            return;
        }

        const span = document.createElement('span');
        span.className = 'small';
        if (row.dataset.dirty === 'true') {
            span.classList.add('text-secondary');
            span.textContent = 'Save to refresh warnings';
        } else {
            span.classList.add('text-success');
            span.textContent = 'No warnings';
        }
        warningCell.append(span);
    };

    const updateRecommendationSummaryStats = (data: RecommendationRow[] = []) => {
        if (!summaryStats) return;

        summaryStats.innerHTML = '';

        if (!data.length) {
            const span = document.createElement('span');
            span.className = 'text-secondary';
            span.textContent = 'No recommendations loaded.';
            summaryStats.append(span);
            return;
        }

        const counts: Record<string, number> = {
            PENDING: 0,
            APPROVED: 0,
            REJECTED: 0,
            APPLIED: 0,
        };

        data.forEach((rec) => {
            if (rec.status && counts[rec.status] !== undefined) {
                counts[rec.status] += 1;
            }
        });

        const pieces: { label: string; key: keyof typeof counts; className: string }[] = [
            {label: 'Pending', key: 'PENDING', className: 'badge bg-secondary text-white me-1'},
            {label: 'Approved', key: 'APPROVED', className: 'badge bg-success text-white me-1'},
            {label: 'Rejected', key: 'REJECTED', className: 'badge bg-warning text-dark me-1'},
            {label: 'Applied', key: 'APPLIED', className: 'badge bg-info text-white me-1'},
        ];

        pieces.forEach(({label, key, className}) => {
            const value = counts[key];
            const span = document.createElement('span');
            span.className = className;
            span.textContent = `${label}: ${value}`;
            summaryStats.append(span);
        });
    };

    const renderRecommendations = (data: RecommendationRow[]) => {
        rows.innerHTML = '';
        updateRecommendationSummaryStats(data);
        const warningMap = buildWarningMap();

        if (!data.length) {
            const empty = document.createElement('tr');
            empty.dataset.emptyState = 'true';
            const cell = document.createElement('td');
            cell.colSpan = 4;
            cell.className = 'text-center text-secondary pt-3';
            cell.textContent = 'No recommendations yet.';
            empty.append(cell);
            rows.append(empty);
            return;
        }

        data.forEach((rec) => {
            const row = document.createElement('tr');
            row.dataset.slotId = rec.slot.id;
            if (rec.user?.id) row.dataset.userId = String(rec.user.id);
            if (rec.guest?.id) row.dataset.guestId = String(rec.guest.id);
            row.dataset.recKey = warningKey(rec.slot.id, rec.user?.id, rec.guest?.id);
            delete row.dataset.dirty;
            row.classList.remove('table-warning');

            const slotCell = document.createElement('td');
            const slotSelect = document.createElement('select');
            slotSelect.className = 'form-select form-select-sm text-bg-dark';
            const slotList = [...slotOptions];
            if (!slotList.some((opt) => opt.id === rec.slot.id)) slotList.push(rec.slot);
            slotList.forEach((opt) => {
                const option = document.createElement('option');
                option.value = opt.id;
                option.textContent = formatSlotLabel(opt);
                slotSelect.append(option);
            });
            slotSelect.value = rec.slot.id;
            slotSelect.addEventListener('change', () => {
                row.dataset.slotId = slotSelect.value;
                row.dataset.recKey = currentRecKey(row);
                markDirty(row);
                renderWarningCell(row, warningMap);
            });
            slotCell.append(slotSelect);

            const participantCell = document.createElement('td');
            const participantSelect = document.createElement('select');
            participantSelect.className = 'form-select form-select-sm text-bg-dark';
            const participantList = [...participantOptions];
            const selectedValue = rec.user?.id ? `user:${rec.user.id}` : rec.guest?.id ? `guest:${rec.guest.id}` : '';
            if (selectedValue && !participantList.some((opt) => participantValue(opt) === selectedValue)) {
                participantList.push({
                    key: selectedValue,
                    label: rec.user?.name || rec.user?.username || rec.guest?.username || selectedValue,
                    userId: rec.user?.id ?? null,
                    guestId: rec.guest?.id ?? null,
                });
            }

            participantList.forEach((opt) => {
                const option = document.createElement('option');
                option.value = participantValue(opt);
                option.textContent = formatParticipantLabel(opt);
                participantSelect.append(option);
            });
            participantSelect.value = selectedValue;
            if (!participantSelect.value && participantList.length) {
                participantSelect.value = participantValue(participantList[0]);
            }
            if (participantSelect.value) {
                setParticipantDataset(row, participantSelect.value);
                row.dataset.recKey = currentRecKey(row);
            }
            participantSelect.addEventListener('change', () => {
                setParticipantDataset(row, participantSelect.value);
                row.dataset.recKey = currentRecKey(row);
                markDirty(row);
                renderWarningCell(row, warningMap);
            });
            participantCell.append(participantSelect);

            const statusCell = document.createElement('td');
            const statusSelect = document.createElement('select');
            statusSelect.className = 'form-select form-select-sm text-bg-dark';
            statusSelect.dataset.recStatus = 'true';
            ['PENDING', 'APPROVED', 'REJECTED', 'APPLIED'].forEach((status) => {
                const opt = document.createElement('option');
                opt.value = status;
                opt.textContent = status;
                statusSelect.append(opt);
            });
            statusSelect.value = rec.status;
            if (rec.status === 'APPLIED') statusSelect.disabled = true;
            statusSelect.addEventListener('change', () => markDirty(row));
            statusCell.append(statusSelect);

            const warningCell = document.createElement('td');
            warningCell.dataset.warning = 'true';

            row.append(slotCell, participantCell, statusCell, warningCell);
            renderWarningCell(row, warningMap);
            rows.append(row);
        });
    };

    const loadRecommendations = async () => {
        setAlert('Loading recommendations…');
        try {
            const res = (await get(`/api/activity/${planId}/recommendations`))?.data;
            const autoGenerated = Boolean(res?.autoGenerated);
            warnings = (res?.warnings || []) as RecommendationWarning[];
            slotOptions = (res?.slots || []) as RecommendationSlotOption[];
            participantOptions = (res?.participants || []) as RecommendationParticipantOption[];
            renderRecommendations((res?.recommendations || []) as RecommendationRow[]);

            if (autoGenerated) {
                setAlert('Recommendations auto-generated after the binding deadline');
                showInlineAlert('info', 'New recommendations were auto-generated because the binding deadline passed.');
            } else {
                setAlert(warnings.length
                    ? 'Warnings detected in proposed assignments'
                    : 'Recommendations loaded');
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to load recommendations';
            setAlert(message, 'danger');
            showInlineAlert('error', message);
        }
    };

    const collectRecommendationPayload = () => {
        return Array.from(rows.querySelectorAll<HTMLElement>('tr[data-slot-id]')).map((row) => {
            const status = row.querySelector<HTMLSelectElement>('[data-rec-status]');
            return {
                slotId: row.dataset.slotId!,
                userId: row.dataset.userId ? Number(row.dataset.userId) : null,
                guestId: row.dataset.guestId ? Number(row.dataset.guestId) : null,
                status: status?.value,
            };
        });
    };

    const saveRecommendations = async () => {
        setAlert('Saving recommendations…');
        try {
            await post(`/api/activity/${planId}/recommendations`, {recommendations: collectRecommendationPayload()});
            showInlineAlert('success', 'Recommendations saved');
            await loadRecommendations();
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to save recommendations';
            setAlert(message, 'danger');
            showInlineAlert('error', message);
        }
    };

    const autoGenerate = async () => {
        setAlert('Generating recommendations…');
        try {
            await post(`/api/activity/${planId}/recommendations/auto`, {});
            showInlineAlert('success', 'Recommendations generated');
            await loadRecommendations();
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to auto-generate recommendations';
            setAlert(message, 'danger');
            showInlineAlert('error', message);
        }
    };

    const applyRecommendations = async () => {
        setAlert('Applying approved recommendations…');
        try {
            const res = await post(`/api/activity/${planId}/recommendations/apply`, {});
            warnings = (res?.warnings || []) as RecommendationWarning[];
            showInlineAlert('success', res?.message || 'Recommendations applied');

            // Store current tab before reload
            const activeTab = document.querySelector('.nav-link.active');
            const activeTabId = activeTab?.getAttribute('data-bs-target');
            if (activeTabId) {
                sessionStorage.setItem('activity-active-tab', activeTabId);
            }

            // Reload the page to show updated assignments
            reloadAfterDelay(1000);
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to apply recommendations';
            setAlert(message, 'danger');
            showInlineAlert('error', message);
        }
    };

    refreshBtn?.addEventListener('click', () => void loadRecommendations());
    autoBtn?.addEventListener('click', () => void autoGenerate());
    saveBtn?.addEventListener('click', () => void saveRecommendations());
    applyBtn?.addEventListener('click', () => void applyRecommendations());

    void loadRecommendations();
}
