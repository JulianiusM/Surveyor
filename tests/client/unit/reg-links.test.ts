/**
 * Tests for reg-links.ts module
 * Registration links management functionality
 */

import {initRegLinks} from '../../../src/public/js/modules/reg-links';
import {regLinksTestData} from '../data/regLinksData';
import * as http from '../../../src/public/js/core/http';
import * as alerts from '../../../src/public/js/shared/alerts';
import * as uiHelpers from '../../../src/public/js/shared/ui-helpers';

// Mock dependencies
jest.mock('../../../src/public/js/core/http');
jest.mock('../../../src/public/js/shared/alerts');
jest.mock('../../../src/public/js/shared/ui-helpers');

const mockHttp = http as jest.Mocked<typeof http>;
const mockAlerts = alerts as jest.Mocked<typeof alerts>;
const mockUiHelpers = uiHelpers as jest.Mocked<typeof uiHelpers>;

describe('reg-links module', () => {
    let container: HTMLElement;

    beforeEach(() => {
        // Clear mocks
        jest.clearAllMocks();
        
        // Mock implementations
        mockUiHelpers.showSpinner = jest.fn();
        mockUiHelpers.hideSpinner = jest.fn();
        mockUiHelpers.copyWithFeedback = jest.fn().mockResolvedValue(undefined);
        mockUiHelpers.createBadge = jest.fn((status: string) => `<span class="badge">${status}</span>`);
        mockAlerts.showInlineAlert = jest.fn();
        
        // Create container
        container = document.createElement('div');
        document.body.innerHTML = '';
        document.body.appendChild(container);
        
        // Mock location
        delete (window as any).location;
        (window as any).location = {origin: 'http://localhost:3000'};
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    describe('initialization and rendering', () => {
        test.each(regLinksTestData.initialization)('$description', async (testCase) => {
            // Setup DOM with test case HTML
            container.innerHTML = testCase.html;
            
            // Mock API response
            mockHttp.get = jest.fn().mockResolvedValue({data: testCase.apiData});
            
            // Initialize
            initRegLinks();
            
            // Wait for async operations
            await new Promise(resolve => setTimeout(resolve, 50));
            
            // Verify API called
            if (testCase.expectApiCall) {
                expect(mockHttp.get).toHaveBeenCalledWith(testCase.apiUrl);
            }
            
            // Verify rendering
            if (testCase.expectedCount !== undefined) {
                const countEl = container.querySelector('.js-count');
                expect(countEl?.textContent).toBe(String(testCase.expectedCount));
            }
            
            if (testCase.expectedEmptyMessage) {
                const emptyRow = container.querySelector('.js-empty');
                expect(emptyRow).toBeTruthy();
            }
            
            if (testCase.expectedRowCount !== undefined) {
                const rows = container.querySelectorAll('tbody.js-rows tr:not(.js-empty)');
                expect(rows.length).toBe(testCase.expectedRowCount);
            }
        });
    });

    describe('link creation', () => {
        beforeEach(() => {
            // Mock Bootstrap modal
            (window as any).bootstrap = {
                Modal: {
                    getOrCreateInstance: jest.fn().mockReturnValue({
                        hide: jest.fn()
                    })
                }
            };
        });

        test.each(regLinksTestData.creation)('$description', async (testCase) => {
            // Setup DOM
            container.innerHTML = testCase.html;
            
            // Mock API responses
            mockHttp.post = jest.fn().mockResolvedValue(testCase.createResponse);
            mockHttp.get = jest.fn().mockResolvedValue({data: testCase.refreshResponse});
            
            // Initialize
            initRegLinks();
            
            // Find and click create button
            const createBtn = container.querySelector<HTMLButtonElement>(testCase.buttonSelector);
            expect(createBtn).toBeTruthy();
            
            createBtn!.click();
            
            // Wait for async operations
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Verify API calls
            if (testCase.expectCreateCall) {
                expect(mockHttp.post).toHaveBeenCalledWith(
                    testCase.createApiUrl,
                    expect.objectContaining(testCase.expectedPayload)
                );
            }
            
            if (testCase.expectCopyCall) {
                expect(mockUiHelpers.copyWithFeedback).toHaveBeenCalled();
            }
            
            if (testCase.expectRefresh) {
                expect(mockHttp.get).toHaveBeenCalled();
            }
        });
    });

    describe('link copying', () => {
        test.each(regLinksTestData.copying)('$description', async (testCase) => {
            // Setup DOM
            container.innerHTML = testCase.html;
            
            // Initialize
            initRegLinks();
            
            // Find and click copy button
            const copyBtn = container.querySelector<HTMLButtonElement>(testCase.buttonSelector);
            expect(copyBtn).toBeTruthy();
            
            copyBtn!.click();
            
            // Wait for async operations
            await new Promise(resolve => setTimeout(resolve, 50));
            
            // Verify copy called with correct URL
            expect(mockUiHelpers.copyWithFeedback).toHaveBeenCalledWith(
                testCase.expectedUrl,
                copyBtn
            );
        });
    });

    describe('link revocation', () => {
        beforeEach(() => {
            // Mock window.confirm
            global.confirm = jest.fn();
        });

        test.each(regLinksTestData.revocation)('$description', async (testCase) => {
            // Setup DOM
            container.innerHTML = testCase.html;
            
            // Mock confirm dialog
            (global.confirm as jest.Mock).mockReturnValue(testCase.confirmResult);
            
            // Mock API responses
            mockHttp.del = jest.fn().mockResolvedValue({});
            mockHttp.get = jest.fn().mockResolvedValue({data: testCase.refreshResponse});
            
            // Initialize
            initRegLinks();
            
            // Find and click revoke button
            const revokeBtn = container.querySelector<HTMLButtonElement>(testCase.buttonSelector);
            expect(revokeBtn).toBeTruthy();
            
            revokeBtn!.click();
            
            // Wait for async operations
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Verify behavior based on confirm result
            if (testCase.confirmResult) {
                expect(mockHttp.del).toHaveBeenCalledWith(testCase.expectedDeleteUrl);
                expect(mockHttp.get).toHaveBeenCalled();
                
                if (testCase.expectSuccessAlert) {
                    expect(mockAlerts.showInlineAlert).toHaveBeenCalledWith('success', expect.any(String));
                }
            } else {
                expect(mockHttp.del).not.toHaveBeenCalled();
            }
        });
    });

    describe('error handling', () => {
        test.each(regLinksTestData.errorHandling)('$description', async (testCase) => {
            // Setup DOM
            container.innerHTML = testCase.html;
            
            // Mock API to throw error
            if (testCase.errorOn === 'get') {
                mockHttp.get = jest.fn().mockRejectedValue(new Error(testCase.errorMessage));
            } else if (testCase.errorOn === 'post') {
                mockHttp.post = jest.fn().mockRejectedValue(new Error(testCase.errorMessage));
            } else if (testCase.errorOn === 'delete') {
                mockHttp.del = jest.fn().mockRejectedValue(new Error(testCase.errorMessage));
                (global.confirm as jest.Mock).mockReturnValue(true);
            }
            
            // Initialize
            initRegLinks();
            
            if (testCase.errorOn === 'get') {
                // Wait for initial load
                await new Promise(resolve => setTimeout(resolve, 100));
            } else if (testCase.triggerAction) {
                // Trigger action
                const btn = container.querySelector<HTMLButtonElement>(testCase.triggerSelector!);
                btn?.click();
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            
            // Verify error alert shown
            expect(mockAlerts.showInlineAlert).toHaveBeenCalledWith('error', expect.stringContaining(testCase.errorMessage));
        });
    });
});
