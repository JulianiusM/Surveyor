/**
 * Tests for drivers-create.ts module
 */

import { driversCreateTestData } from '../data/driversCreateData';

// Mock dependencies
jest.mock('../../../src/public/js/core/navigation', () => ({
    setCurrentNavLocation: jest.fn(),
}));

jest.mock('../../../src/public/js/core/permissions', () => ({
    loadPerms: jest.fn(),
}));

import { setCurrentNavLocation } from '../../../src/public/js/core/navigation';
import { loadPerms } from '../../../src/public/js/core/permissions';

describe('drivers-create module', () => {
    let init: () => void;

    beforeEach(() => {
        // Setup DOM
        document.body.innerHTML = `
            <form id="packingForm">
                <input type="hidden" id="itemsJson" />
                <table>
                    <tbody id="itemTable"></tbody>
                </table>
            </form>
        `;

        // Setup global namespace
        window.Surveyor = {} as any;

        // Clear mocks
        jest.clearAllMocks();

        // Import module fresh
        jest.isolateModules(() => {
            const module = require('../../../src/public/js/drivers-create');
            init = module.init;
        });
    });

    describe('init', () => {
        it('should call setCurrentNavLocation', () => {
            init();
            expect(setCurrentNavLocation).toHaveBeenCalledTimes(1);
        });

        it('should call loadPerms', () => {
            init();
            expect(loadPerms).toHaveBeenCalledTimes(1);
        });

        it('should call functions in correct order', () => {
            const calls: string[] = [];
            (setCurrentNavLocation as jest.Mock).mockImplementation(() => calls.push('nav'));
            (loadPerms as jest.Mock).mockImplementation(() => calls.push('perms'));

            init();

            expect(calls).toEqual(['nav', 'perms']);
        });

        it('should expose init function to global scope', () => {
            init();
            expect(window.Surveyor.init).toBe(init);
        });

        it('should initialize form submit listener', () => {
            init();
            const form = document.getElementById('packingForm')!;
            const submitEvent = new Event('submit', { bubbles: true, cancelable: true });
            const preventDefaultSpy = jest.spyOn(submitEvent, 'preventDefault');

            form.dispatchEvent(submitEvent);

            expect(preventDefaultSpy).toHaveBeenCalled();
        });
    });

    describe('form submission', () => {
        beforeEach(() => {
            init();
        });

        it('should serialize items to JSON and submit form', () => {
            const form = document.getElementById('packingForm') as HTMLFormElement;
            const hiddenField = document.getElementById('itemsJson') as HTMLInputElement;
            const tableBody = document.getElementById('itemTable')!;

            // Add sample rows
            driversCreateTestData.sampleItems.forEach((item, idx) => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><input name="t_${idx}" value="${item.title}" /></td>
                    <td><input name="d_${idx}" value="${item.description}" /></td>
                    <td><input name="m_${idx}" value="${item.maxAssignees}" /></td>
                `;
                tableBody.appendChild(tr);
            });

            const submitSpy = jest.spyOn(form, 'submit').mockImplementation(() => {});
            const submitEvent = new Event('submit', { bubbles: true, cancelable: true });

            form.dispatchEvent(submitEvent);

            expect(submitSpy).toHaveBeenCalled();
            expect(hiddenField.value).toBeTruthy();

            const parsed = JSON.parse(hiddenField.value);
            expect(parsed).toHaveLength(3);
            expect(parsed[0].title).toBe('Driver 1');
            expect(parsed[0].maxAssignees).toBe(2);
        });

        it('should handle empty form', () => {
            const form = document.getElementById('packingForm') as HTMLFormElement;
            const hiddenField = document.getElementById('itemsJson') as HTMLInputElement;
            const submitSpy = jest.spyOn(form, 'submit').mockImplementation(() => {});
            const submitEvent = new Event('submit', { bubbles: true, cancelable: true });

            form.dispatchEvent(submitEvent);

            expect(submitSpy).toHaveBeenCalled();
            expect(JSON.parse(hiddenField.value)).toEqual([]);
        });

        it('should skip rows with empty titles', () => {
            const form = document.getElementById('packingForm') as HTMLFormElement;
            const hiddenField = document.getElementById('itemsJson') as HTMLInputElement;
            const tableBody = document.getElementById('itemTable')!;

            // Add rows with some empty titles
            const tr1 = document.createElement('tr');
            tr1.innerHTML = '<td><input name="t_0" value="" /></td>';
            tableBody.appendChild(tr1);

            const tr2 = document.createElement('tr');
            tr2.innerHTML = '<td><input name="t_1" value="Valid Title" /></td><td><input name="m_1" value="1" /></td>';
            tableBody.appendChild(tr2);

            const submitSpy = jest.spyOn(form, 'submit').mockImplementation(() => {});
            const submitEvent = new Event('submit', { bubbles: true, cancelable: true });

            form.dispatchEvent(submitEvent);

            const parsed = JSON.parse(hiddenField.value);
            expect(parsed).toHaveLength(1);
            expect(parsed[0].title).toBe('Valid Title');
        });

        it('should default maxAssignees to 1 when missing', () => {
            const form = document.getElementById('packingForm') as HTMLFormElement;
            const hiddenField = document.getElementById('itemsJson') as HTMLInputElement;
            const tableBody = document.getElementById('itemTable')!;

            const tr = document.createElement('tr');
            tr.innerHTML = '<td><input name="t_0" value="Test" /></td>';
            tableBody.appendChild(tr);

            const submitSpy = jest.spyOn(form, 'submit').mockImplementation(() => {});
            const submitEvent = new Event('submit', { bubbles: true, cancelable: true });

            form.dispatchEvent(submitEvent);

            const parsed = JSON.parse(hiddenField.value);
            expect(parsed[0].maxAssignees).toBe(1);
        });
    });

    describe('graceful handling', () => {
        it('should handle missing table element', () => {
            document.body.innerHTML = '<form id="packingForm"><input id="itemsJson" /></form>';

            init();

            const form = document.getElementById('packingForm') as HTMLFormElement;
            const submitSpy = jest.spyOn(form, 'submit').mockImplementation(() => {});
            const submitEvent = new Event('submit', { bubbles: true, cancelable: true });

            expect(() => form.dispatchEvent(submitEvent)).not.toThrow();
            expect(submitSpy).toHaveBeenCalled();
        });

        it('should handle missing form element', () => {
            document.body.innerHTML = '<div></div>';

            expect(() => init()).not.toThrow();
        });
    });
});
