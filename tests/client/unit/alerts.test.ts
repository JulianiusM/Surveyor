// tests/client/unit/alerts.test.ts
// Unit tests for shared/alerts.ts utilities
// Uses data-driven testing approach
import { showInlineAlert } from '../../../src/public/js/shared/alerts';
import { showInlineAlertData } from '../data/alertsData';
import { setupTest } from '../helpers/testSetup';

describe('alerts utilities', () => {
    setupTest({
        beforeEach: () => {
            document.body.innerHTML = '<div id="liveAlerts"></div>';
            
            // Mock scrollIntoView (not available in jsdom)
            Element.prototype.scrollIntoView = jest.fn();
            // Mock focus (not fully implemented in jsdom)
            HTMLElement.prototype.focus = jest.fn();
        }
    });

    describe('showInlineAlert - Data Driven', () => {
        test.each(showInlineAlertData)(
            '$description',
            ({ input, expectedClass, expectedMessage }) => {
                showInlineAlert(input.status, input.message);
                
                const alertBox = document.getElementById('liveAlerts');
                const alert = alertBox?.querySelector('.alert');
                
                expect(alert).not.toBeNull();
                expect(alert?.classList.contains('alert')).toBe(true);
                expect(alert?.classList.contains(expectedClass)).toBe(true);
                expect(alert?.textContent).toContain(expectedMessage);
            }
        );

        test('creates alert with dismissible button', () => {
            showInlineAlert('info', 'Test message');
            
            const alert = document.querySelector('.alert');
            const closeBtn = alert?.querySelector('button.btn-close');
            
            expect(closeBtn).not.toBeNull();
            expect(closeBtn?.getAttribute('data-bs-dismiss')).toBe('alert');
        });

        test('creates alert with Bootstrap fade and show classes', () => {
            showInlineAlert('success', 'Test');
            
            const alert = document.querySelector('.alert');
            expect(alert?.classList.contains('fade')).toBe(true);
            expect(alert?.classList.contains('show')).toBe(true);
        });

        test('sets role="alert" on alert element', () => {
            showInlineAlert('error', 'Error message');
            
            const alert = document.querySelector('.alert');
            expect(alert?.getAttribute('role')).toBe('alert');
        });

        test('uses custom container when provided', () => {
            const customContainer = document.createElement('div');
            customContainer.id = 'custom';
            document.body.appendChild(customContainer);
            
            showInlineAlert('info', 'Custom message', customContainer);
            
            const alert = customContainer.querySelector('.alert');
            expect(alert).not.toBeNull();
            expect(alert?.textContent).toContain('Custom message');
        });

        test('returns early if no alert container found', () => {
            document.body.innerHTML = ''; // Remove alert container
            
            // Should not throw
            expect(() => {
                showInlineAlert('info', 'Test');
            }).not.toThrow();
        });

        test('appends multiple alerts to container', () => {
            showInlineAlert('success', 'First message');
            showInlineAlert('info', 'Second message');
            showInlineAlert('error', 'Third message');
            
            const alertBox = document.getElementById('liveAlerts');
            const alerts = alertBox?.querySelectorAll('.alert');
            
            expect(alerts).toHaveLength(3);
        });
    });
});
