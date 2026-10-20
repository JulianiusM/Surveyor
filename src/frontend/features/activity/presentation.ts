import type {components} from '../../../types/api/v1';
import type {Translator} from '../../../types/LocalizationTypes';
import {civilDateWeeks, formatCivilDate} from '../../../modules/lib/civilDate';

/** Localize only an explicitly generated label. Literal
 * user names remain data even when they equal the old English fallback wording.
 * Raw absent-name consumers derive that flag before calling; false/undefined
 * preserves even an empty name. Only an existing profile fallback supplies an ID. */
export function activityParticipantName(name: string | null | undefined, t: Translator, nameIsFallback = false,
                                        profileId?: string | null): string {
    if (!nameIsFallback) return name ?? '';
    return profileId ? t('activity.profileFallback', {id: profileId}) : t('activity.participant');
}

/** Creation uses the same civil-week owner as the versioned saved schedule;
 * retain the creation table's existing array shape and lexical date drafts. */
export function activityCreationWeeks(start: string, end: string): string[][] {
    return civilDateWeeks(start, end).map(week => week.days);
}

export function activityDayLabel(day: string, locale: string): string {
    return formatCivilDate(day, locale, {weekday: 'short'})
        ?? new Date(day + 'T00:00:00Z').toLocaleDateString(locale, {weekday: 'short'});
}

export function activityDateLabel(day: string, locale: string): string {
    return formatCivilDate(day, locale) ?? new Date(day + 'T00:00:00Z').toLocaleDateString(locale);
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
