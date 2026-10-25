import type {components} from './api/v1';
import type {FrontendActionState, FrontendPlainMessageKey, FrontendRequestScope} from './FrontendUiTypes';

/** Creation features retain their fields and collection rules. This contract
 * supplies only admission, command delivery and the confirmed destination. */
export interface FrontendCreationOptions<Result> {
    dirty(): boolean;
    eligible(): boolean;
    readEntry(scope: FrontendRequestScope, returnTo: string): Promise<components['schemas']['PageEntryOutcome']>;
    navigateEntry(outcome: components['schemas']['PageEntryOutcome'], scope: FrontendRequestScope, origin: string): Promise<boolean>;
    destination(result: Result): string;
    success: FrontendPlainMessageKey;
    unknownMessage: FrontendPlainMessageKey;
}

/** Collect only after fresh admission. A feature can report local validation and
 * return no operation without creating an uncertain command or releasing input. */
export type FrontendCreationCollector<Result> = () => ((scope: FrontendRequestScope) => Promise<Result>) | undefined;

/** Admission feedback is presentation supplied by the actual read owner. A
 * successful receipt and retry state never come from the form's local draft. */
export interface FrontendCreationAdmissionNotice {
    error: Error | null | undefined;
    lastUpdatedAt?: number;
    retryAt?: number;
    action: FrontendActionState;
    stale?: boolean;
    kind?: 'warning' | 'danger';
}

/** Root forms share only these two warnings. Page denial, ordinary command
 * errors, uncertainty and confirmed navigation retain their own placement. */
export interface FrontendCreationAdmissionNoticesProps {
    read: FrontendCreationAdmissionNotice;
    submission: FrontendCreationAdmissionNotice;
}
