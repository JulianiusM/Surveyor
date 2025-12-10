/**
 * Tests for packing-create.ts module
 * Using real PUG template for DOM structure
 */

import { packingCreateTestData as _packingCreateTestData } from '../data/packingCreateData';

const packingCreateTestData = _packingCreateTestData();
import { setupTest } from '../helpers/testSetup';
import { renderPugView } from '../helpers/renderPugView';

// Mock dependencies
jest.mock('../../../src/public/js/core/navigation', () => ({
    setCurrentNavLocation: jest.fn(),
}));

jest.mock('../../../src/public/js/core/permissions', () => ({
    loadPerms: jest.fn(),
}));

import { setCurrentNavLocation } from '../../../src/public/js/core/navigation';
import { loadPerms } from '../../../src/public/js/core/permissions';

describe('packing-create module', () => {
    let init: () => void;

    setupTest({
        beforeEach: () => {
            // Render real PUG template
            const html = renderPugView('packing/packing-create.pug', {
                data: {} // Empty data for create mode
            }, true); // Extract content only
            document.body.innerHTML = html;

            // Setup global namespace
            window.Surveyor = {} as any;

            // Import module fresh
            jest.isolateModules(() => {
                const module = require('../../../src/public/js/packing-create');
                init = module.init;
            });
        }
    });

    describe('init', () => {
        it('should call setCurrentNavLocation and loadPerms', () => {
            init();
            expect(setCurrentNavLocation).toHaveBeenCalledTimes(1);
            expect(loadPerms).toHaveBeenCalledTimes(1);
        });

        it('should create initial row when no prefilled items', () => {
            init();
            const tableBody = document.getElementById('itemTable')!;
            expect(tableBody.querySelectorAll('tr')).toHaveLength(1);
        });

        it('should prefill rows when prefilledItems exist', () => {
            window.Surveyor.prefilledItems = packingCreateTestData.prefilledItems;
            init();

            const tableBody = document.getElementById('itemTable')!;
            const rows = tableBody.querySelectorAll('tr');
            expect(rows).toHaveLength(2);

            const firstRowTitle = rows[0].querySelector<HTMLInputElement>('input[name^="t_"]')!;
            expect(firstRowTitle.value).toBe('Prefilled 1');
        });

        it('should initialize add button listener', () => {
            init();
            const tableBody = document.getElementById('itemTable')!;
            const addBtn = document.getElementById('addItemBtn')!;

            expect(tableBody.querySelectorAll('tr')).toHaveLength(1);

            addBtn.click();

            expect(tableBody.querySelectorAll('tr')).toHaveLength(2);
        });

        it('should initialize form submit listener', () => {
            init();
            const form = document.getElementById('packingForm')!;
            const submitEvent = new Event('submit', { bubbles: true, cancelable: true });
            const preventDefaultSpy = jest.spyOn(submitEvent, 'preventDefault');

            form.dispatchEvent(submitEvent);

            expect(preventDefaultSpy).toHaveBeenCalled();
        });

        it('should expose init function to global scope', () => {
            init();
            expect(window.Surveyor.init).toBe(init);
        });
    });

    describe('row creation', () => {
        beforeEach(() => {
            init();
        });

        it('should create row with all input fields', () => {
            const tableBody = document.getElementById('itemTable')!;
            const row = tableBody.querySelector('tr')!;

            expect(row.querySelector('input[name^="t_"]')).toBeTruthy(); // title
            expect(row.querySelector('input[name^="d_"]')).toBeTruthy(); // description
            expect(row.querySelector('input[name^="m_"]')).toBeTruthy(); // maxAssignees
            expect(row.querySelector('input[name^="e_"]')).toBeTruthy(); // everyone switch
        });

        it('should create row with remove button', () => {
            const tableBody = document.getElementById('itemTable')!;
            const addBtn = document.getElementById('addItemBtn')!;

            addBtn.click(); // Create second row
            expect(tableBody.querySelectorAll('tr')).toHaveLength(2);

            const removeBtn = tableBody.querySelector('button') as HTMLButtonElement;
            removeBtn.click();

            expect(tableBody.querySelectorAll('tr')).toHaveLength(1);
        });

        it('should increment row index for each new row', () => {
            const addBtn = document.getElementById('addItemBtn')!;

            addBtn.click();
            addBtn.click();

            const tableBody = document.getElementById('itemTable')!;
            const rows = tableBody.querySelectorAll('tr');

            expect(rows[0].dataset.idx).toBe('0');
            expect(rows[1].dataset.idx).toBe('1');
            expect(rows[2].dataset.idx).toBe('2');
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

            // Clear initial row and add sample rows
            tableBody.innerHTML = '';
            packingCreateTestData.sampleItems.forEach((item, idx) => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><input name="t_${idx}" value="${item.title}" /></td>
                    <td><input name="d_${idx}" value="${item.description}" /></td>
                    <td><input name="m_${idx}" value="${item.maxAssignees}" /></td>
                    <td><input type="checkbox" name="e_${idx}" ${item.requiredByAll ? 'checked' : ''} /></td>
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
            expect(parsed[0].title).toBe('Item 1');
            expect(parsed[0].requiredByAll).toBe(true);
            expect(parsed[1].requiredByAll).toBe(false);
        });

        it('should handle empty form', () => {
            const form = document.getElementById('packingForm') as HTMLFormElement;
            const hiddenField = document.getElementById('itemsJson') as HTMLInputElement;
            const tableBody = document.getElementById('itemTable')!;
            tableBody.innerHTML = ''; // Clear rows

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
            tableBody.innerHTML = '';

            // Add rows with some empty titles
            const tr1 = document.createElement('tr');
            tr1.innerHTML = '<td><input name="t_0" value="" /></td>';
            tableBody.appendChild(tr1);

            const tr2 = document.createElement('tr');
            tr2.innerHTML = '<td><input name="t_1" value="Valid" /></td><td><input name="m_1" value="1" /></td>';
            tableBody.appendChild(tr2);

            const submitSpy = jest.spyOn(form, 'submit').mockImplementation(() => {});
            const submitEvent = new Event('submit', { bubbles: true, cancelable: true });

            form.dispatchEvent(submitEvent);

            const parsed = JSON.parse(hiddenField.value);
            expect(parsed).toHaveLength(1);
            expect(parsed[0].title).toBe('Valid');
        });

        it('should default maxAssignees to 1 when missing', () => {
            const form = document.getElementById('packingForm') as HTMLFormElement;
            const hiddenField = document.getElementById('itemsJson') as HTMLInputElement;
            const tableBody = document.getElementById('itemTable')!;
            tableBody.innerHTML = '';

            const tr = document.createElement('tr');
            tr.innerHTML = '<td><input name="t_0" value="Test" /></td>';
            tableBody.appendChild(tr);

            const submitSpy = jest.spyOn(form, 'submit').mockImplementation(() => {});
            const submitEvent = new Event('submit', { bubbles: true, cancelable: true });

            form.dispatchEvent(submitEvent);

            const parsed = JSON.parse(hiddenField.value);
            expect(parsed[0].maxAssignees).toBe(1);
        });

        it('should handle requiredByAll checkbox correctly', () => {
            const form = document.getElementById('packingForm') as HTMLFormElement;
            const hiddenField = document.getElementById('itemsJson') as HTMLInputElement;
            const tableBody = document.getElementById('itemTable')!;
            tableBody.innerHTML = '';

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><input name="t_0" value="Test" /></td>
                <td><input name="m_0" value="1" /></td>
                <td><input type="checkbox" name="e_0" /></td>
            `;
            tableBody.appendChild(tr);

            const checkbox = tr.querySelector<HTMLInputElement>('input[name="e_0"]')!;
            checkbox.checked = false;

            const submitSpy = jest.spyOn(form, 'submit').mockImplementation(() => {});
            const submitEvent = new Event('submit', { bubbles: true, cancelable: true });

            form.dispatchEvent(submitEvent);

            const parsed = JSON.parse(hiddenField.value);
            expect(parsed[0].requiredByAll).toBe(false);
        });
    });

    describe('graceful handling', () => {
        it('should require table element for initialization', () => {
            document.body.innerHTML = '<form id="packingForm"><input id="itemsJson" /><button id="addItemBtn"></button></form>';

            // createRow() requires table element, so init() will throw
            expect(() => init()).toThrow();
        });
    });
});
