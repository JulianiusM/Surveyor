import type {components} from '../../../types/api/v1';
import type {Translator} from '../../../types/LocalizationTypes';

/** Copy the native creation calendar's local Monday stepping and elapsed-day
 * selection. Detail weeks are a server projection because its Pug baseline uses
 * server-local date steps instead. Preserve those distinct timezone/DST semantics. */
export function activityCreationWeeks(start: string, end: string): string[][] {
    const first = new Date(start + 'T00:00:00Z');
    const finish = new Date(end + 'T00:00:00Z');
    const weeks: string[][] = [];
    // Invalid/inverted input produces no calendar while the form retains its draft.
    if (!Number.isFinite(first.getTime()) || !Number.isFinite(finish.getTime()) || first > finish) return weeks;
    const monday = new Date(first);
    monday.setDate(monday.getDate() - (monday.getDay() || 7) + 1);
    while (monday <= finish) {
        // Native creation enumerates elapsed 24-hour days from each locally
        // stepped Monday, retaining its existing behavior at DST transitions.
        const days: string[] = [];
        for (let offset = 0; offset < 7; offset++) {
            const date = new Date(monday.getTime() + offset * 24 * 60 * 60 * 1000);
            if (date >= first && date <= finish) days.push(date.toISOString().slice(0, 10));
        }
        weeks.push(days);
        monday.setDate(monday.getDate() + 7);
    }
    return weeks;
}

export function activityDayLabel(day: string, locale: string): string {
    return new Date(day + 'T00:00:00Z').toLocaleDateString(locale, {weekday: 'short'});
}

export function activityDateLabel(day: string, locale: string): string {
    // Keep native UTC-midnight/browser-zone presentation, including inherited
    // previous-day display in negative offsets. Stored dates remain ISO.
    return new Date(day + 'T00:00:00Z').toLocaleDateString(locale);
}

/** Native review labels describe only an admitted slot and its civil timebox. */
export function activitySlotLabel(slot: Pick<components['schemas']['ActivitySlotView'], 'title' | 'day' | 'startTime' | 'endTime'>, t: Translator): string {
    const time = slot.startTime || slot.endTime ? ` (${slot.startTime?.slice(0, 5) || '–'}-${slot.endTime?.slice(0, 5) || '–'})` : '';
    return t('activity.describeSlot', {title: slot.title, date: slot.day, time});
}

/** Copy native warning phrasing without importing its frontend implementation.
 * Foreign details come only from the redacted server receipt; local lookup never
 * performs discovery or reconstructs a hidden sibling plan from its identifier. */
export function activityWarningLabel(warning: components['schemas']['ActivityWarning'], slots: components['schemas']['ActivitySlotView'][], t: Translator): string {
    const keys = {ineligible_participant: 'activity.warningIneligible', outside_attendance: 'activity.warningAttendance',
        arrival_day: 'activity.warningArrival', arrival_time_restricted: 'activity.warningArrivalTime',
        departure_day: 'activity.warningDeparture', departure_time_restricted: 'activity.warningDepartureTime',
        over_capacity: 'activity.fullHint'} as const;
    if (warning.type !== 'overlap') return t(keys[warning.type] ?? 'activity.warningUnknown');

    // The native modal keeps all conflicts in one escaped sentence. Retain its
    // commas and parenthesized timeboxes so wrapping and emphasis stay equivalent.
    const conflicts: string[] = [];
    for (const detail of warning.overlapDetails ?? []) {
        const title = detail.title || localSlotLabel(detail.id);
        const time = detail.startTime && detail.endTime ? ` (${detail.startTime.slice(0, 5)}–${detail.endTime.slice(0, 5)})` : '';
        conflicts.push(`${detail.planTitle ? detail.planTitle + ': ' : ''}${t('activity.warningSlot', {title, date: detail.day})}${time}`);
    }
    if (!conflicts.length) {
        for (const id of warning.conflicts ?? []) conflicts.push(localSlotLabel(id));
    }
    const details = conflicts.length ? ': ' + conflicts.join(', ') : '';
    return t(warning.requiredPriority ? 'activity.warningOverlapPriority' : warning.confirmable ? 'activity.warningOverlapConfirm' : 'activity.warningOverlapDetail', {details});

    /** Known local slots may use their visible labels; foreign IDs stay opaque. */
    function localSlotLabel(id: string): string {
        const slot = slots.find(candidate => candidate.id === id);
        return slot ? activitySlotLabel(slot, t) : t('activity.slotIdLabel', {id});
    }
}
