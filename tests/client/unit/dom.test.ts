// tests/client/unit/dom.test.ts
// Unit tests for core/dom.ts utilities
// Uses data-driven testing approach
import { qs, qsAll, closest } from '../../../src/public/js/core/dom';
import { querySelectorData, querySelectorAllData, closestData } from '../data/domData';
import { setupTest } from '../helpers/testSetup';

describe('DOM utilities', () => {
    setupTest();

    describe('qs (querySelector) - Data Driven', () => {
        test.each(querySelectorData())(
            '$description',
            ({ html, selector, expectedContent }) => {
                document.body.innerHTML = html;
                const element = qs(selector);
                
                if (expectedContent === null) {
                    expect(element).toBeNull();
                } else {
                    expect(element).not.toBeNull();
                    expect(element?.textContent).toBe(expectedContent);
                }
            }
        );

        test('accepts custom root element', () => {
            document.body.innerHTML = '<div id="root"><span class="target">Text</span></div>';
            const root = document.getElementById('root')!;
            const element = qs('.target', root);
            
            expect(element?.textContent).toBe('Text');
        });

        test('returns typed element', () => {
            document.body.innerHTML = '<button id="btn">Click</button>';
            const button = qs<HTMLButtonElement>('#btn');
            
            expect(button).toBeInstanceOf(HTMLButtonElement);
            expect(button?.textContent).toBe('Click');
        });
    });

    describe('qsAll (querySelectorAll) - Data Driven', () => {
        test.each(querySelectorAllData())(
            '$description',
            ({ html, selector, expectedCount }) => {
                document.body.innerHTML = html;
                const elements = qsAll(selector);
                
                expect(elements).toHaveLength(expectedCount);
                expect(Array.isArray(elements)).toBe(true);
            }
        );

        test('accepts custom root element', () => {
            document.body.innerHTML = '<div id="root"><div class="item">1</div><div class="item">2</div></div>';
            const root = document.getElementById('root')!;
            const elements = qsAll('.item', root);
            
            expect(elements).toHaveLength(2);
        });

        test('returns typed elements array', () => {
            document.body.innerHTML = '<button>1</button><button>2</button>';
            const buttons = qsAll<HTMLButtonElement>('button');
            
            expect(buttons).toHaveLength(2);
            buttons.forEach(btn => {
                expect(btn).toBeInstanceOf(HTMLButtonElement);
            });
        });

        test('maps array correctly', () => {
            document.body.innerHTML = '<div class="num">1</div><div class="num">2</div><div class="num">3</div>';
            const numbers = qsAll('.num').map(el => el.textContent);
            
            expect(numbers).toEqual(['1', '2', '3']);
        });
    });

    describe('closest - Data Driven', () => {
        test.each(closestData())(
            '$description',
            ({ html, startSelector, closestSelector, expectedClass }) => {
                document.body.innerHTML = html;
                const start = qs(startSelector);
                const result = closest(start, closestSelector);
                
                if (expectedClass === null) {
                    expect(result).toBeNull();
                } else {
                    expect(result).not.toBeNull();
                    expect(result?.classList.contains(expectedClass)).toBe(true);
                }
            }
        );

        test('handles null element', () => {
            const result = closest(null, '.anything');
            // closest returns undefined (not null) when element is null due to optional chaining
            expect(result).toBeFalsy();
            expect(result).not.toBeTruthy();
        });

        test('returns typed element', () => {
            document.body.innerHTML = '<div class="parent"><button id="btn">Click</button></div>';
            const button = qs('#btn');
            const parent = closest<HTMLDivElement>(button, '.parent');
            
            expect(parent).toBeInstanceOf(HTMLDivElement);
        });

        test('finds self if matches', () => {
            document.body.innerHTML = '<div class="target" id="elem">Content</div>';
            const elem = qs('#elem');
            const result = closest(elem, '.target');
            
            expect(result).toBe(elem);
        });
    });
});
