import type {SurveyAnswer, WeekDay} from '../../../types/SurveyTypes';

/** Both combination inputs and read-only column headings select the same catalog
 * owner. The mapping keeps dynamic weekday labels typed without a copied catalog. */
export const weekdayMessages = {
    MON: 'survey.weekday.MON', TUE: 'survey.weekday.TUE', WED: 'survey.weekday.WED', THU: 'survey.weekday.THU',
    FRI: 'survey.weekday.FRI', SAT: 'survey.weekday.SAT', SUN: 'survey.weekday.SUN',
} as const satisfies Record<WeekDay, string>;

/** Ballot choices and named results use the same answer colors. Capitalization
 * remains with each surface's catalog keys; no answer or authority is inferred. */
export const answerVariants = {
    yes: 'success',
    maybe: 'warning',
    no: 'danger',
} as const satisfies Record<Exclude<SurveyAnswer, null>, string>;
