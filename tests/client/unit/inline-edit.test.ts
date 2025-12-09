/**
 * Tests for inline-edit.ts
 * Data-driven tests for inline editing functionality
 */

import { enableDnD, disableDnD, startInlineEditArea, startInlineEdit } from '../../../src/public/js/shared/inline-edit';
import { enableDnDData as _enableDnDData, disableDnDData as _disableDnDData, startInlineEditAreaData as _startInlineEditAreaData, startInlineEditData as _startInlineEditData } from '../data/inlineEditData';

const enableDnDData = _enableDnDData();
const disableDnDData = _disableDnDData();
const startInlineEditAreaData = _startInlineEditAreaData();
const startInlineEditData = _startInlineEditData();
import { getPerms, requireEntityPerm, requireItemPerm } from '../../../src/public/js/core/permissions';
import { post } from '../../../src/public/js/core/http';
import { showInlineAlert } from '../../../src/public/js/shared/alerts';
import { reloadAfterDelay } from '../../../src/public/js/shared/ui-helpers';
import { setupTest } from '../helpers/testSetup';

// Mock dependencies
jest.mock('../../../src/public/js/core/permissions');
jest.mock('../../../src/public/js/core/http');
jest.mock('../../../src/public/js/shared/alerts');
jest.mock('../../../src/public/js/shared/ui-helpers');

const mockGetPerms = getPerms as jest.MockedFunction<typeof getPerms>;
const mockRequireEntityPerm = requireEntityPerm as jest.MockedFunction<typeof requireEntityPerm>;
const mockRequireItemPerm = requireItemPerm as jest.MockedFunction<typeof requireItemPerm>;
const mockPost = post as jest.MockedFunction<typeof post>;
const mockShowInlineAlert = showInlineAlert as jest.MockedFunction<typeof showInlineAlert>;
const mockReloadAfterDelay = reloadAfterDelay as jest.MockedFunction<typeof reloadAfterDelay>;

// Test helpers
const waitForAsync = () => new Promise(resolve => setTimeout(resolve, 0));

const createKeyboardEvent = (key: string, options: { ctrlKey?: boolean } = {}) => {
    const event = new KeyboardEvent('keydown', { key, ...options });
    Object.defineProperty(event, 'preventDefault', { value: jest.fn() });
    return event;
};

describe('inline-edit', () => {
    setupTest();

    describe('enableDnD - Data Driven', () => {
        test.each(enableDnDData)('$description', ({ hasPermission, draggableCount, expectedDraggable }) => {
            // Setup DOM
            for (let i = 0; i < draggableCount; i++) {
                const elem = document.createElement('div');
                elem.className = 'draggable';
                document.body.appendChild(elem);
            }

            // Mock permissions
            mockGetPerms.mockReturnValue(
                hasPermission
                    ? { entity: { has: () => true }, item: { has: () => true } }
                    : { entity: { has: () => false }, item: { has: () => false } }
            );

            // Execute
            enableDnD();

            // Verify
            const draggables = document.getElementsByClassName('draggable');
            if (draggableCount === 0) {
                expect(draggables.length).toBe(0);
            } else {
                for (const elem of Array.from(draggables)) {
                    expect((elem as HTMLElement).draggable).toBe(expectedDraggable);
                }
            }
        });
    });

    describe('disableDnD - Data Driven', () => {
        test.each(disableDnDData)('$description', ({ draggableCount }) => {
            // Setup DOM
            for (let i = 0; i < draggableCount; i++) {
                const elem = document.createElement('div');
                elem.className = 'draggable';
                (elem as HTMLElement).draggable = true;
                document.body.appendChild(elem);
            }

            // Execute
            disableDnD();

            // Verify
            const draggables = document.getElementsByClassName('draggable');
            for (const elem of Array.from(draggables)) {
                expect((elem as HTMLElement).draggable).toBe(false);
            }
        });
    });

    describe('startInlineEditArea - Data Driven', () => {
        test.each(startInlineEditAreaData)('$description', ({ oldText, hasPermission, expectedValue, shouldBlock, hasExistingTextarea, shouldSkip }) => {
            // Setup DOM
            const elem = document.createElement('div');
            elem.innerText = oldText;
            
            if (hasExistingTextarea) {
                const textarea = document.createElement('textarea');
                elem.appendChild(textarea);
            }
            
            document.body.appendChild(elem);

            // Mock permissions
            if (shouldBlock) {
                mockRequireEntityPerm.mockImplementation(() => {
                    throw new Error('Permission denied');
                });
            } else {
                mockRequireEntityPerm.mockImplementation(() => {});
            }

            // Execute
            startInlineEditArea(elem, '/api/test/description');

            // Verify
            if (shouldBlock) {
                expect(mockShowInlineAlert).toHaveBeenCalledWith('error', 'Permission denied');
                expect(elem.querySelector('textarea')).toBeNull();
            } else if (shouldSkip) {
                // Should not create new textarea
                expect(elem.querySelectorAll('textarea').length).toBe(1);
            } else if (!hasExistingTextarea) {
                const textarea = elem.querySelector('textarea');
                expect(textarea).not.toBeNull();
                expect((textarea as HTMLTextAreaElement).value).toBe(expectedValue);
                expect((textarea as HTMLTextAreaElement).className).toContain('form-control');
                expect((textarea as HTMLTextAreaElement).maxLength).toBe(1999);
            }
        });
    });

    describe('startInlineEdit - Data Driven', () => {
        test.each(startInlineEditData)('$description', ({ field, oldText, inputType, hasPermission, shouldBlock, hasExistingInput, shouldSkip }) => {
            // Setup DOM
            const elem = document.createElement('div');
            elem.dataset.edit = field;
            elem.dataset.id = '123';
            elem.textContent = oldText;
            
            if (hasExistingInput) {
                const input = document.createElement('input');
                elem.appendChild(input);
            }
            
            document.body.appendChild(elem);

            // Mock permissions
            if (shouldBlock) {
                mockRequireItemPerm.mockImplementation(() => {
                    throw new Error('Permission denied');
                });
            } else {
                mockRequireItemPerm.mockImplementation(() => {});
            }

            // Execute
            startInlineEdit(elem, '/api/test');

            // Verify
            if (shouldBlock) {
                expect(mockShowInlineAlert).toHaveBeenCalledWith('error', 'Permission denied');
                expect(elem.querySelector('input')).toBeNull();
            } else if (shouldSkip) {
                // Should not create new input
                expect(elem.querySelectorAll('input').length).toBe(1);
            } else if (!hasExistingInput) {
                const input = elem.querySelector('input');
                expect(input).not.toBeNull();
                expect((input as HTMLInputElement).type).toBe(inputType);
                expect((input as HTMLInputElement).value).toBe(oldText);
                expect((input as HTMLInputElement).className).toContain('form-control');
            }
        });
    });

    describe('startInlineEditArea - Save Functionality', () => {
        test('saves description on blur', async () => {
            const elem = document.createElement('div');
            elem.innerText = 'Old text';
            document.body.appendChild(elem);

            mockRequireEntityPerm.mockImplementation(() => {});
            mockPost.mockResolvedValue({});

            startInlineEditArea(elem, '/api/test/description');

            const textarea = elem.querySelector('textarea');
            expect(textarea).not.toBeNull();

            (textarea as HTMLTextAreaElement).value = 'New text';
            textarea?.dispatchEvent(new Event('blur'));

            await waitForAsync();

            expect(mockPost).toHaveBeenCalledWith('/api/test/description', { description: 'New text' });
            expect(mockShowInlineAlert).toHaveBeenCalledWith('success', 'Description updated');
        });

        test('handles save error', async () => {
            const elem = document.createElement('div');
            elem.innerText = 'Old text';
            document.body.appendChild(elem);

            mockRequireEntityPerm.mockImplementation(() => {});
            mockPost.mockRejectedValue(new Error('Save failed'));

            startInlineEditArea(elem, '/api/test/description');

            const textarea = elem.querySelector('textarea');
            (textarea as HTMLTextAreaElement).value = 'New text';
            textarea?.dispatchEvent(new Event('blur'));

            await waitForAsync();

            expect(mockShowInlineAlert).toHaveBeenCalledWith('error', 'Save failed');
            expect(elem.innerHTML).toContain('Old text');
        });

        test('saves on Ctrl+Enter', async () => {
            const elem = document.createElement('div');
            elem.innerText = 'Old';
            document.body.appendChild(elem);

            mockRequireEntityPerm.mockImplementation(() => {});
            mockPost.mockResolvedValue({});

            startInlineEditArea(elem, '/api/test/description');

            const textarea = elem.querySelector('textarea') as HTMLTextAreaElement;
            textarea.value = 'New';

            const event = createKeyboardEvent('Enter', { ctrlKey: true });
            textarea.dispatchEvent(event);

            await waitForAsync();

            expect(mockPost).toHaveBeenCalledWith('/api/test/description', { description: 'New' });
        });

        test('cancels on Escape', () => {
            const elem = document.createElement('div');
            elem.innerText = 'Original';
            document.body.appendChild(elem);

            mockRequireEntityPerm.mockImplementation(() => {});

            startInlineEditArea(elem, '/api/test/description');

            const textarea = elem.querySelector('textarea') as HTMLTextAreaElement;
            textarea.value = 'Modified';

            const event = new KeyboardEvent('keydown', { key: 'Escape' });
            textarea.dispatchEvent(event);

            expect(elem.innerHTML).toContain('Original');
        });
    });

    describe('startInlineEdit - Save Functionality', () => {
        test('saves on blur', async () => {
            const elem = document.createElement('div');
            elem.dataset.edit = 'title';
            elem.dataset.id = '456';
            elem.textContent = 'Old Title';
            document.body.appendChild(elem);

            mockRequireItemPerm.mockImplementation(() => {});
            mockPost.mockResolvedValue({});

            startInlineEdit(elem, '/api/test');

            const input = elem.querySelector('input') as HTMLInputElement;
            input.value = 'New Title';
            input.dispatchEvent(new Event('blur'));

            await waitForAsync();

            expect(mockPost).toHaveBeenCalledWith('/api/test/456/attr', { field: 'title', value: 'New Title' });
            expect(mockShowInlineAlert).toHaveBeenCalledWith('success', 'Updated');
        });

        test('reloads after saving maxAssignees', async () => {
            const elem = document.createElement('div');
            elem.dataset.edit = 'maxAssignees';
            elem.dataset.id = '789';
            elem.textContent = '5';
            document.body.appendChild(elem);

            mockRequireItemPerm.mockImplementation(() => {});
            mockPost.mockResolvedValue({});

            startInlineEdit(elem, '/api/test');

            const input = elem.querySelector('input') as HTMLInputElement;
            input.value = '10';
            input.dispatchEvent(new Event('blur'));

            await waitForAsync();

            expect(mockPost).toHaveBeenCalledWith('/api/test/789/attr', { field: 'maxAssignees', value: '10' });
            expect(mockReloadAfterDelay).toHaveBeenCalledWith(100);
        });

        test('handles save error', async () => {
            const elem = document.createElement('div');
            elem.dataset.edit = 'title';
            elem.dataset.id = '999';
            elem.textContent = 'Original';
            document.body.appendChild(elem);

            mockRequireItemPerm.mockImplementation(() => {});
            mockPost.mockRejectedValue(new Error('Failed to save'));

            startInlineEdit(elem, '/api/test');

            const input = elem.querySelector('input') as HTMLInputElement;
            input.value = 'Modified';
            input.dispatchEvent(new Event('blur'));

            await waitForAsync();

            expect(mockShowInlineAlert).toHaveBeenCalledWith('error', 'Failed to save');
            expect(elem.textContent).toBe('Original');
        });

        test('saves on Enter key', async () => {
            const elem = document.createElement('div');
            elem.dataset.edit = 'title';
            elem.dataset.id = '111';
            elem.textContent = 'Before';
            document.body.appendChild(elem);

            mockRequireItemPerm.mockImplementation(() => {});
            mockPost.mockResolvedValue({});

            startInlineEdit(elem, '/api/test');

            const input = elem.querySelector('input') as HTMLInputElement;
            input.value = 'After';

            const event = createKeyboardEvent('Enter');
            input.dispatchEvent(event);

            await waitForAsync();

            expect(mockPost).toHaveBeenCalledWith('/api/test/111/attr', { field: 'title', value: 'After' });
        });
    });
});
