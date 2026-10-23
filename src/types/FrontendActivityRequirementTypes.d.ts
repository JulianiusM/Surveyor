import type {components} from './api/v1';

/** Lexical controls belong to one requirements visit, independently of cached reads. */
export interface ActivityRequirementDraft {
    assignmentMode: 'FREE' | 'REQUIRED';
    generalRequiredShifts: string;
    roundingMode: '' | 'CEIL' | 'ROUND' | 'FLOOR';
    bindingDeadline: string;
    allowOverfillAfterFull: boolean;
    allowExternalAssignees: boolean;
    allowArrivalDayEvening: boolean;
    allowDepartureDayMorning: boolean;
    roles: {roleId: string; value: string}[];
    stays: {stayDays: number; value: string}[];
    overrides: {key: number; id?: string; profileId: string; profileName?: string | null; roleId: string; value: string}[];
    removedOverrideIds: string[];
}

/** Coverage wording is presentation; the shared domain engine supplies all figures. */
export interface ActivityRequirementCoverage {
    state: 'inactive' | 'exact' | 'acceptable' | 'conflict';
    variant: 'secondary' | 'success' | 'warning' | 'danger';
    icon: string;
    title: string;
    detail: string;
}

export type ActivityRequirementConfiguration = components['schemas']['ActivityRequirements'];
