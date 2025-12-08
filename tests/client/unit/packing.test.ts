/**
 * Tests for packing.ts module
 */

import { packingTestData } from '../data/packingData';

// Mock dependencies
jest.mock('../../../src/public/js/core/navigation', () => ({
    setCurrentNavLocation: jest.fn(),
}));

jest.mock('../../../src/public/js/core/permissions', () => ({
    loadPerms: jest.fn(),
    requireEntityPerm: jest.fn(),
    requireItemPerm: jest.fn(),
}));

jest.mock('../../../src/public/js/core/http', () => ({
    post: jest.fn(),
}));

jest.mock('../../../src/public/js/shared/alerts', () => ({
    showInlineAlert: jest.fn(),
}));

jest.mock('../../../src/public/js/shared/inline-edit', () => ({
    startInlineEdit: jest.fn(),
    startInlineEditArea: jest.fn(),
}));

jest.mock('../../../src/public/js/shared/entity-assign', () => ({
    initAssignButtons: jest.fn(),
}));

jest.mock('../../../src/public/js/shared/drag-drop', () => ({
    initTableReorder: jest.fn(),
}));

jest.mock('../../../src/public/js/shared/ui-helpers', () => ({
    reloadAfterDelay: jest.fn(),
}));

jest.mock('../../../src/public/js/shared/list-actions', () => ({
    initAssignmentRemoval: jest.fn(),
    initItemDeletion: jest.fn(),
    initQuickAdd: jest.fn(),
}));

import { setCurrentNavLocation } from '../../../src/public/js/core/navigation';
import { loadPerms, requireEntityPerm, requireItemPerm } from '../../../src/public/js/core/permissions';
import { post } from '../../../src/public/js/core/http';
import { showInlineAlert } from '../../../src/public/js/shared/alerts';
import { startInlineEdit, startInlineEditArea } from '../../../src/public/js/shared/inline-edit';
import { initAssignButtons } from '../../../src/public/js/shared/entity-assign';
import { initTableReorder } from '../../../src/public/js/shared/drag-drop';
import { reloadAfterDelay } from '../../../src/public/js/shared/ui-helpers';
import { initAssignmentRemoval, initItemDeletion, initQuickAdd } from '../../../src/public/js/shared/list-actions';

describe('packing module', () => {
    let init: () => void;

    beforeEach(() => {
        // Setup DOM
        document.body.innerHTML = `
            <table data-assignable>
                <tbody data-reorderable>
                    <tr data-itemid="item1" data-pos="0">
                        <td data-edit="title">Item 1</td>
                        <td><input type="checkbox" data-packed data-itemid="item1" /></td>
                    </tr>
                    <tr data-itemid="item2" data-pos="1" class="table-info" data-required="true">
                        <td data-edit="title">Item 2</td>
                        <td>
                            <input type="checkbox" data-packed data-itemid="item2" />
                            <input type="checkbox" data-required-toggle data-itemid="item2" checked />
                        </td>
                    </tr>
                </tbody>
            </table>
            <div data-edit="planDescription">Plan description</div>
            <form id="quickAddForm"></form>
        `;

        // Setup global namespace
        window.Surveyor = { entityId: packingTestData.packListId } as any;

        // Setup localStorage mock
        const localStorageMock = (() => {
            let store: Record<string, string> = {};
            return {
                getItem: (key: string) => store[key] || null,
                setItem: (key: string, value: string) => { store[key] = value; },
                removeItem: (key: string) => { delete store[key]; },
                clear: () => { store = {}; },
            };
        })();
        Object.defineProperty(window, 'localStorage', { value: localStorageMock, writable: true });

        // Clear mocks
        jest.clearAllMocks();

        // Import module fresh
        jest.isolateModules(() => {
            const module = require('../../../src/public/js/packing');
            init = module.init;
        });
    });

    describe('init', () => {
        it('should call setCurrentNavLocation and loadPerms', () => {
            init();
            expect(setCurrentNavLocation).toHaveBeenCalledTimes(1);
            expect(loadPerms).toHaveBeenCalledTimes(1);
        });

        it('should initialize all modules when entityId exists', () => {
            init();

            expect(initAssignButtons).toHaveBeenCalledWith({
                tableSelector: 'table[data-assignable]',
                baseUrl: `/packing/${packingTestData.packListId}`,
            });
            expect(initQuickAdd).toHaveBeenCalled();
            expect(initAssignmentRemoval).toHaveBeenCalled();
            expect(initItemDeletion).toHaveBeenCalled();
        });

        it('should initialize drag-and-drop with permission check', () => {
            (requireEntityPerm as jest.Mock).mockImplementation(() => {}); // permit
            init();

            expect(requireEntityPerm).toHaveBeenCalledWith('ITEM_EDIT', 'reorder packing items');
            expect(initTableReorder).toHaveBeenCalledWith({
                tbodySelector: 'tbody[data-reorderable]',
                apiUrl: `/packing/${packingTestData.packListId}/reorder`,
                getItemId: expect.any(Function),
            });
        });

        it('should handle drag-and-drop permission denial gracefully', () => {
            const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
            (requireEntityPerm as jest.Mock).mockImplementation(() => {
                throw new Error('Permission denied');
            });

            expect(() => init()).not.toThrow();
            expect(consoleWarnSpy).toHaveBeenCalledWith('Permission denied');
            expect(initTableReorder).not.toHaveBeenCalled();

            consoleWarnSpy.mockRestore();
        });

        it('should not initialize modules when entityId is missing', () => {
            window.Surveyor.entityId = '';
            init();

            expect(initAssignButtons).not.toHaveBeenCalled();
            expect(initTableReorder).not.toHaveBeenCalled();
        });

        it('should expose init function to global scope', () => {
            init();
            expect(window.Surveyor.init).toBe(init);
        });

        it('should reorder required rows on init', () => {
            init();

            const tbody = document.querySelector('tbody')!;
            const rows = Array.from(tbody.querySelectorAll('tr'));

            // Required row (table-info) should be first
            expect(rows[0].classList.contains('table-info')).toBe(true);
        });
    });

    describe('inline editing', () => {
        beforeEach(() => {
            init();
        });

        it('should attach inline edit handlers to editable cells', () => {
            const cell = document.querySelector('td[data-edit="title"]')!;
            const dblclickEvent = new Event('dblclick', { bubbles: true });

            cell.dispatchEvent(dblclickEvent);

            expect(startInlineEdit).toHaveBeenCalledWith(
                cell,
                `/api/packing/${packingTestData.packListId}/item`
            );
        });

        it('should attach inline edit area handler to plan description', () => {
            const elem = document.querySelector('[data-edit="planDescription"]')!;
            const dblclickEvent = new Event('dblclick', { bubbles: true });

            elem.dispatchEvent(dblclickEvent);

            expect(startInlineEditArea).toHaveBeenCalledWith(
                elem,
                `/api/packing/${packingTestData.packListId}/description`,
                {
                    scope: 'entity',
                    key: 'EDIT_DESC',
                    action: 'edit packing list descriptions',
                }
            );
        });
    });

    describe('packed toggle', () => {
        beforeEach(() => {
            init();
        });

        it('should restore packed state from localStorage', () => {
            const checkbox = document.querySelector('[data-packed][data-itemid="item1"]') as HTMLInputElement;
            const row = checkbox.closest('tr')!;

            // Simulate pre-stored packed state
            localStorage.setItem(`packed_${packingTestData.packListId}_item1`, '1');

            // Re-init to load from storage
            jest.isolateModules(() => {
                const module = require('../../../src/public/js/packing');
                module.init();
            });

            expect(row.classList.contains('table-success')).toBe(true);
        });

        it('should mark item as packed and store in localStorage', () => {
            const checkbox = document.querySelector('[data-packed][data-itemid="item1"]') as HTMLInputElement;
            const row = checkbox.closest('tr')!;

            checkbox.checked = true;
            checkbox.dispatchEvent(new Event('change', { bubbles: true }));

            expect(row.classList.contains('table-success')).toBe(true);
            expect(localStorage.getItem(`packed_${packingTestData.packListId}_item1`)).toBe('1');
        });

        it('should unmark item as packed and remove from localStorage', () => {
            const checkbox = document.querySelector('[data-packed][data-itemid="item2"]') as HTMLInputElement;
            const row = checkbox.closest('tr')!;

            // First pack it
            checkbox.checked = true;
            checkbox.dispatchEvent(new Event('change', { bubbles: true }));

            // Then unpack it
            checkbox.checked = false;
            checkbox.dispatchEvent(new Event('change', { bubbles: true }));

            expect(row.classList.contains('table-success')).toBe(false);
            expect(localStorage.getItem(`packed_${packingTestData.packListId}_item2`)).toBeNull();
        });

        it('should restore required item styling when unpacked', () => {
            const checkbox = document.querySelector('[data-packed][data-itemid="item2"]') as HTMLInputElement;
            const row = checkbox.closest('tr')!;

            // Pack required item
            checkbox.checked = true;
            checkbox.dispatchEvent(new Event('change', { bubbles: true }));
            expect(row.classList.contains('table-info')).toBe(false);

            // Unpack required item
            checkbox.checked = false;
            checkbox.dispatchEvent(new Event('change', { bubbles: true }));
            expect(row.classList.contains('table-info')).toBe(true);
        });
    });

    describe('required toggle', () => {
        beforeEach(() => {
            init();
            (requireItemPerm as jest.Mock).mockImplementation(() => {}); // permit
            (post as jest.Mock).mockResolvedValue({ success: true });
        });

        it('should toggle required status with API call', async () => {
            const toggle = document.querySelector('[data-required-toggle][data-itemid="item2"]') as HTMLInputElement;
            toggle.checked = false;

            const changeEvent = new Event('change', { bubbles: true });
            Object.defineProperty(changeEvent, 'target', { value: toggle, enumerable: true });

            document.dispatchEvent(changeEvent);

            await Promise.resolve(); // Wait for async

            expect(requireItemPerm).toHaveBeenCalledWith('item2', 'EDIT_META', 'toggle shared requirements', 'ITEM_EDIT');
            expect(post).toHaveBeenCalledWith(`/api/packing/${packingTestData.packListId}/item/item2/required`, { flag: false });
        });

        it('should show success alert and reload on successful toggle', async () => {
            const toggle = document.querySelector('[data-required-toggle][data-itemid="item2"]') as HTMLInputElement;

            const changeEvent = new Event('change', { bubbles: true });
            Object.defineProperty(changeEvent, 'target', { value: toggle, enumerable: true });

            document.dispatchEvent(changeEvent);

            await Promise.resolve();

            expect(showInlineAlert).toHaveBeenCalledWith('success', 'Updated');
            expect(reloadAfterDelay).toHaveBeenCalledWith(100);
        });

        it('should rollback toggle and show error on permission denial', async () => {
            (requireItemPerm as jest.Mock).mockImplementation(() => {
                throw new Error('No permission');
            });

            const toggle = document.querySelector('[data-required-toggle][data-itemid="item2"]') as HTMLInputElement;
            const originalState = toggle.checked;
            toggle.checked = !originalState;

            const changeEvent = new Event('change', { bubbles: true });
            Object.defineProperty(changeEvent, 'target', { value: toggle, enumerable: true });

            document.dispatchEvent(changeEvent);

            await Promise.resolve();

            expect(toggle.checked).toBe(originalState);
            expect(showInlineAlert).toHaveBeenCalledWith('error', 'No permission');
        });

        it('should handle API errors gracefully', async () => {
            (post as jest.Mock).mockRejectedValue(new Error('API error'));

            const toggle = document.querySelector('[data-required-toggle][data-itemid="item2"]') as HTMLInputElement;
            const originalState = toggle.checked;
            toggle.checked = !originalState;

            const changeEvent = new Event('change', { bubbles: true });
            Object.defineProperty(changeEvent, 'target', { value: toggle, enumerable: true });

            document.dispatchEvent(changeEvent);

            await Promise.resolve();
            await Promise.resolve(); // Wait for error handling

            expect(toggle.checked).toBe(originalState);
            expect(showInlineAlert).toHaveBeenCalledWith('error', 'API error');
        });
    });
});
