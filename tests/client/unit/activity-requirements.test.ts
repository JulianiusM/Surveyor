/**
 * Tests for activity-requirements module
 * Tests requirements panel initialization and management
 */

import {initRequirementPanel} from '../../../src/public/js/modules/activity-requirements';
import * as http from '../../../src/public/js/core/http';
import * as alerts from '../../../src/public/js/shared/alerts';
import * as activityRoles from '../../../src/public/js/modules/activity-roles';
import {activityRequirementsData} from '../data/activityRequirementsData';
import {setupTest} from '../helpers/testSetup';

// Mock dependencies
jest.mock('../../../src/public/js/core/http');
jest.mock('../../../src/public/js/shared/alerts');
jest.mock('../../../src/public/js/modules/activity-roles');

const mockGet = http.get as jest.MockedFunction<typeof http.get>;
const mockPost = http.post as jest.MockedFunction<typeof http.post>;
const mockShowInlineAlert = alerts.showInlineAlert as jest.MockedFunction<typeof alerts.showInlineAlert>;
const mockGetAllRoles = activityRoles.getAllRoles as jest.MockedFunction<typeof activityRoles.getAllRoles>;

describe('activity-requirements module', () => {
    setupTest({
        beforeEach: () => {
            mockGetAllRoles.mockReturnValue([
                {id: 1, name: 'Driver', label: 'Driver', color: '#ff0000'},
                {id: 2, name: 'Navigator', label: 'Navigator', color: '#00ff00'}
            ]);
        }
    });

    describe('initRequirementPanel - setup', () => {
        test.each(activityRequirementsData.initSetup.invalid)('$description', ({planId, html}) => {
            document.body.innerHTML = html;
            mockGet.mockClear(); // Clear any previous calls
            
            // Should not throw when panel missing or incomplete
            expect(() => initRequirementPanel(planId)).not.toThrow();
            
            // If panel exists (even if empty), it will call loadRequirements which calls the API
            // If panel doesn't exist at all, it returns early and doesn't call API
            const panelExists = document.getElementById('requirementPanel') !== null;
            if (panelExists) {
                expect(mockGet).toHaveBeenCalledWith(`/api/activity/${planId}/requirements`);
            } else {
                expect(mockGet).not.toHaveBeenCalled();
            }
        });

        test.each(activityRequirementsData.initSetup.valid)('$description', async ({planId, html, mockData}) => {
            document.body.innerHTML = html;
            mockGet.mockResolvedValue({data: mockData});
            
            initRequirementPanel(planId);
            
            // Wait for async load
            await new Promise(resolve => setTimeout(resolve, 10));
            
            // Should make API call to load requirements
            expect(mockGet).toHaveBeenCalledWith(`/api/activity/${planId}/requirements`);
        });
    });

    describe('requirements loading', () => {
        test.each(activityRequirementsData.loading.success)('$description', async ({planId, html, mockData, expectedAlertText}) => {
            document.body.innerHTML = html;
            mockGet.mockResolvedValue({data: mockData});
            
            initRequirementPanel(planId);
            
            // Wait for async load
            await new Promise(resolve => setTimeout(resolve, 10));
            
            const alertBox = document.querySelector('[data-requirements-alert]');
            if (alertBox) {
                expect(alertBox.textContent).toContain(expectedAlertText);
            }
        });

        test.each(activityRequirementsData.loading.error)('$description', async ({planId, html, errorMessage}) => {
            document.body.innerHTML = html;
            mockGet.mockRejectedValue(new Error(errorMessage));
            
            initRequirementPanel(planId);
            
            // Wait for async load
            await new Promise(resolve => setTimeout(resolve, 10));
            
            const alertBox = document.querySelector('[data-requirements-alert]');
            if (alertBox) {
                expect(alertBox.classList.contains('alert-danger')).toBe(true);
            }
        });
    });

    describe('role requirements rendering', () => {
        test.each(activityRequirementsData.roleRequirements.render)('$description', async ({planId, html, mockData, expectedInputs}) => {
            document.body.innerHTML = html;
            mockGet.mockResolvedValue({data: mockData});
            
            initRequirementPanel(planId);
            
            // Wait for async load and rendering
            await new Promise(resolve => setTimeout(resolve, 10));
            
            const roleList = document.getElementById('roleRequirementList');
            const inputs = roleList?.querySelectorAll<HTMLInputElement>('input[data-role-id]');
            
            expect(inputs?.length).toBe(expectedInputs);
        });
    });

    describe('overrides rendering', () => {
        test.each(activityRequirementsData.overrides.render)('$description', async ({planId, html, mockData, hasEmptyState, expectedRows}) => {
            document.body.innerHTML = html;
            mockGet.mockResolvedValue({data: mockData});
            
            initRequirementPanel(planId);
            
            // Wait for async load and rendering
            await new Promise(resolve => setTimeout(resolve, 10));
            
            const overrideList = document.getElementById('overrideList');
            
            if (hasEmptyState) {
                const emptyState = overrideList?.querySelector('[data-empty-state]');
                expect(emptyState).toBeTruthy();
            } else {
                const rows = overrideList?.querySelectorAll('.override-row');
                expect(rows?.length).toBe(expectedRows);
            }
        });

        test.each(activityRequirementsData.overrides.addOverride)('$description', async ({planId, html, mockData}) => {
            document.body.innerHTML = html;
            mockGet.mockResolvedValue({data: mockData});
            
            initRequirementPanel(planId);
            
            // Wait for async load
            await new Promise(resolve => setTimeout(resolve, 10));
            
            const addBtn = document.querySelector('[data-add-override]') as HTMLButtonElement;
            const overrideList = document.getElementById('overrideList');
            
            const initialRows = overrideList?.querySelectorAll('.override-row').length || 0;
            
            // Click add button
            addBtn?.click();
            
            const finalRows = overrideList?.querySelectorAll('.override-row').length || 0;
            expect(finalRows).toBeGreaterThan(initialRows);
        });

        test.each(activityRequirementsData.overrides.removeOverride)('$description', async ({planId, html, mockData}) => {
            document.body.innerHTML = html;
            mockGet.mockResolvedValue({data: mockData});
            
            initRequirementPanel(planId);
            
            // Wait for async load
            await new Promise(resolve => setTimeout(resolve, 10));
            
            const overrideList = document.getElementById('overrideList');
            const initialRows = overrideList?.querySelectorAll('.override-row').length || 0;
            
            if (initialRows > 0) {
                // Click remove button on first row
                const removeBtn = overrideList?.querySelector('.override-row button') as HTMLButtonElement;
                removeBtn?.click();
                
                const finalRows = overrideList?.querySelectorAll('.override-row').length || 0;
                expect(finalRows).toBe(initialRows - 1);
            }
        });
    });

    describe('summary statistics', () => {
        test.each(activityRequirementsData.summary.stats)('$description', async ({planId, html, mockData, expectedBadges}) => {
            document.body.innerHTML = html;
            mockGet.mockResolvedValue({data: mockData});
            
            initRequirementPanel(planId);
            
            // Wait for async load and rendering
            await new Promise(resolve => setTimeout(resolve, 10));
            
            const summaryStats = document.getElementById('requirementSummaryStats');
            const badges = summaryStats?.querySelectorAll('.badge');
            
            expect(badges?.length).toBe(expectedBadges);
        });

        test.each(activityRequirementsData.summary.table)('$description', async ({planId, html, mockData, expectedRows}) => {
            document.body.innerHTML = html;
            mockGet.mockResolvedValue({data: mockData});
            
            initRequirementPanel(planId);
            
            // Wait for async load and rendering
            await new Promise(resolve => setTimeout(resolve, 10));
            
            const summaryBody = document.getElementById('requirementSummaryBody');
            const rows = summaryBody?.querySelectorAll('tr');
            
            expect(rows?.length).toBe(expectedRows);
        });
    });

    describe('save requirements', () => {
        test.each(activityRequirementsData.save.success)('$description', async ({planId, html, mockData, expectedPayload}) => {
            document.body.innerHTML = html;
            mockGet.mockResolvedValue({data: mockData});
            mockPost.mockResolvedValue({});
            
            initRequirementPanel(planId);
            
            // Wait for initial load
            await new Promise(resolve => setTimeout(resolve, 10));
            
            // Click save button
            const saveBtn = document.querySelector('[data-requirements-save]') as HTMLButtonElement;
            saveBtn?.click();
            
            // Wait for async save
            await new Promise(resolve => setTimeout(resolve, 10));
            
            // Should call API with correct endpoint
            expect(mockPost).toHaveBeenCalledWith(
                `/api/activity/${planId}/requirements`,
                expect.objectContaining(expectedPayload)
            );
            
            // Should show success message
            expect(mockShowInlineAlert).toHaveBeenCalledWith('success', expect.any(String));
        });

        test.each(activityRequirementsData.save.error)('$description', async ({planId, html, mockData, errorMessage}) => {
            document.body.innerHTML = html;
            mockGet.mockResolvedValue({data: mockData});
            mockPost.mockRejectedValue(new Error(errorMessage));
            
            initRequirementPanel(planId);
            
            // Wait for initial load
            await new Promise(resolve => setTimeout(resolve, 10));
            
            // Click save button
            const saveBtn = document.querySelector('[data-requirements-save]') as HTMLButtonElement;
            saveBtn?.click();
            
            // Wait for async save
            await new Promise(resolve => setTimeout(resolve, 10));
            
            // Should show error message
            expect(mockShowInlineAlert).toHaveBeenCalledWith('error', expect.any(String));
            
            const alertBox = document.querySelector('[data-requirements-alert]');
            expect(alertBox?.classList.contains('alert-danger')).toBe(true);
        });
    });

    describe('reload requirements', () => {
        test.each(activityRequirementsData.reload)('$description', async ({planId, html, mockData}) => {
            document.body.innerHTML = html;
            mockGet.mockResolvedValue({data: mockData});
            
            initRequirementPanel(planId);
            
            // Wait for initial load
            await new Promise(resolve => setTimeout(resolve, 10));
            
            // Clear mock calls
            mockGet.mockClear();
            
            // Click reload button
            const reloadBtn = document.querySelector('[data-requirements-refresh]') as HTMLButtonElement;
            reloadBtn?.click();
            
            // Wait for reload
            await new Promise(resolve => setTimeout(resolve, 10));
            
            // Should make another API call
            expect(mockGet).toHaveBeenCalledWith(`/api/activity/${planId}/requirements`);
        });
    });
});
