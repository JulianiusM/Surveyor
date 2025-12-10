/**
 * Tests for drivers.ts module
 */

import { driversTestData as _driversTestData } from '../data/driversData';

const driversTestData = _driversTestData();
import { setupTest } from '../helpers/testSetup';

// Mock dependencies
jest.mock('../../../src/public/js/core/navigation', () => ({
    setCurrentNavLocation: jest.fn(),
}));

jest.mock('../../../src/public/js/core/permissions', () => ({
    loadPerms: jest.fn(),
    requireEntityPerm: jest.fn(),
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

jest.mock('../../../src/public/js/shared/list-actions', () => ({
    initAssignmentRemoval: jest.fn(),
    initItemDeletion: jest.fn(),
    initQuickAdd: jest.fn(),
}));

import { setCurrentNavLocation } from '../../../src/public/js/core/navigation';
import { loadPerms, requireEntityPerm } from '../../../src/public/js/core/permissions';
import { startInlineEdit, startInlineEditArea } from '../../../src/public/js/shared/inline-edit';
import { initAssignButtons } from '../../../src/public/js/shared/entity-assign';
import { initTableReorder } from '../../../src/public/js/shared/drag-drop';
import { initAssignmentRemoval, initItemDeletion, initQuickAdd } from '../../../src/public/js/shared/list-actions';

describe('drivers module', () => {
    let init: () => void;

    setupTest({
        beforeEach: () => {
            // Setup DOM
            document.body.innerHTML = `
                <table data-assignable>
                    <tbody data-reorderable>
                        <tr data-itemid="item1">
                            <td data-edit="title">Driver 1</td>
                        </tr>
                    </tbody>
                </table>
                <div data-edit="planDescription">Plan description</div>
                <form id="quickAddForm"></form>
            `;

            // Setup global namespace
            window.Surveyor = { entityId: driversTestData.driversListId } as any;

            // Import module fresh
            jest.isolateModules(() => {
                const module = require('../../../src/public/js/drivers');
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

        it('should initialize all modules when entityId exists', () => {
            init();

            expect(initAssignButtons).toHaveBeenCalledWith({
                tableSelector: 'table[data-assignable]',
                baseUrl: `/drivers/${driversTestData.driversListId}`,
            });
            expect(initQuickAdd).toHaveBeenCalled();
            expect(initAssignmentRemoval).toHaveBeenCalled();
            expect(initItemDeletion).toHaveBeenCalled();
        });

        it('should initialize drag-and-drop with permission check', () => {
            (requireEntityPerm as jest.Mock).mockImplementation(() => {}); // permit
            init();

            expect(requireEntityPerm).toHaveBeenCalledWith('ITEM_EDIT', 'reorder drivers');
            expect(initTableReorder).toHaveBeenCalledWith({
                tbodySelector: 'tbody[data-reorderable]',
                apiUrl: `/drivers/${driversTestData.driversListId}/reorder`,
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
                `/api/drivers/${driversTestData.driversListId}/item`
            );
        });

        it('should attach inline edit area handler to plan description', () => {
            const elem = document.querySelector('[data-edit="planDescription"]')!;
            const dblclickEvent = new Event('dblclick', { bubbles: true });

            elem.dispatchEvent(dblclickEvent);

            expect(startInlineEditArea).toHaveBeenCalledWith(
                elem,
                `/api/drivers/${driversTestData.driversListId}/description`,
                {
                    scope: 'entity',
                    key: 'EDIT_DESC',
                    action: 'edit driver plan descriptions',
                }
            );
        });
    });

    describe('initialization order', () => {
        it('should call functions in correct order', () => {
            const calls: string[] = [];
            (setCurrentNavLocation as jest.Mock).mockImplementation(() => calls.push('nav'));
            (loadPerms as jest.Mock).mockImplementation(() => calls.push('perms'));
            (initAssignButtons as jest.Mock).mockImplementation(() => calls.push('assign'));

            init();

            expect(calls[0]).toBe('nav');
            expect(calls[1]).toBe('perms');
            expect(calls).toContain('assign');
        });
    });
});
