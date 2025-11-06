import {APIError, ExpectedError, ValidationError} from '../../src/modules/lib/errors';

describe('lib/errors', () => {
    test('APIError sets name, status and data', () => {
        const err = new APIError('boom', {foo: 'bar'}, 418);
        expect(err.name).toBe('APIError');
        expect(err.status).toBe(418);
        expect(err.data).toEqual({foo: 'bar'});
        expect(err.message).toBe('boom');
    });

    test('ExpectedError sets severity and defaults', () => {
        const err = new ExpectedError('expected!', 'info', 400, {a: 1});
        expect(err.name).toBe('ExpectedError');
        expect(err.severity).toBe('info');
        expect(err.data).toEqual({a: 1});
        expect(err.message).toBe('expected!');
    });

    test('ValidationError carries template and data', () => {
        const err = new ValidationError('form', 'test', {v: 1});
        expect(err.name).toBe('ValidationError');
        expect(err.template).toBe('form');
        expect(err.message).toBe('test');
        expect(err.data).toEqual({v: 1});
    });
});
