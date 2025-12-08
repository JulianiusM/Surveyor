// tests/client/unit/clipboard.test.ts
// Unit tests for core/clipboard.ts utilities
// Uses data-driven testing approach
import { copyToClipboard } from '../../../src/public/js/core/clipboard';
import { copyToClipboardData } from '../data/clipboardData';

describe('clipboard utilities', () => {
    describe('copyToClipboard - Data Driven', () => {
        beforeEach(() => {
            // Mock navigator.clipboard for tests
            Object.assign(navigator, {
                clipboard: {
                    writeText: jest.fn((text) => Promise.resolve()),
                },
            });
        });

        test.each(copyToClipboardData)(
            '$description',
            async ({ input, expected }) => {
                await copyToClipboard(input.text);
                expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expected);
            }
        );

        test('uses clipboard API when available', async () => {
            const mockWriteText = jest.fn(() => Promise.resolve());
            Object.assign(navigator, {
                clipboard: { writeText: mockWriteText },
            });

            await copyToClipboard('test');
            expect(mockWriteText).toHaveBeenCalledWith('test');
        });

        test('falls back to execCommand when clipboard API unavailable', async () => {
            // Remove clipboard API
            Object.assign(navigator, { clipboard: undefined });
            
            // Mock execCommand
            document.execCommand = jest.fn(() => true);
            
            await copyToClipboard('fallback text');
            expect(document.execCommand).toHaveBeenCalledWith('copy');
        });

        test('handles execCommand failure', async () => {
            Object.assign(navigator, { clipboard: undefined });
            document.execCommand = jest.fn(() => {
                throw new Error('Copy failed');
            });

            await expect(copyToClipboard('fail')).rejects.toThrow('Copy failed');
        });

        test('removes textarea element after fallback copy', async () => {
            Object.assign(navigator, { clipboard: undefined });
            document.execCommand = jest.fn(() => true);
            
            const initialChildCount = document.body.children.length;
            await copyToClipboard('test');
            
            // Textarea should be removed
            expect(document.body.children.length).toBe(initialChildCount);
        });
    });
});
