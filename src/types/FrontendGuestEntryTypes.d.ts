import type {components} from './api/v1';
import type {FrontendRequestScope} from './FrontendUiTypes';
import type {MessageKey} from './LocalizationTypes';

/** A feature owns admission, query identity and canonical destination. The shared
 * guest page owns only the repeated identity choices, draft and presentation. */
export interface FrontendGuestEntryProps {
    entry?: components['schemas']['GuestEntry'];
    resourceId: string;
    destination: string;
    titleKey: MessageKey;
    /** Select contextual guidance and confirmation; features still own admission and commands. */
    presentation?: 'generic' | 'event';
    queryKey: readonly unknown[];
    readEntry: (scope: FrontendRequestScope, signal?: AbortSignal) => Promise<components['schemas']['GuestEntry']>;
    registerGuest: (input: components['schemas']['GuestRegistrationInput'], scope: FrontendRequestScope) => Promise<components['schemas']['IdentityResult']>;
}
