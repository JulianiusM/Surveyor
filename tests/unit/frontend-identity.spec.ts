import {describe, expect, it} from 'vitest';
import {frontendIdentityPageEntry, frontendOverviewPageEntry, readGuestLinkHandoff, safeFrontendReturn} from '../../src/modules/lib/frontendIdentity';
import {createTranslator} from '../../src/modules/localization/translator';
import {ApiProblem, validatedProblemBody} from '../../src/modules/api/problem';

describe('frontend identity destinations', () => {
    it('preserves owned path, query and fragment while normalizing dot segments', () => {
        expect(safeFrontendReturn('/packing/abc?locale=de#items')).toBe('/packing/abc?locale=de#items');
        expect(safeFrontendReturn('/help/../packing')).toBe('/packing');
        expect(safeFrontendReturn('/?locale=de')).toBe('/?locale=de');
        expect(safeFrontendReturn('/PACKING/abc?locale=de#items')).toBe('/PACKING/abc?locale=de#items');
    });

    it.each([undefined, null, [], 'https://outside.invalid', '//outside.invalid', '/\\outside.invalid',
        '/../../api/private', '/../outside', '/frontend-pilotish', '/FRONTEND-PILOTish',
        '/frontend-pilot/help', '/home',
        '/\r\nLocation: https://outside.invalid', 'javascript:alert(1)'])
    ('keeps an unsafe or unrelated return inside the frontend: %j', value => {
        expect(safeFrontendReturn(value)).toBe('/users/dashboard');
    });
});

describe('personal Dashboard page admission', () => {
    it.each(['account', 'guest'] as const)('admits an existing %s profile without redirect or another read', kind => {
        expect(frontendOverviewPageEntry({kind, activeProfile: {id: 'profile', name: 'Current profile'}})).toEqual({kind: 'render'});
    });

    it('keeps an anonymous visitor on the native Login journey with exact owned destination and typed notice', () => {
        const destination = '/USERS/DASHBOARD/?owner_main_q=equipment&locale=de#overview-owner';
        expect(frontendOverviewPageEntry({kind: 'anonymous', activeProfile: null}, destination)).toEqual({kind: 'redirect',
            url: '/users/login?next=' + encodeURIComponent(destination),
            notice: {kind: 'info', messageKey: 'auth.loginRequired'}});
        expect(frontendOverviewPageEntry({kind: 'anonymous', activeProfile: null}, 'https://outside.invalid')).toMatchObject({
            url: '/users/login?next=%2Fusers%2Fdashboard'});
    });
});

describe('committed guest-link document handoff', () => {
    const handoff = {context: 'committed-guest-context',
        personalLink: 'https://surveyor.example/guest/example/login/private-token'};

    it('discloses the existing private-link feedback only to its admitted committed context', () => {
        const stored = JSON.stringify(handoff);
        expect(readGuestLinkHandoff(stored, handoff.context)).toEqual(handoff);
        expect(readGuestLinkHandoff(stored, 'later-account-context')).toBeUndefined();
    });

    it.each([undefined, handoff.personalLink, '{malformed', JSON.stringify({...handoff, context: 'another-context'}),
        JSON.stringify({...handoff, personalLink: 123}), JSON.stringify({personalLink: handoff.personalLink})])
    ('discards unscoped or malformed flash data without admitting a private link: %j', value => {
        expect(readGuestLinkHandoff(value, handoff.context)).toBeUndefined();
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
        const next = '/packing/source/duplicate?eventId=parent&locale=de#details';
        for (const oidcEnabled of [false, true]) {
            const entry = frontendIdentityPageEntry('register', {localLoginEnabled: false, oidcEnabled}, next);
            expect(entry).toEqual({kind: 'redirect', url: `/users/oidc/login?next=${encodeURIComponent(next)}`, notice: null});
        }
        const problem = validatedProblemBody(new ApiProblem('LOCAL_LOGIN_DISABLED'), 'en');
        expect(problem).toMatchObject({status: 403, code: 'LOCAL_LOGIN_DISABLED', messageKey: 'api:errors.LOCAL_LOGIN_DISABLED'});
        expect(createTranslator('en').t('auth.activated')).toBe('Account successfully activated');
        expect(createTranslator('en').t('auth.logoutDone')).toBe('Logout successful');
    });
});
