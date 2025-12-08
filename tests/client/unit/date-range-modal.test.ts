/**
 * Tests for date-range-modal.ts
 * Data-driven tests for date range modal functionality
 */

import {
    readDateRangePayload,
    populateDateRangeModal,
    submitDateRangeModal,
} from '../../../src/public/js/shared/date-range-modal';
import { readDateRangePayloadData, boundsData } from '../data/dateRangeModalData';

describe('date-range-modal', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        jest.clearAllMocks();
        
        // Mock Bootstrap Modal
        (window as any).bootstrap = {
            Modal: {
                getOrCreateInstance: jest.fn(() => ({
                    show: jest.fn(),
                    hide: jest.fn(),
                })),
            },
        };
    });

    describe('readDateRangePayload - Data Driven', () => {
        test.each(readDateRangePayloadData)(
            '$description',
            ({ arrival, departure, registrationId, expected }) => {
                // Setup DOM
                const form = document.createElement('form');
                form.innerHTML = `
                    <input name="arrivalDate" value="${arrival}" />
                    <input name="departureDate" value="${departure}" />
                    <input name="registrationId" value="${registrationId}" />
                `;

                // Execute
                const result = readDateRangePayload(form);

                // Verify
                expect(result).toEqual(expected);
            }
        );
    });

    describe('readDateRangePayload - Missing inputs', () => {
        test('returns null when arrival input missing', () => {
            const form = document.createElement('form');
            form.innerHTML = `
                <input name="departureDate" value="2024-01-05" />
                <input name="registrationId" value="123" />
            `;

            const result = readDateRangePayload(form);
            expect(result).toBeNull();
        });

        test('returns null when departure input missing', () => {
            const form = document.createElement('form');
            form.innerHTML = `
                <input name="arrivalDate" value="2024-01-01" />
                <input name="registrationId" value="123" />
            `;

            const result = readDateRangePayload(form);
            expect(result).toBeNull();
        });
    });

    describe('populateDateRangeModal - Data Driven', () => {
        test.each(boundsData)('$description', ({ bounds, expectedMin, expectedMax }) => {
            // Setup DOM
            const modal = document.createElement('div');
            const form = document.createElement('form');
            form.innerHTML = `
                <input name="arrivalDate" />
                <input name="departureDate" />
                <input name="registrationId" />
            `;
            modal.appendChild(form);
            document.body.appendChild(modal);

            const arrivalInput = form.querySelector('input[name="arrivalDate"]') as HTMLInputElement;
            const departureInput = form.querySelector('input[name="departureDate"]') as HTMLInputElement;

            // Execute
            populateDateRangeModal(
                { modal, form, bounds },
                { arrivalDate: '2024-06-01', departureDate: '2024-06-10', registrationId: '999' }
            );

            // Verify bounds
            if (expectedMin !== undefined) {
                expect(arrivalInput.min).toBe(expectedMin);
                expect(departureInput.min).toBe(expectedMin);
            }
            if (expectedMax !== undefined) {
                expect(arrivalInput.max).toBe(expectedMax);
                expect(departureInput.max).toBe(expectedMax);
            }

            // Verify values
            expect(arrivalInput.value).toBe('2024-06-01');
            expect(departureInput.value).toBe('2024-06-10');
        });
    });

    describe('populateDateRangeModal - Missing inputs', () => {
        test('returns early when inputs are missing', () => {
            const modal = document.createElement('div');
            const form = document.createElement('form');
            // Missing inputs
            modal.appendChild(form);

            // Should not throw
            expect(() => {
                populateDateRangeModal(
                    { modal, form },
                    { arrivalDate: '2024-06-01', departureDate: '2024-06-10', registrationId: '999' }
                );
            }).not.toThrow();
        });
    });

    describe('submitDateRangeModal', () => {
        test('submits successfully with default success message', async () => {
            // Setup DOM
            const modal = document.createElement('div');
            const form = document.createElement('form');
            form.innerHTML = `
                <input name="arrivalDate" value="2024-01-01" />
                <input name="departureDate" value="2024-01-05" />
                <input name="registrationId" value="123" />
                <button type="submit">Submit</button>
            `;
            modal.appendChild(form);
            document.body.appendChild(modal);

            // Mock submit action
            const submitAction = jest.fn().mockResolvedValue(undefined);

            // Execute
            await submitDateRangeModal({ modal, form }, submitAction);

            // Verify
            expect(submitAction).toHaveBeenCalledWith({
                arrivalDate: '2024-01-01',
                departureDate: '2024-01-05',
                registrationId: '123',
            });
        });

        test('calls onSuccess callback', async () => {
            // Setup DOM
            const modal = document.createElement('div');
            const form = document.createElement('form');
            form.innerHTML = `
                <input name="arrivalDate" value="2024-01-01" />
                <input name="departureDate" value="2024-01-05" />
                <input name="registrationId" value="123" />
                <button type="submit">Submit</button>
            `;
            modal.appendChild(form);
            document.body.appendChild(modal);

            // Mock callbacks
            const submitAction = jest.fn().mockResolvedValue(undefined);
            const onSuccess = jest.fn();

            // Execute
            await submitDateRangeModal({ modal, form }, submitAction, { onSuccess });

            // Verify
            expect(onSuccess).toHaveBeenCalled();
        });

        test('handles submit action error', async () => {
            // Setup DOM
            const modal = document.createElement('div');
            const form = document.createElement('form');
            form.innerHTML = `
                <input name="arrivalDate" value="2024-01-01" />
                <input name="departureDate" value="2024-01-05" />
                <input name="registrationId" value="123" />
                <button type="submit">Submit</button>
            `;
            modal.appendChild(form);
            document.body.appendChild(modal);

            // Mock submit action with error
            const submitAction = jest.fn().mockRejectedValue(new Error('API Error'));

            // Execute
            await submitDateRangeModal({ modal, form }, submitAction);

            // Verify error was handled (no throw)
            expect(submitAction).toHaveBeenCalled();
        });

        test('returns early with invalid payload', async () => {
            // Setup DOM with missing registration ID
            const modal = document.createElement('div');
            const form = document.createElement('form');
            form.innerHTML = `
                <input name="arrivalDate" value="2024-01-01" />
                <input name="departureDate" value="2024-01-05" />
                <input name="registrationId" value="" />
            `;
            modal.appendChild(form);

            // Mock submit action
            const submitAction = jest.fn();

            // Execute
            await submitDateRangeModal({ modal, form }, submitAction);

            // Verify submit action was not called
            expect(submitAction).not.toHaveBeenCalled();
        });
    });
});
