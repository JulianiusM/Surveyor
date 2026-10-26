import {describe, expect, it} from 'vitest';
import {coerceLimit, SQL_ALLOW_LIST} from '../../src/backend/modules/lib/util';
import {createQueryLimitCase} from '../factories/queryLimitFactory';

describe('API contract behavior suite', () => {
    describe('list limit input shaping', () => {
        // Canary: protects a high-value production behavior while avoiding private implementation details.
        it('uses the requested API limit when it is within bounds', () => {
            const limitCase = createQueryLimitCase();
            expect(coerceLimit(limitCase.input, limitCase.defaultLimit, limitCase.maxLimit)).toBe(limitCase.expectedLimit);
        });

        // Canary: protects a high-value production behavior while avoiding private implementation details.
        it('falls back to the endpoint default for non-numeric limits', () => {
            const limitCase = createQueryLimitCase({input: 'many', expectedLimit: 10});
            expect(coerceLimit(limitCase.input, limitCase.defaultLimit, limitCase.maxLimit)).toBe(limitCase.expectedLimit);
        });

        // Canary: protects a high-value production behavior while avoiding private implementation details.
        it('caps list limits at the endpoint maximum to protect expensive queries', () => {
            const limitCase = createQueryLimitCase({input: '100', expectedLimit: 25});
            expect(coerceLimit(limitCase.input, limitCase.defaultLimit, limitCase.maxLimit)).toBe(limitCase.expectedLimit);
            expect(coerceLimit('250', 10, 50)).toBe(50);
        });

        // Canary: protects a high-value production behavior while avoiding private implementation details.
        it('uses endpoint-specific defaults for optional list limits', () => {
            const limitCase = createQueryLimitCase({input: undefined, defaultLimit: 50, maxLimit: 100, expectedLimit: 50});
            expect(coerceLimit(limitCase.input, limitCase.defaultLimit, limitCase.maxLimit)).toBe(limitCase.expectedLimit);
        });

        // Canary: protects a high-value production behavior while avoiding private implementation details.
        it('raises empty and non-positive list limits to the minimum page size', () => {
            const limitCase = createQueryLimitCase({input: '', expectedLimit: 1});
            expect(coerceLimit(limitCase.input, limitCase.defaultLimit, limitCase.maxLimit)).toBe(limitCase.expectedLimit);
            expect(coerceLimit('0', 10, 50)).toBe(1);
            expect(coerceLimit('-1', 10, 50)).toBe(1);
        });
    });

    describe('search query allow-list contract', () => {
        // Canary: protects a high-value production behavior while avoiding private implementation details.
        it('allows ordinary names used by user and entity search endpoints', () => {
            expect(SQL_ALLOW_LIST.test('summer camp')).toBe(true);
        });

        // Canary: protects a high-value production behavior while avoiding private implementation details.
        it('allows email fragments used by participant search endpoints', () => {
            expect(SQL_ALLOW_LIST.test('camper@example.com')).toBe(true);
        });

        // Canary: protects a high-value production behavior while avoiding private implementation details.
        it('allows plus and dash characters used in real account identifiers', () => {
            expect(SQL_ALLOW_LIST.test('alex+driver-1')).toBe(true);
        });

        // Canary: protects a high-value production behavior while avoiding private implementation details.
        it('rejects very short broad searches that would create noisy scans', () => {
            expect(SQL_ALLOW_LIST.test('ab')).toBe(false);
        });

        // Canary: protects a high-value production behavior while avoiding private implementation details.
        it('rejects SQL wildcard and statement characters from search input', () => {
            expect(SQL_ALLOW_LIST.test("%' OR 1=1 --")).toBe(false);
        });
    });
});
