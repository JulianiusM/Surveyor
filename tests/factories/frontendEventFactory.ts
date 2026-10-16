import type {components} from '../../src/types/api/v1';

export const frontendEventId = '11111111-1111-4111-8111-111111111111';

/** Supply one complete generated actor shape for real mounted Event consumers. */
export function createFrontendEventSession(): components['schemas']['SessionView'] & {context: string; csrfToken: string} {
    return {kind: 'account', deployment: {buildId: 'fixture', apiCompatibility: 'v1-pilot-2026-10-07'},
        context: 'event-organizer-context-1234567890', csrfToken: 'event-organizer-csrf-1234567890', locale: 'en',
        activeProfile: {id: frontendEventId, name: 'Organizer'}, profiles: [{id: frontendEventId, name: 'Organizer'}],
        loginUrl: '/users/login', logoutUrl: '/users/logout',
        shell: {version: 'test', imprintUrl: '/imprint', privacyPolicyUrl: '/privacy', localLoginEnabled: true,
            oidcEnabled: false, oidcName: 'SSO'}};
}

/** Keep deliberate test variants sparse while the normal bounded Event shape stays valid. */
export function createFrontendEventView(overrides: Partial<components['schemas']['EventView']> = {}): components['schemas']['EventView'] {
    return {id: frontendEventId, title: 'Event fixture', description: null, headerUrl: null, headerVersion: null,
        startDate: '2027-06-01', endDate: '2027-06-03', location: null, bindingDeadline: null,
        timezone: 'UTC', maxParticipants: null, requireDietaryInfo: true, allowDietComment: true,
        allowRegDateUpdatesAfterDeadline: false, allowRegCancelationAfterDeadline: false, allowRegDietUpdateAfterDeadline: false,
        registrationCount: 0, isFull: false, hasInvoicePools: false, registration: null,
        capabilities: {register: true, admin: false, participants: false, manageRegistrations: false,
            items: false, settings: false, exportParticipants: false, manageAssignments: false},
        archive: {direct: false, inherited: false, archivedAt: null, autoArchivePaused: false, eventUrl: null}, ...overrides};
}
