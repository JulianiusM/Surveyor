/**
 * Tests for survey-create.ts module
 */

import { surveyCreateTestData } from '../data/surveyCreateData';

// Mock dependencies
jest.mock('../../../src/public/js/core/navigation', () => ({
    setCurrentNavLocation: jest.fn(),
}));

jest.mock('../../../src/public/js/core/permissions', () => ({
    loadPerms: jest.fn(),
}));

import { setCurrentNavLocation } from '../../../src/public/js/core/navigation';
import { loadPerms } from '../../../src/public/js/core/permissions';

describe('survey-create module', () => {
    let init: () => void;

    beforeEach(() => {
        // Setup DOM
        document.body.innerHTML = `
            <table>
                <tbody id="combinationTable"></tbody>
            </table>
            <button id="addCombinationBtn">Add Combination</button>
        `;

        // Setup global namespace
        window.Surveyor = {} as any;

        // Clear mocks
        jest.clearAllMocks();

        // Import module fresh
        jest.isolateModules(() => {
            const module = require('../../../src/public/js/survey-create');
            init = module.init;
        });
    });

    describe('init', () => {
        it('should call setCurrentNavLocation and loadPerms', () => {
            init();
            expect(setCurrentNavLocation).toHaveBeenCalledTimes(1);
            expect(loadPerms).toHaveBeenCalledTimes(1);
        });

        it('should call functions in correct order', () => {
            const calls: string[] = [];
            (setCurrentNavLocation as jest.Mock).mockImplementation(() => calls.push('nav'));
            (loadPerms as jest.Mock).mockImplementation(() => calls.push('perms'));

            init();

            expect(calls).toEqual(['nav', 'perms']);
        });

        it('should create initial combination row when no prefilled combinations', () => {
            init();
            const tableBody = document.getElementById('combinationTable')!;
            expect(tableBody.querySelectorAll('tr')).toHaveLength(1);
        });

        it('should prefill combination rows when prefilledCombinations exist', () => {
            window.Surveyor.prefilledCombinations = surveyCreateTestData.prefilledCombinations;
            init();

            const tableBody = document.getElementById('combinationTable')!;
            const rows = tableBody.querySelectorAll('tr');
            expect(rows).toHaveLength(3);

            const firstRowWeekday = rows[0].querySelector<HTMLSelectElement>('select[name*="weekday"]')!;
            const firstRowWeek = rows[0].querySelector<HTMLSelectElement>('select[name*="week"]')!;
            expect(firstRowWeekday.value).toBe('MON');
            expect(firstRowWeek.value).toBe('1');
        });

        it('should initialize add button listener', () => {
            init();
            const tableBody = document.getElementById('combinationTable')!;
            const addBtn = document.getElementById('addCombinationBtn')!;

            expect(tableBody.querySelectorAll('tr')).toHaveLength(1);

            addBtn.click();

            expect(tableBody.querySelectorAll('tr')).toHaveLength(2);
        });

        it('should expose init function to global scope', () => {
            init();
            expect(window.Surveyor.init).toBe(init);
        });
    });

    describe('combination row creation', () => {
        beforeEach(() => {
            init();
        });

        it('should create row with weekday select', () => {
            const tableBody = document.getElementById('combinationTable')!;
            const row = tableBody.querySelector('tr')!;
            const weekdaySelect = row.querySelector<HTMLSelectElement>('select[name*="weekday"]')!;

            expect(weekdaySelect).toBeTruthy();
            expect(weekdaySelect.required).toBe(true);
            expect(weekdaySelect.options).toHaveLength(7);
        });

        it('should create row with week select', () => {
            const tableBody = document.getElementById('combinationTable')!;
            const row = tableBody.querySelector('tr')!;
            const weekSelect = row.querySelector<HTMLSelectElement>('select[name*="week"]')!;

            expect(weekSelect).toBeTruthy();
            expect(weekSelect.required).toBe(true);
            expect(weekSelect.options).toHaveLength(5);
        });

        it('should create row with remove button', () => {
            const tableBody = document.getElementById('combinationTable')!;
            const addBtn = document.getElementById('addCombinationBtn')!;

            addBtn.click(); // Create second row
            expect(tableBody.querySelectorAll('tr')).toHaveLength(2);

            const removeBtn = tableBody.querySelector('.remove-combination-btn') as HTMLButtonElement;
            expect(removeBtn).toBeTruthy();
            expect(removeBtn.textContent).toBe('Remove');
        });

        it('should increment row ID for each new row', () => {
            const addBtn = document.getElementById('addCombinationBtn')!;

            addBtn.click();
            addBtn.click();

            const tableBody = document.getElementById('combinationTable')!;
            const rows = tableBody.querySelectorAll('tr');

            expect(rows[0].id).toBe('row-0');
            expect(rows[1].id).toBe('row-1');
            expect(rows[2].id).toBe('row-2');
        });

        it('should populate weekday select with all weekdays', () => {
            const tableBody = document.getElementById('combinationTable')!;
            const row = tableBody.querySelector('tr')!;
            const weekdaySelect = row.querySelector<HTMLSelectElement>('select[name*="weekday"]')!;

            const values = Array.from(weekdaySelect.options).map(opt => opt.value);
            expect(values).toEqual(surveyCreateTestData.weekdays);
        });

        it('should populate week select with all week options', () => {
            const tableBody = document.getElementById('combinationTable')!;
            const row = tableBody.querySelector('tr')!;
            const weekSelect = row.querySelector<HTMLSelectElement>('select[name*="week"]')!;

            const values = Array.from(weekSelect.options).map(opt => opt.value);
            expect(values).toEqual(surveyCreateTestData.weeks);
        });

        it('should display "Last" text for LAST week option', () => {
            const tableBody = document.getElementById('combinationTable')!;
            const row = tableBody.querySelector('tr')!;
            const weekSelect = row.querySelector<HTMLSelectElement>('select[name*="week"]')!;

            const lastOption = Array.from(weekSelect.options).find(opt => opt.value === 'LAST');
            expect(lastOption?.textContent).toBe('Last');
        });
    });

    describe('combination row removal', () => {
        beforeEach(() => {
            init();
        });

        it('should remove row when remove button is clicked', () => {
            const addBtn = document.getElementById('addCombinationBtn')!;
            const tableBody = document.getElementById('combinationTable')!;

            addBtn.click(); // Create second row
            expect(tableBody.querySelectorAll('tr')).toHaveLength(2);

            const removeBtn = tableBody.querySelector('.remove-combination-btn') as HTMLButtonElement;
            removeBtn.click();

            expect(tableBody.querySelectorAll('tr')).toHaveLength(1);
        });

        it('should handle remove button click via event delegation', () => {
            const addBtn = document.getElementById('addCombinationBtn')!;
            const tableBody = document.getElementById('combinationTable')!;

            // Add multiple rows
            addBtn.click();
            addBtn.click();
            expect(tableBody.querySelectorAll('tr')).toHaveLength(3);

            // Remove second row
            const secondRow = tableBody.querySelectorAll('tr')[1];
            const removeBtn = secondRow.querySelector('.remove-combination-btn') as HTMLButtonElement;
            removeBtn.click();

            expect(tableBody.querySelectorAll('tr')).toHaveLength(2);
        });
    });

    describe('prefilled combinations', () => {
        it('should set selected values for prefilled combinations', () => {
            window.Surveyor.prefilledCombinations = surveyCreateTestData.prefilledCombinations;
            init();

            const tableBody = document.getElementById('combinationTable')!;
            const rows = tableBody.querySelectorAll('tr');

            // Check first combination
            const row0Weekday = rows[0].querySelector<HTMLSelectElement>('select[name*="weekday"]')!;
            const row0Week = rows[0].querySelector<HTMLSelectElement>('select[name*="week"]')!;
            expect(row0Weekday.value).toBe('MON');
            expect(row0Week.value).toBe('1');

            // Check second combination
            const row1Weekday = rows[1].querySelector<HTMLSelectElement>('select[name*="weekday"]')!;
            const row1Week = rows[1].querySelector<HTMLSelectElement>('select[name*="week"]')!;
            expect(row1Weekday.value).toBe('WED');
            expect(row1Week.value).toBe('LAST');

            // Check third combination
            const row2Weekday = rows[2].querySelector<HTMLSelectElement>('select[name*="weekday"]')!;
            const row2Week = rows[2].querySelector<HTMLSelectElement>('select[name*="week"]')!;
            expect(row2Weekday.value).toBe('FRI');
            expect(row2Week.value).toBe('3');
        });

        it('should handle empty prefilled combinations', () => {
            window.Surveyor.prefilledCombinations = [];
            init();

            const tableBody = document.getElementById('combinationTable')!;
            // Should still create initial row
            expect(tableBody.querySelectorAll('tr')).toHaveLength(1);
        });
    });

    describe('graceful handling', () => {
        it('should handle missing table element', () => {
            document.body.innerHTML = '<button id="addCombinationBtn"></button>';

            expect(() => init()).not.toThrow();
        });

        it('should handle missing add button', () => {
            document.body.innerHTML = '<tbody id="combinationTable"></tbody>';

            expect(() => init()).not.toThrow();
        });

        it('should handle both missing elements', () => {
            document.body.innerHTML = '<div></div>';

            expect(() => init()).not.toThrow();
        });
    });
});
