// tests/client/unit/navigation.test.ts
// Unit tests for core/navigation.ts utilities
// Uses data-driven testing approach
import { setCurrentNavLocation, initEntityLists } from '../../../src/public/js/core/navigation';
import { setCurrentNavLocationData, initEntityListsData } from '../data/navigationData';
import { setupTest } from '../helpers/testSetup';

describe('navigation utilities', () => {
    setupTest();
    
    describe.skip('setCurrentNavLocation - Data Driven (browser-specific behavior - tested in E2E)', () => {
        beforeEach(() => {
            // Create navigation structure
            document.body.innerHTML = `
                <nav>
                    <a class="nav-link" href="/survey">Survey</a>
                    <a class="nav-link" href="/packing">Packing</a>
                    <a class="nav-link" href="/activity">Activity</a>
                    <a class="nav-link" href="/drivers">Drivers</a>
                    <a class="nav-link" href="/users/login">Login</a>
                    <a class="nav-link" href="/users/register">Register</a>
                    <div class="dropdown">
                        <a class="dropdown-item" href="/users/dashboard">Dashboard</a>
                        <a class="dropdown-item" href="/users/manage-dashboard">Manage</a>
                    </div>
                </nav>
            `;
        });

        test.each(setCurrentNavLocationData())(
            '$description',
            ({ pathname, expectedSelector }) => {
                // Mock window.location with pathname
                delete (window as any).location;
                (window as any).location = { pathname };
                
                // Verify mock is working
                expect(window.location.pathname).toBe(pathname);
                
                setCurrentNavLocation();
                
                const activeLink = document.querySelector(expectedSelector);
                expect(activeLink).not.toBeNull();
                if (!activeLink?.classList.contains('active')) {
                    // Debug output
                    console.log('pathname:', pathname);
                    console.log('selector:', expectedSelector);
                    console.log('found link:', activeLink);
                    console.log('link classes:', activeLink?.className);
                }
                expect(activeLink?.classList.contains('active')).toBe(true);
            }
        );

        test('handles path without matching nav link', () => {
            delete (window as any).location;
            (window as any).location = { pathname: '/unknown/path' };
            
            // Should not throw
            expect(() => setCurrentNavLocation()).not.toThrow();
            
            // No links should be active
            const activeLinks = document.querySelectorAll('.active');
            expect(activeLinks.length).toBe(0);
        });

        test('handles missing nav links gracefully', () => {
            document.body.innerHTML = '';
            delete (window as any).location;
            (window as any).location = { pathname: '/survey' };
            
            expect(() => setCurrentNavLocation()).not.toThrow();
        });
    });

    describe('initEntityLists - Data Driven', () => {
        function createListHTML(items: Array<{ text: string; dataSearch: string }>): string {
            return `
                <div data-filter="section">
                    <input type="search" />
                    <div class="js-list">
                        ${items.map(item => 
                            `<div class="list-group-item" data-search="${item.dataSearch}">${item.text}</div>`
                        ).join('')}
                    </div>
                    <span class="js-count">0/0</span>
                </div>
            `;
        }

        test.each(initEntityListsData())(
            '$description',
            ({ items, searchQuery, expectedVisible }) => {
                document.body.innerHTML = createListHTML(items);
                
                initEntityLists();
                
                const input = document.querySelector('input[type="search"]') as HTMLInputElement;
                const count = document.querySelector('.js-count');
                
                // Simulate user typing
                input.value = searchQuery;
                input.dispatchEvent(new Event('input'));
                
                // Check count display
                expect(count?.textContent).toBe(`${expectedVisible}/${items.length}`);
                
                // Check visible items
                const visibleItems = Array.from(document.querySelectorAll('.list-group-item'))
                    .filter(item => !item.classList.contains('d-none'));
                expect(visibleItems).toHaveLength(expectedVisible);
            }
        );

        test('uses textContent when data-search attribute is missing', () => {
            document.body.innerHTML = `
                <div data-filter="section">
                    <input type="search" />
                    <div class="js-list">
                        <div class="list-group-item">Searchable Text</div>
                    </div>
                    <span class="js-count">0/0</span>
                </div>
            `;
            
            initEntityLists();
            
            const input = document.querySelector('input[type="search"]') as HTMLInputElement;
            input.value = 'searchable';
            input.dispatchEvent(new Event('input'));
            
            const visibleItems = document.querySelectorAll('.list-group-item:not(.d-none)');
            expect(visibleItems).toHaveLength(1);
        });

        test('handles custom selectors via options', () => {
            document.body.innerHTML = `
                <div class="custom-section">
                    <input class="custom-input" type="text" />
                    <div class="custom-list">
                        <div class="custom-item">Item 1</div>
                        <div class="custom-item">Item 2</div>
                    </div>
                    <span class="custom-count">0/0</span>
                </div>
            `;
            
            initEntityLists(document, {
                sectionSelector: '.custom-section',
                inputSelector: '.custom-input',
                listSelector: '.custom-list',
                countSelector: '.custom-count',
                itemSelector: '.custom-item',
            });
            
            const input = document.querySelector('.custom-input') as HTMLInputElement;
            const count = document.querySelector('.custom-count');
            
            expect(count?.textContent).toBe('2/2');
            
            input.value = 'Item 1';
            input.dispatchEvent(new Event('input'));
            expect(count?.textContent).toBe('1/2');
        });

        test('returns early if required elements are missing', () => {
            document.body.innerHTML = '<div data-filter="section"></div>';
            
            // Should not throw
            expect(() => initEntityLists()).not.toThrow();
        });

        test('handles multiple sections', () => {
            document.body.innerHTML = `
                <div data-filter="section">
                    <input type="search" />
                    <div class="js-list">
                        <div class="list-group-item">Section 1 Item</div>
                    </div>
                    <span class="js-count">0/0</span>
                </div>
                <div data-filter="section">
                    <input type="search" />
                    <div class="js-list">
                        <div class="list-group-item">Section 2 Item</div>
                    </div>
                    <span class="js-count">0/0</span>
                </div>
            `;
            
            initEntityLists();
            
            const counts = document.querySelectorAll('.js-count');
            expect(counts).toHaveLength(2);
            expect(counts[0].textContent).toBe('1/1');
            expect(counts[1].textContent).toBe('1/1');
        });

        test('sets data-filter attribute on section', () => {
            document.body.innerHTML = createListHTML([{ text: 'Test', dataSearch: 'test' }]);
            
            const section = document.querySelector('[data-filter="section"]');
            expect(section?.getAttribute('data-filter')).toBe('section');
            
            initEntityLists();
            
            expect(section?.getAttribute('data-filter')).toBe('section');
        });

        test('uses custom container element', () => {
            const container = document.createElement('div');
            container.innerHTML = createListHTML([{ text: 'Test', dataSearch: 'test' }]);
            document.body.appendChild(container);
            
            initEntityLists(container);
            
            const count = container.querySelector('.js-count');
            expect(count?.textContent).toBe('1/1');
        });
    });
});
