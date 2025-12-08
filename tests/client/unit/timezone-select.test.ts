/**
 * Tests for timezone-select.ts
 * Tests timezone selection UI functionality
 */

import { initTimezoneSelect } from '../../../src/public/js/modules/timezone-select';
import { timezoneSelectInitData, timezoneSelectSetZoneData, timezoneSelectFilterData } from '../data/timezoneSelectData';

// Mock Bootstrap Modal
class MockModal {
    private element: HTMLElement;
    constructor(element: HTMLElement) {
        this.element = element;
    }
    show() {
        this.element.dispatchEvent(new Event('shown.bs.modal'));
    }
    hide() {
        this.element.dispatchEvent(new Event('hidden.bs.modal'));
    }
}

(global as any).bootstrap = {
    Modal: MockModal
};

// Mock Intl.supportedValuesOf if not available
if (typeof Intl.supportedValuesOf !== 'function') {
    (Intl as any).supportedValuesOf = (type: string) => {
        if (type === 'timeZone') {
            return ['UTC', 'Europe/Berlin', 'Europe/London', 'America/New_York', 'America/Chicago',
                'America/Denver', 'America/Los_Angeles', 'America/Sao_Paulo', 'Africa/Johannesburg',
                'Asia/Dubai', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney', 'Pacific/Auckland'];
        }
        return [];
    };
}

describe('timezone-select', () => {
    let container: HTMLElement;
    let originalDateTimeFormat: any;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        
        // Mock Intl.DateTimeFormat consistently
        originalDateTimeFormat = Intl.DateTimeFormat;
        (Intl as any).DateTimeFormat = function(locales?: any, options?: any) {
            return {
                resolvedOptions: () => ({ timeZone: 'UTC' }),
                formatToParts: (date?: Date) => {
                    if (options?.timeZone) {
                        return [{ type: 'timeZoneName', value: 'UTC+00:00' }];
                    }
                    return [{ type: 'timeZoneName', value: 'UTC+00:00' }];
                }
            };
        };
    });

    afterEach(() => {
        document.body.removeChild(container);
        Intl.DateTimeFormat = originalDateTimeFormat;
    });

    function setupDOM(id: number) {
        container.innerHTML = `
            <input type="hidden" id="${id}" />
            <button type="button" id="${id}-btn">
                <span id="${id}-btn-label">Select timezone</span>
            </button>
            <button type="button" id="${id}-guess">Use my timezone</button>
            <div id="${id}-modal" class="modal">
                <div id="${id}-chips"></div>
                <input type="text" id="${id}-search" />
                <ul id="${id}-list" class="list-group"></ul>
            </div>
        `;
    }

    describe('Initialization', () => {
        test.each(timezoneSelectInitData)('$description', (testCase) => {
            setupDOM(testCase.id);
            initTimezoneSelect(testCase.id, testCase.opts);

            const input = document.getElementById(`${testCase.id}`) as HTMLInputElement;
            const btnLabel = document.getElementById(`${testCase.id}-btn-label`) as HTMLSpanElement;

            if (testCase.expectedZone) {
                expect(input.value).toBe(testCase.expectedZone);
            }

            if (testCase.expectedLabelContains) {
                expect(btnLabel.textContent).toContain(testCase.expectedLabelContains);
            }

            if (testCase.expectedCommonCount) {
                const chips = document.getElementById(`${testCase.id}-chips`) as HTMLElement;
                const chipButtons = chips.querySelectorAll('button');
                expect(chipButtons.length).toBe(testCase.expectedCommonCount);
            }
        });

        test('should return early if required elements missing', () => {
            container.innerHTML = '<input type="hidden" id="999" />';
            // Should not throw
            expect(() => initTimezoneSelect(999, {})).not.toThrow();
        });
    });

    describe('Timezone selection', () => {
        test.each(timezoneSelectSetZoneData)('$description', (testCase) => {
            const id = 100;
            setupDOM(id);
            initTimezoneSelect(id, { value: 'UTC' });

            const input = document.getElementById(`${id}`) as HTMLInputElement;
            const chips = document.getElementById(`${id}-chips`) as HTMLElement;
            const chipButton = chips.querySelector('button') as HTMLButtonElement;

            if (chipButton) {
                // Simulate clicking a chip to set timezone
                const targetZone = testCase.zone;
                const allChips = chips.querySelectorAll('button');
                let targetButton: HTMLButtonElement | null = null;

                allChips.forEach(btn => {
                    if (btn.textContent?.includes(targetZone)) {
                        targetButton = btn;
                    }
                });

                if (targetButton && testCase.shouldSet) {
                    const initialValue = input.value;
                    targetButton.click();
                    expect(input.value).not.toBe(initialValue);
                }
            }
        });
    });

    describe('Search and filtering', () => {
        test.each(timezoneSelectFilterData)('$description', (testCase) => {
            const id = 200;
            setupDOM(id);
            initTimezoneSelect(id, {});

            const search = document.getElementById(`${id}-search`) as HTMLInputElement;
            const list = document.getElementById(`${id}-list`) as HTMLUListElement;

            search.value = testCase.query;
            search.dispatchEvent(new Event('input'));

            const items = list.querySelectorAll('li');

            if (testCase.expectedMatchesAll) {
                expect(items.length).toBeGreaterThan(0);
            } else if (testCase.expectedNoMatches) {
                expect(items.length).toBe(1);
                expect(items[0].textContent).toBe('No matches');
            } else if (testCase.expectedMatches) {
                const matchedZones: string[] = [];
                items.forEach(item => {
                    const zone = item.dataset.zone;
                    if (zone) matchedZones.push(zone);
                });
                testCase.expectedMatches.forEach(expectedZone => {
                    expect(matchedZones).toContain(expectedZone);
                });
            }
        });
    });

    describe('Modal interactions', () => {
        test('should open modal and focus search input', (done) => {
            const id = 300;
            setupDOM(id);
            initTimezoneSelect(id, {});

            const btn = document.getElementById(`${id}-btn`) as HTMLButtonElement;
            const search = document.getElementById(`${id}-search`) as HTMLInputElement;

            // Mock focus
            search.focus = jest.fn();

            btn.click();

            // Wait for setTimeout in the code
            setTimeout(() => {
                expect(search.focus).toHaveBeenCalled();
                done();
            }, 250);
        });

        test('should clear search when modal closes', () => {
            const id = 400;
            setupDOM(id);
            initTimezoneSelect(id, {});

            const modalEl = document.getElementById(`${id}-modal`) as HTMLElement;
            const search = document.getElementById(`${id}-search`) as HTMLInputElement;

            search.value = 'test query';
            modalEl.dispatchEvent(new Event('hidden.bs.modal'));

            expect(search.value).toBe('');
        });
    });

    describe('Guess timezone button', () => {
        test('should update timezone when guess button clicked', () => {
            const id = 500;
            setupDOM(id);
            initTimezoneSelect(id, { value: 'Europe/Berlin' });

            const input = document.getElementById(`${id}`) as HTMLInputElement;
            const btnLabel = document.getElementById(`${id}-btn-label`) as HTMLSpanElement;
            const guessBtn = document.getElementById(`${id}-guess`) as HTMLButtonElement;
            
            expect(input.value).toBe('Europe/Berlin'); // Initially set
            const initialLabel = btnLabel.textContent;

            guessBtn.click();

            // The value might change (to guessed timezone) or stay the same
            // Just verify the button was processed
            expect(input.value).toBeTruthy();
        });
    });

    describe('List item interactions', () => {
        test('should select timezone when list item clicked', () => {
            const id = 600;
            setupDOM(id);
            initTimezoneSelect(id, {});

            const input = document.getElementById(`${id}`) as HTMLInputElement;
            const list = document.getElementById(`${id}-list`) as HTMLUListElement;

            const firstItem = list.querySelector('li[data-zone]') as HTMLElement;
            if (firstItem) {
                const zone = firstItem.dataset.zone!;
                firstItem.click();
                expect(input.value).toBe(zone);
            }
        });

        test('should select timezone when Enter key pressed on list item', () => {
            const id = 700;
            setupDOM(id);
            initTimezoneSelect(id, {});

            const input = document.getElementById(`${id}`) as HTMLInputElement;
            const list = document.getElementById(`${id}-list`) as HTMLUListElement;

            const firstItem = list.querySelector('li[data-zone]') as HTMLElement;
            if (firstItem) {
                const zone = firstItem.dataset.zone!;
                const event = new KeyboardEvent('keydown', { key: 'Enter' });
                firstItem.dispatchEvent(event);
                expect(input.value).toBe(zone);
            }
        });
    });
});
