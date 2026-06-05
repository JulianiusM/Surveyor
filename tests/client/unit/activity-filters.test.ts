/**
 * Tests for activity-filters module
 * Data-driven approach with test data from activityFiltersData.ts
 */

import {initDates, initSlotFilters} from '../../../src/public/js/modules/activity/activity-filters';
import {initDatesTestData, initSlotFiltersTestData} from '../data/activityFiltersData';
import {setupTest} from '../helpers/testSetup';

describe('activity-filters', () => {
    describe('initDates', () => {
        setupTest({
            beforeEach: () => {
                // Mock toLocaleDateString to work in jsdom environment
                const originalToLocaleDateString = Date.prototype.toLocaleDateString;
                Date.prototype.toLocaleDateString = function(locales?: string | string[], options?: Intl.DateTimeFormatOptions) {
                    if (options?.weekday) {
                        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                        return days[this.getUTCDay()];
                    }
                    const month = this.getUTCMonth() + 1;
                    const day = this.getUTCDate();
                    const year = this.getUTCFullYear();
                    return `${month}/${day}/${year}`;
                };
            }
        });

        test('does nothing when no date headers exist', () => {
            document.body.innerHTML = '<table><th></th></table>';
            initDates();
            // Should not throw
            expect(document.querySelectorAll('th[data-date]')).toHaveLength(0);
        });

        test.each(initDatesTestData())('$description', ({date}) => {
            document.body.innerHTML = `
                <th data-date="${date}">
                    <span class="day"></span>
                    <span class="date"></span>
                </th>
            `;

            // Function should run without errors
            expect(() => initDates()).not.toThrow();

            const dayEl = document.querySelector('.day');
            const dateEl = document.querySelector('.date');

            // Elements should exist
            expect(dayEl).toBeTruthy();
            expect(dateEl).toBeTruthy();
        });

        test('handles missing day element', () => {
            document.body.innerHTML = `
                <th data-date="2024-03-15">
                    <span class="date"></span>
                </th>
            `;

            // Should not throw even if day element is missing
            expect(() => initDates()).not.toThrow();

            const dateEl = document.querySelector('.date');
            expect(dateEl).toBeTruthy();
        });

        test('handles missing date element', () => {
            document.body.innerHTML = `
                <th data-date="2024-03-15">
                    <span class="day"></span>
                </th>
            `;

            // Should not throw even if date element is missing
            expect(() => initDates()).not.toThrow();

            const dayEl = document.querySelector('.day');
            expect(dayEl).toBeTruthy();
        });

        test('handles missing data-date attribute', () => {
            document.body.innerHTML = `
                <th>
                    <span class="day"></span>
                    <span class="date"></span>
                </th>
            `;

            initDates();

            const dayEl = document.querySelector('.day');
            const dateEl = document.querySelector('.date');

            expect(dayEl?.textContent).toBe('');
            expect(dateEl?.textContent).toBe('');
        });

        test('handles multiple date headers', () => {
            document.body.innerHTML = `
                <th data-date="2024-03-15">
                    <span class="day"></span>
                    <span class="date"></span>
                </th>
                <th data-date="2024-03-16">
                    <span class="day"></span>
                    <span class="date"></span>
                </th>
            `;

            // Should process all headers without errors
            expect(() => initDates()).not.toThrow();

            const dayEls = document.querySelectorAll('.day');
            const dateEls = document.querySelectorAll('.date');

            // All elements should exist
            expect(dayEls).toHaveLength(2);
            expect(dateEls).toHaveLength(2);
        });
    });

    describe('initSlotFilters', () => {
        setupTest();

        test('does nothing when no filter buttons exist', () => {
            document.body.innerHTML = '<div></div>';
            initSlotFilters();
            // Should not throw
            expect(document.querySelectorAll('[data-slot-filter]')).toHaveLength(0);
        });

        test.each(initSlotFiltersTestData())('$description', ({filterMode, slots}) => {
            // Create filter buttons
            document.body.innerHTML = `
                <button data-slot-filter="all">All</button>
                <button data-slot-filter="mine">Mine</button>
                <button data-slot-filter="open">Open</button>
                ${slots.map((slot, idx) => `
                    <div class="slot" data-my="${slot.dataset.my}" data-open="${slot.dataset.open}" data-testid="slot-${idx}"></div>
                `).join('')}
            `;

            initSlotFilters();

            // Click the appropriate filter button
            const filterBtn = document.querySelector(`[data-slot-filter="${filterMode}"]`) as HTMLButtonElement;
            filterBtn.click();

            // Check visibility of each slot
            slots.forEach((expected, idx) => {
                const slot = document.querySelector(`[data-testid="slot-${idx}"]`) as HTMLElement;
                const isVisible = !slot.classList.contains('d-none');
                expect(isVisible).toBe(expected.expectedVisible);
            });
        });

        test('sets active state on clicked button', () => {
            document.body.innerHTML = `
                <button data-slot-filter="all">All</button>
                <button data-slot-filter="mine">Mine</button>
                <button data-slot-filter="open">Open</button>
            `;

            initSlotFilters();

            const allBtn = document.querySelector('[data-slot-filter="all"]') as HTMLButtonElement;
            const mineBtn = document.querySelector('[data-slot-filter="mine"]') as HTMLButtonElement;
            const openBtn = document.querySelector('[data-slot-filter="open"]') as HTMLButtonElement;

            // Click mine button
            mineBtn.click();

            expect(allBtn.classList.contains('active')).toBe(false);
            expect(mineBtn.classList.contains('active')).toBe(true);
            expect(openBtn.classList.contains('active')).toBe(false);

            // Click open button
            openBtn.click();

            expect(allBtn.classList.contains('active')).toBe(false);
            expect(mineBtn.classList.contains('active')).toBe(false);
            expect(openBtn.classList.contains('active')).toBe(true);
        });

        test('initializes with all filter applied', () => {
            document.body.innerHTML = `
                <button data-slot-filter="all">All</button>
                <button data-slot-filter="mine">Mine</button>
                <div class="slot" data-my="0" data-open="0"></div>
                <div class="slot" data-my="1" data-open="0"></div>
            `;

            initSlotFilters();

            // All slots should be visible initially
            const slots = document.querySelectorAll('.slot');
            slots.forEach(slot => {
                expect(slot.classList.contains('d-none')).toBe(false);
            });
        });

        test('handles button without data-slot-filter attribute', () => {
            document.body.innerHTML = `
                <button data-slot-filter="all">All</button>
                <button>Invalid</button>
                <div class="slot" data-my="1" data-open="0"></div>
            `;

            initSlotFilters();

            const invalidBtn = document.querySelectorAll('button')[1];
            invalidBtn.click();

            // Should not throw, slot should still be visible (all filter remains)
            const slot = document.querySelector('.slot') as HTMLElement;
            expect(slot.classList.contains('d-none')).toBe(false);
        });

        test('filters can be switched multiple times', () => {
            document.body.innerHTML = `
                <button data-slot-filter="all">All</button>
                <button data-slot-filter="mine">Mine</button>
                <button data-slot-filter="open">Open</button>
                <div class="slot" data-my="0" data-open="1" data-testid="slot-0"></div>
                <div class="slot" data-my="1" data-open="0" data-testid="slot-1"></div>
            `;

            initSlotFilters();

            const allBtn = document.querySelector('[data-slot-filter="all"]') as HTMLButtonElement;
            const mineBtn = document.querySelector('[data-slot-filter="mine"]') as HTMLButtonElement;
            const openBtn = document.querySelector('[data-slot-filter="open"]') as HTMLButtonElement;
            const slot0 = document.querySelector('[data-testid="slot-0"]') as HTMLElement;
            const slot1 = document.querySelector('[data-testid="slot-1"]') as HTMLElement;

            // Apply mine filter
            mineBtn.click();
            expect(slot0.classList.contains('d-none')).toBe(true);
            expect(slot1.classList.contains('d-none')).toBe(false);

            // Switch to open filter
            openBtn.click();
            expect(slot0.classList.contains('d-none')).toBe(false);
            expect(slot1.classList.contains('d-none')).toBe(true);

            // Switch to all filter
            allBtn.click();
            expect(slot0.classList.contains('d-none')).toBe(false);
            expect(slot1.classList.contains('d-none')).toBe(false);
        });
    });
});
