// tests/client/unit/ui-helpers.test.ts
// Unit tests for shared/ui-helpers.ts utilities
// Uses data-driven testing approach
import { 
    createBadge, 
    createChip, 
    createDietaryChip,
    showSpinner,
    hideSpinner,
    parseJsonScript,
    reloadAfterDelay,
    updateToLocalString,
    formatDuration,
    copyWithFeedback,
} from '../../../src/public/js/shared/ui-helpers';
import { createBadgeData, createChipData, createDietaryChipData } from '../data/uiHelpersData';
import { setupTest } from '../helpers/testSetup';

describe('UI helpers utilities', () => {
    setupTest();
    describe('createBadge - Data Driven', () => {
        test.each(createBadgeData())(
            '$description',
            ({ input, expectedClass, expectedText }) => {
                const result = createBadge(input.status);
                
                expect(result).toContain(`class="badge ${expectedClass} text-uppercase"`);
                expect(result).toContain(expectedText);
                expect(result).toMatch(/<span[^>]*>.*<\/span>/);
            }
        );

        test('accepts custom color map', () => {
            const customMap = { custom: 'primary' };
            const result = createBadge('custom', customMap);
            
            expect(result).toContain('text-bg-primary');
        });

        test('uses secondary for unmapped status with custom map', () => {
            const customMap = { known: 'success' };
            const result = createBadge('unknown', customMap);
            
            expect(result).toContain('text-bg-secondary');
        });

        test('preserves original status text casing', () => {
            const result = createBadge('MixedCase');
            expect(result).toContain('MixedCase');
        });
    });

    describe('createChip - Data Driven', () => {
        test.each(createChipData())(
            '$description',
            ({ input, expectedClass, expectedText }) => {
                const result = input.variant 
                    ? createChip(input.text, input.variant)
                    : createChip(input.text);
                
                expect(result).toContain(`class="badge rounded-pill ${expectedClass} me-1"`);
                expect(result).toContain(expectedText);
            }
        );

        test('includes rounded-pill and me-1 classes', () => {
            const result = createChip('Test');
            
            expect(result).toContain('rounded-pill');
            expect(result).toContain('me-1');
        });
    });

    describe('createDietaryChip - Data Driven', () => {
        test.each(createDietaryChipData())(
            '$description',
            ({ input, expectedClass, expectedText }) => {
                const result = createDietaryChip(input.choice);
                
                expect(result).toContain(expectedClass);
                expect(result).toContain(expectedText);
                expect(result).toContain('rounded-pill');
            }
        );

        test('treats non-ALLERGIES choices as secondary', () => {
            ['VEGETARIAN', 'VEGAN', 'HALAL', 'KOSHER'].forEach(choice => {
                const result = createDietaryChip(choice);
                expect(result).toContain('text-bg-secondary');
            });
        });
    });

    describe('showSpinner', () => {
        test('disables button', () => {
            const btn = document.createElement('button');
            btn.disabled = false;
            
            showSpinner(btn);
            
            expect(btn.disabled).toBe(true);
        });

        test('reveals spinner element if present', () => {
            const btn = document.createElement('button');
            const spinner = document.createElement('div');
            spinner.classList.add('spinner-border', 'd-none');
            btn.appendChild(spinner);
            
            showSpinner(btn);
            
            expect(spinner.classList.contains('d-none')).toBe(false);
        });

        test('handles button without spinner gracefully', () => {
            const btn = document.createElement('button');
            
            expect(() => showSpinner(btn)).not.toThrow();
            expect(btn.disabled).toBe(true);
        });
    });

    describe('hideSpinner', () => {
        test('enables button', () => {
            const btn = document.createElement('button');
            btn.disabled = true;
            
            hideSpinner(btn);
            
            expect(btn.disabled).toBe(false);
        });

        test('hides spinner element if present', () => {
            const btn = document.createElement('button');
            const spinner = document.createElement('div');
            spinner.classList.add('spinner-border');
            btn.appendChild(spinner);
            
            hideSpinner(btn);
            
            expect(spinner.classList.contains('d-none')).toBe(true);
        });

        test('handles button without spinner gracefully', () => {
            const btn = document.createElement('button');
            
            expect(() => hideSpinner(btn)).not.toThrow();
            expect(btn.disabled).toBe(false);
        });
    });

    describe('parseJsonScript', () => {
        beforeEach(() => {
            document.body.innerHTML = '';
        });

        test('parses valid JSON from script tag', () => {
            const script = document.createElement('script');
            script.id = 'test-data';
            script.type = 'application/json';  // Prevent execution
            script.textContent = '{"name": "test", "value": 123}';
            document.body.appendChild(script);
            
            const result = parseJsonScript<{ name: string; value: number }>('test-data');
            
            expect(result).not.toBeNull();
            expect(result?.name).toBe('test');
            expect(result?.value).toBe(123);
        });

        test('returns null for non-existent script', () => {
            const result = parseJsonScript('non-existent');
            expect(result).toBeNull();
        });

        test('returns null for empty script', () => {
            const script = document.createElement('script');
            script.id = 'empty';
            script.type = 'application/json';
            script.textContent = '';
            document.body.appendChild(script);
            
            const result = parseJsonScript('empty');
            expect(result).toBeNull();
        });

        test('returns null for invalid JSON', () => {
            const script = document.createElement('script');
            script.id = 'invalid';
            script.type = 'application/json';
            script.textContent = '{invalid}';
            document.body.appendChild(script);
            
            const result = parseJsonScript('invalid');
            expect(result).toBeNull();
        });

        test('handles null textContent', () => {
            const script = document.createElement('script');
            script.id = 'null-content';
            script.type = 'application/json';
            document.body.appendChild(script);
            
            const result = parseJsonScript('null-content');
            expect(result).toBeNull();
        });
    });

    describe.skip('reloadAfterDelay (browser-specific behavior)', () => {
        // Note: location.reload() is difficult to properly mock in Jest/jsdom
        // This function's behavior is verified in E2E tests
        test('schedules page reload', () => {
            // Placeholder test - actual behavior tested in E2E
            expect(typeof reloadAfterDelay).toBe('function');
        });
    });

    describe('updateToLocalString', () => {
        test('updates element with date string', () => {
            const element = document.createElement('div');
            const date = new Date('2025-01-15T12:00:00Z');
            
            updateToLocalString(element, date);
            
            expect(element.textContent).toBeTruthy();
            expect(element.textContent).not.toBe('');
        });

        test('handles ISO date string', () => {
            const element = document.createElement('div');
            
            updateToLocalString(element, '2025-01-15T12:00:00Z');
            
            expect(element.textContent).toBeTruthy();
        });

        test('uses custom format options', () => {
            const element = document.createElement('div');
            const date = new Date('2025-01-15');
            
            updateToLocalString(element, date, { dateStyle: 'short' });
            
            expect(element.textContent).toBeTruthy();
        });
    });

    describe('formatDuration', () => {
        test('formats days, hours, and minutes', () => {
            const ms = 2 * 24 * 60 * 60 * 1000 + 3 * 60 * 60 * 1000 + 45 * 60 * 1000;
            expect(formatDuration(ms)).toBe('2d 3h 45m');
        });

        test('returns "closed" for zero', () => {
            expect(formatDuration(0)).toBe('closed');
        });

        test('returns "closed" for negative values', () => {
            expect(formatDuration(-1000)).toBe('closed');
        });

        test('formats less than one day', () => {
            const ms = 5 * 60 * 60 * 1000 + 30 * 60 * 1000;
            expect(formatDuration(ms)).toBe('0d 5h 30m');
        });

        test('formats exactly one day', () => {
            const ms = 24 * 60 * 60 * 1000;
            expect(formatDuration(ms)).toBe('1d 0h 0m');
        });
    });

    describe('copyWithFeedback', () => {
        beforeEach(() => {
            // Mock navigator.clipboard
            Object.assign(navigator, {
                clipboard: {
                    writeText: jest.fn(() => Promise.resolve()),
                },
            });
            jest.useFakeTimers();
        });

        afterEach(() => {
            jest.useRealTimers();
        });

        test('copies text using clipboard API', async () => {
            await copyWithFeedback('test text');
            
            expect(navigator.clipboard.writeText).toHaveBeenCalledWith('test text');
        });

        test('shows and hides spinner on button', async () => {
            const btn = document.createElement('button');
            const spinner = document.createElement('div');
            spinner.classList.add('spinner-border', 'd-none');
            btn.appendChild(spinner);
            
            const promise = copyWithFeedback('test', btn);
            
            // Spinner should be shown immediately
            expect(btn.disabled).toBe(true);
            expect(spinner.classList.contains('d-none')).toBe(false);
            
            await promise;
            
            // Fast-forward setTimeout
            jest.runAllTimers();
            
            // Spinner should be hidden after delay
            expect(btn.disabled).toBe(false);
            expect(spinner.classList.contains('d-none')).toBe(true);
        });

        test('works without button parameter', async () => {
            await expect(copyWithFeedback('test')).resolves.not.toThrow();
            expect(navigator.clipboard.writeText).toHaveBeenCalledWith('test');
        });

        test('uses fallback when clipboard API unavailable', async () => {
            Object.assign(navigator, { clipboard: undefined });
            document.execCommand = jest.fn(() => true);
            
            await copyWithFeedback('fallback text');
            
            expect(document.execCommand).toHaveBeenCalledWith('copy');
        });
    });
});
