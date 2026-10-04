import {describe, expect, it} from 'vitest';
import {prepareSharesPdfOptions, preparePoolSubmissionState, preparePoolCreation, prepareOrganizerInvoice} from '../../src/modules/invoice/requests';
import {APIError} from '../../src/modules/lib/errors';

describe('invoice shares PDF preferences', () => {
    it('preserves the existing example when no preference is supplied', () => {
        expect(prepareSharesPdfOptions()).toEqual({includeExampleCalculation: true});
        expect(prepareSharesPdfOptions({})).toEqual({includeExampleCalculation: true});
    });

    it.each([true, 'true', false, 'false'])('normalizes the single explicit preference %s', (example) => {
        const query = {example, unrelated: 'existing query value'};
        const before = structuredClone(query);
        expect(prepareSharesPdfOptions(query)).toEqual({includeExampleCalculation: example === true || example === 'true'});
        expect(query).toEqual(before);
    });

    it.each(['invalid', '', 0, 1, ['false'], ['true', 'false'], {value: false}, null])(
        'rejects an ambiguous or invalid preference %j', (example) => {
            expect(() => prepareSharesPdfOptions({example})).toThrow(APIError);
            try {
                prepareSharesPdfOptions({example});
            } catch (error) {
                expect(error).toMatchObject({status: 400});
            }
        },
    );
});

describe('invoice pool creation state', () => {
    it('keeps existing creation requests open for invoices when no state is supplied', () => {
        const body = {name: 'Existing pool request', distribution: 'EQUAL', assignAll: true};
        expect(preparePoolCreation(body, [])).toMatchObject({status: 'OPEN', assignAll: true});
        expect(body).not.toHaveProperty('status');
    });

    it.each(['OPEN', 'ORGANIZER_ONLY'])('accepts %s as the initial pool state without a transition request', (status) => {
        const body = {name: 'Independent pool state', distribution: 'EQUAL', status};
        expect(preparePoolCreation(body, [])).toMatchObject({status});
    });

    it.each(['CLOSED', 'UNSUPPORTED', '', null, ['OPEN']])('rejects an invalid initial state %j', (status) => {
        expect(() => preparePoolCreation({name: 'Invalid initial state', distribution: 'EQUAL', status}, [])).toThrow(APIError);
    });
});

describe('invoice pool submission state requests', () => {
    it.each(['OPEN', 'ORGANIZER_ONLY'])('accepts an independent %s target without a confirmation API field', (status) => {
        expect(preparePoolSubmissionState({status, expectedRevision: '3'})).toEqual({status, expectedRevision: 3});
    });

    it.each([
        {status: 'CLOSED', expectedRevision: 3},
        {status: 'ORGANIZER_ONLY'},
        {status: 'OPEN', expectedRevision: -1},
        {status: 'OPEN', expectedRevision: 0.5},
        {status: ['OPEN', 'ORGANIZER_ONLY'], expectedRevision: 3},
    ])('rejects a financial close or an unverifiable target %j', (body) => {
        expect(() => preparePoolSubmissionState(body)).toThrow(APIError);
    });
});

describe('organizer invoice paid-by attribution', () => {
    it.each([undefined, ''])('keeps an omitted or empty paid-by selection as a shared organizer cost', (registrationId) => {
        const body = {amount: '25.00', description: '  Shared booking  ', registrationId};
        const before = structuredClone(body);
        const request = prepareOrganizerInvoice(body);
        expect(request).toMatchObject({amount: 25, description: 'Shared booking'});
        expect(request.registrationId).toBeUndefined();
        expect(body).toEqual(before);
    });

    it.each([12, '12'])('normalizes a single explicit participant selection %s', (registrationId) => {
        expect(prepareOrganizerInvoice({amount: 25, description: 'Participant paid', registrationId}))
            .toMatchObject({amount: 25, description: 'Participant paid', registrationId: 12});
    });

    it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, 'participant', null, [12], {id: 12}])(
        'rejects ambiguous or invalid paid-by attribution %j', (registrationId) => {
            expect(() => prepareOrganizerInvoice({amount: 25, description: 'Invalid attribution', registrationId})).toThrow(APIError);
        },
    );
});
