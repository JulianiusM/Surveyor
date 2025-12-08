// tests/client/unit/ui-helpers.test.ts
// Unit tests for shared/ui-helpers.ts utilities
// Uses data-driven testing approach
import { 
    createBadge, 
    createChip, 
    createDietaryChip,
    showSpinner,
    hideSpinner,
} from '../../../src/public/js/shared/ui-helpers';
import { createBadgeData, createChipData, createDietaryChipData } from '../data/uiHelpersData';

describe('UI helpers utilities', () => {
    describe('createBadge - Data Driven', () => {
        test.each(createBadgeData)(
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
        test.each(createChipData)(
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
        test.each(createDietaryChipData)(
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
});
