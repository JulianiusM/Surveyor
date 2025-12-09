/**
 * Tests for activity-recommendations.ts
 * Testing recommendations panel functionality
 */

import {initRecommendationPanel} from '../../../src/public/js/modules/activity-recommendations';
import {activityRecommendationsData as testData} from '../data/activityRecommendationsData';
import * as http from '../../../src/public/js/core/http';
import * as alerts from '../../../src/public/js/shared/alerts';
import * as uiHelpers from '../../../src/public/js/shared/ui-helpers';
import * as activityAssignments from '../../../src/public/js/modules/activity-assignments';

// Mock dependencies
jest.mock('../../../src/public/js/core/http');
jest.mock('../../../src/public/js/shared/alerts');
jest.mock('../../../src/public/js/shared/ui-helpers');
jest.mock('../../../src/public/js/modules/activity-assignments');

describe('activity-recommendations', () => {
    let mockGet: jest.SpyInstance;
    let mockPost: jest.SpyInstance;
    const mockDescribeSlot = jest.fn((slotId: string) => `Slot ${slotId}`);

    beforeEach(() => {
        document.body.innerHTML = '';
        jest.clearAllMocks();

        mockGet = jest.spyOn(http, 'get');
        mockPost = jest.spyOn(http, 'post');
        jest.spyOn(alerts, 'showInlineAlert').mockImplementation();
        jest.spyOn(uiHelpers, 'reloadAfterDelay').mockImplementation();
        jest.spyOn(activityAssignments, 'describeWarning').mockReturnValue('Warning description');

        const panel = document.createElement('div');
        panel.id = 'recommendationPanel';

        const rows = document.createElement('tbody');
        rows.id = 'recommendationRows';

        const alertBox = document.createElement('div');
        alertBox.dataset.recommendationsAlert = 'true';
        alertBox.classList.add('d-none');
        const alertSpan = document.createElement('span');
        alertBox.append(alertSpan);

        const refreshBtn = document.createElement('button');
        refreshBtn.dataset.recommendationsRefresh = 'true';

        const autoBtn = document.createElement('button');
        autoBtn.dataset.recommendationsAuto = 'true';

        const saveBtn = document.createElement('button');
        saveBtn.dataset.recommendationsSave = 'true';

        const applyBtn = document.createElement('button');
        applyBtn.dataset.recommendationsApply = 'true';

        const summaryStats = document.createElement('div');
        summaryStats.id = 'recommendationSummaryStats';

        panel.append(rows, alertBox, refreshBtn, autoBtn, saveBtn, applyBtn, summaryStats);
        document.body.append(panel);
    });

    describe('initialization', () => {
        test('should not initialize without planId', () => {
            mockGet.mockResolvedValue(testData.apiResponses.loadSuccess);
            initRecommendationPanel('', mockDescribeSlot);
            expect(mockGet).not.toHaveBeenCalled();
        });

        test('should not initialize without panel element', () => {
            document.body.innerHTML = '';
            mockGet.mockResolvedValue(testData.apiResponses.loadSuccess);
            initRecommendationPanel(testData.initialization.valid.planId, mockDescribeSlot);
            expect(mockGet).not.toHaveBeenCalled();
        });

        test('should initialize and load recommendations', async () => {
            mockGet.mockResolvedValue(testData.apiResponses.loadSuccess);
            initRecommendationPanel(testData.initialization.valid.planId, mockDescribeSlot);
            
            await new Promise((resolve) => setTimeout(resolve, 100));

            expect(mockGet).toHaveBeenCalledWith(
                `/api/activity/${testData.initialization.valid.planId}/recommendations`
            );
        });
    });

    describe('loading recommendations', () => {
        test('should display empty state when no recommendations', async () => {
            mockGet.mockResolvedValue({
                data: {
                    recommendations: testData.recommendations.empty,
                    warnings: [],
                    slots: [],
                    participants: [],
                },
            });

            initRecommendationPanel(testData.initialization.valid.planId, mockDescribeSlot);
            await new Promise((resolve) => setTimeout(resolve, 100));

            const rows = document.getElementById('recommendationRows')!;
            expect(rows.textContent).toContain('No recommendations yet');
        });

        test('should render single recommendation', async () => {
            mockGet.mockResolvedValue({
                data: {
                    recommendations: testData.recommendations.single,
                    warnings: [],
                    slots: testData.slots,
                    participants: testData.participants,
                },
            });

            initRecommendationPanel(testData.initialization.valid.planId, mockDescribeSlot);
            await new Promise((resolve) => setTimeout(resolve, 100));

            const rows = document.getElementById('recommendationRows')!;
            expect(rows.querySelectorAll('tr[data-slot-id]')).toHaveLength(1);
        });

        test('should render multiple recommendations with different statuses', async () => {
            mockGet.mockResolvedValue({
                data: {
                    recommendations: testData.recommendations.multiple,
                    warnings: [],
                    slots: testData.slots,
                    participants: testData.participants,
                },
            });

            initRecommendationPanel(testData.initialization.valid.planId, mockDescribeSlot);
            await new Promise((resolve) => setTimeout(resolve, 100));

            const rows = document.getElementById('recommendationRows')!;
            expect(rows.querySelectorAll('tr[data-slot-id]')).toHaveLength(4);
        });

        test('should display alert for auto-generated recommendations', async () => {
            mockGet.mockResolvedValue({
                data: {
                    ...testData.apiResponses.loadSuccessAutoGenerated.data,
                    recommendations: testData.recommendations.single,
                },
            });

            initRecommendationPanel(testData.initialization.valid.planId, mockDescribeSlot);
            await new Promise((resolve) => setTimeout(resolve, 100));

            expect(alerts.showInlineAlert).toHaveBeenCalledWith(
                'info',
                expect.stringContaining('auto-generated')
            );
        });

        test('should handle load error', async () => {
            mockGet.mockRejectedValue(new Error('Network error'));

            initRecommendationPanel(testData.initialization.valid.planId, mockDescribeSlot);
            await new Promise((resolve) => setTimeout(resolve, 100));

            const alertBox = document.querySelector('[data-recommendations-alert]')!;
            expect(alertBox.classList.contains('d-none')).toBe(false);
            expect(alertBox.textContent).toContain('Failed to load recommendations');
            expect(alerts.showInlineAlert).toHaveBeenCalledWith('error', expect.any(String));
        });
    });

    describe('summary statistics', () => {
        test('should display empty state when no recommendations', async () => {
            mockGet.mockResolvedValue({
                data: {
                    recommendations: testData.recommendations.empty,
                    warnings: [],
                    slots: [],
                    participants: [],
                },
            });

            initRecommendationPanel(testData.initialization.valid.planId, mockDescribeSlot);
            await new Promise((resolve) => setTimeout(resolve, 100));

            const summaryStats = document.getElementById('recommendationSummaryStats')!;
            expect(summaryStats.textContent).toContain('No recommendations loaded');
        });

        test('should display summary with counts for each status', async () => {
            mockGet.mockResolvedValue({
                data: {
                    recommendations: testData.recommendations.multiple,
                    warnings: [],
                    slots: testData.slots,
                    participants: testData.participants,
                },
            });

            initRecommendationPanel(testData.initialization.valid.planId, mockDescribeSlot);
            await new Promise((resolve) => setTimeout(resolve, 100));

            const summaryStats = document.getElementById('recommendationSummaryStats')!;
            expect(summaryStats.textContent).toContain('Pending');
            expect(summaryStats.textContent).toContain('Approved');
            expect(summaryStats.textContent).toContain('Rejected');
            expect(summaryStats.textContent).toContain('Applied');
        });
    });

    describe('warnings', () => {
        test('should display warnings for recommendations', async () => {
            mockGet.mockResolvedValue({
                data: {
                    recommendations: testData.recommendations.single,
                    warnings: testData.warnings.single,
                    slots: testData.slots,
                    participants: testData.participants,
                },
            });

            initRecommendationPanel(testData.initialization.valid.planId, mockDescribeSlot);
            await new Promise((resolve) => setTimeout(resolve, 100));

            expect(activityAssignments.describeWarning).toHaveBeenCalled();
        });

        test('should show "No warnings" for clean recommendations', async () => {
            mockGet.mockResolvedValue({
                data: {
                    recommendations: testData.recommendations.single,
                    warnings: testData.warnings.empty,
                    slots: testData.slots,
                    participants: testData.participants,
                },
            });

            initRecommendationPanel(testData.initialization.valid.planId, mockDescribeSlot);
            await new Promise((resolve) => setTimeout(resolve, 100));

            const rows = document.getElementById('recommendationRows')!;
            const warningCell = rows.querySelector('td[data-warning]');
            expect(warningCell?.textContent).toContain('No warnings');
        });

        test('should show "Save to refresh warnings" for dirty rows', async () => {
            mockGet.mockResolvedValue({
                data: {
                    recommendations: testData.recommendations.single,
                    warnings: [],
                    slots: testData.slots,
                    participants: testData.participants,
                },
            });

            initRecommendationPanel(testData.initialization.valid.planId, mockDescribeSlot);
            await new Promise((resolve) => setTimeout(resolve, 100));

            const rows = document.getElementById('recommendationRows')!;
            const row = rows.querySelector('tr[data-slot-id]') as HTMLElement;
            const slotSelect = row.querySelector('select') as HTMLSelectElement;
            
            // Change selection to mark as dirty
            slotSelect.dispatchEvent(new Event('change'));

            const warningCell = row.querySelector('td[data-warning]');
            expect(warningCell?.textContent).toContain('Save to refresh warnings');
        });
    });

    describe('recommendation editing', () => {
        test('should mark row as dirty when slot changes', async () => {
            mockGet.mockResolvedValue({
                data: {
                    recommendations: testData.recommendations.single,
                    warnings: [],
                    slots: testData.slots,
                    participants: testData.participants,
                },
            });

            initRecommendationPanel(testData.initialization.valid.planId, mockDescribeSlot);
            await new Promise((resolve) => setTimeout(resolve, 100));

            const rows = document.getElementById('recommendationRows')!;
            const row = rows.querySelector('tr[data-slot-id]') as HTMLElement;
            const slotSelect = row.querySelector('select') as HTMLSelectElement;
            
            slotSelect.dispatchEvent(new Event('change'));

            expect(row.dataset.dirty).toBe('true');
            expect(row.classList.contains('table-warning')).toBe(true);
        });

        test('should mark row as dirty when participant changes', async () => {
            mockGet.mockResolvedValue({
                data: {
                    recommendations: testData.recommendations.single,
                    warnings: [],
                    slots: testData.slots,
                    participants: testData.participants,
                },
            });

            initRecommendationPanel(testData.initialization.valid.planId, mockDescribeSlot);
            await new Promise((resolve) => setTimeout(resolve, 100));

            const rows = document.getElementById('recommendationRows')!;
            const row = rows.querySelector('tr[data-slot-id]') as HTMLElement;
            const participantSelect = row.querySelectorAll('select')[1] as HTMLSelectElement;
            
            participantSelect.dispatchEvent(new Event('change'));

            expect(row.dataset.dirty).toBe('true');
        });

        test('should mark row as dirty when status changes', async () => {
            mockGet.mockResolvedValue({
                data: {
                    recommendations: testData.recommendations.single,
                    warnings: [],
                    slots: testData.slots,
                    participants: testData.participants,
                },
            });

            initRecommendationPanel(testData.initialization.valid.planId, mockDescribeSlot);
            await new Promise((resolve) => setTimeout(resolve, 100));

            const rows = document.getElementById('recommendationRows')!;
            const row = rows.querySelector('tr[data-slot-id]') as HTMLElement;
            const statusSelect = row.querySelector('[data-rec-status]') as HTMLSelectElement;
            
            statusSelect.dispatchEvent(new Event('change'));

            expect(row.dataset.dirty).toBe('true');
        });

        test('should disable status select for APPLIED recommendations', async () => {
            mockGet.mockResolvedValue({
                data: {
                    recommendations: testData.recommendations.multiple,
                    warnings: [],
                    slots: testData.slots,
                    participants: testData.participants,
                },
            });

            initRecommendationPanel(testData.initialization.valid.planId, mockDescribeSlot);
            await new Promise((resolve) => setTimeout(resolve, 100));

            const rows = document.getElementById('recommendationRows')!;
            const allRows = Array.from(rows.querySelectorAll('tr[data-slot-id]'));
            
            // Find the APPLIED row (4th recommendation in testData)
            const appliedRow = allRows[3];
            const statusSelect = appliedRow?.querySelector('[data-rec-status]') as HTMLSelectElement;
            
            expect(statusSelect?.disabled).toBe(true);
        });
    });

    describe('saving recommendations', () => {
        test('should save recommendations successfully', async () => {
            mockGet.mockResolvedValue({
                data: {
                    recommendations: testData.recommendations.single,
                    warnings: [],
                    slots: testData.slots,
                    participants: testData.participants,
                },
            });
            mockPost.mockResolvedValue(testData.apiResponses.saveSuccess);

            initRecommendationPanel(testData.initialization.valid.planId, mockDescribeSlot);
            await new Promise((resolve) => setTimeout(resolve, 100));

            const saveBtn = document.querySelector('[data-recommendations-save]') as HTMLButtonElement;
            saveBtn?.click();

            await new Promise((resolve) => setTimeout(resolve, 100));

            expect(mockPost).toHaveBeenCalledWith(
                `/api/activity/${testData.initialization.valid.planId}/recommendations`,
                expect.objectContaining({
                    recommendations: expect.any(Array),
                })
            );
            expect(alerts.showInlineAlert).toHaveBeenCalledWith('success', 'Recommendations saved');
        });

        test('should handle save error', async () => {
            mockGet.mockResolvedValue({
                data: {
                    recommendations: testData.recommendations.single,
                    warnings: [],
                    slots: testData.slots,
                    participants: testData.participants,
                },
            });
            mockPost.mockRejectedValue(new Error('Save failed'));

            initRecommendationPanel(testData.initialization.valid.planId, mockDescribeSlot);
            await new Promise((resolve) => setTimeout(resolve, 100));

            const saveBtn = document.querySelector('[data-recommendations-save]') as HTMLButtonElement;
            saveBtn?.click();

            await new Promise((resolve) => setTimeout(resolve, 100));

            expect(alerts.showInlineAlert).toHaveBeenCalledWith('error', expect.any(String));
        });
    });

    describe('auto-generating recommendations', () => {
        test('should auto-generate recommendations successfully', async () => {
            mockGet.mockResolvedValue({
                data: {
                    recommendations: testData.recommendations.empty,
                    warnings: [],
                    slots: testData.slots,
                    participants: testData.participants,
                },
            });
            mockPost.mockResolvedValue(testData.apiResponses.autoSuccess);

            initRecommendationPanel(testData.initialization.valid.planId, mockDescribeSlot);
            await new Promise((resolve) => setTimeout(resolve, 100));

            const autoBtn = document.querySelector('[data-recommendations-auto]') as HTMLButtonElement;
            autoBtn?.click();

            await new Promise((resolve) => setTimeout(resolve, 100));

            expect(mockPost).toHaveBeenCalledWith(
                `/api/activity/${testData.initialization.valid.planId}/recommendations/auto`,
                {}
            );
            expect(alerts.showInlineAlert).toHaveBeenCalledWith('success', 'Recommendations generated');
        });

        test('should handle auto-generate error', async () => {
            mockGet.mockResolvedValue({
                data: {
                    recommendations: testData.recommendations.empty,
                    warnings: [],
                    slots: testData.slots,
                    participants: testData.participants,
                },
            });
            mockPost.mockRejectedValue(new Error('Generation failed'));

            initRecommendationPanel(testData.initialization.valid.planId, mockDescribeSlot);
            await new Promise((resolve) => setTimeout(resolve, 100));

            const autoBtn = document.querySelector('[data-recommendations-auto]') as HTMLButtonElement;
            autoBtn?.click();

            await new Promise((resolve) => setTimeout(resolve, 100));

            expect(alerts.showInlineAlert).toHaveBeenCalledWith('error', expect.any(String));
        });
    });

    describe('applying recommendations', () => {
        test('should apply recommendations successfully', async () => {
            mockGet.mockResolvedValue({
                data: {
                    recommendations: testData.recommendations.single,
                    warnings: [],
                    slots: testData.slots,
                    participants: testData.participants,
                },
            });
            mockPost.mockResolvedValue(testData.apiResponses.applySuccess);

            initRecommendationPanel(testData.initialization.valid.planId, mockDescribeSlot);
            await new Promise((resolve) => setTimeout(resolve, 100));

            const applyBtn = document.querySelector('[data-recommendations-apply]') as HTMLButtonElement;
            applyBtn?.click();

            await new Promise((resolve) => setTimeout(resolve, 100));

            expect(mockPost).toHaveBeenCalledWith(
                `/api/activity/${testData.initialization.valid.planId}/recommendations/apply`,
                {}
            );
            expect(uiHelpers.reloadAfterDelay).toHaveBeenCalled();
        });

        test('should handle apply error', async () => {
            mockGet.mockResolvedValue({
                data: {
                    recommendations: testData.recommendations.single,
                    warnings: [],
                    slots: testData.slots,
                    participants: testData.participants,
                },
            });
            mockPost.mockRejectedValue(new Error('Apply failed'));

            initRecommendationPanel(testData.initialization.valid.planId, mockDescribeSlot);
            await new Promise((resolve) => setTimeout(resolve, 100));

            const applyBtn = document.querySelector('[data-recommendations-apply]') as HTMLButtonElement;
            applyBtn?.click();

            await new Promise((resolve) => setTimeout(resolve, 100));

            expect(alerts.showInlineAlert).toHaveBeenCalledWith('error', expect.any(String));
            expect(uiHelpers.reloadAfterDelay).not.toHaveBeenCalled();
        });

        test('should store active tab before reload', async () => {
            // Create active tab element
            const activeTab = document.createElement('a');
            activeTab.className = 'nav-link active';
            activeTab.dataset.bsTarget = '#testTab';
            document.body.append(activeTab);

            mockGet.mockResolvedValue({
                data: {
                    recommendations: testData.recommendations.single,
                    warnings: [],
                    slots: testData.slots,
                    participants: testData.participants,
                },
            });
            mockPost.mockResolvedValue(testData.apiResponses.applySuccess);

            initRecommendationPanel(testData.initialization.valid.planId, mockDescribeSlot);
            await new Promise((resolve) => setTimeout(resolve, 100));

            const applyBtn = document.querySelector('[data-recommendations-apply]') as HTMLButtonElement;
            applyBtn?.click();

            await new Promise((resolve) => setTimeout(resolve, 100));

            expect(sessionStorage.getItem('activity-active-tab')).toBe('#testTab');
        });
    });

    describe('refresh button', () => {
        test('should reload recommendations when clicked', async () => {
            mockGet.mockResolvedValue({
                data: {
                    recommendations: testData.recommendations.empty,
                    warnings: [],
                    slots: [],
                    participants: [],
                },
            });

            initRecommendationPanel(testData.initialization.valid.planId, mockDescribeSlot);
            await new Promise((resolve) => setTimeout(resolve, 100));

            mockGet.mockClear();
            mockGet.mockResolvedValue({
                data: {
                    recommendations: testData.recommendations.single,
                    warnings: [],
                    slots: testData.slots,
                    participants: testData.participants,
                },
            });

            const refreshBtn = document.querySelector('[data-recommendations-refresh]') as HTMLButtonElement;
            refreshBtn?.click();

            await new Promise((resolve) => setTimeout(resolve, 100));

            expect(mockGet).toHaveBeenCalledWith(
                `/api/activity/${testData.initialization.valid.planId}/recommendations`
            );
        });
    });
});
