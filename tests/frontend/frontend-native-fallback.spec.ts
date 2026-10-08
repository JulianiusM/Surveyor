// @vitest-environment happy-dom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {render} from '../../src/frontend/app/entry-server';
import type {components} from '../../src/types/api/v1';

const profileId = '11111111-1111-4111-8111-111111111111';
const entityId = '22222222-2222-4222-8222-222222222222';
const session: components['schemas']['SessionView'] = {kind: 'anonymous', context: 'native-context',
    csrfToken: 'native-csrf', locale: 'en', activeProfile: null, profiles: [], loginUrl: '/users/login',
    logoutUrl: null, deployment: {buildId: 'native-build', apiCompatibility: 'v1-pilot-2026-10-07'},
    shell: {version: 'fixture', imprintUrl: '/imprint', privacyPolicyUrl: '/privacy',
        localLoginEnabled: true, oidcEnabled: false, oidcName: 'Provider'}};

function region(collection: 'owner' | 'participant', visibility: 'main' | 'hidden'): components['schemas']['OverviewRegion'] {
    return {collection, region: visibility, q: '', type: 'all', availableTypes: ['packing'], page: 1, childPage: 1,
        eventId: null, pageSize: 24, totalEntities: 2, hiddenEntities: 1, regionEntities: 1, matchingEntities: 1,
        totalCards: 1, totalChildren: 0, hasPrevious: false, hasNext: false, parent: null,
        items: [{id: entityId, type: 'packing', title: `${collection} ${visibility} packing list`, description: null,
            url: `/frontend-pilot/packing/${entityId}`, headerUrl: null, headerVersion: null, eventContext: null,
            visibility: 'default', overviewHidden: visibility === 'hidden', archived: false, inheritedArchived: false,
            capabilities: {archive: false, restore: false, duplicate: false, remove: false}, children: null}]};
}

afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; });

describe('same-component native fallback', () => {
    it('renders localized packing admission errors without private views or unsupported-page fallback', async () => {
        const fetch = vi.fn(() => {throw new Error('An admission error must not request private packing data');});
        vi.stubGlobal('fetch', fetch);
        for (const locale of ['en', 'de']) {
            for (const suffix of ['', '/guest', '/duplicate']) {
                const result = await render(`/frontend-pilot/packing/${entityId}${suffix}`, {
                    session: {...session, locale}, packingError: 'packing.notFound',
                });
                const document = new DOMParser().parseFromString(result.html, 'text/html');
                expect(document.querySelector('main [role="alert"]')?.textContent).toContain(
                    locale === 'de' ? 'Packliste nicht gefunden.' : 'Packing list not found.',
                );
                const card = document.querySelector('main section.card')!;
                expect(card.querySelector('h1.card-header')?.textContent).toBe(locale === 'de' ? 'Fehler' : 'Error');
                expect(card.querySelector('a.btn-primary')?.getAttribute('href')).toBe('/frontend-pilot');
                expect(card.querySelector('a.btn-primary')?.textContent).toBe(locale === 'de' ? 'Startseite' : 'Home');
                expect(document.querySelector('main form')).toBeNull();
                expect(result.javascriptRequired).toBe(false);
                expect(JSON.parse(result.state).packingError).toBe('packing.notFound');
            }
        }
        expect(fetch).not.toHaveBeenCalled();
    }, 20_000);

    it('initializes an admitted public duplicate form without granting account creation or calling HTTP during SSR', async () => {
        const fetch = vi.fn(() => {throw new Error('SSR must use its admitted copy projection');});
        vi.stubGlobal('fetch', fetch);
        const result = await render(`/frontend-pilot/packing/${entityId}/duplicate`, {session,
            packingDuplicate: {title: 'Public copy', description: 'Copied description', eventId: null,
                items: [{title: 'Camping stove', description: null, maxAssignees: null, requiredByAll: true}],
                defaultPermissions: {public: 0, guest: 0, authenticated: 0, participant: 0},
                formContext: {defaults: {public: 0, guest: 0, authenticated: 0, participant: 0}, permissions: [], presets: []}},
        });
        const document = new DOMParser().parseFromString(result.html, 'text/html');
        expect(document.querySelector<HTMLInputElement>('#create-title')?.value).toBe('Public copy');
        expect(document.querySelector<HTMLTextAreaElement>('#create-description')?.value).toBe('Copied description');
        expect(document.querySelector('main form')).not.toBeNull();
        expect(result.javascriptRequired).toBe(true);
        expect(fetch).not.toHaveBeenCalled();
    });

    it('renders rejected native profile/logout transitions at their own URL without an identity form', async () => {
        for (const path of ['/frontend-pilot/users/profile', '/frontend-pilot/users/logout']) {
            const result = await render(path, {session, identityProblem: {type: 'urn:surveyor:problem:csrf-invalid',
                title: 'Forbidden', status: 403, code: 'CSRF_INVALID', detail: 'The request could not be verified.',
                requestId: 'native-transition-denial', messageKey: 'api:errors.CSRF_INVALID', params: {}}});
            const document = new DOMParser().parseFromString(result.html, 'text/html');
            expect(document.querySelector('main [role="alert"]')?.textContent).toContain('This request could not be verified.');
            expect(document.querySelector('main form')).toBeNull();
            expect(JSON.parse(result.state).initialUrl).toBe(path);
        }
    });
    it('renders local identity forms with native field names and session admission in both languages', async () => {
        for (const locale of ['en', 'de']) {
            const result = await render('/frontend-pilot/users/register', {session: {...session, locale},
                identityFields: {username: 'Redisplayed name', displayname: 'Public name', email: 'fixture@example.test'}});
            const document = new DOMParser().parseFromString(result.html, 'text/html');
            const form = document.querySelector<HTMLFormElement>('main form')!;
            expect(form.method).toBe('post');
            expect(form.getAttribute('action')).toBe('/frontend-pilot/users/register');
            const data = new FormData(form);
            expect(data.get('_context')).toBe(session.context);
            expect(data.get('_csrf')).toBe(session.csrfToken);
            expect(data.get('_compatibility')).toBe(session.deployment.apiCompatibility);
            expect(data.get('locale')).toBe(locale);
            expect(data.get('username')).toBe('Redisplayed name');
            expect(data.get('displayname')).toBe('Public name');
            expect(data.has('password_repeat')).toBe(true);
            expect(data.get('password')).toBe('');
            expect(JSON.parse(result.state).identityFields).not.toHaveProperty('password');
            expect(result.javascriptRequired).toBe(true);
        }
    });

    it('renders native reset and guest forms using their own API input names and initial admission', async () => {
        const reset = await render('/frontend-pilot/users/reset-password/fixture-token', {session, passwordReset: {valid: true}});
        const resetDoc = new DOMParser().parseFromString(reset.html, 'text/html');
        expect(resetDoc.querySelector('main form')?.getAttribute('method')).toBe('post');
        expect(resetDoc.querySelector('input[name="confirmPassword"]')).not.toBeNull();
        const guest = await render(`/frontend-pilot/packing/${entityId}/guest`, {session,
            guestEntry: {id: entityId, title: 'Guest entry fixture'}});
        const guestDoc = new DOMParser().parseFromString(guest.html, 'text/html');
        expect(guestDoc.querySelector('h1')?.textContent).toContain('Guest entry fixture');
        const form = guestDoc.querySelector('main form')!;
        expect(form.getAttribute('action')).toBe(`/frontend-pilot/packing/${entityId}/guest`);
        expect(form.querySelector('input[name="username"]')).not.toBeNull();
        expect(form.querySelector('input[name="email"]')).not.toBeNull();
        expect(form.querySelector('button[type="submit"]')?.hasAttribute('disabled')).toBe(false);
        expect(guest.javascriptRequired).toBe(true);
    }, 20_000); // The first lazy packing route compiles its complete view graph under Vitest.

    it('renders authorized overview cards, badges and independent native search/hidden navigation without HTTP', async () => {
        const fetch = vi.fn(() => { throw new Error('SSR must not call its own API'); });
        vi.stubGlobal('fetch', fetch);
        const account: components['schemas']['SessionView'] = {...session, kind: 'account',
            activeProfile: {id: profileId, name: 'Account fixture'}, profiles: [{id: profileId, name: 'Account fixture'}], logoutUrl: '/users/logout'};
        const url = '/frontend-pilot?participant_hidden_open=1&owner_main_q=equipment';
        const overview = [region('participant', 'main'), region('participant', 'hidden'), region('owner', 'main'), region('owner', 'hidden')];
        overview[2].q = 'equipment';
        const result = await render(url, {session: account, overview});
        const document = new DOMParser().parseFromString(result.html, 'text/html');
        const main = document.querySelector('[data-collection="participant"][data-region="main"]')!;
        expect(main.textContent).toContain('participant main packing list');
        const form = main.querySelector('form')!;
        expect(form.getAttribute('method')).toBe('get');
        expect(form.getAttribute('action')).toBe('/frontend-pilot');
        expect(form.querySelector('input[name="participant_main_q"]')).not.toBeNull();
        expect(form.querySelector('select[name="participant_main_type"]')).not.toBeNull();
        expect(form.querySelector('input[name="owner_main_q"]')?.getAttribute('value')).toBe('equipment');
        const hiddenLink = document.querySelector('a[aria-controls="overview-owner-hidden"]')!;
        expect(hiddenLink.getAttribute('href')).toContain('owner_hidden_open=1');
        expect(hiddenLink.getAttribute('href')).toContain('owner_main_q=equipment');
        expect(document.querySelector('[aria-controls="overview-participant"] .badge')?.textContent).toBe('2');
        expect(document.querySelector('[data-region="hidden"]')?.textContent).toContain('participant hidden packing list');
        expect(fetch).not.toHaveBeenCalled();
    });
});
