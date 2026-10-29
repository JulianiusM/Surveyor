import {expect, type APIRequestContext} from '@playwright/test';
import type {components} from '../../src/types/api/v1';
import {commandHeadersForE2E} from './e2eCoreKeywords';

/** Exercise an actual admitted API request with the actor's current session.
 * Fixture commands use the same context/CSRF boundary as browser commands and
 * preserve real response statuses, uploads and persisted business behavior. */
export async function financeFixtureRequest(request: APIRequestContext, method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string, options: Parameters<APIRequestContext['fetch']>[1] = {}) {
    return request.fetch(path, {...options, method,
        headers: {...await commandHeadersForE2E(request), ...options.headers}});
}

/** Create a real guest identity and registration, renewing the session headers
 * between operations because identity entry changes the admitted actor. */
export async function registerFinanceParticipantFixture(request: APIRequestContext, eventId: string, name: string, email?: string): Promise<void> {
    const guest = await financeFixtureRequest(request, 'POST', `/api/v1/events/${eventId}/guest`, {
        data: {username: name, email: email ?? null} satisfies components['schemas']['GuestRegistrationInput'],
    });
    expect(guest.status()).toBe(200);
    const registration = await financeFixtureRequest(request, 'PUT', `/api/v1/events/${eventId}/registration`, {
        data: {arrivalDate: '2030-06-01', departureDate: '2030-06-04', dietary: ['MEAT']},
    });
    expect(registration.status()).toBe(200);
}

/** Persist a participant or organizer receipt through its declared multipart
 * operation, retaining the original proof bytes and checking the real receipt. */
export async function submitFinanceInvoiceFixture(request: APIRequestContext, path: string,
    input: components['schemas']['FinanceOrganizerInvoiceInput'],
    proof?: {name: string; mimeType: string; buffer: Buffer}): Promise<void> {
    const response = await financeFixtureRequest(request, 'POST', path, {
        multipart: {data: JSON.stringify(input), ...(proof ? {proof} : {})},
    });
    expect(response.status(), await response.text()).toBe(200);
}

/** Create one uniquely named pool and obtain its ID from the actual organizer
 * projection. The command receipt intentionally supplies no resource ID. */
export async function createFinancePoolFixture(request: APIRequestContext, eventId: string,
    input: Pick<components['schemas']['FinancePoolCreateInput'], 'name'> & Partial<components['schemas']['FinancePoolCreateInput']>): Promise<string> {
    const response = await financeFixtureRequest(request, 'POST', `/api/v1/events/${eventId}/finance/pools`, {data: {
            distribution: 'EQUAL', status: 'OPEN', isDefault: false, assignAll: true, subtractPersonalInvoices: true,
            sendCalculationEmails: false, roundUpShares: false, registrations: [], ...input,
        }});
    expect(response.status()).toBe(200);
    const read = await financeFixtureRequest(request, 'GET', `/api/v1/events/${eventId}/finance/organizer`);
    expect(read.status()).toBe(200);
    const view: components['schemas']['FinanceView'] = await read.json();
    const matches = view.pools.filter(pool => pool.name === input.name);
    expect(matches).toHaveLength(1);
    return matches[0]!.id;
}
