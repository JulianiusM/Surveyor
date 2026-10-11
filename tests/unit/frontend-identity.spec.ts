import {describe, expect, it} from 'vitest';
import {frontendIdentityPageEntry, safeFrontendReturn} from '../../src/modules/lib/frontendIdentity';
import {createTranslator} from '../../src/modules/localization/translator';
import {ApiProblem, validatedProblemBody} from '../../src/modules/api/problem';

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

describe('native identity configuration presentation', () => {
    it.each(['forgot', 'reset', 'activate'] as const)('projects the native disabled-local %s page independently of API status', operation => {
        const entry = frontendIdentityPageEntry(operation, {localLoginEnabled: false, oidcEnabled: true});
        expect(entry).toEqual({kind: 'denied', status: 500, messageKey: 'auth.localLoginDisabled'});
    });

    it.each(['login', 'register', 'forgot', 'reset'] as const)('preserves native disabled-local %s POST denial before credential admission', operation => {
        expect(frontendIdentityPageEntry(operation, {localLoginEnabled: false, oidcEnabled: false}, undefined, 'POST'))
            .toEqual({kind: 'denied', status: 500, messageKey: 'auth.localLoginDisabled'});
    });

    it('denies a disabled OIDC entry while leaving guest recovery independent of local login', () => {
        const login = {localLoginEnabled: false, oidcEnabled: false};
        expect(frontendIdentityPageEntry('oidc', login)).toEqual({kind: 'denied', status: 500, messageKey: 'auth.oidcDisabled'});
        expect(frontendIdentityPageEntry('recovery', login, undefined, 'POST')).toEqual({kind: 'render'});
    });

    it('keeps native presentation separate from the authored API 403 and preserves the exact provider return', () => {
        const next = '/frontend-pilot/packing/source/duplicate?eventId=parent&locale=de#details';
        for (const oidcEnabled of [false, true]) {
            const entry = frontendIdentityPageEntry('register', {localLoginEnabled: false, oidcEnabled}, next);
            expect(entry).toEqual({kind: 'redirect', url: `/frontend-pilot/users/oidc/login?next=${encodeURIComponent(next)}`, notice: null});
        }
        const problem = validatedProblemBody(new ApiProblem('LOCAL_LOGIN_DISABLED'), 'en');
        expect(problem).toMatchObject({status: 403, code: 'LOCAL_LOGIN_DISABLED', messageKey: 'api:errors.LOCAL_LOGIN_DISABLED'});
        expect(createTranslator('en').t('auth.activated')).toBe('Account successfully activated');
        expect(createTranslator('en').t('auth.logoutDone')).toBe('Logout successful');
    });
});
