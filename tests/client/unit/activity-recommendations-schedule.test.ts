/**
 * Tests for activity-recommendations-schedule.ts
 * Testing schedule-based recommendations view
 */

import {initRecommendationScheduleView, cleanupRecommendationScheduleView} from '../../../src/public/js/modules/activity-recommendations-schedule';
import {activityRecommendationsScheduleData as testData} from '../data/activityRecommendationsScheduleData';
import * as http from '../../../src/public/js/core/http';
import * as uiHelpers from '../../../src/public/js/shared/ui-helpers';
import {setupTest} from '../helpers/testSetup';

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
jest.mock('../../../src/public/js/core/http');
jest.mock('../../../src/public/js/shared/ui-helpers');

describe('activity-recommendations-schedule', () => {
    let mockGet: jest.SpyInstance;
    let mockPost: jest.SpyInstance;
    const mockDescribeSlot = jest.fn((slotId: string) => `Slot ${slotId}`);

    setupTest({
        beforeEach: () => {
            mockShow.mockClear();
            mockHide.mockClear();

            mockGet = jest.spyOn(http, 'get');
            mockPost = jest.spyOn(http, 'post');
            jest.spyOn(uiHelpers, 'reloadAfterDelay').mockImplementation();

            // setupTest() already cleared DOM, just create our structure
            // Create panel structure
            const panel = document.createElement('div');
            panel.id = 'recommendationPanel';

            const scheduleView = document.createElement('div');
            scheduleView.id = 'recommendationScheduleView';

            const alertBox = document.createElement('div');
            alertBox.dataset.recommendationsAlert = 'true';
            alertBox.classList.add('d-none');
            const alertSpan = document.createElement('span');
            alertBox.append(alertSpan);

            const refreshBtn = document.createElement('button');
            refreshBtn.dataset.recommendationsRefresh = 'true';

            const autoBtn = document.createElement('button');
            autoBtn.dataset.recommendationsAuto = 'true';

            const applyBtn = document.createElement('button');
            applyBtn.dataset.recommendationsApply = 'true';

            const summaryStats = document.createElement('div');
            summaryStats.id = 'recommendationSummaryStats';

            panel.append(scheduleView, alertBox, refreshBtn, autoBtn, applyBtn, summaryStats);
            document.body.append(panel);

            // Create add recommendation modal
            const addModal = document.createElement('div');
            addModal.id = 'addRecommendationModal';

            const addSlotIdInput = document.createElement('input');
            addSlotIdInput.id = 'addRecommendationSlotId';

            const addParticipantSelect = document.createElement('select');
            addParticipantSelect.id = 'addRecommendationParticipant';

            const addConfirmBtn = document.createElement('button');
            addConfirmBtn.id = 'addRecommendationConfirm';

            const addWarningBox = document.createElement('div');
            addWarningBox.dataset.addWarning = 'true';
            addWarningBox.classList.add('d-none');
            const warningSpan = document.createElement('span');
            addWarningBox.append(warningSpan);

            addModal.append(addSlotIdInput, addParticipantSelect, addConfirmBtn, addWarningBox);
            document.body.append(addModal);
        },
        afterEach: () => {
            // Call cleanup function to reset module state and remove event listeners
            cleanupRecommendationScheduleView();
            // Comprehensive cleanup: remove all dynamically created elements
            document.body.innerHTML = '';
        }
    });

    describe('initialization', () => {
        test('should not initialize without planId', () => {
            mockGet.mockResolvedValue(testData.apiResponses.loadSuccess);
            initRecommendationScheduleView('', mockDescribeSlot);
            expect(mockGet).not.toHaveBeenCalled();
        });

        test('should not initialize without schedule view element', () => {
            document.getElementById('recommendationScheduleView')?.remove();
            mockGet.mockResolvedValue(testData.apiResponses.loadSuccess);
            initRecommendationScheduleView(testData.initialization.valid.planId, mockDescribeSlot);
            expect(mockGet).not.toHaveBeenCalled();
        });

        test('should initialize and load recommendations', async () => {
            mockGet.mockResolvedValue(testData.apiResponses.loadSuccess);
            initRecommendationScheduleView(testData.initialization.valid.planId, mockDescribeSlot);
            
            await new Promise((resolve) => setTimeout(resolve, 100));

            expect(mockGet).toHaveBeenCalledWith(
                `/api/activity/${testData.initialization.valid.planId}/recommendations`
            );
        });

        test('should initialize Bootstrap modal', () => {
            mockGet.mockResolvedValue(testData.apiResponses.loadSuccess);
            initRecommendationScheduleView(testData.initialization.valid.planId, mockDescribeSlot);
            
            expect((global as any).bootstrap.Modal).toHaveBeenCalled();
        });
    });

    describe('loading recommendations', () => {
        test('should handle empty recommendations', async () => {
            mockGet.mockResolvedValue({
                data: {
                    recommendations: testData.recommendations.empty,
                    warnings: [],
                    slots: [],
                    participantOptions: [],
                },
            });

            initRecommendationScheduleView(testData.initialization.valid.planId, mockDescribeSlot);
            await new Promise((resolve) => setTimeout(resolve, 100));

            const summaryStats = document.getElementById('recommendationSummaryStats')!;
            expect(summaryStats.textContent).toContain('No recommendations loaded');
        });

        test('should render recommendations in schedule view', async () => {
            const scheduleView = document.getElementById('recommendationScheduleView')!;
            
            // Create slot container
            const slotContainer = document.createElement('div');
            slotContainer.dataset.slotRecommendations = 'slot1';
            scheduleView.append(slotContainer);

            mockGet.mockResolvedValue({
                data: {
                    recommendations: testData.recommendations.pending,
                    warnings: [],
                    slots: testData.slots,
                    participantOptions: testData.participants,
                },
            });

            initRecommendationScheduleView(testData.initialization.valid.planId, mockDescribeSlot);
            await new Promise((resolve) => setTimeout(resolve, 100));

            expect(slotContainer.children.length).toBeGreaterThan(0);
        });

        test('should handle load error', async () => {
            mockGet.mockRejectedValue(new Error('Network error'));

            initRecommendationScheduleView(testData.initialization.valid.planId, mockDescribeSlot);
            await new Promise((resolve) => setTimeout(resolve, 100));

            const alertBox = document.querySelector('[data-recommendations-alert]')!;
            expect(alertBox.classList.contains('d-none')).toBe(false);
            expect(alertBox.textContent).toContain('Failed to load recommendations');
        });
    });

    describe('summary statistics', () => {
        test('should display empty state when no recommendations', async () => {
            mockGet.mockResolvedValue({
                data: {
                    recommendations: testData.recommendations.empty,
                    warnings: [],
                    slots: [],
                    participantOptions: [],
                },
            });

            initRecommendationScheduleView(testData.initialization.valid.planId, mockDescribeSlot);
            await new Promise((resolve) => setTimeout(resolve, 100));

            const summaryStats = document.getElementById('recommendationSummaryStats')!;
            expect(summaryStats.textContent).toContain('No recommendations loaded');
        });

        test('should display summary with counts for each status', async () => {
            mockGet.mockResolvedValue({
                data: {
                    recommendations: testData.recommendations.mixed,
                    warnings: [],
                    slots: testData.slots,
                    participantOptions: testData.participants,
                },
            });

            initRecommendationScheduleView(testData.initialization.valid.planId, mockDescribeSlot);
            await new Promise((resolve) => setTimeout(resolve, 100));

            const summaryStats = document.getElementById('recommendationSummaryStats')!;
            expect(summaryStats.textContent).toContain('Pending');
            expect(summaryStats.textContent).toContain('Approved');
            expect(summaryStats.textContent).toContain('Rejected');
        });
    });

    describe('recommendation rendering', () => {
        beforeEach(() => {
            const scheduleView = document.getElementById('recommendationScheduleView')!;
            
            testData.slots.forEach((slot) => {
                const slotContainer = document.createElement('div');
                slotContainer.dataset.slotRecommendations = slot.id;
                scheduleView.append(slotContainer);
            });
        });

        test('should render pending recommendations with correct styling', async () => {
            mockGet.mockResolvedValue({
                data: {
                    recommendations: testData.recommendations.pending,
                    warnings: [],
                    slots: testData.slots,
                    participantOptions: testData.participants,
                },
            });

            initRecommendationScheduleView(testData.initialization.valid.planId, mockDescribeSlot);
            await new Promise((resolve) => setTimeout(resolve, 100));

            const container = document.querySelector('[data-slot-recommendations="slot1"]')!;
            const recDiv = container.querySelector('.border-warning');
            expect(recDiv).toBeTruthy();
        });

        test('should render approved recommendations with correct styling', async () => {
            mockGet.mockResolvedValue({
                data: {
                    recommendations: testData.recommendations.approved,
                    warnings: [],
                    slots: testData.slots,
                    participantOptions: testData.participants,
                },
            });

            initRecommendationScheduleView(testData.initialization.valid.planId, mockDescribeSlot);
            await new Promise((resolve) => setTimeout(resolve, 100));

            const container = document.querySelector('[data-slot-recommendations="slot2"]')!;
            const recDiv = container.querySelector('.border-success');
            expect(recDiv).toBeTruthy();
        });

        test('should render rejected recommendations with correct styling', async () => {
            mockGet.mockResolvedValue({
                data: {
                    recommendations: testData.recommendations.rejected,
                    warnings: [],
                    slots: testData.slots,
                    participantOptions: testData.participants,
                },
            });

            initRecommendationScheduleView(testData.initialization.valid.planId, mockDescribeSlot);
            await new Promise((resolve) => setTimeout(resolve, 100));

            const container = document.querySelector('[data-slot-recommendations="slot3"]')!;
            const recDiv = container.querySelector('.border-danger');
            expect(recDiv).toBeTruthy();
        });

        test('should display participant name in recommendation', async () => {
            mockGet.mockResolvedValue({
                data: {
                    recommendations: testData.recommendations.pending,
                    warnings: [],
                    slots: testData.slots,
                    participantOptions: testData.participants,
                },
            });

            initRecommendationScheduleView(testData.initialization.valid.planId, mockDescribeSlot);
            await new Promise((resolve) => setTimeout(resolve, 100));

            const container = document.querySelector('[data-slot-recommendations="slot1"]')!;
            expect(container.textContent).toContain('john_doe');
        });
    });

    describe('recommendation actions', () => {
        beforeEach(() => {
            const scheduleView = document.getElementById('recommendationScheduleView')!;
            
            // Clear any dynamically created content from previous test
            scheduleView.innerHTML = '';
            
            // Create containers for all test slots
            ['slot1', 'slot2', 'slot3'].forEach((slotId) => {
                const slotContainer = document.createElement('div');
                slotContainer.dataset.slotRecommendations = slotId;
                scheduleView.append(slotContainer);
            });
        });
        
        afterEach(() => {
            // Clean up dynamically created elements after each test
            const scheduleView = document.getElementById('recommendationScheduleView');
            if (scheduleView) {
                scheduleView.innerHTML = '';
            }
        });

        test('should approve pending recommendation', async () => {
            mockGet.mockResolvedValue({
                data: {
                    recommendations: testData.recommendations.pending,
                    warnings: [],
                    slots: testData.slots,
                    participantOptions: testData.participants,
                },
            });

            initRecommendationScheduleView(testData.initialization.valid.planId, mockDescribeSlot);
            await new Promise((resolve) => setTimeout(resolve, 100));

            const approveBtn = document.querySelector('.btn-success') as HTMLButtonElement;
            expect(approveBtn).toBeTruthy();
            approveBtn?.click();

            await new Promise((resolve) => setTimeout(resolve, 100));

            // Should re-render with approved styling
            const container = document.querySelector('[data-slot-recommendations="slot1"]')!;
            const recDiv = container.querySelector('.border-success');
            expect(recDiv).toBeTruthy();
        });

        test('should reject pending recommendation', async () => {
            mockGet.mockResolvedValue({
                data: {
                    recommendations: testData.recommendations.pending,
                    warnings: [],
                    slots: testData.slots,
                    participantOptions: testData.participants,
                },
            });

            initRecommendationScheduleView(testData.initialization.valid.planId, mockDescribeSlot);
            await new Promise((resolve) => setTimeout(resolve, 100));

            const rejectBtn = document.querySelector('.btn-danger') as HTMLButtonElement;
            expect(rejectBtn).toBeTruthy();
            rejectBtn?.click();

            await new Promise((resolve) => setTimeout(resolve, 100));

            // Should re-render with rejected styling
            const container = document.querySelector('[data-slot-recommendations="slot1"]')!;
            const recDiv = container.querySelector('.border-danger');
            expect(recDiv).toBeTruthy();
        });

        test('should revert approved recommendation to pending', async () => {
            mockGet.mockResolvedValue({
                data: {
                    recommendations: testData.recommendations.approved,
                    warnings: [],
                    slots: testData.slots,
                    participantOptions: testData.participants,
                },
            });

            initRecommendationScheduleView(testData.initialization.valid.planId, mockDescribeSlot);
            await new Promise((resolve) => setTimeout(resolve, 100));

            const revertBtn = document.querySelector('.btn-outline-secondary') as HTMLButtonElement;
            expect(revertBtn).toBeTruthy();
            revertBtn?.click();

            await new Promise((resolve) => setTimeout(resolve, 100));

            // Should re-render with pending styling
            const container = document.querySelector('[data-slot-recommendations="slot2"]')!;
            const recDiv = container.querySelector('.border-warning');
            expect(recDiv).toBeTruthy();
        });

        test('should approve rejected recommendation', async () => {
            mockGet.mockResolvedValue({
                data: {
                    recommendations: testData.recommendations.rejected,
                    warnings: [],
                    slots: testData.slots,
                    participantOptions: testData.participants,
                },
            });

            initRecommendationScheduleView(testData.initialization.valid.planId, mockDescribeSlot);
            await new Promise((resolve) => setTimeout(resolve, 100));

            const approveBtn = document.querySelector('.btn-outline-success') as HTMLButtonElement;
            expect(approveBtn).toBeTruthy();
            approveBtn?.click();

            await new Promise((resolve) => setTimeout(resolve, 100));

            // Should re-render with approved styling
            const container = document.querySelector('[data-slot-recommendations="slot3"]')!;
            const recDiv = container.querySelector('.border-success');
            expect(recDiv).toBeTruthy();
        });
    });

    describe('add recommendation modal', () => {
        beforeEach(() => {
            const scheduleView = document.getElementById('recommendationScheduleView')!;
            
            const addBtn = document.createElement('button');
            addBtn.dataset.addRecommendation = 'true';
            addBtn.dataset.slotId = testData.addModal.slotId;

            const dayDiv = document.createElement('div');
            dayDiv.dataset.day = '2024-12-15';

            const slotDiv = document.createElement('div');
            slotDiv.dataset.slotId = testData.addModal.slotId;

            dayDiv.append(slotDiv);
            slotDiv.append(addBtn);
            scheduleView.append(dayDiv);
        });

        test('should open modal when clicking add button', async () => {
            mockGet.mockResolvedValue({
                data: {
                    recommendations: [],
                    warnings: [],
                    slots: testData.slots,
                    participantOptions: testData.participants,
                },
            });

            initRecommendationScheduleView(testData.initialization.valid.planId, mockDescribeSlot);
            await new Promise((resolve) => setTimeout(resolve, 100));

            const addBtn = document.querySelector('[data-add-recommendation]') as HTMLButtonElement;
            addBtn?.click();

            expect(mockShow).toHaveBeenCalled();
        });

        test('should populate modal with slot ID', async () => {
            mockGet.mockResolvedValue({
                data: {
                    recommendations: [],
                    warnings: [],
                    slots: testData.slots,
                    participantOptions: testData.participants,
                },
            });

            initRecommendationScheduleView(testData.initialization.valid.planId, mockDescribeSlot);
            await new Promise((resolve) => setTimeout(resolve, 100));

            const addBtn = document.querySelector('[data-add-recommendation]') as HTMLButtonElement;
            addBtn?.click();

            const slotIdInput = document.getElementById('addRecommendationSlotId') as HTMLInputElement;
            expect(slotIdInput.value).toBe(testData.addModal.slotId);
        });

        test('should populate participant options', async () => {
            mockGet.mockResolvedValue({
                data: {
                    recommendations: [],
                    warnings: [],
                    slots: testData.slots,
                    participantOptions: testData.participants,
                },
            });

            initRecommendationScheduleView(testData.initialization.valid.planId, mockDescribeSlot);
            await new Promise((resolve) => setTimeout(resolve, 100));

            const addBtn = document.querySelector('[data-add-recommendation]') as HTMLButtonElement;
            addBtn?.click();

            const participantSelect = document.getElementById('addRecommendationParticipant') as HTMLSelectElement;
            expect(participantSelect.options.length).toBeGreaterThan(1); // Plus "Choose participant"
        });

        test('should prevent duplicate recommendations', async () => {
            // Mock alert
            global.alert = jest.fn();

            mockGet.mockResolvedValue({
                data: {
                    recommendations: testData.recommendations.pending,
                    warnings: [],
                    slots: testData.slots,
                    participantOptions: testData.participants,
                },
            });

            initRecommendationScheduleView(testData.initialization.valid.planId, mockDescribeSlot);
            await new Promise((resolve) => setTimeout(resolve, 100));

            // Create add button for this test
            const scheduleView = document.getElementById('recommendationScheduleView')!;
            const addBtn = document.createElement('button');
            addBtn.dataset.addRecommendation = 'true';
            addBtn.dataset.slotId = 'slot1';
            scheduleView.append(addBtn);

            addBtn.click();
            await new Promise((resolve) => setTimeout(resolve, 50));

            const addSlotIdInput = document.getElementById('addRecommendationSlotId') as HTMLInputElement;
            addSlotIdInput.value = 'slot1';

            const participantSelect = document.getElementById('addRecommendationParticipant') as HTMLSelectElement;
            participantSelect.value = testData.addModal.participantValue;

            const confirmBtn = document.getElementById('addRecommendationConfirm') as HTMLButtonElement;
            confirmBtn.click();

            await new Promise((resolve) => setTimeout(resolve, 100));

            expect(global.alert).toHaveBeenCalledWith('This recommendation already exists.');
        });

        test('should add new recommendation', async () => {
            mockGet.mockResolvedValue({
                data: {
                    recommendations: [],
                    warnings: [],
                    slots: testData.slots,
                    participantOptions: testData.participants,
                },
            });

            initRecommendationScheduleView(testData.initialization.valid.planId, mockDescribeSlot);
            await new Promise((resolve) => setTimeout(resolve, 100));

            const scheduleView = document.getElementById('recommendationScheduleView')!;
            const slotContainer = document.createElement('div');
            slotContainer.dataset.slotRecommendations = testData.addModal.slotId;
            scheduleView.append(slotContainer);

            const addBtn = document.querySelector('[data-add-recommendation]') as HTMLButtonElement;
            addBtn?.click();

            const participantSelect = document.getElementById('addRecommendationParticipant') as HTMLSelectElement;
            participantSelect.value = testData.addModal.participantValue;

            const confirmBtn = document.getElementById('addRecommendationConfirm') as HTMLButtonElement;
            confirmBtn?.click();

            await new Promise((resolve) => setTimeout(resolve, 100));

            expect(mockHide).toHaveBeenCalled();
            expect(slotContainer.children.length).toBeGreaterThan(0);
        });
    });

    describe('applying recommendations', () => {
        test('should apply recommendations successfully', async () => {
            mockGet.mockResolvedValue({
                data: {
                    recommendations: testData.recommendations.pending,
                    warnings: [],
                    slots: testData.slots,
                    participantOptions: testData.participants,
                },
            });
            mockPost.mockResolvedValue(testData.apiResponses.applySuccess);

            initRecommendationScheduleView(testData.initialization.valid.planId, mockDescribeSlot);
            await new Promise((resolve) => setTimeout(resolve, 100));

            const applyBtn = document.querySelector('[data-recommendations-apply]') as HTMLButtonElement;
            applyBtn?.click();

            await new Promise((resolve) => setTimeout(resolve, 100));

            expect(mockPost).toHaveBeenCalledWith(
                `/api/activity/${testData.initialization.valid.planId}/recommendations/apply`,
                expect.objectContaining({
                    recommendations: expect.any(Array),
                })
            );
            expect(uiHelpers.reloadAfterDelay).toHaveBeenCalled();
        });

        test('should handle apply error', async () => {
            mockGet.mockResolvedValue({
                data: {
                    recommendations: testData.recommendations.pending,
                    warnings: [],
                    slots: testData.slots,
                    participantOptions: testData.participants,
                },
            });
            mockPost.mockRejectedValue(new Error('Apply failed'));

            initRecommendationScheduleView(testData.initialization.valid.planId, mockDescribeSlot);
            await new Promise((resolve) => setTimeout(resolve, 100));

            const applyBtn = document.querySelector('[data-recommendations-apply]') as HTMLButtonElement;
            applyBtn?.click();

            await new Promise((resolve) => setTimeout(resolve, 100));

            const alertBox = document.querySelector('[data-recommendations-alert]')!;
            expect(alertBox.textContent).toContain('Failed to save recommendations');
        });

        test('should store active tab before reload', async () => {
            // Create active tab element
            const activeTab = document.createElement('a');
            activeTab.className = 'nav-link active';
            activeTab.dataset.bsTarget = '#testTab';
            document.body.append(activeTab);

            mockGet.mockResolvedValue({
                data: {
                    recommendations: testData.recommendations.pending,
                    warnings: [],
                    slots: testData.slots,
                    participantOptions: testData.participants,
                },
            });
            mockPost.mockResolvedValue(testData.apiResponses.applySuccess);

            initRecommendationScheduleView(testData.initialization.valid.planId, mockDescribeSlot);
            await new Promise((resolve) => setTimeout(resolve, 100));

            const applyBtn = document.querySelector('[data-recommendations-apply]') as HTMLButtonElement;
            applyBtn?.click();

            await new Promise((resolve) => setTimeout(resolve, 100));

            expect(sessionStorage.getItem('activity-active-tab')).toBe('#testTab');
        });
    });

    describe('generating recommendations', () => {
        test('should generate recommendations successfully', async () => {
            mockGet.mockResolvedValue({
                data: {
                    recommendations: [],
                    warnings: [],
                    slots: testData.slots,
                    participantOptions: testData.participants,
                },
            });
            mockPost.mockResolvedValue(testData.apiResponses.generateSuccess);

            initRecommendationScheduleView(testData.initialization.valid.planId, mockDescribeSlot);
            await new Promise((resolve) => setTimeout(resolve, 100));

            const autoBtn = document.querySelector('[data-recommendations-auto]') as HTMLButtonElement;
            autoBtn?.click();

            await new Promise((resolve) => setTimeout(resolve, 100));

            expect(mockPost).toHaveBeenCalledWith(
                `/api/activity/${testData.initialization.valid.planId}/recommendations/auto`,
                {}
            );
        });

        test('should handle generate error', async () => {
            mockGet.mockResolvedValue({
                data: {
                    recommendations: [],
                    warnings: [],
                    slots: testData.slots,
                    participantOptions: testData.participants,
                },
            });
            mockPost.mockRejectedValue(new Error('Generation failed'));

            initRecommendationScheduleView(testData.initialization.valid.planId, mockDescribeSlot);
            await new Promise((resolve) => setTimeout(resolve, 100));

            const autoBtn = document.querySelector('[data-recommendations-auto]') as HTMLButtonElement;
            autoBtn?.click();

            await new Promise((resolve) => setTimeout(resolve, 100));

            const alertBox = document.querySelector('[data-recommendations-alert]')!;
            expect(alertBox.textContent).toContain('Failed to generate recommendations');
        });
    });

    describe('refresh button', () => {
        test('should reload recommendations when clicked', async () => {
            mockGet.mockResolvedValue({
                data: {
                    recommendations: [],
                    warnings: [],
                    slots: [],
                    participantOptions: [],
                },
            });

            initRecommendationScheduleView(testData.initialization.valid.planId, mockDescribeSlot);
            await new Promise((resolve) => setTimeout(resolve, 100));

            mockGet.mockClear();
            mockGet.mockResolvedValue({
                data: {
                    recommendations: testData.recommendations.pending,
                    warnings: [],
                    slots: testData.slots,
                    participantOptions: testData.participants,
                },
            });

            const refreshBtn = document.querySelector('[data-recommendations-refresh]') as HTMLButtonElement;
            refreshBtn?.click();

            await new Promise((resolve) => setTimeout(resolve, 0));

            expect(mockGet).toHaveBeenCalledWith(
                `/api/activity/${testData.initialization.valid.planId}/recommendations`
            );
        });
    });
});
