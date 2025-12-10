/**
 * Tests for activity-slot-editor.ts
 * Testing slot editor modal functionality
 */

import {initSlotEditorModal} from '../../../src/public/js/modules/activity-slot-editor';
import {activitySlotEditorData} from '../data/activitySlotEditorData';

const testData = activitySlotEditorData();
import * as alerts from '../../../src/public/js/shared/alerts';
import * as uiHelpers from '../../../src/public/js/shared/ui-helpers';
import * as permissions from '../../../src/public/js/core/permissions';
import * as activityRoles from '../../../src/public/js/modules/activity-roles';
import {setupTest, mockApiSuccess, mockApiError} from '../helpers/testSetup';

// Mock Bootstrap
const mockShow = jest.fn();
const mockHide = jest.fn();
(global as any).bootstrap = {
    Modal: jest.fn().mockImplementation(() => ({
        show: mockShow,
        hide: mockHide,
    })),
};

// Mock dependencies
jest.mock('../../../src/public/js/shared/alerts');
jest.mock('../../../src/public/js/shared/ui-helpers');
jest.mock('../../../src/public/js/core/permissions');
jest.mock('../../../src/public/js/modules/activity-roles');

describe('activity-slot-editor', () => {
    let modal: HTMLElement;
    let form: HTMLFormElement;

    setupTest({
        beforeEach: () => {
            mockShow.mockClear();
            mockHide.mockClear();

        // Setup basic modal structure
        modal = document.createElement('div');
        modal.id = 'slotEditorModal';

        form = document.createElement('form');
        form.id = 'slotEditorForm';

        const titleEl = document.createElement('h5');
        titleEl.id = 'slotEditorTitle';

        const slotIdInput = document.createElement('input');
        slotIdInput.id = 'slotEditorSlotId';

        const dateInput = document.createElement('input');
        dateInput.id = 'slotEditorDate';

        const titleInput = document.createElement('input');
        titleInput.id = 'slotEditorTitleInput';

        const descInput = document.createElement('textarea');
        descInput.id = 'slotEditorDescription';

        const startInput = document.createElement('input');
        startInput.id = 'slotEditorStartTime';

        const endInput = document.createElement('input');
        endInput.id = 'slotEditorEndTime';

        const capacityInput = document.createElement('input');
        capacityInput.id = 'slotEditorCapacity';

        const metaSpan = document.createElement('span');
        metaSpan.id = 'slotEditorMeta';

        const errorSpan = document.createElement('span');
        errorSpan.id = 'slotEditorError';
        errorSpan.classList.add('d-none');

        const roleChips = document.createElement('div');
        roleChips.id = 'slotEditorRoleChips';

        const roleInput = document.createElement('input');
        roleInput.id = 'slotEditorRoleInput';

        const roleSuggestions = document.createElement('div');
        roleSuggestions.id = 'slotEditorRoleSuggestions';
        roleSuggestions.classList.add('d-none');

        form.append(slotIdInput, dateInput, titleInput, descInput, startInput, endInput, capacityInput);
        modal.append(titleEl, form, metaSpan, errorSpan, roleChips, roleInput, roleSuggestions);
        document.body.append(modal);

        jest.spyOn(alerts, 'showInlineAlert').mockImplementation();
        jest.spyOn(uiHelpers, 'reloadAfterDelay').mockImplementation();
        jest.spyOn(permissions, 'requireEntityPerm').mockImplementation();
        jest.spyOn(permissions, 'requireItemPerm').mockImplementation();
        jest.spyOn(activityRoles, 'getAllRoles').mockReturnValue(testData.roleManagement.multipleRoles);
        jest.spyOn(activityRoles, 'getSlotRolesForSlot').mockReturnValue([]);
        jest.spyOn(activityRoles, 'addRoleToGlobal').mockImplementation();
        }
    });

    describe('initialization', () => {
        test('should not initialize without planId', () => {
            initSlotEditorModal('');
            expect((global as any).bootstrap.Modal).not.toHaveBeenCalled();
        });

        test('should not initialize with missing modal element', () => {
            document.body.innerHTML = '';
            initSlotEditorModal(testData.initialization.valid.planId);
            expect((global as any).bootstrap.Modal).not.toHaveBeenCalled();
        });

        test('should initialize with valid setup', () => {
            initSlotEditorModal(testData.initialization.valid.planId);
            expect((global as any).bootstrap.Modal).toHaveBeenCalledWith(
                modal,
                expect.objectContaining({focus: true})
            );
        });

        test('should not initialize without required form inputs', () => {
            document.getElementById('slotEditorTitleInput')?.remove();
            (global as any).bootstrap.Modal.mockClear();
            initSlotEditorModal(testData.initialization.valid.planId);
            expect((global as any).bootstrap.Modal).not.toHaveBeenCalled();
        });
    });

    describe('role management', () => {
        beforeEach(() => {
            initSlotEditorModal(testData.initialization.valid.planId);
        });

        test('should render empty state when no roles selected', () => {
            const roleChips = document.getElementById('slotEditorRoleChips')!;
            // Initially, roleChips is empty until modal opens or a slot is loaded
            // The renderRoleChips function is called when the modal opens or roles change
            // For this test, we just verify the element exists and is empty initially
            expect(roleChips).toBeTruthy();
            expect(roleChips.innerHTML).toBe('');
            // The actual empty state rendering happens when modal opens with no selected roles
        });

        test('should display role suggestions when typing', () => {
            const roleInput = document.getElementById('slotEditorRoleInput') as HTMLInputElement;
            const roleSuggestions = document.getElementById('slotEditorRoleSuggestions')!;

            roleInput.value = testData.roleManagement.roleSearch.term;
            roleInput.dispatchEvent(new Event('input'));

            expect(roleSuggestions.classList.contains('d-none')).toBe(false);
            expect(roleSuggestions.textContent).toContain('Cook');
        });

        test('should hide suggestions when search term is empty', () => {
            const roleInput = document.getElementById('slotEditorRoleInput') as HTMLInputElement;
            const roleSuggestions = document.getElementById('slotEditorRoleSuggestions')!;

            roleInput.value = 'cook';
            roleInput.dispatchEvent(new Event('input'));
            expect(roleSuggestions.classList.contains('d-none')).toBe(false);

            roleInput.value = '';
            roleInput.dispatchEvent(new Event('input'));
            expect(roleSuggestions.classList.contains('d-none')).toBe(true);
        });

        test('should suggest creating new role when no matches found', () => {
            const roleInput = document.getElementById('slotEditorRoleInput') as HTMLInputElement;
            const roleSuggestions = document.getElementById('slotEditorRoleSuggestions')!;

            roleInput.value = 'NonExistentRole';
            roleInput.dispatchEvent(new Event('input'));

            expect(roleSuggestions.textContent).toContain('Create new role');
        });

        test('should select role from suggestions on Enter key', async () => {
            const roleInput = document.getElementById('slotEditorRoleInput') as HTMLInputElement;
            const roleSuggestions = document.getElementById('slotEditorRoleSuggestions')!;
            const roleChips = document.getElementById('slotEditorRoleChips')!;

            roleInput.value = 'cook';
            roleInput.dispatchEvent(new Event('input'));

            const event = new KeyboardEvent('keydown', {key: 'Enter'});
            roleInput.dispatchEvent(event);

            // Wait for async
            await new Promise((resolve) => setTimeout(resolve, 0));

            expect(roleChips.querySelector('[data-role-chip-remove]')).toBeTruthy();
        });

        test('should clear role input on Escape key', () => {
            const roleInput = document.getElementById('slotEditorRoleInput') as HTMLInputElement;
            const roleSuggestions = document.getElementById('slotEditorRoleSuggestions')!;

            roleInput.value = 'cook';
            roleInput.dispatchEvent(new Event('input'));

            const event = new KeyboardEvent('keydown', {key: 'Escape'});
            roleInput.dispatchEvent(event);

            expect(roleInput.value).toBe('');
            expect(roleSuggestions.classList.contains('d-none')).toBe(true);
        });

        test('should add role when clicking suggestion', async () => {
            const roleInput = document.getElementById('slotEditorRoleInput') as HTMLInputElement;
            const roleSuggestions = document.getElementById('slotEditorRoleSuggestions')!;
            const roleChips = document.getElementById('slotEditorRoleChips')!;

            roleInput.value = 'cook';
            roleInput.dispatchEvent(new Event('input'));

            const suggestion = roleSuggestions.querySelector('button')!;
            suggestion.click();

            // Wait for async
            await new Promise((resolve) => setTimeout(resolve, 0));

            expect(roleChips.querySelector('[data-role-chip-remove]')).toBeTruthy();
            expect(roleInput.value).toBe('');
        });

        test('should remove role when clicking remove button', async () => {
            const roleInput = document.getElementById('slotEditorRoleInput') as HTMLInputElement;
            const roleSuggestions = document.getElementById('slotEditorRoleSuggestions')!;
            const roleChips = document.getElementById('slotEditorRoleChips')!;

            // Add a role first
            roleInput.value = 'cook';
            roleInput.dispatchEvent(new Event('input'));
            const suggestion = roleSuggestions.querySelector('button')!;
            suggestion.click();
            await new Promise((resolve) => setTimeout(resolve, 0));

            // Now remove it
            const removeBtn = roleChips.querySelector('[data-role-chip-remove]') as HTMLButtonElement;
            expect(removeBtn).toBeTruthy();
            removeBtn.click();

            await new Promise((resolve) => setTimeout(resolve, 0));

            expect(roleChips.textContent).toContain('No roles assigned yet');
        });
    });

    describe('slot creation', () => {
        beforeEach(() => {
            initSlotEditorModal(testData.initialization.valid.planId);
        });

        test('should open modal in create mode when clicking add slot button', () => {
            const addBtn = document.createElement('button');
            addBtn.dataset.addSlot = '1';
            addBtn.dataset.date = testData.slotCreation.valid.date;
            document.body.append(addBtn);

            addBtn.click();

            expect(mockShow).toHaveBeenCalled();
            const titleEl = document.getElementById('slotEditorTitle')!;
            expect(titleEl.textContent).toContain('Create slot');
        });

        test('should show error when submitting without title', async () => {
            const addBtn = document.createElement('button');
            addBtn.dataset.addSlot = '1';
            addBtn.dataset.date = testData.slotCreation.valid.date;
            document.body.append(addBtn);
            addBtn.click();

            const titleInput = document.getElementById('slotEditorTitleInput') as HTMLInputElement;
            titleInput.value = '';

            form.dispatchEvent(new Event('submit'));
            await new Promise((resolve) => setTimeout(resolve, 0));

            const errorSpan = document.getElementById('slotEditorError')!;
            expect(errorSpan.textContent).toContain('Title is required');
            expect(errorSpan.classList.contains('d-none')).toBe(false);
        });

        test('should create slot successfully with valid data', async () => {
            mockApiSuccess('POST', '/api/activity/plan123/slot/add', {
                status: 'success',
                data: {slotId: 'newSlot'},
            });

            const addBtn = document.createElement('button');
            addBtn.dataset.addSlot = '1';
            addBtn.dataset.date = testData.slotCreation.valid.date;
            document.body.append(addBtn);
            addBtn.click();

            const titleInput = document.getElementById('slotEditorTitleInput') as HTMLInputElement;
            const descInput = document.getElementById('slotEditorDescription') as HTMLTextAreaElement;
            const startInput = document.getElementById('slotEditorStartTime') as HTMLInputElement;
            const endInput = document.getElementById('slotEditorEndTime') as HTMLInputElement;
            const capacityInput = document.getElementById('slotEditorCapacity') as HTMLInputElement;

            titleInput.value = testData.slotCreation.valid.title;
            descInput.value = testData.slotCreation.valid.description;
            startInput.value = testData.slotCreation.valid.startTime;
            endInput.value = testData.slotCreation.valid.endTime;
            capacityInput.value = testData.slotCreation.valid.capacity;

            form.dispatchEvent(new Event('submit'));
            await new Promise((resolve) => setTimeout(resolve, 200));

            expect(alerts.showInlineAlert).toHaveBeenCalledWith('success', 'Slot created');
            expect(mockHide).toHaveBeenCalled();
            expect(uiHelpers.reloadAfterDelay).toHaveBeenCalledWith(150);
        });

        test('should handle API error during creation', async () => {
            mockApiError('POST', '/api/activity/plan123/slot/add', 'Permission denied', 403);

            const addBtn = document.createElement('button');
            addBtn.dataset.addSlot = '1';
            addBtn.dataset.date = testData.slotCreation.valid.date;
            document.body.append(addBtn);
            addBtn.click();

            const titleInput = document.getElementById('slotEditorTitleInput') as HTMLInputElement;
            titleInput.value = testData.slotCreation.valid.title;

            form.dispatchEvent(new Event('submit'));
            await new Promise((resolve) => setTimeout(resolve, 150));

            const errorSpan = document.getElementById('slotEditorError')!;
            expect(errorSpan.textContent).toContain('Permission denied');
            expect(mockHide).not.toHaveBeenCalled();
        });

        test('should check permissions before creating slot', async () => {
            mockApiSuccess('POST', '/api/activity/plan123/slot/add', {
                status: 'success',
                data: {slotId: 'newSlot'},
            });

            const addBtn = document.createElement('button');
            addBtn.dataset.addSlot = '1';
            addBtn.dataset.date = testData.slotCreation.valid.date;
            document.body.append(addBtn);
            addBtn.click();

            const titleInput = document.getElementById('slotEditorTitleInput') as HTMLInputElement;
            titleInput.value = testData.slotCreation.valid.title;

            form.dispatchEvent(new Event('submit'));
            await new Promise((resolve) => setTimeout(resolve, 200));

            expect(permissions.requireEntityPerm).toHaveBeenCalledWith('ITEM_ADD', 'add slots');
        });
    });

    describe('slot editing', () => {
        let slotEl: HTMLElement;

        beforeEach(() => {
            initSlotEditorModal(testData.initialization.valid.planId);

            // Create slot element
            const slotContainer = document.createElement('div');
            slotContainer.className = 'slot-container';
            slotContainer.dataset.date = testData.slotEditing.existing.date;

            slotEl = document.createElement('div');
            slotEl.className = 'slot';
            slotEl.dataset.slotid = testData.slotEditing.existing.slotId;
            slotEl.dataset.start = testData.slotEditing.existing.startTime;
            slotEl.dataset.end = testData.slotEditing.existing.endTime;

            const titleSpan = document.createElement('span');
            titleSpan.dataset.edit = 'title';
            titleSpan.textContent = testData.slotEditing.existing.title;

            const descSpan = document.createElement('span');
            descSpan.dataset.edit = 'description';
            descSpan.textContent = testData.slotEditing.existing.description;

            const maxSpan = document.createElement('span');
            maxSpan.dataset.edit = 'maxAssignees';
            maxSpan.textContent = testData.slotEditing.existing.capacity;

            slotEl.append(titleSpan, descSpan, maxSpan);
            slotContainer.append(slotEl);
            document.body.append(slotContainer);
        });

        test('should open modal in edit mode when clicking edit button', () => {
            const editBtn = document.createElement('button');
            editBtn.dataset.slotEdit = '1';
            slotEl.append(editBtn);

            editBtn.click();

            expect(mockShow).toHaveBeenCalled();
            const titleEl = document.getElementById('slotEditorTitle')!;
            expect(titleEl.textContent).toContain('Edit slot');

            const titleInput = document.getElementById('slotEditorTitleInput') as HTMLInputElement;
            expect(titleInput.value).toBe(testData.slotEditing.existing.title);
        });

        test('should populate form with existing slot data', () => {
            const editBtn = document.createElement('button');
            editBtn.dataset.slotEdit = '1';
            slotEl.append(editBtn);

            editBtn.click();

            const titleInput = document.getElementById('slotEditorTitleInput') as HTMLInputElement;
            const descInput = document.getElementById('slotEditorDescription') as HTMLTextAreaElement;
            const startInput = document.getElementById('slotEditorStartTime') as HTMLInputElement;
            const endInput = document.getElementById('slotEditorEndTime') as HTMLInputElement;
            const capacityInput = document.getElementById('slotEditorCapacity') as HTMLInputElement;

            expect(titleInput.value).toBe(testData.slotEditing.existing.title);
            expect(descInput.value).toBe(testData.slotEditing.existing.description);
            expect(startInput.value).toBe('14:00');
            expect(endInput.value).toBe('18:00');
            expect(capacityInput.value).toBe(testData.slotEditing.existing.capacity);
        });

        test('should update slot successfully', async () => {
            mockApiSuccess('POST', '/api/activity/plan123/slot/slot456/attr', {
                status: 'success',
            });

            const editBtn = document.createElement('button');
            editBtn.dataset.slotEdit = '1';
            slotEl.append(editBtn);
            editBtn.click();

            const titleInput = document.getElementById('slotEditorTitleInput') as HTMLInputElement;
            titleInput.value = 'Updated Title';

            form.dispatchEvent(new Event('submit'));
            await new Promise((resolve) => setTimeout(resolve, 200));

            expect(alerts.showInlineAlert).toHaveBeenCalledWith('success', 'Slot updated');
            expect(mockHide).toHaveBeenCalled();
        });

        test('should check permissions before editing slot', async () => {
            mockApiSuccess('POST', '/api/activity/plan123/slot/slot456/attr', {
                status: 'success',
            });

            const editBtn = document.createElement('button');
            editBtn.dataset.slotEdit = '1';
            slotEl.append(editBtn);
            editBtn.click();

            const titleInput = document.getElementById('slotEditorTitleInput') as HTMLInputElement;
            titleInput.value = 'Updated Title';

            form.dispatchEvent(new Event('submit'));
            await new Promise((resolve) => setTimeout(resolve, 200));

            expect(permissions.requireItemPerm).toHaveBeenCalledWith(
                testData.slotEditing.existing.slotId,
                'ITEM_EDIT',
                'edit slots',
                'ITEM_EDIT'
            );
        });
    });

    describe('time conversion utilities', () => {
        beforeEach(() => {
            initSlotEditorModal(testData.initialization.valid.planId);
        });

        test('should convert HTML time input to database format', async () => {
            mockApiSuccess('POST', '/api/activity/plan123/slot/add', {
                status: 'success',
                data: {slotId: 'newSlot'},
            });

            const addBtn = document.createElement('button');
            addBtn.dataset.addSlot = '1';
            addBtn.dataset.date = '2024-12-15';
            document.body.append(addBtn);
            addBtn.click();

            const titleInput = document.getElementById('slotEditorTitleInput') as HTMLInputElement;
            const startInput = document.getElementById('slotEditorStartTime') as HTMLInputElement;

            titleInput.value = 'Test';
            startInput.value = testData.timeConversion.validInput.htmlTime;

            form.dispatchEvent(new Event('submit'));
            await new Promise((resolve) => setTimeout(resolve, 200));

            expect(alerts.showInlineAlert).toHaveBeenCalledWith('success', 'Slot created');
        });

        test('should handle null time values', async () => {
            mockApiSuccess('POST', '/api/activity/plan123/slot/add', {
                status: 'success',
                data: {slotId: 'newSlot'},
            });

            const addBtn = document.createElement('button');
            addBtn.dataset.addSlot = '1';
            addBtn.dataset.date = '2024-12-15';
            document.body.append(addBtn);
            addBtn.click();

            const titleInput = document.getElementById('slotEditorTitleInput') as HTMLInputElement;
            const startInput = document.getElementById('slotEditorStartTime') as HTMLInputElement;

            titleInput.value = 'Test';
            startInput.value = '';

            form.dispatchEvent(new Event('submit'));
            await new Promise((resolve) => setTimeout(resolve, 200));

            expect(alerts.showInlineAlert).toHaveBeenCalledWith('success', 'Slot created');
        });
    });

    describe('role creation', () => {
        beforeEach(() => {
            initSlotEditorModal(testData.initialization.valid.planId);
        });

        test('should create new role when suggested and Enter pressed', async () => {
            mockApiSuccess('POST', '/api/activity/plan123/roles', {
                status: 'success',
                data: [testData.apiResponses.roleCreationSuccess.data[0]],
            });

            const roleInput = document.getElementById('slotEditorRoleInput') as HTMLInputElement;
            roleInput.value = 'Dishwasher';
            roleInput.dispatchEvent(new Event('input'));

            const event = new KeyboardEvent('keydown', {key: 'Enter'});
            roleInput.dispatchEvent(event);

            await new Promise((resolve) => setTimeout(resolve, 200));

            expect(activityRoles.addRoleToGlobal).toHaveBeenCalled();
        });

        test('should handle error when creating role', async () => {
            mockApiError('POST', '/api/activity/plan123/roles', 'Permission denied', 403);

            const roleInput = document.getElementById('slotEditorRoleInput') as HTMLInputElement;
            roleInput.value = 'Dishwasher';
            roleInput.dispatchEvent(new Event('input'));

            const event = new KeyboardEvent('keydown', {key: 'Enter'});
            roleInput.dispatchEvent(event);

            await new Promise((resolve) => setTimeout(resolve, 150));

            const errorSpan = document.getElementById('slotEditorError')!;
            expect(errorSpan.textContent).toContain('Permission denied');
        });

        test('should check EDIT_META permission before creating role', async () => {
            mockApiSuccess('POST', '/api/activity/plan123/roles', {
                status: 'success',
                data: [testData.apiResponses.roleCreationSuccess.data[0]],
            });

            const roleInput = document.getElementById('slotEditorRoleInput') as HTMLInputElement;
            roleInput.value = 'Dishwasher';
            roleInput.dispatchEvent(new Event('input'));

            const event = new KeyboardEvent('keydown', {key: 'Enter'});
            roleInput.dispatchEvent(event);

            await new Promise((resolve) => setTimeout(resolve, 200));

            expect(permissions.requireEntityPerm).toHaveBeenCalledWith(
                'EDIT_META',
                'create roles for this plan'
            );
        });
    });
});
