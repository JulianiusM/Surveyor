/**
 * Tests for entity-select.ts
 * Tests entity selection UI functionality
 */

import { initEntitySelect } from '../../../src/public/js/modules/entity-select';
import { entitySelectInitData, entitySelectFilterData, entitySelectSelectionData } from '../data/entitySelectData';

// Mock Bootstrap Modal
class MockModal {
    private element: HTMLElement;
    static instances = new Map();
    
    constructor(element: HTMLElement) {
        this.element = element;
        MockModal.instances.set(element, this);
    }
    
    static getInstance(element: HTMLElement) {
        return MockModal.instances.get(element) || null;
    }
    
    hide() {
        this.element.dispatchEvent(new Event('hidden.bs.modal'));
    }
}

(global as any).window = global;
(global as any).window.bootstrap = {
    Modal: MockModal
};

describe('entity-select', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        MockModal.instances.clear();
    });

    afterEach(() => {
        document.body.removeChild(container);
    });

    function setupDOM(id: string, initialValue: string = '') {
        container.innerHTML = `
            <input type="hidden" id="${id}" value="${initialValue}" />
            <span id="${id}-btn-label">Select entity</span>
            <div id="${id}-modal" class="modal">
                <input type="text" id="${id}-search" />
                <ul id="${id}-list" class="list-group"></ul>
                <div id="${id}-empty" class="d-none">No results</div>
                <div id="${id}-sr" aria-live="polite"></div>
            </div>
        `;
    }

    describe('Initialization', () => {
        test.each(entitySelectInitData)('$description', (testCase) => {
            // Set initial value in DOM or pass through opts
            const initialValue = typeof testCase.opts.value === 'string' ? testCase.opts.value : '';
            setupDOM(testCase.id, initialValue);
            initEntitySelect(testCase.id, testCase.entities, testCase.opts);

            const input = document.getElementById(testCase.id) as HTMLInputElement;
            const btnLabel = document.getElementById(`${testCase.id}-btn-label`) as HTMLElement;

            // Input value should match what was set initially
            expect(input.value).toBe(testCase.expectedValue);
            // Button label should be updated based on the selected entity
            expect(btnLabel.textContent).toBe(testCase.expectedLabel);
        });

        test('should warn and return early if required elements missing', () => {
            const consoleWarn = jest.spyOn(console, 'warn').mockImplementation();
            container.innerHTML = '<input type="hidden" id="missing" />';
            
            initEntitySelect('missing', [], {});
            
            expect(consoleWarn).toHaveBeenCalled();
            consoleWarn.mockRestore();
        });

        test('should handle empty entities array', () => {
            setupDOM('empty');
            initEntitySelect('empty', [], {});

            const list = document.getElementById('empty-list') as HTMLUListElement;
            expect(list.children.length).toBe(0);
        });
    });

    describe('Filtering', () => {
        test.each(entitySelectFilterData)('$description', (testCase) => {
            setupDOM('filter-test');
            initEntitySelect('filter-test', testCase.entities, {});

            const search = document.getElementById('filter-test-search') as HTMLInputElement;
            const list = document.getElementById('filter-test-list') as HTMLUListElement;
            const empty = document.getElementById('filter-test-empty') as HTMLElement;

            search.value = testCase.query;
            search.dispatchEvent(new Event('input'));

            if (testCase.expectedEmpty) {
                expect(empty.classList.contains('d-none')).toBe(false);
            } else {
                const buttons = list.querySelectorAll('button[data-event-id]');
                const ids = Array.from(buttons).map(btn => (btn as HTMLButtonElement).dataset.eventId);
                testCase.expectedMatches.forEach(expectedId => {
                    expect(ids).toContain(expectedId);
                });
            }
        });

        test('should announce result count for accessibility', () => {
            setupDOM('a11y-test');
            const entities = [
                { id: 1, title: 'Event 1' },
                { id: 2, title: 'Event 2' },
            ];
            initEntitySelect('a11y-test', entities, {});

            const search = document.getElementById('a11y-test-search') as HTMLInputElement;
            const sr = document.getElementById('a11y-test-sr') as HTMLElement;

            search.value = 'event 1';
            search.dispatchEvent(new Event('input'));

            expect(sr.textContent).toBe('1 result.');
        });
    });

    describe('Selection', () => {
        test('should select entity when list item clicked', () => {
            setupDOM('select-test');
            const entities = [
                { id: 1, title: 'Event 1' },
                { id: 2, title: 'Event 2' },
            ];
            initEntitySelect('select-test', entities, { value: '1' });

            const input = document.getElementById('select-test') as HTMLInputElement;
            const btnLabel = document.getElementById('select-test-btn-label') as HTMLElement;
            const list = document.getElementById('select-test-list') as HTMLUListElement;

            const button2 = list.querySelector('button[data-event-id="2"]') as HTMLButtonElement;
            expect(button2).toBeTruthy();

            button2.click();

            expect(input.value).toBe('2');
            expect(btnLabel.textContent).toBe('Event 2');
        });

        test('should mark selected item as active', () => {
            setupDOM('active-test');
            const entities = [
                { id: 1, title: 'Event 1' },
                { id: 2, title: 'Event 2' },
            ];
            initEntitySelect('active-test', entities, { value: '1' });

            const list = document.getElementById('active-test-list') as HTMLUListElement;
            const button1 = list.querySelector('button[data-event-id="1"]') as HTMLButtonElement;
            const button2 = list.querySelector('button[data-event-id="2"]') as HTMLButtonElement;

            expect(button1.classList.contains('active')).toBe(true);
            expect(button2.classList.contains('active')).toBe(false);

            button2.click();

            expect(button1.classList.contains('active')).toBe(false);
            expect(button2.classList.contains('active')).toBe(true);
        });
    });

    describe('Modal interactions', () => {
        test('should focus search when modal opens', (done) => {
            setupDOM('modal-test');
            initEntitySelect('modal-test', [], {});

            const modalEl = document.getElementById('modal-test-modal') as HTMLElement;
            const search = document.getElementById('modal-test-search') as HTMLInputElement;

            search.focus = jest.fn();

            modalEl.dispatchEvent(new Event('shown.bs.modal'));

            setTimeout(() => {
                expect(search.focus).toHaveBeenCalled();
                done();
            }, 20);
        });
    });

    describe('Rendering', () => {
        test('should render entity with title and metadata', () => {
            setupDOM('render-test');
            const entities = [
                { id: 1, title: 'Event 1', dateIso: '2024-01-15', description: 'Test event' },
            ];
            initEntitySelect('render-test', entities, {});

            const list = document.getElementById('render-test-list') as HTMLUListElement;
            const button = list.querySelector('button[data-event-id="1"]') as HTMLButtonElement;

            expect(button).toBeTruthy();
            expect(button.textContent).toContain('Event 1');
            expect(button.textContent).toContain('2024-01-15');
            expect(button.textContent).toContain('Test event');
        });

        test('should handle entity without title gracefully', () => {
            setupDOM('notitle-test');
            const entities = [
                { id: 42 } as any,
            ];
            initEntitySelect('notitle-test', entities, {});

            const list = document.getElementById('notitle-test-list') as HTMLUListElement;
            const button = list.querySelector('button[data-event-id="42"]') as HTMLButtonElement;

            expect(button).toBeTruthy();
            expect(button.textContent).toContain('untitled #42');
        });
    });
});
