import type {components} from './api/v1';
import type {PilotPlainMessageKey, PilotRequestScope} from './FrontendPilotUiTypes';

/** Creation features retain their fields and collection rules. This contract
 * supplies only admission, command delivery and the confirmed destination. */
export interface PilotCreationOptions<Result> {
    dirty(): boolean;
    eligible(): boolean;
    readEntry(scope: PilotRequestScope, returnTo: string): Promise<components['schemas']['PageEntryOutcome']>;
    navigateEntry(outcome: components['schemas']['PageEntryOutcome'], scope: PilotRequestScope, origin: string): Promise<boolean>;
    destination(result: Result): string;
    success: PilotPlainMessageKey;
    unknownMessage: PilotPlainMessageKey;
}

/** Collect only after fresh admission. A feature can report local validation and
 * return no operation without creating an uncertain command or releasing input. */
export type PilotCreationCollector<Result> = () => ((scope: PilotRequestScope) => Promise<Result>) | undefined;
