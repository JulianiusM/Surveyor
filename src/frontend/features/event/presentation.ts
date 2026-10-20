import type {LocalizationContext} from '../../../types/LocalizationTypes';
import {formatCivilDate} from '../../../modules/lib/civilDate';

/** Summary and saved attendance display their stored civil day in the selected
 * language. The existing invalid-value fallback remains feature-owned. */
export function formatEventCivilDate(value: string, locale: string): string {
    return formatCivilDate(value, locale, {dateStyle: 'full'})
        ?? new Date(value).toLocaleString(locale, {dateStyle: 'full'});
}

/** The roster shares civil-day formatting while retaining absent/raw fallbacks. */
export function formatEventDate(value: string | null | undefined, locale: string): string {
    if (!value) return '—';
    const civilDate = formatCivilDate(value, locale);
    if (civilDate !== null) return civilDate;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(locale);
}

/** Registration-link timestamps are instants; absent/invalid expiry has no display value. */
export function formatEventTimestamp(value: string | null | undefined, locale: string): string {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString(locale);
}

const dietaryMessages = {
    MEAT: 'event.dietBadge.MEAT', FISH: 'event.dietBadge.FISH', VEGETARIAN: 'event.dietBadge.VEGETARIAN',
    VEGAN: 'event.dietBadge.VEGAN', HALAL: 'event.dietBadge.HALAL', KOSHER: 'event.dietBadge.KOSHER',
    ALLERGIES: 'event.dietBadge.ALLERGIES', COMMENT: 'event.dietBadge.COMMENT',
    MEAT_OR_FISH: 'event.dietBadge.MEAT_OR_FISH', JUST_MEAT: 'event.dietBadge.JUST_MEAT', JUST_FISH: 'event.dietBadge.JUST_FISH',
} as const;

/** Localize known dietary badges/totals while retaining the exact native English
 * uppercase copy. Unknown wire tokens never become untranslated interface text. */
export function eventDietaryLabel(messages: LocalizationContext, choice: string): string {
    if (!Object.hasOwn(dietaryMessages, choice)) return messages.t('common.unknown');
    // Only fixed catalog identities cross this lookup; dates have a separate path.
    return messages.t(dietaryMessages[choice as keyof typeof dietaryMessages]);
}
