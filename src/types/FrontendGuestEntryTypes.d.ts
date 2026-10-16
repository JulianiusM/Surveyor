import type {components} from './api/v1';
import type {PilotRequestScope} from './FrontendPilotUiTypes';
import type {MessageKey} from './LocalizationTypes';

/** A feature owns admission, query identity and canonical destination. The shared
 * guest page owns only the repeated identity choices, draft and presentation. */
export interface FrontendGuestEntryProps {
    entry?: components['schemas']['GuestEntry'];
    resourceId: string;
    destination: string;
    titleKey: MessageKey;
    queryKey: readonly unknown[];
    readEntry: (scope: PilotRequestScope, signal?: AbortSignal) => Promise<components['schemas']['GuestEntry']>;
    registerGuest: (input: components['schemas']['GuestRegistrationInput'], scope: PilotRequestScope) => Promise<components['schemas']['IdentityResult']>;
}
