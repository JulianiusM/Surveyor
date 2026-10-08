import {describe, expect, it} from 'vitest';
import packingController from '../../src/controller/packingController';
import {ValidationError} from '../../src/modules/lib/errors';

/** Exercise the real native form adapter without opening a database or creating records. */
function form(item: Record<string, unknown> = {}, root: Record<string, unknown> = {}) {
    return {title: '  Native list  ', description: '  Native description  ', event_id: '',
        items: JSON.stringify([{title: '  Tent  ', description: '', maxAssignees: '2e0', requiredByAll: 'TRUE', ...item}]), ...root};
}

describe('generated native packing creation contract', () => {
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
