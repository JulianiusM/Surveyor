// @vitest-environment happy-dom
import {apiCompatibility} from '../../.generated/api/v1/policy.mjs';
import {afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
import {render} from '../../src/frontend/app/entry-server';
import type {components} from '../../src/types/api/v1';

const profileId = '11111111-1111-4111-8111-111111111111';
const entityId = '22222222-2222-4222-8222-222222222222';
const session: components['schemas']['SessionView'] = {kind: 'anonymous', context: 'native-context',
    csrfToken: 'native-csrf', locale: 'en', activeProfile: null, profiles: [], loginUrl: '/users/login',
    logoutUrl: null, deployment: {buildId: 'native-build', apiCompatibility},
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

describe('admitted initial document delivery', () => {
    // Cold Vitest compilation belongs to preparation, not the timed observable
    // SSR contract. Resolve each lazy route graph with one bounded startup budget;
    // the actual render/assertion bodies retain the ordinary five-second budget.
    beforeAll(async function prepareSsrRouteModules(): Promise<void> {
        await Promise.all([
            import('../../src/frontend/features/packing/PackingCreatePage.vue'),
            import('../../src/frontend/features/packing/PackingEntry.vue'),
            import('../../src/frontend/features/identity/IdentityPage.vue'),
            import('../../src/frontend/features/overview/OverviewPage.vue'),
            import('../../src/frontend/features/help/HelpPage.vue'),
        ]);
    }, 60_000);

    it('renders initial public Help and first login with no stored anonymous evidence or self HTTP', async () => {
        const fetch = vi.fn(() => { throw new Error('SSR must render admitted request data without self HTTP'); });
        vi.stubGlobal('fetch', fetch);
        const initial: components['schemas']['SessionView'] = {...session, context: null, csrfToken: null};
        const help: components['schemas']['HelpPageData'] = {locale: 'en', title: 'Public Help', content: '<p>Read this task.</p>',
            currentDoc: 'fixture.md', docsList: [], docsGroups: [], toc: []};

        // Public content stays server-rendered. A null pair describes absence of
        // stored evidence, rather than a missing bootstrap or an unreadable shell.
        const publicResult = await render('/frontend-pilot/help', {session: initial, help});
        const publicDocument = new DOMParser().parseFromString(publicResult.html, 'text/html');
        expect(publicDocument.querySelector('main article')?.textContent).toContain('Read this task.');
        expect(JSON.parse(publicResult.state).session).toMatchObject({context: null, csrfToken: null});
        expect(publicResult.javascriptRequired).toBe(false);

        // Identity input retains its existing initialization disclosure; no new
        // frontend bootstrap or anonymous session is required before showing it.
        const loginResult = await render('/frontend-pilot/users/login', {session: initial});
        const loginDocument = new DOMParser().parseFromString(loginResult.html, 'text/html');
        expect(loginDocument.querySelector('[data-pilot-initial-loading]')).not.toBeNull();
        expect(loginDocument.querySelector('main form')).toBeNull();
        expect(JSON.parse(loginResult.state).session).toMatchObject({context: null, csrfToken: null});
        expect(loginResult.javascriptRequired).toBe(true);
        expect(fetch).not.toHaveBeenCalled();
    });

    it('retains the server-admitted event while withholding creation controls during SSR', async () => {
        const fetch = vi.fn(() => {throw new Error('SSR must retain server-owned initial selection');});
        vi.stubGlobal('fetch', fetch);
        const option: components['schemas']['EventPickerOption'] = {id: entityId, title: 'Admitted initial event',
            description: null, startDate: '2026-10-07', endDate: '2026-10-08', archived: false, deadlinePassed: false};
        for (const selectedEvent of [option, null]) {
            const result = await render(`/frontend-pilot/packing/create?eventId=${entityId}`, {
                session: {...session, kind: 'account', activeProfile: {id: profileId, name: 'Account owner'}},
                pageEntry: {kind: 'render'}, packingSelectedEvent: selectedEvent,
                packingCreateContext: {defaults: {public: 0, guest: 0, authenticated: 0, participant: 0}, permissions: [], presets: []},
            });
            const document = new DOMParser().parseFromString(result.html, 'text/html');
            expect(document.querySelector('[data-pilot-initial-loading]')).not.toBeNull();
            expect(document.querySelector('#create-event-button')).toBeNull();
            expect(JSON.parse(result.state).packingSelectedEvent).toEqual(selectedEvent);
        }
        expect(fetch).not.toHaveBeenCalled();
    });

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
                    locale === 'de' ? 'Packliste nicht gefunden.' : 'packing not found',
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
    });

    it('retains an admitted public copy projection without exposing a duplicate form or calling HTTP during SSR', async () => {
        const fetch = vi.fn(() => {throw new Error('SSR must use its admitted copy projection');});
        vi.stubGlobal('fetch', fetch);
        const result = await render(`/frontend-pilot/packing/${entityId}/duplicate`, {session,
            packingDuplicate: {title: 'Public copy', description: 'Copied description', eventId: null,
                items: [{title: 'Camping stove', description: null, maxAssignees: null, requiredByAll: true}],
                defaultPermissions: {public: 0, guest: 0, authenticated: 0, participant: 0},
                formContext: {defaults: {public: 0, guest: 0, authenticated: 0, participant: 0}, permissions: [], presets: []}},
        });
        const document = new DOMParser().parseFromString(result.html, 'text/html');
        expect(document.querySelector('[data-pilot-initial-loading]')).not.toBeNull();
        expect(document.querySelector('main form')).toBeNull();
        expect(JSON.parse(result.state).packingDuplicate).toMatchObject({title: 'Public copy', description: 'Copied description'});
        expect(result.javascriptRequired).toBe(true);
        expect(fetch).not.toHaveBeenCalled();
    });

    it('withholds local identity forms while retaining session admission in both languages', async () => {
        for (const locale of ['en', 'de']) {
            const result = await render('/frontend-pilot/users/register', {session: {...session, locale}});
            const document = new DOMParser().parseFromString(result.html, 'text/html');
            expect(document.querySelector('[data-pilot-initial-loading]')).not.toBeNull();
            expect(document.querySelector('main form')).toBeNull();
            const bootstrap = JSON.parse(result.state);
            expect(bootstrap.session).toMatchObject({context: session.context, csrfToken: session.csrfToken, locale});
            expect(bootstrap).not.toHaveProperty('identityFields');
            expect(bootstrap).not.toHaveProperty('identityFormProblem');
            expect(result.javascriptRequired).toBe(true);
        }
    });

    it('withholds reset and guest forms while retaining their initial admission', async () => {
        const reset = await render('/frontend-pilot/users/reset-password/fixture-token', {session, passwordReset: {valid: true}});
        const resetDoc = new DOMParser().parseFromString(reset.html, 'text/html');
        expect(resetDoc.querySelector('[data-pilot-initial-loading]')).not.toBeNull();
        expect(resetDoc.querySelector('main form')).toBeNull();
        expect(JSON.parse(reset.state).passwordReset).toEqual({valid: true});
        const guest = await render(`/frontend-pilot/packing/${entityId}/guest`, {session,
            guestEntry: {id: entityId, title: 'Guest entry fixture'}});
        const guestDoc = new DOMParser().parseFromString(guest.html, 'text/html');
        expect(guestDoc.querySelector('[data-pilot-initial-loading]')).not.toBeNull();
        expect(guestDoc.querySelector('main form')).toBeNull();
        expect(JSON.parse(guest.state).guestEntry).toEqual({id: entityId, title: 'Guest entry fixture'});
        expect(guest.javascriptRequired).toBe(true);
    });

    it('retains independent admitted overview regions without exposing their interactive controls during SSR', async () => {
        const fetch = vi.fn(() => { throw new Error('SSR must not call its own API'); });
        vi.stubGlobal('fetch', fetch);
        const account: components['schemas']['SessionView'] = {...session, kind: 'account',
            activeProfile: {id: profileId, name: 'Account fixture'}, profiles: [{id: profileId, name: 'Account fixture'}], logoutUrl: '/users/logout'};
        const url = '/frontend-pilot?participant_hidden_open=1&owner_main_q=equipment';
        const overview = [region('participant', 'main'), region('participant', 'hidden'), region('owner', 'main'), region('owner', 'hidden')];
        overview[2].q = 'equipment';
        const result = await render(url, {session: account, overview});
        const document = new DOMParser().parseFromString(result.html, 'text/html');
        expect(document.querySelector('[data-pilot-initial-loading]')).not.toBeNull();
        expect(document.querySelector('main form')).toBeNull();
        expect(document.querySelector('[data-collection]')).toBeNull();
        const bootstrap = JSON.parse(result.state);
        expect(bootstrap.overview).toEqual(overview);
        expect(bootstrap.initialUrl).toBe(url);
        expect(fetch).not.toHaveBeenCalled();
    });
});
