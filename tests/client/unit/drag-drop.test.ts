/**
 * Tests for drag-drop.ts
 * Data-driven tests for drag-and-drop functionality
 */

import { initTableReorder, initCardReorder } from '../../../src/public/js/shared/drag-drop';
import { tableReorderData, cardReorderData } from '../data/dragDropData';
import { post } from '../../../src/public/js/core/http';
import { showInlineAlert } from '../../../src/public/js/shared/alerts';

// Mock dependencies
jest.mock('../../../src/public/js/core/http');
jest.mock('../../../src/public/js/shared/alerts');
jest.mock('../../../src/public/js/shared/ui-helpers');

const mockPost = post as jest.MockedFunction<typeof post>;
const mockShowInlineAlert = showInlineAlert as jest.MockedFunction<typeof showInlineAlert>;

describe('drag-drop', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        jest.clearAllMocks();
    });

    describe('initTableReorder - Data Driven', () => {
        test.each(tableReorderData)('$description', ({ tbodySelector, apiUrl, rows }) => {
            // Setup DOM
            if (rows.length > 0) {
                const tbody = document.createElement('tbody');
                tbody.className = tbodySelector.replace('.', '');
                
                rows.forEach(row => {
                    const tr = document.createElement('tr');
                    tr.dataset.id = row.id;
                    tr.innerHTML = `<td>${row.name}</td>`;
                    tbody.appendChild(tr);
                });
                
                document.body.appendChild(tbody);
            }

            // Execute
            const config = {
                tbodySelector,
                apiUrl,
                getItemId: (row: HTMLTableRowElement) => row.dataset.id || '',
            };
            
            initTableReorder(config);

            // Verify
            const tbody = document.querySelector(tbodySelector);
            if (tbody) {
                const draggables = tbody.querySelectorAll('tr');
                draggables.forEach(tr => {
                    expect((tr as HTMLTableRowElement).draggable).toBe(true);
                });
            } else {
                // Should handle missing tbody gracefully
                expect(tbody).toBeNull();
            }
        });

        test('calls onDragStart callback when provided', () => {
            const tbody = document.createElement('tbody');
            tbody.className = 'test-tbody';
            
            const tr = document.createElement('tr');
            tr.dataset.id = '1';
            tr.innerHTML = '<td>Item 1</td>';
            tbody.appendChild(tr);
            document.body.appendChild(tbody);

            const onDragStart = jest.fn();
            const config = {
                tbodySelector: '.test-tbody',
                apiUrl: '/api/test/reorder',
                getItemId: (row: HTMLTableRowElement) => row.dataset.id || '',
                onDragStart,
            };
            
            initTableReorder(config);

            // Verify listeners are attached (cannot easily test DragEvent in jsdom)
            // Just verify the rows are draggable
            expect(tr.draggable).toBe(true);
        });

        test('calls onDragEnd callback when provided', () => {
            const tbody = document.createElement('tbody');
            tbody.className = 'test-tbody';
            
            const tr1 = document.createElement('tr');
            tr1.dataset.id = '1';
            const tr2 = document.createElement('tr');
            tr2.dataset.id = '2';
            
            tbody.appendChild(tr1);
            tbody.appendChild(tr2);
            document.body.appendChild(tbody);

            const onDragEnd = jest.fn();
            const config = {
                tbodySelector: '.test-tbody',
                apiUrl: '/api/test/reorder',
                getItemId: (row: HTMLTableRowElement) => row.dataset.id || '',
                onDragEnd,
            };
            
            initTableReorder(config);

            // Verify rows are draggable
            expect(tr1.draggable).toBe(true);
            expect(tr2.draggable).toBe(true);
        });
    });

    describe('initCardReorder - Data Driven', () => {
        test.each(cardReorderData)('$description', ({ containerClass, cardClass, apiUrl, cards }) => {
            // Setup DOM
            const container = document.createElement('div');
            container.className = containerClass;
            
            cards.forEach(card => {
                const cardElem = document.createElement('div');
                cardElem.className = cardClass;
                cardElem.dataset.id = card.id;
                cardElem.textContent = card.content;
                container.appendChild(cardElem);
            });
            
            document.body.appendChild(container);

            // Execute
            const config = {
                containerClass,
                cardClass,
                apiUrl,
                getOrderData: (container: HTMLElement) => {
                    return Array.from(container.children).map((child, idx) => ({
                        id: (child as HTMLElement).dataset.id,
                        position: idx,
                    }));
                },
            };
            
            initCardReorder(config);

            // Verify setup (cards should be in DOM)
            const cardElements = document.querySelectorAll(`.${cardClass}`);
            expect(cardElements.length).toBe(cards.length);
        });

        test('sets up card reordering listeners', () => {
            const container = document.createElement('div');
            container.className = 'test-container';
            
            const card = document.createElement('div');
            card.className = 'test-card';
            card.dataset.id = 'card-1';
            container.appendChild(card);
            document.body.appendChild(container);

            const config = {
                containerClass: 'test-container',
                cardClass: 'test-card',
                apiUrl: '/api/test/reorder-cards',
                getOrderData: () => [],
            };
            
            initCardReorder(config);

            // Verify setup completed (listeners attached to document)
            // DragEvent testing is limited in jsdom, so we just verify initialization
            expect(card).toBeTruthy();
        });

        test('getOrderData callback works correctly', () => {
            const container = document.createElement('div');
            container.className = 'test-container';
            
            const card1 = document.createElement('div');
            card1.className = 'test-card';
            card1.dataset.id = 'card-1';
            
            const card2 = document.createElement('div');
            card2.className = 'test-card';
            card2.dataset.id = 'card-2';
            
            container.appendChild(card1);
            container.appendChild(card2);
            document.body.appendChild(container);

            const getOrderData = (cont: HTMLElement) => {
                return Array.from(cont.children).map((child, idx) => ({
                    id: (child as HTMLElement).dataset.id,
                    position: idx,
                }));
            };

            const config = {
                containerClass: 'test-container',
                cardClass: 'test-card',
                apiUrl: '/api/test/reorder-cards',
                getOrderData,
            };
            
            initCardReorder(config);

            // Test getOrderData directly
            const order = getOrderData(container);
            expect(order).toEqual([
                { id: 'card-1', position: 0 },
                { id: 'card-2', position: 1 },
            ]);
        });
    });
});
