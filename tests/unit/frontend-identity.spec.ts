import {describe, expect, it} from 'vitest';
import {safeFrontendReturn} from '../../src/modules/lib/frontendIdentity';

describe('frontend identity destinations', () => {
    it('preserves owned path, query and fragment while normalizing dot segments', () => {
        expect(safeFrontendReturn('/frontend-pilot/packing/abc?locale=de#items')).toBe('/frontend-pilot/packing/abc?locale=de#items');
        expect(safeFrontendReturn('/frontend-pilot/help/../packing')).toBe('/frontend-pilot/packing');
        expect(safeFrontendReturn('/frontend-pilot?locale=de')).toBe('/frontend-pilot?locale=de');
    });

    it.each([undefined, null, [], 'https://outside.invalid', '//outside.invalid', '/\\outside.invalid',
        '/frontend-pilot/../../users/login', '/frontend-pilot/../outside', '/frontend-pilotish',
        '/frontend-pilot/\r\nLocation: https://outside.invalid', 'javascript:alert(1)'])
    ('keeps an unsafe or unrelated return inside the frontend: %j', value => {
        expect(safeFrontendReturn(value)).toBe('/frontend-pilot');
    });
});
