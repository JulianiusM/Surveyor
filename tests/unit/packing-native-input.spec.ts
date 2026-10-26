import {normalizeListMetadataPatch as normalizePackingMetadataPatch} from '../../src/backend/controller/entityAdminController';
import {describe, expect, it} from 'vitest';
import packingController from '../../src/backend/controller/packingController';
import {APIError, ValidationError} from '../../src/backend/modules/lib/errors';
import {ApiProblem} from '../../src/backend/modules/api/problem';

import {validateApiInput} from '../../src/backend/modules/api/transport';

/** Exercise the real native form adapter without opening a database or creating records. */
function form(item: Record<string, unknown> = {}, root: Record<string, unknown> = {}) {
    return {title: '  Native list  ', description: '  Native description  ', event_id: '',
        items: JSON.stringify([{title: '  Tent  ', description: '', maxAssignees: '2e0', requiredByAll: 'TRUE', ...item}]), ...root};
}

describe('original native packing creation contract', () => {
    it('preserves native whitespace, decimal/exponent and boolean coercion, and unknown item fields', () => {
        const parsed = packingController.preprocessCreate(form({legacyField: 'retained'}));
        expect(parsed).toMatchObject({title: '  Native list  ', description: '  Native description  ', eventId: null,
            items: [{title: '  Tent  ', description: '', maxAssignees: 2, requiredByAll: true, legacyField: 'retained'}]});
        expect(packingController.preprocessCreate(form({maxAssignees: '1.0', requiredByAll: 'false'})).items[0])
            .toMatchObject({maxAssignees: 1, requiredByAll: false});
    });

    it('keeps omitted and blank root descriptions optional while rejecting explicit null descriptions', () => {
        expect(packingController.preprocessCreate(form({}, {description: undefined})).description).toBeNull();
        expect(packingController.preprocessCreate(form({}, {description: ''})).description).toBeNull();
        expect(() => packingController.preprocessCreate(form({}, {description: null})))
            .toThrow('"description" must be a string');
        expect(() => packingController.preprocessCreate(form({description: null})))
            .toThrow('"items[0].description" must be a string');
    });

    it.each([
        [{maxAssignees: '0x2'}, '"items[0].maxAssignees" must be a number'],
        [{maxAssignees: 0}, '"items[0].maxAssignees" must be greater than or equal to 1'],
        [{maxAssignees: 1.5}, '"items[0].maxAssignees" must be an integer'],
        [{maxAssignees: '9007199254740993'}, '"items[0].maxAssignees" must be a safe number'],
        [{requiredByAll: 'yes'}, '"items[0].requiredByAll" must be a boolean'],
        [{title: ''}, '"items[0].title" is not allowed to be empty'],
    ])('retains the native field error and submitted redisplay data for %j', (item, message) => {
        const body = form(item);
        try {
            packingController.preprocessCreate(body);
            throw new Error('Invalid native form was accepted');
        } catch (error) {
            expect(error).toBeInstanceOf(ValidationError);
            expect(error).toMatchObject({template: 'packing/packing-create', message, data: {body}});
        }
    });

    it('retains malformed JSON and required-row errors without trimming whitespace titles', () => {
        expect(() => packingController.preprocessCreate(form({}, {items: 'invalid json'}))).toThrow('Invalid items JSON');
        expect(() => packingController.preprocessCreate(form({}, {items: '[]'}))).toThrow('"items" must contain at least 1 items');
        expect(packingController.preprocessCreate(form({title: '   '}, {title: '   '})).title).toBe('   ');
    });

    it('retains the original unbounded creation strings instead of adopting metadata maxima', () => {
        const text = '\u{1F600}'.repeat(16001);
        const parsed = packingController.preprocessCreate(form({title: text, description: text}, {title: text, description: text}));
        expect(parsed).toMatchObject({title: text, description: text, items: [{title: text, description: text}]});
    });

    it('keeps mixed root, required-row, scalar and multiple-rule failures in the original native schema order', () => {
        const body = form({}, {title: '', description: null, event_id: 'invalid-guid', items: JSON.stringify([
            {title: '', description: null, maxAssignees: '0x2', requiredByAll: 'yes'},
            {description: '', maxAssignees: 0.5, requiredByAll: false},
        ])});
        expect(() => packingController.preprocessCreate(body)).toThrow([
            '"title" is not allowed to be empty',
            '"description" must be a string',
            '"items[0].title" is not allowed to be empty',
            '"items[0].description" must be a string',
            '"items[0].maxAssignees" must be a number',
            '"items[0].requiredByAll" must be a boolean',
            '"items[1].title" is required',
            '"items[1].maxAssignees" must be an integer',
            '"items[1].maxAssignees" must be greater than or equal to 1',
            '"event_id" must be a valid GUID',
        ].join(', '));
    });
});

describe('original native packing metadata diagnostics', () => {
    it.each([
        [{title: '   '}, '"title" is not allowed to be empty', false],
        [{title: 'T'.repeat(256)}, '"title" length must be less than or equal to 255 characters long', false],
        [{title: '\u{1F600}'.repeat(128)}, '"title" length must be less than or equal to 255 characters long', true],
        [{description: 'D'.repeat(16001)}, '"description" length must be less than or equal to 16000 characters long', false],
        [{description: '\u{1F600}'.repeat(8001)}, '"description" length must be less than or equal to 16000 characters long', true],
        [{description: 42}, '"description" must be a string', false],
        [{}, '"value" must have at least 1 key', false],
        [undefined, '"value" is required', false],
        [null, '"value" must be of type object', false],
        [{title: ' ', description: false}, '"title" is not allowed to be empty. "description" must be a string', false],
    ] as const)('retains the original native diagnostic for %j without starting persistence', async (body, message, versionedAccepts) => {
        // These independently recorded literals come from the original native controller,
        // not the generated API catalog. Invalid structure is rejected before a DBAL call.
        const entity = {id: '11111111-1111-4111-8111-111111111111', title: 'Native metadata',
            ownerId: '22222222-2222-4222-8222-222222222222'};
        try {
            await packingController.updateProperties(entity, body);
            throw new Error('Invalid native metadata was accepted');
        } catch (error) {
            expect(error).toBeInstanceOf(APIError);
            expect(error).not.toBeInstanceOf(ApiProblem);
            expect(error).toMatchObject({status: 400, message, data: {}});
        }
        // Original Joi counts UTF-16 units. The separate v1 schema counts code
        // points, so the same astral boundary is accepted only by that adapter.
        if (versionedAccepts) {
            const normalized = normalizePackingMetadataPatch(body);
            expect(normalized).toEqual(body);
            expect(() => validateApiInput('updatePackingMetadata', normalized)).not.toThrow();
        }
    });

    it('keeps the native inline-description diagnostic independently of its versioned transport', async () => {
        await expect(packingController.updateDescription('unused-before-validation', {description: 'D'.repeat(16001)}))
            .rejects.toMatchObject({status: 400,
                message: '"description" length must be less than or equal to 16000 characters long', data: {}});
    });
});
