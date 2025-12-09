/**
 * Tests for perm-matrix.ts module
 * Permission matrix UI functionality
 */

import {initPermMatrix} from '../../../src/public/js/modules/perm-matrix';
import {permMatrixTestData} from '../data/permMatrixData';
import * as http from '../../../src/public/js/core/http';
import * as alerts from '../../../src/public/js/shared/alerts';
import * as uiHelpers from '../../../src/public/js/shared/ui-helpers';
import { setupTest } from '../helpers/testSetup';

// Mock dependencies
jest.mock('../../../src/public/js/core/http');
jest.mock('../../../src/public/js/shared/alerts');
jest.mock('../../../src/public/js/shared/ui-helpers');

const mockHttp = http as jest.Mocked<typeof http>;
const mockAlerts = alerts as jest.Mocked<typeof alerts>;
const mockUiHelpers = uiHelpers as jest.Mocked<typeof uiHelpers>;

describe('perm-matrix module', () => {
    let container: HTMLElement;

    setupTest({
        beforeEach: () => {
            mockUiHelpers.showSpinner = jest.fn();
            mockUiHelpers.hideSpinner = jest.fn();
            mockUiHelpers.reloadAfterDelay = jest.fn();
            mockAlerts.showInlineAlert = jest.fn();
            mockHttp.post = jest.fn().mockResolvedValue({});
            
            container = document.createElement('div');
            document.body.appendChild(container);
        }
    });

    describe('select all / clear functionality', () => {
        test.each(permMatrixTestData.selectAll)('$description', (testCase) => {
            container.innerHTML = testCase.html;
            initPermMatrix();
            
            const btn = container.querySelector<HTMLButtonElement>(testCase.buttonSelector)!;
            expect(btn).toBeTruthy();
            
            btn.click();
            
            const checkboxes = container.querySelectorAll<HTMLInputElement>(`[data-aud="${testCase.audience}"] input.perm-box`);
            checkboxes.forEach(cb => {
                expect(cb.checked).toBe(testCase.expectedChecked);
            });
        });
    });

    describe('preset application', () => {
        test.each(permMatrixTestData.presets)('$description', (testCase) => {
            container.innerHTML = testCase.html;
            initPermMatrix();
            
            const btn = container.querySelector<HTMLButtonElement>(testCase.buttonSelector)!;
            btn.click();
            
            testCase.expectedStates.forEach(({bit, checked}) => {
                const cb = container.querySelector<HTMLInputElement>(`[data-aud="${testCase.audience}"] input.perm-box[data-bit="${bit}"]`);
                expect(cb?.checked).toBe(checked);
            });
        });
    });

    describe('update permissions', () => {
        test.each(permMatrixTestData.updates)('$description', async (testCase) => {
            container.innerHTML = testCase.html;
            initPermMatrix();
            
            const btn = container.querySelector<HTMLButtonElement>(testCase.buttonSelector)!;
            btn.click();
            
            await new Promise(resolve => setTimeout(resolve, 50));
            
            expect(mockHttp.post).toHaveBeenCalledWith(
                testCase.expectedApiUrl,
                expect.objectContaining(testCase.expectedPayload)
            );
            expect(mockAlerts.showInlineAlert).toHaveBeenCalledWith('success', expect.any(String));
            expect(mockUiHelpers.reloadAfterDelay).toHaveBeenCalledWith(1000);
        });
    });

    describe('error handling', () => {
        test('handles API error on update', async () => {
            mockHttp.post = jest.fn().mockRejectedValue(new Error('Update failed'));
            
            container.innerHTML = `
                <div class="perm-matrix" data-field-base="testPerms">
                    <div class="accordion-body">
                        <div class="row" data-aud="public">
                            <input class="perm-box" type="checkbox" value="VIEW" data-bit="1" checked>
                        </div>
                    </div>
                    <button class="btn-perm-update" data-api="/api/test/perms">Update</button>
                </div>
            `;
            
            initPermMatrix();
            
            const btn = container.querySelector<HTMLButtonElement>('.btn-perm-update')!;
            btn.click();
            
            await new Promise(resolve => setTimeout(resolve, 50));
            
            expect(mockAlerts.showInlineAlert).toHaveBeenCalledWith('error', 'Update failed');
        });
    });
});
