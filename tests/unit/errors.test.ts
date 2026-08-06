import { APIError, ExpectedError, ValidationError } from '../../src/modules/lib/errors';
import { apiErrorData, expectedErrorData, validationErrorData } from '../data/unit/errorsData';

describe('lib/errors', () => {
    describe('APIError - Data Driven', () => {
        test.each(apiErrorData)('$description', ({ message, data, status, expected }) => {
            const err = new APIError(message, data, status);
            expect(err.name).toBe(expected.name);
            expect(err.status).toBe(expected.status);
            expect(err.data).toEqual(expected.data);
            expect(err.message).toBe(expected.message);
        });
    });

    describe('ExpectedError - Data Driven', () => {
        test.each(expectedErrorData)('$description', ({ message, severity, status, data, expected }) => {
            const err = new ExpectedError(message, severity, status, data);
            expect(err.name).toBe(expected.name);
            expect(err.severity).toBe(expected.severity);
            expect(err.data).toEqual(expected.data);
            expect(err.message).toBe(expected.message);
        });
    });

    describe('ValidationError - Data Driven', () => {
        test.each(validationErrorData)('$description', ({ template, message, data, expected }) => {
            const err = new ValidationError(template, message, data);
            expect(err.name).toBe(expected.name);
            expect(err.template).toBe(expected.template);
            expect(err.message).toBe(expected.message);
            expect(err.data).toEqual(expected.data);
        });
    });
});
