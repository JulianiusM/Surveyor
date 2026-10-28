/** A Monday-based calendar week with only the admitted range's stored civil days. */
export interface CivilDateWeek {
    start: string;
    days: string[];
}

/** A selected calendar interval; saved endpoints remain independent of its bounded projection. */
export interface CivilDateWindow {
    startDate: string;
    endDate: string;
    previous: string | null;
    next: string | null;
    oversized: boolean;
    maxDurationDays: number;
}
