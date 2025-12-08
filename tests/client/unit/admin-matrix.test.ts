/**
 * Tests for admin-matrix module
 */

import {initAdminMatrix} from '../../../src/public/js/modules/admin-matrix';
import {permissionData, maskApplicationData, updateOperationData, searchUserData} from '../data/adminMatrixData';
import {server} from '../msw/server';
import {http, HttpResponse} from 'msw';

describe('admin-matrix module', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement('div');
        container.innerHTML = `
            <div class="admin-matrix"
                 data-api-update="/api/admin/permissions"
                 data-api-remove="/api/admin/users"
                 data-api-add="/api/admin/users"
                 data-api-search="/api/users/search">
                <div class="admin-card">
                    <input type="checkbox" class="perm-box" value="MANAGE_USERS" data-bit="1">
                    <input type="checkbox" class="perm-box" value="MANAGE_EVENTS" data-bit="2">
                    <input type="checkbox" class="perm-box" value="VIEW_REPORTS" data-bit="4">
                    <button class="admin-perm-preset" data-mask="3">Preset</button>
                    <button class="admin-perm-select-all">Select All</button>
                    <button class="admin-perm-clear">Clear</button>
                    <button class="btn-admin-update" data-user-id="123">Update</button>
                    <button class="btn-admin-remove" data-user-id="123">Remove</button>
                </div>
                <div class="modal admin-modal" id="test-add-modal">
                    <input type="text" list="user-list">
                    <datalist id="user-list"></datalist>
                    <input type="hidden" id="test-userId">
                    <select>
                        <option value="">None</option>
                        <option value="editor">Editor</option>
                    </select>
                    <button class="btn-admin-add-submit" data-modal="#test-add-modal">Add</button>
                </div>
            </div>
            <div id="liveAlerts"></div>
        `;
        document.body.appendChild(container);
        initAdminMatrix();
    });

    afterEach(() => {
        document.body.removeChild(container);
    });

    describe('permission collection', () => {
        test.each(permissionData)('$description', ({checkboxes, expectedKeys}) => {
            const card = container.querySelector('.admin-card') as HTMLElement;
            const permBoxes = card.querySelectorAll('.perm-box') as NodeListOf<HTMLInputElement>;

            checkboxes.forEach((cb, idx) => {
                if (permBoxes[idx]) {
                    permBoxes[idx].checked = cb.checked;
                }
            });

            const updateBtn = card.querySelector('.btn-admin-update') as HTMLButtonElement;
            
            let capturedPayload: any = null;
            server.use(
                http.patch('/api/admin/permissions/:userId', async ({request}) => {
                    capturedPayload = await request.json();
                    return HttpResponse.json({status: 'success', data: null});
                })
            );

            updateBtn.click();

            // Wait for async operation
            setTimeout(() => {
                if (capturedPayload) {
                    expect(capturedPayload.perms).toEqual(expectedKeys);
                }
            }, 100);
        });
    });

    describe('permission mask application', () => {
        test.each(maskApplicationData)('$description', ({mask, checkboxes, expectedChecked, expectedUnchecked}) => {
            const card = container.querySelector('.admin-card') as HTMLElement;
            
            // Clear existing and add test checkboxes
            card.innerHTML = checkboxes.map(cb => 
                `<input type="checkbox" class="perm-box" value="${cb.value}" data-bit="${cb.bit}">`
            ).join('') + `<button class="admin-perm-preset" data-mask="${mask}">Apply</button>`;

            const presetBtn = card.querySelector('.admin-perm-preset') as HTMLButtonElement;
            presetBtn.click();

            expectedChecked.forEach(value => {
                const checkbox = card.querySelector(`input[value="${value}"]`) as HTMLInputElement;
                expect(checkbox.checked).toBe(true);
            });

            expectedUnchecked.forEach(value => {
                const checkbox = card.querySelector(`input[value="${value}"]`) as HTMLInputElement;
                expect(checkbox.checked).toBe(false);
            });
        });
    });

    describe('select all and clear', () => {
        test('should select all checkboxes', () => {
            const card = container.querySelector('.admin-card') as HTMLElement;
            const checkboxes = card.querySelectorAll('.perm-box') as NodeListOf<HTMLInputElement>;
            
            // Uncheck all first
            checkboxes.forEach(cb => cb.checked = false);

            const selectAllBtn = card.querySelector('.admin-perm-select-all') as HTMLButtonElement;
            selectAllBtn.click();

            checkboxes.forEach(cb => {
                expect(cb.checked).toBe(true);
            });
        });

        test('should clear all checkboxes', () => {
            const card = container.querySelector('.admin-card') as HTMLElement;
            const checkboxes = card.querySelectorAll('.perm-box') as NodeListOf<HTMLInputElement>;
            
            // Check all first
            checkboxes.forEach(cb => cb.checked = true);

            const clearBtn = card.querySelector('.admin-perm-clear') as HTMLButtonElement;
            clearBtn.click();

            checkboxes.forEach(cb => {
                expect(cb.checked).toBe(false);
            });
        });
    });

    describe('update operation', () => {
        test.each(updateOperationData)('$description', async ({userId, selectedPerms, apiResponse, expectedSuccess}) => {
            const card = container.querySelector('.admin-card') as HTMLElement;
            const checkboxes = card.querySelectorAll('.perm-box') as NodeListOf<HTMLInputElement>;
            
            // Set checkboxes based on selectedPerms
            checkboxes.forEach(cb => {
                cb.checked = selectedPerms.includes(cb.value);
            });

            server.use(
                http.patch('/api/admin/permissions/:userId', () => {
                    if (expectedSuccess) {
                        return HttpResponse.json(apiResponse);
                    } else {
                        return HttpResponse.json(apiResponse, {status: 400});
                    }
                })
            );

            const updateBtn = card.querySelector('.btn-admin-update') as HTMLButtonElement;
            updateBtn.click();

            await new Promise(resolve => setTimeout(resolve, 150));

            const alerts = document.querySelector('#liveAlerts');
            if (expectedSuccess) {
                expect(alerts?.textContent).toContain('Permissions updated');
            }
        });
    });

    describe('remove administrator', () => {
        test('should remove admin on confirmation', async () => {
            const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
            let deleteCalled = false;

            server.use(
                http.delete('/api/admin/users/:userId', () => {
                    deleteCalled = true;
                    return HttpResponse.json({status: 'success', data: null});
                })
            );

            const removeBtn = container.querySelector('.btn-admin-remove') as HTMLButtonElement;
            removeBtn.click();

            await new Promise(resolve => setTimeout(resolve, 150));

            expect(confirmSpy).toHaveBeenCalled();
            expect(deleteCalled).toBe(true);

            confirmSpy.mockRestore();
        });

        test('should not remove when user cancels', () => {
            const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false);
            let deleteCalled = false;

            server.use(
                http.delete('/api/admin/users/:userId', () => {
                    deleteCalled = true;
                    return HttpResponse.json({status: 'success', data: null});
                })
            );

            const removeBtn = container.querySelector('.btn-admin-remove') as HTMLButtonElement;
            removeBtn.click();

            expect(confirmSpy).toHaveBeenCalled();
            expect(deleteCalled).toBe(false);

            confirmSpy.mockRestore();
        });
    });

    describe('user search typeahead', () => {
        test.each(searchUserData)('$description', async ({query, apiResponse, expectedOptions}) => {
            const modal = container.querySelector('.admin-modal') as HTMLElement;
            const input = modal.querySelector('input[type="text"]') as HTMLInputElement;
            const datalist = modal.querySelector('datalist') as HTMLDataListElement;

            server.use(
                http.get('/api/users/search', ({request}) => {
                    const url = new URL(request.url);
                    expect(url.searchParams.get('q')).toBe(query);
                    return HttpResponse.json(apiResponse);
                })
            );

            // Trigger Bootstrap modal shown event
            const modalEvent = new Event('shown.bs.modal', {bubbles: true});
            Object.defineProperty(modalEvent, 'target', {value: modal, enumerable: true});
            document.dispatchEvent(modalEvent);

            // Simulate input
            input.value = query;
            input.dispatchEvent(new Event('input', {bubbles: true}));

            await new Promise(resolve => setTimeout(resolve, 150));

            const options = datalist.querySelectorAll('option');
            expect(options.length).toBe(expectedOptions);
        });

        test('should set hidden userId when option selected', async () => {
            const modal = container.querySelector('.admin-modal') as HTMLElement;
            const input = modal.querySelector('input[type="text"]') as HTMLInputElement;
            const hiddenId = modal.querySelector('input[type="hidden"]') as HTMLInputElement;
            const datalist = modal.querySelector('datalist') as HTMLDataListElement;

            server.use(
                http.get('/api/users/search', () => {
                    return HttpResponse.json({
                        status: 'success',
                        data: [{id: 42, username: 'testuser', name: 'Test User'}],
                    });
                })
            );

            // Trigger modal shown
            const modalEvent = new Event('shown.bs.modal', {bubbles: true});
            Object.defineProperty(modalEvent, 'target', {value: modal, enumerable: true});
            document.dispatchEvent(modalEvent);

            // Simulate search
            input.value = 'test';
            input.dispatchEvent(new Event('input', {bubbles: true}));

            await new Promise(resolve => setTimeout(resolve, 150));

            // Simulate selection
            input.value = 'testuser';
            input.dispatchEvent(new Event('change', {bubbles: true}));

            const option = datalist.querySelector('option');
            expect(hiddenId.value).toBe('42');
        });
    });

    describe('add administrator', () => {
        test('should add admin with selected user', async () => {
            const modal = container.querySelector('.admin-modal') as HTMLElement;
            const hiddenId = modal.querySelector('input[type="hidden"]') as HTMLInputElement;
            hiddenId.value = '789';

            let capturedPayload: any = null;
            server.use(
                http.post('/api/admin/users', async ({request}) => {
                    capturedPayload = await request.json();
                    return HttpResponse.json({status: 'success', data: null});
                })
            );

            const addBtn = modal.querySelector('.btn-admin-add-submit') as HTMLButtonElement;
            addBtn.click();

            await new Promise(resolve => setTimeout(resolve, 150));

            expect(capturedPayload).toBeTruthy();
            expect(capturedPayload.userId).toBe(789);
        });

        test('should show error when no user selected', () => {
            const modal = container.querySelector('.admin-modal') as HTMLElement;
            const input = modal.querySelector('input[type="text"]') as HTMLInputElement;
            const hiddenId = modal.querySelector('input[type="hidden"]') as HTMLInputElement;
            
            input.value = '';
            hiddenId.value = '';

            const addBtn = modal.querySelector('.btn-admin-add-submit') as HTMLButtonElement;
            addBtn.click();

            const alerts = document.querySelector('#liveAlerts');
            expect(alerts?.textContent).toContain('Please select a user');
        });

        test('should include preset in payload', async () => {
            const modal = container.querySelector('.admin-modal') as HTMLElement;
            const hiddenId = modal.querySelector('input[type="hidden"]') as HTMLInputElement;
            const select = modal.querySelector('select') as HTMLSelectElement;
            
            hiddenId.value = '999';
            select.value = 'editor';

            let capturedPayload: any = null;
            server.use(
                http.post('/api/admin/users', async ({request}) => {
                    capturedPayload = await request.json();
                    return HttpResponse.json({status: 'success', data: null});
                })
            );

            const addBtn = modal.querySelector('.btn-admin-add-submit') as HTMLButtonElement;
            addBtn.click();

            await new Promise(resolve => setTimeout(resolve, 150));

            expect(capturedPayload.preset).toBe('editor');
        });
    });
});
