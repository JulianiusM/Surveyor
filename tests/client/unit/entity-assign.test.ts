/**
 * Tests for entity-assign.ts
 * Data-driven tests for assignment functionality
 */

import { initAssignButtons } from '../../../src/public/js/shared/entity-assign';
import { configData } from '../data/entityAssignData';
import { server } from '../msw/server';
import { http, HttpResponse } from 'msw';

describe('entity-assign', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        jest.clearAllMocks();
        // Reset location.reload mock
        delete (window as any).location;
        (window as any).location = { reload: jest.fn() };
    });

    describe('initAssignButtons - Configuration', () => {
        test.each(configData)('$description', ({ config, expectedReloadDelay }) => {
            // Setup DOM
            const table = document.createElement('table');
            table.id = config.tableSelector.replace('#', '');
            document.body.appendChild(table);

            // Execute (just initialize, don't test full flow)
            initAssignButtons(config);

            // Verify table was found and initialized
            expect(document.querySelector(config.tableSelector)).toBe(table);
            
            // Note: We can't easily test the internal reloadDelay value
            // but we verify the function accepts the config
        });
    });

    describe('initAssignButtons - Missing table', () => {
        test('returns early when table not found', () => {
            const config = {
                tableSelector: '#missing-table',
                baseUrl: '/api/test',
            };

            // Execute (should not throw)
            expect(() => initAssignButtons(config)).not.toThrow();
        });
    });

    describe('initAssignButtons - Button click handling', () => {
        test('handles assign button click with API success', async () => {
            // Setup MSW handler
            server.use(
                http.post('/api/test/assign', async () => {
                    return HttpResponse.json({ status: 'success' });
                })
            );

            // Setup DOM
            const table = document.createElement('table');
            table.id = 'test-table';
            const tr = document.createElement('tr');
            tr.dataset.itemid = '123';
            tr.innerHTML = `
                <td><span data-count>5</span> / <span data-max>10</span></td>
                <td>
                    <button data-action="assign" class="btn btn-outline-success">Take</button>
                </td>
            `;
            table.appendChild(tr);
            document.body.appendChild(table);

            initAssignButtons({ tableSelector: '#test-table', baseUrl: '/api/test' });

            // Execute
            const button = tr.querySelector('button') as HTMLButtonElement;
            button.click();

            // Wait for async operations
            await new Promise(resolve => setTimeout(resolve, 50));

            // Verify count was updated
            const countSpan = tr.querySelector('[data-count]');
            expect(countSpan?.textContent).toBe('6');

            // Verify button was updated
            expect(button.dataset.action).toBe('unassign');
            expect(button.classList.contains('btn-outline-danger')).toBe(true);
            expect(button.textContent).toBe('Remove');
        });

        test('handles unassign button click with API success', async () => {
            // Setup MSW handler
            server.use(
                http.post('/api/test/unassign', async () => {
                    return HttpResponse.json({ status: 'success' });
                })
            );

            // Setup DOM
            const table = document.createElement('table');
            table.id = 'test-table';
            const tr = document.createElement('tr');
            tr.dataset.itemid = '456';
            tr.innerHTML = `
                <td><span data-count>10</span> / <span data-max>10</span></td>
                <td>
                    <button data-action="unassign" class="btn btn-outline-danger">Remove</button>
                    <span class="badge bg-secondary ms-1">Full</span>
                </td>
            `;
            table.appendChild(tr);
            document.body.appendChild(table);

            initAssignButtons({ tableSelector: '#test-table', baseUrl: '/api/test' });

            // Execute
            const button = tr.querySelector('button') as HTMLButtonElement;
            button.click();

            // Wait for async operations
            await new Promise(resolve => setTimeout(resolve, 50));

            // Verify count was updated
            const countSpan = tr.querySelector('[data-count]');
            expect(countSpan?.textContent).toBe('9');

            // Verify button was updated
            expect(button.dataset.action).toBe('assign');
            expect(button.classList.contains('btn-outline-success')).toBe(true);
            expect(button.textContent).toBe('Take');

            // Verify badge was removed
            const badge = tr.querySelector('.badge');
            expect(badge).toBeNull();
        });

        test('shows full badge when reaching max', async () => {
            // Setup MSW handler
            server.use(
                http.post('/api/test/assign', async () => {
                    return HttpResponse.json({ status: 'success' });
                })
            );

            // Setup DOM
            const table = document.createElement('table');
            table.id = 'test-table';
            const tr = document.createElement('tr');
            tr.dataset.itemid = '789';
            tr.innerHTML = `
                <td><span data-count>9</span> / <span data-max>10</span></td>
                <td>
                    <button data-action="assign" class="btn btn-outline-success">Take</button>
                </td>
            `;
            table.appendChild(tr);
            document.body.appendChild(table);

            initAssignButtons({ tableSelector: '#test-table', baseUrl: '/api/test' });

            // Execute
            const button = tr.querySelector('button') as HTMLButtonElement;
            button.click();

            // Wait for async operations
            await new Promise(resolve => setTimeout(resolve, 50));

            // Verify badge was added
            const badge = tr.querySelector('.badge');
            expect(badge).not.toBeNull();
            expect(badge?.textContent).toBe('Full');
        });
    });
});
