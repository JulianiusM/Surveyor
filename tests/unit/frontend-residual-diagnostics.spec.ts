
import {getEventLinkOptions} from '../../src/backend/modules/event/linkage';
import {describe, expect, it} from 'vitest';
import eventController from '../../src/backend/controller/eventController';
import {createProfile, deactivateProfile} from '../../src/backend/controller/userController';
import {isDeactivationOwnershipRejection, requireAccountDeletion, updateProfile} from '../../src/backend/modules/identity';
import {DataSource} from 'typeorm';
import {normalizeBasicProperties} from '../../src/backend/controller/entityAdminController';
import type {Event} from '../../src/backend/modules/database/entities/event/Event';
import {APIError, ValidationError} from '../../src/backend/modules/lib/errors';
import {ApiProblem, classifyApiError, declaredApiProblem, validatedProblemBody} from '../../src/backend/modules/api/problem';
import {contractValidator} from '../../src/backend/modules/api/contracts';
import type {PermView, SessionLike} from '../../src/types/PermissionTypes';

const event = {id: '11111111-1111-4111-8111-111111111111'} as Event;
const actor = {profile: {id: event.id, name: 'Saved profile name'},
    auth: {user: {id: 1, username: 'saved-username'}}};
// Construct a real manager without initializing a connection. The early input
// guard must reject before metadata lookup, SQL or any persistence is attempted.
const manager = new DataSource({type: 'mariadb'}).manager;
const permissions: PermView = {mask: 0, parentMask: 0, bits: {},
    has: () => true, allow: () => true, all: () => true, any: () => true};

/** Exercise original feature/controller guards before their first persistence call.
 * No repository, transaction, validator or business operation is substituted. */
async function rejection(operation: () => Promise<unknown>): Promise<APIError | ValidationError> {
    try { await operation(); } catch (error) {
        expect(error instanceof APIError || error instanceof ValidationError).toBe(true);
        return error as APIError | ValidationError;
    }
    throw new Error('Expected the original controller guard to reject');
}

/** Both public replies use the declared finite code; native prose, form data
 * and submitted values never become the translated explanation. */
function localizedRejection(error: APIError | ValidationError, code: string): void {
    expect(error.cause).toBe(code);
    const problem = classifyApiError(error);
    expect(problem).toMatchObject({code, status: 400, params: {}});
    for (const locale of ['en', 'de']) {
        const response = validatedProblemBody(problem, locale, 'residual-diagnostic');
        expect(contractValidator('Problem')(response)).toBe(true);
        expect(response).toMatchObject({code, status: 400, params: {}});
        expect(response.detail).not.toBe(error.message);
        expect(response.detail).not.toContain('submitted values');
        expect(JSON.stringify(response)).not.toContain('PRIVATE_');
        expect(JSON.stringify(response)).not.toContain('saved-username');
        expect(JSON.stringify(response)).not.toContain('Saved profile name');
    }
}

describe('Remaining reachable controller rejection diagnostics', () => {
    it('does not classify an unrelated same-code error as a pre-detach ownership rejection', () => {
        // Mail, selection or local-save errors cannot borrow a known rejection
        // merely by carrying its public code or shape after detach has committed.
        expect(isDeactivationOwnershipRejection(new ApiProblem('SESSION_CONTEXT_CHANGED'))).toBe(false);
        expect(isDeactivationOwnershipRejection({code: 'SESSION_CONTEXT_CHANGED'})).toBe(false);
    });

    it.each([
        {query: {cursor: 'PRIVATE_MODIFIED_CURSOR'}, code: 'EVENT_SEARCH_EXPIRED',
            message: 'Search expired or changed. Reset filters and try again.'},
        {query: {from: '2030-06-03', to: '2030-06-01'}, code: 'EVENT_SEARCH_RANGE_INVALID',
            message: 'Invalid event filters.'},
    ])('explains $code before event search persistence', async ({query, code, message}) => {
        const error = await rejection(() => getEventLinkOptions(query, actor satisfies SessionLike));
        expect(error).toMatchObject({message, status: 400, data: {}});
        localizedRejection(error, code);
    });

    it.each([
        {body: {maxParticipants: 0}, code: 'EVENT_PARTICIPANT_LIMIT_INVALID'},
        {body: {maxParticipants: -1}, code: 'EVENT_PARTICIPANT_LIMIT_INVALID'},
        {body: {maxParticipants: 1.5}, code: 'EVENT_PARTICIPANT_LIMIT_INVALID'},
        {body: {maxParticipants: 'PRIVATE_INVALID_LIMIT'}, code: 'EVENT_PARTICIPANT_LIMIT_INVALID'},
        {body: {startDate: '2030-02-30'}, code: 'EVENT_CALENDAR_DATE_INVALID'},
        {body: {endDate: '0000-01-01'}, code: 'EVENT_CALENDAR_DATE_INVALID'},
        {body: {title: '   '}, code: 'EVENT_TITLE_INVALID'},
        {body: {title: '😀'.repeat(128)}, code: 'EVENT_TITLE_INVALID'},
        {body: {description: '😀'.repeat(8001)}, code: 'EVENT_DESCRIPTION_TOO_LONG'},
        {body: {location: '😀'.repeat(128)}, code: 'EVENT_LOCATION_TOO_LONG'},
        {body: {deadlineTz: '😀'.repeat(128)}, code: 'EVENT_TIMEZONE_INVALID'},
    ])('explains existing Event property rejection $code without changing native validation', async ({body, code}) => {
        // These all pass the actual wire schema; existing shared validation then
        // rejects semantic dates, native string lengths or positive whole limits.
        expect(contractValidator('EventMetadataPatch')(body)).toBe(true);
        const original = structuredClone(body);
        const error = await rejection(() => eventController.updateEventSettings(event, body, {entity: permissions}));
        expect(error).toMatchObject({status: 400, data: {}});
        expect(body).toEqual(original);
        localizedRejection(error, code);
    });

    it.each(['account', 'profile'] as const)('explains an incorrect %s deletion confirmation before any write', async kind => {
        const session = actor as Parameters<typeof deactivateProfile>[1];
        const body = kind === 'account' ? {username: 'PRIVATE_WRONG_USERNAME'} : {name: 'PRIVATE_WRONG_NAME'};
        const error = await rejection(async () => kind === 'account'
            ? requireAccountDeletion(body, session) : deactivateProfile(body, session));
        expect(error).toBeInstanceOf(ValidationError);
        expect(error).toMatchObject({data: body, message: kind === 'account'
            ? 'Invalid account deletion verification' : 'Invalid profile deactivation verification'});
        localizedRejection(error, kind === 'account' ? 'ACCOUNT_DELETION_CONFIRMATION_INVALID' : 'PROFILE_DEACTIVATION_CONFIRMATION_INVALID');
    });

    it.each(['create', 'update'] as const)('explains a blank profile name in the existing %s operation', async kind => {
        const body = {name: '   ', ...(kind === 'update' ? {isDefault: false} : {})};
        expect(contractValidator(kind === 'create' ? 'ProfileCreateInput' : 'ProfileUpdateInput')(body)).toBe(true);
        const error = await rejection(() => kind === 'create' ? createProfile(body, 1)
            : updateProfile(body, actor, manager));
        expect(error).toBeInstanceOf(ValidationError);
        expect(error).toMatchObject({message: 'Invalid profile name', data: kind === 'create' ? body : {}});
        localizedRejection(error, 'PROFILE_NAME_REQUIRED');
    });

    it.each([
        {body: {title: '😀'.repeat(128)}, code: 'ENTITY_TITLE_INVALID'},
        {body: {description: '😀'.repeat(8001)}, code: 'ENTITY_DESCRIPTION_TOO_LONG'},
    ])('explains shared root-property rejection $code before persistence', async ({body, code}) => {
        // Packing, Drivers and Survey use this one shared validator. Their wire
        // schemas allow this code-point length; native UTF16 limits still reject.
        for (const schema of ['BasicEntityMetadataPatch', 'DriversMetadataPatch', 'SurveyMetadataPatch'])
            expect(contractValidator(schema)(body)).toBe(true);
        const original = structuredClone(body);
        const error = await rejection(async () => normalizeBasicProperties(body));
        expect(error).toMatchObject({status: 400, data: {}});
        expect(body).toEqual(original);
        localizedRejection(error, code);
    });

    it('keeps ValidationError causes within the trusted closed status400 manifest', () => {
        expect(declaredApiProblem(new ValidationError('native', 'PRIVATE_DETAILS', {}, {cause: 'PROFILE_NAME_REQUIRED'})))
            .toMatchObject({code: 'PROFILE_NAME_REQUIRED', status: 400, params: {}});
        expect(declaredApiProblem(new ValidationError('native', 'PRIVATE_DETAILS', {}, {cause: 'EVENT_FULL'}))).toBeNull();
        expect(declaredApiProblem(new Error('PRIVATE_DETAILS', {cause: 'PROFILE_NAME_REQUIRED'}))).toBeNull();
        expect(declaredApiProblem({cause: 'PROFILE_NAME_REQUIRED', status: 400})).toBeNull();
    });
});
