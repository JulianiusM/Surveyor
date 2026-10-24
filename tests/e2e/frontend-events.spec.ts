import {expect, test, type APIRequestContext, type Locator} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import type {components} from '../../src/types/api/v1';
import {createE2ELogin} from '../factories/e2eCoreFactory';
import {closeModalForE2E, expectUsableFrontendLayout, loginForE2E, openModalForE2E,
    readControlContracts} from '../keywords/e2eCoreKeywords';
import {createFrontendEventFixture, frontendEventHeaders} from '../keywords/frontendEventE2EKeywords';
import {waitForPilotHydration} from '../keywords/frontendDynamicKeywords';
import {PERM} from '../../src/modules/lib/permissions';

/** Establish a distinct guest through the real Event identity boundary, then
 * prove this cookie jar cannot inherit the fixture owner's full permissions. */
async function enterIndependentEventGuest(actor: APIRequestContext, owner: APIRequestContext, eventId: string): Promise<string> {
    const input: components['schemas']['GuestRegistrationInput'] = {
        username: `P2 independent guest ${randomUUID().slice(0, 8)}`, email: null,
    };
    const created = await actor.post(`/api/v1/events/${eventId}/guest`, {
        headers: await frontendEventHeaders(actor), data: input,
    });
    expect(created.status()).toBe(200);
    const session = await (await actor.get('/api/v1/session')).json() as components['schemas']['SessionView'];
    const ownerSession = await (await owner.get('/api/v1/session')).json() as components['schemas']['SessionView'];
    expect(session.kind).toBe('guest');
    expect(session.activeProfile).not.toBeNull();
    expect(ownerSession.activeProfile).not.toBeNull();
    expect(session.activeProfile!.id).not.toBe(ownerSession.activeProfile!.id);
    return session.activeProfile!.id;
}

/** Measure the complete visible registration card from its real built document.
 * Positions are relative to that card, so approved shell/flash differences do
 * not conceal differences in the form's own layout, fields or action placement. */
async function measureEventRegistration(surface: Locator) {
    const measured = await surface.evaluate(function inspectRegistration(element) {
        const origin = element.getBoundingClientRect();
        const controls = [...element.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLButtonElement>(
            'input:not([type="hidden"]),textarea,select,button')].filter(visible);
        const labels = [...element.querySelectorAll<HTMLElement>('.card-header,.form-label,.form-check-label,.form-text')]
            .filter(visible);
        const icons = [...element.querySelectorAll<HTMLElement>('.bi')].filter(visible);

        // Read visible output and successful-control values separately. Hidden
        // transport fields and implementation-only wrapper elements are excluded.
        return {
            bounds: {x: 0, y: 0, width: origin.width, height: origin.height},
            text: text(element as HTMLElement),
            style: style(element),
            labels: labels.map(measureLabel),
            icons: icons.map(measureIcon),
            controls: controls.map(measureControl),
        };

        function visible(node: HTMLElement): boolean { return node.checkVisibility(); }
        function text(node: HTMLElement): string { return node.innerText.replace(/\s+/gu, ' ').trim(); }

        /** Preserve actual browser fractions as diagnostic evidence. */
        function bounds(node: Element) {
            const box = node.getBoundingClientRect();
            return {x: box.x - origin.x, y: box.y - origin.y, width: box.width, height: box.height};
        }
        function style(node: Element) {
            const computed = getComputedStyle(node);
            return {
                font: computed.fontFamily, size: computed.fontSize, weight: computed.fontWeight,
                lineHeight: computed.lineHeight, letterSpacing: computed.letterSpacing,
                color: computed.color, background: computed.backgroundColor, border: computed.borderColor,
            };
        }
        function measureLabel(node: HTMLElement) {
            return {text: text(node), style: style(node), bounds: bounds(node)};
        }
        function measureIcon(node: HTMLElement) {
            return {
                name: [...node.classList].filter(name => name.startsWith('bi-')).join(' '),
                style: style(node), bounds: bounds(node), marginRight: getComputedStyle(node).marginRight,
            };
        }

        /** Compare rendered machine values and constraints, not component models. */
        function measureControl(node: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLButtonElement) {
            return {style: style(node), bounds: bounds(node)};
        }
    });
    // Registration and the other migrated features share the same browser
    // constraint projection. Card-specific label/icon/layout evidence stays here.
    const contracts = await readControlContracts(surface.locator('input:not([type="hidden"]),textarea,select,button'));
    expect(contracts).toHaveLength(measured.controls.length);
    return {...measured, controls: measured.controls.map((control, index) => ({...control, state: contracts[index]}))};
}

/** Protect visible information, painted hierarchy and successful-control meaning.
 * Raw geometry remains evidence; responsive layout and internal names may differ. */
function compareEventRegistration(native: Awaited<ReturnType<typeof measureEventRegistration>>,
                                  migrated: Awaited<ReturnType<typeof measureEventRegistration>>): void {
    expect(migrated.text).toBe(native.text);
    expect(migrated.style).toEqual(native.style);

    // Compare ordered labels/icons as well as controls: matching field rectangles
    // alone cannot detect missing helper text, the wrong icon or changed wording.
    expect(migrated.labels).toHaveLength(native.labels.length);
    for (let index = 0; index < native.labels.length; index++) {
        const expected = native.labels[index]!;
        const actual = migrated.labels[index]!;
        expect(actual.text).toBe(expected.text);
        expect(actual.style).toEqual(expected.style);
    }
    expect(migrated.icons).toHaveLength(native.icons.length);
    for (let index = 0; index < native.icons.length; index++) {
        const expected = native.icons[index]!;
        const actual = migrated.icons[index]!;
        expect(actual.style).toEqual(expected.style);
    }
    expect(migrated.controls).toHaveLength(native.controls.length);
    for (let index = 0; index < native.controls.length; index++) {
        const expected = native.controls[index]!;
        const actual = migrated.controls[index]!;
        expect(actual.state).toEqual(expected.state);
        expect(actual.style).toEqual(expected.style);
    }
}

/** Ordinary dietary words must remain readable as a unit at phone width.
 * Browser ranges inspect the painted text rather than assuming a grid layout. */
async function expectReadableDietaryChoices(surface: Locator): Promise<void> {
    const choices = await surface.locator('.form-check-label').evaluateAll(function inspectChoiceWords(labels) {
        return labels.map(label => {
            const fragmentedWords: string[] = [];
            // A label may wrap between words. Splitting a short authored word
            // across lines instead indicates that its choice column is squeezed.
            const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
            let node: Node | null;
            while ((node = walker.nextNode())) {
                for (const match of node.textContent!.matchAll(/\S+/gu)) {
                    const range = document.createRange();
                    range.setStart(node, match.index!);
                    range.setEnd(node, match.index! + match[0].length);
                    const lines = new Set([...range.getClientRects()].map(rect => Math.round(rect.top)));
                    if (lines.size > 1) fragmentedWords.push(match[0]);
                }
            }
            return {label: label.textContent?.trim(), fragmentedWords};
        });
    });
    expect(choices.length).toBeGreaterThan(0);
    for (const choice of choices) expect(choice.fragmentedWords, choice.label).toEqual([]);

    // Exercise the label association and real hit target without submitting a
    // registration. Restore the initial unchecked value for the later Refresh.
    const vegetarian = surface.getByRole('checkbox', {name: 'Vegetarian', exact: true});
    await expect(vegetarian).not.toBeChecked();
    await surface.getByText('Vegetarian', {exact: true}).click();
    await expect(vegetarian).toBeChecked();
    await vegetarian.uncheck();
    await expect(vegetarian).not.toBeChecked();
}

test('creates and duplicates an Event through multipart SPA commands with native field, image and timezone meaning', async ({page}) => {
    await loginForE2E(page.request, createE2ELogin());
    const title = `P2 SPA creation ${randomUUID().slice(0, 8)}`;
    await page.goto('/frontend-pilot/event/create?locale=en', {waitUntil: 'domcontentloaded'});
    await waitForPilotHydration(page);
    await page.evaluate(() => {document.documentElement.dataset.pilotDocument = 'event-create';});
    const documentRequests: string[] = [];
    page.on('request', request => {
        if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documentRequests.push(request.url());
    });
    await page.locator('input[name="title"]').fill(title);
    await page.locator('input[name="startDate"]').fill('2030-06-01');
    await page.locator('input[name="endDate"]').fill('2030-06-04');
    await page.locator('input[name="location"]').fill('Event campsite');
    await page.locator('input[name="maxParticipants"]').fill('12');
    await page.locator('input[name="bindingDeadline"]').fill('2030-05-01T12:30');
    await page.locator('input[name="requireDietaryInfo"]').check();
    await page.locator('input[name="headerImg"]').setInputFiles('src/public/img/logo.png');
    const posted = page.waitForResponse(response => response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/api/v1/events');
    await page.getByRole('button', {name: 'Create event', exact: true}).click();
    expect((await posted).status()).toBe(201);
    await expect(page).toHaveURL(/\/frontend-pilot\/event\/[a-f0-9-]+$/u);
    await expect(page.getByRole('heading', {name: title, exact: true})).toBeVisible();
    await expect(page).toHaveTitle(`${title} | Event`);
    const id = new URL(page.url()).pathname.split('/').pop()!;
    const detail = await (await page.request.get(`/api/v1/events/${id}`, {headers: await frontendEventHeaders(page.request)})).json() as components['schemas']['EventView'];
    expect(detail).toMatchObject({title, startDate: '2030-06-01', endDate: '2030-06-04', maxParticipants: 12,
        location: 'Event campsite', requireDietaryInfo: true});
    expect(detail.bindingDeadline).toBe('2030-05-01T12:30:00.000Z');
    expect(detail.headerUrl).toBe(`/api/v1/events/${id}/header`);
    expect(detail).not.toHaveProperty('invoicePools');
    expect(detail).not.toHaveProperty('participants');
    expect((await page.request.get(detail.headerUrl!, {headers: await frontendEventHeaders(page.request)})).status()).toBe(200);

    // Establish actual attendance through the existing native operation before
    // copying. Both the empty destination and unchanged source must be proved;
    // a zero-count assertion against an empty source would be vacuous.
    expect((await page.request.post(`/api/event/${id}/register`, {data: {
        arrivalDate: detail.startDate, departureDate: detail.endDate, dietary: ['MEAT'],
    }})).status()).toBe(200);
    const sourceAttendance = await (await page.request.get(`/api/v1/events/${id}`, {
        headers: await frontendEventHeaders(page.request),
    })).json() as components['schemas']['EventView'];
    expect(sourceAttendance.registrationCount).toBe(1);
    expect(sourceAttendance.registration).toMatchObject({arrivalDate: detail.startDate,
        departureDate: detail.endDate, dietary: ['MEAT']});

    // Independently read the existing native view instead of asserting only the
    // new projection that created the record.
    const native = await page.request.get(`/event/${id}`);
    expect(native.status()).toBe(200);
    expect(await native.text()).toContain(title);

    // Native duplication copies the form values, including its empty rendered
    // datetime-local deadline, while leaving the source image and attendance out.
    await page.getByRole('button', {name: 'Entity settings', exact: true}).click();
    const settings = page.getByRole('dialog');
    await expect(settings).toBeVisible();
    await settings.getByRole('tab', {name: 'Actions', exact: true}).click();
    await settings.getByRole('link', {name: 'Duplicate', exact: true}).click();
    await expect(page).toHaveURL(`/frontend-pilot/event/${id}/duplicate`);
    await expect(page.locator('input[name="title"]')).toHaveValue(title);
    await expect(page.locator('input[name="bindingDeadline"]')).toHaveValue('');
    await page.locator('input[name="title"]').fill(`${title} copy`);
    const duplicated = page.waitForResponse(response => response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/api/v1/events');
    await page.getByRole('button', {name: 'Create event', exact: true}).click();
    expect((await duplicated).status()).toBe(201);
    await expect(page).toHaveURL(/\/frontend-pilot\/event\/[a-f0-9-]+$/u);
    const copyId = new URL(page.url()).pathname.split('/').pop()!;
    expect(copyId).not.toBe(id);
    await expect(page).toHaveTitle(`${title} copy | Event`);
    const copy = await (await page.request.get(`/api/v1/events/${copyId}`, {headers: await frontendEventHeaders(page.request)})).json() as components['schemas']['EventView'];
    expect(copy).toMatchObject({title: `${title} copy`, startDate: detail.startDate, endDate: detail.endDate,
        location: detail.location, maxParticipants: 12, registration: null, registrationCount: 0, headerUrl: null, bindingDeadline: null});
    const retainedSource = await (await page.request.get(`/api/v1/events/${id}`, {
        headers: await frontendEventHeaders(page.request),
    })).json() as components['schemas']['EventView'];
    expect(retainedSource.registrationCount).toBe(1);
    expect(retainedSource.registration).toEqual(sourceAttendance.registration);
    expect(await page.evaluate(() => document.documentElement.dataset.pilotDocument)).toBe('event-create');
    expect(documentRequests).toEqual([]);
});

test('updates one registration through the shared native persistence', async ({page}) => {
    const event = await createFrontendEventFixture(page.request);
    await page.goto(`/frontend-pilot/event/${event.id}?locale=en`, {waitUntil: 'domcontentloaded'});
    await waitForPilotHydration(page);
    await page.locator('#arrivalDate').fill('2030-06-01');
    await page.locator('#departureDate').fill('2030-06-04');
    await page.locator('#diet-meat').check();
    await page.locator('#diet-fish').check();
    await page.locator('#diet-allergies').check();
    await page.locator('#allergyNotes').fill('Peanuts');
    await page.getByRole('button', {name: 'Save registration', exact: true}).click();
    await expect(page.getByText('Your registration', {exact: true})).toBeVisible();
    const first = await (await page.request.get(`/api/v1/events/${event.id}`, {headers: await frontendEventHeaders(page.request)})).json() as components['schemas']['EventView'];
    await page.locator('#departureDate').fill('2030-06-03');
    const savedUpdate = page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1/events/${event.id}/registration`
        && response.request().method() === 'PUT');
    await page.getByRole('button', {name: 'Update', exact: true}).click();
    expect((await savedUpdate).status()).toBe(200);
    const updated = await (await page.request.get(`/api/v1/events/${event.id}`, {headers: await frontendEventHeaders(page.request)})).json() as components['schemas']['EventView'];
    expect(updated.registration?.id).toBe(first.registration?.id);
    expect(updated.registrationCount).toBe(1);
    expect(updated.registration).toMatchObject({departureDate: '2030-06-03', dietary: ['MEAT', 'FISH', 'ALLERGIES'], allergyNotes: 'Peanuts'});

});

test('carries a late-registration token through guest entry and spends it only on registration', async ({page, playwright, baseURL}) => {
    const owner = await playwright.request.newContext({baseURL});
    try {
        const event = await createFrontendEventFixture(owner, true);
        const created = await owner.post(`/api/v1/events/${event.id}/links`, {headers: await frontendEventHeaders(owner), data: {maxUses: 1}});
        expect(created.status()).toBe(200);
        const link = await created.json() as components['schemas']['EventCreatedRegistrationLink'];
        await page.goto(`/frontend-pilot/event/${event.id}?regToken=${encodeURIComponent(link.token)}&locale=en`, {waitUntil: 'domcontentloaded'});
        await waitForPilotHydration(page);
        await page.locator('#guest-name').fill(`P2 guest ${randomUUID().slice(0, 8)}`);
        await page.getByRole('button', {name: 'Continue as guest', exact: true}).click();
        await expect(page).toHaveURL(new RegExp(`/frontend-pilot/event/${event.id}\\?regToken=`));
        await expect(page.locator('#arrivalDate')).toBeVisible();
        const before = await (await owner.get(`/api/v1/events/${event.id}/links`, {headers: await frontendEventHeaders(owner)})).json() as components['schemas']['EventRegistrationLinks'];
        expect(before.items[0]?.status).toBe('active');
        expect(before.items[0]?.used).toBe(false);
        await page.locator('#arrivalDate').fill('2030-06-01');
        await page.locator('#departureDate').fill('2030-06-04');
        await page.locator('#diet-vegan').check();
        await page.getByRole('button', {name: 'Save registration', exact: true}).click();
        await expect(page.getByText('Your registration', {exact: true})).toBeVisible();
        const after = await (await owner.get(`/api/v1/events/${event.id}/links`, {headers: await frontendEventHeaders(owner)})).json() as components['schemas']['EventRegistrationLinks'];
        expect(after.items[0]?.status).toBe('consumed');
        expect(after.items[0]?.used).toBe(true);
        // A later update reuses the saved registration and does not spend the
        // consumed token again. The existing post-deadline date exception applies.
        await page.locator('#departureDate').fill('2030-06-03');
        const savedUpdate = page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1/events/${event.id}/registration`
            && response.request().method() === 'PUT');
        await page.getByRole('button', {name: 'Update', exact: true}).click();
        expect((await savedUpdate).status()).toBe(200);
        const roster = await (await owner.get(`/api/v1/events/${event.id}/participants`, {headers: await frontendEventHeaders(owner)})).json() as components['schemas']['EventParticipants'];
        expect(roster.participants).toHaveLength(1);
        expect(roster.participants[0]?.departureDate).toBe('2030-06-03');
    } finally {
        await owner.dispose();
    }
});

test('preserves native and versioned own-profile cancellation no-ops and deadline rejection', async ({request, playwright, baseURL}) => {
    const event = await createFrontendEventFixture(request);
    const actor = await playwright.request.newContext({baseURL});
    try {
        await enterIndependentEventGuest(actor, request, event.id);
        const proof = await frontendEventHeaders(actor);
        const nativeCancel = `/api/event/${event.id}/register/delete`;
        const registration = `/api/v1/events/${event.id}/registration`;
        // The nonowner has no attendance or cancellation-specific grant. Both
        // transports retain the native scoped no-op, including a repeated write.
        expect((await actor.post(nativeCancel)).status()).toBe(200);
        expect((await actor.delete(registration, {headers: proof})).status()).toBe(200);
        const input = {arrivalDate: '2030-06-01', departureDate: '2030-06-04', dietary: ['VEGAN']};
        expect((await actor.put(registration, {headers: proof, data: input})).status()).toBe(200);
        expect((await actor.post(nativeCancel)).status()).toBe(200);
        expect((await actor.delete(registration, {headers: proof})).status()).toBe(200);
        const cancelled = await (await actor.get(`/api/v1/events/${event.id}`, {headers: proof})).json() as components['schemas']['EventView'];
        expect(cancelled).toMatchObject({registration: null, registrationCount: 0});

        expect((await actor.put(registration, {headers: proof, data: input})).status()).toBe(200);
        const ownerProof = await frontendEventHeaders(request);
        const metadata = await (await request.get(`/api/v1/events/${event.id}/metadata`, {headers: ownerProof})).json() as components['schemas']['EventMetadata'];
        expect((await request.patch(`/api/v1/events/${event.id}/metadata`, {
            headers: {...ownerProof, 'If-Match': metadata.editToken}, data: {
                bindingDeadline: '2000-01-01T00:00:00', deadlineTz: 'UTC', allowRegCancelationAfterDeadline: false,
            },
        })).status()).toBe(200);
        expect((await actor.post(nativeCancel)).status()).toBe(403);
        const rejected = await actor.delete(registration, {headers: proof});
        expect(rejected.status()).toBe(403);
        expect(await rejected.json()).toMatchObject({code: 'EVENT_CANCELLATION_CLOSED'});
        const retained = await (await actor.get(`/api/v1/events/${event.id}`, {headers: proof})).json() as components['schemas']['EventView'];
        expect(retained.registration).toMatchObject(input);
        expect(retained.registrationCount).toBe(1);
    } finally {
        await actor.dispose();
    }
});

test('keeps native and versioned Event grants independent and requires both participant-export bits', async ({request, playwright, baseURL}) => {
    const event = await createFrontendEventFixture(request);
    const actor = await playwright.request.newContext({baseURL});
    try {
        const profileId = await enterIndependentEventGuest(actor, request, event.id);
        const proof = await frontendEventHeaders(actor);
        expect((await request.post(`/api/event/${event.id}/admins`, {data: {profileId, mask: 0}})).status()).toBe(200);
        for (const variant of [
            {mask: PERM.ACCESS_ADMIN, admin: true, roster: false, manage: false, exports: false},
            {mask: PERM.ACCESS_PARTICIPANTS, admin: false, roster: true, manage: false, exports: false},
            {mask: PERM.MANAGE_REGISTRATIONS, admin: false, roster: false, manage: true, exports: false},
            {mask: PERM.DATA_EXPORT, admin: false, roster: false, manage: false, exports: false},
            {mask: PERM.DATA_EXPORT | PERM.ACCESS_PARTICIPANTS, admin: false, roster: true, manage: false, exports: true},
        ]) {
            expect((await request.patch(`/api/event/${event.id}/admins/${profileId}`, {data: {mask: variant.mask}})).status()).toBe(200);
            // Read independent capabilities and exercise both real route families;
            // entering the admin page cannot stand in for roster/manager authority.
            const view = await (await actor.get(`/api/v1/events/${event.id}`, {headers: proof})).json() as components['schemas']['EventView'];
            expect(view.capabilities).toMatchObject({admin: variant.admin, participants: variant.roster,
                manageRegistrations: variant.manage, exportParticipants: variant.exports});
            expect((await actor.get(`/event/${event.id}/admin`)).status()).toBe(variant.admin ? 200 : 403);
            const entry = await (await actor.get(`/api/v1/events/${event.id}/entry?view=admin`, {headers: proof})).json() as components['schemas']['EventResourceEntry'];
            expect(entry.entry.kind).toBe(variant.admin ? 'render' : 'denied');
            for (const prefix of ['/api/event', '/api/v1/events']) {
                expect((await actor.get(`${prefix}/${event.id}/participants`, {headers: proof})).status()).toBe(variant.roster ? 200 : 403);
                expect((await actor.get(`${prefix}/${event.id}/links`, {headers: proof})).status()).toBe(variant.manage ? 200 : 403);
            }
            expect((await actor.get(`/event/${event.id}/export/participants`)).status()).toBe(variant.exports ? 200 : 403);
        }
    } finally {
        await actor.dispose();
    }
});

test('opens the native participant PDF from shared Event settings without granting administration', async ({request, browser, baseURL}) => {
    const event = await createFrontendEventFixture(request);
    const actor = await browser.newContext({baseURL, viewport: {width: 390, height: 900}});
    const page = await actor.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
        const profileId = await enterIndependentEventGuest(actor.request, request, event.id);
        expect((await request.post(`/api/event/${event.id}/admins`, {data: {
            profileId, mask: PERM.DATA_EXPORT | PERM.ACCESS_PARTICIPANTS,
        }})).status()).toBe(200);
        const proof = await frontendEventHeaders(actor.request);
        const view = await (await actor.request.get(`/api/v1/events/${event.id}`, {headers: proof})).json() as components['schemas']['EventView'];
        expect(view.capabilities).toMatchObject({admin: false, settings: true, exportParticipants: true});
        expect((await actor.request.get(`/event/${event.id}/admin`)).status()).toBe(403);

        // Exercise the same independently authorized settings action in each
        // running frontend. This actor has no general administration capability.
        for (const pilot of [false, true]) {
            await page.goto(`${pilot ? '/frontend-pilot' : ''}/event/${event.id}?locale=en`, {waitUntil: 'domcontentloaded'});
            if (pilot) await waitForPilotHydration(page);
            const origin = await page.evaluate(() => performance.timeOrigin);
            const nativeModal = page.locator('#entityPropertiesModal');
            const opener = page.getByRole('button', {name: 'Entity settings', exact: true});
            if (pilot) await opener.click();
            else await openModalForE2E(nativeModal, opener);
            const dialog = pilot ? page.getByRole('dialog') : nativeModal;
            const exportLink = dialog.getByRole('link', {
                name: pilot ? 'Participants (PDF)' : 'Export participants', exact: true,
            });
            await expect(exportLink).toBeVisible();
            await expect(exportLink).toHaveAttribute('href', `/event/${event.id}/export/participants`);
            await expect(exportLink).toHaveAttribute('target', '_blank');
            await expect(dialog.locator('input:not([type="hidden"]),textarea,select')).toHaveCount(0);
            await expectUsableFrontendLayout(dialog);

            // Follow the actual visible action, including its separate document
            // request, rather than substituting a direct API-only export check.
            const exported = actor.waitForEvent('response', response =>
                new URL(response.url()).pathname === `/event/${event.id}/export/participants`);
            await exportLink.click();
            const document = await exported;
            expect(document.status()).toBe(200);
            expect(document.headers()['content-type']).toContain('application/pdf');
            expect(await page.evaluate(() => performance.timeOrigin)).toBe(origin);
            for (const opened of actor.pages()) if (opened !== page) await opened.close();
            if (pilot) await dialog.locator('.modal-header .btn-close').click();
            else await closeModalForE2E(nativeModal);
        }

        // Removing either export bit must remove the action and its admission,
        // while preserving roster access and denying the protected PDF route.
        expect((await request.patch(`/api/event/${event.id}/admins/${profileId}`, {
            data: {mask: PERM.ACCESS_PARTICIPANTS},
        })).status()).toBe(200);
        await page.reload({waitUntil: 'domcontentloaded'});
        await waitForPilotHydration(page);
        await expect(page.getByRole('button', {name: 'Entity settings', exact: true})).toHaveCount(0);
        expect((await actor.request.get(`/event/${event.id}/export/participants`)).status()).toBe(403);
        expect((await actor.request.get(`/event/${event.id}/admin`)).status()).toBe(403);
        expect(errors).toEqual([]);
    } finally {
        await actor.close();
    }
});

test('binds Event settings to shared image, metadata, archive, automation and deletion operations', async ({request}) => {
    const event = await createFrontendEventFixture(request);
    const proof = await frontendEventHeaders(request);
    const settings = await (await request.get(`/api/v1/events/${event.id}/settings`, {headers: proof})).json() as components['schemas']['EventSettings'];
    const image = readFileSync('src/public/img/logo.png');
    const uploaded = await request.put(`/api/v1/events/${event.id}/header`, {headers: {...proof, 'If-Match': settings.settingsToken},
        multipart: {image: {name: 'event.png', mimeType: 'image/png', buffer: image}}});
    expect(uploaded.status()).toBe(200);
    const storedImage = await request.get(`/api/v1/events/${event.id}/header`, {headers: proof});
    expect(storedImage.status()).toBe(200);
    expect(await storedImage.body()).toEqual(image);
    const baseline = await (await request.get(`/api/v1/events/${event.id}/header/edit-baseline`, {headers: proof})).json() as components['schemas']['PackingHeaderBaseline'];
    expect((await request.delete(`/api/v1/events/${event.id}/header`, {headers: {...proof, 'If-Match': baseline.editToken}})).status()).toBe(200);
    expect((await request.get(`/event/${event.id}/header`)).status()).toBe(404);

    const metadata = await (await request.get(`/api/v1/events/${event.id}/metadata`, {headers: proof})).json() as components['schemas']['EventMetadata'];
    const changed = await request.patch(`/api/v1/events/${event.id}/metadata`, {headers: {...proof, 'If-Match': metadata.editToken}, data: {location: 'Changed campsite'}});
    expect(changed.status()).toBe(200);
    expect(await (await request.get(`/event/${event.id}`)).text()).toContain('Changed campsite');
    expect((await request.post(`/api/v1/events/${event.id}/archive`, {headers: proof})).status()).toBe(200);
    const archived = await (await request.get(`/api/v1/events/${event.id}`, {headers: proof})).json() as components['schemas']['EventView'];
    expect(archived.archive.direct).toBe(true);
    expect((await request.post(`/api/v1/events/${event.id}/restore`, {headers: proof})).status()).toBe(200);
    const restored = await (await request.get(`/api/v1/events/${event.id}`, {headers: proof})).json() as components['schemas']['EventView'];
    expect(restored.archive).toMatchObject({direct: false, autoArchivePaused: true});
    expect((await request.put(`/api/v1/events/${event.id}/automatic-archive`, {headers: proof, data: {paused: false}})).status()).toBe(200);
    const scheduled = await (await request.get(`/api/v1/events/${event.id}`, {headers: proof})).json() as components['schemas']['EventView'];
    expect(scheduled.archive.autoArchivePaused).toBe(false);
    expect((await request.delete(`/api/v1/events/${event.id}`, {headers: proof})).status()).toBe(200);
    expect((await request.get(`/event/${event.id}`)).status()).toBe(404);
});

for (const width of [1280, 390]) {
    test(`compares native and migrated Event registration at ${width}px`, async ({page}, testInfo) => {
        await page.setViewportSize({width, height: 900});
        const event = await createFrontendEventFixture(page.request);
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`/event/${event.id}`, {waitUntil: 'domcontentloaded'});
        await expect(page.locator('#arrivalDate')).toBeVisible();
        const nativeCard = page.locator('#registrationForm')
            .locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," card ")][1]');
        await expect(nativeCard).toContainText('Register for this event');
        await page.evaluate(() => document.fonts.ready);
        const native = await measureEventRegistration(nativeCard);
        await page.screenshot({path: testInfo.outputPath('native-event.png'), fullPage: true});

        await page.goto(`/frontend-pilot/event/${event.id}?locale=en`, {waitUntil: 'domcontentloaded'});
        await waitForPilotHydration(page);
        await expect(page.locator('#arrivalDate')).toBeEnabled();
        const migratedCard = page.locator('#registrationForm')
            .locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," card ")][1]');
        await expect(migratedCard).toContainText('Register for this event');
        await page.evaluate(() => document.fonts.ready);
        const migrated = await measureEventRegistration(migratedCard);
        await expectUsableFrontendLayout(migratedCard);
        await page.screenshot({path: testInfo.outputPath('pilot-event.png'), fullPage: true});
        await testInfo.attach('native-pilot-registration-metrics', {
            body: JSON.stringify({native, migrated}, null, 2), contentType: 'application/json',
        });
        compareEventRegistration(native, migrated);
        if (width === 390) await expectReadableDietaryChoices(migratedCard);
        const documentOrigin = await page.evaluate(() => performance.timeOrigin);
        const arrival = await page.locator('#arrivalDate').inputValue();
        const refreshed = page.waitForResponse(response => response.request().method() === 'GET'
            && new URL(response.url()).pathname === `/api/v1/events/${event.id}`);
        // The Event's root Refresh owns this detail read. Personal Finance can
        // expose another independently scoped control with the same label.
        await page.locator('main > section.card > .card-header .pilot-page-heading-actions')
            .getByRole('button', {name: 'Refresh', exact: true}).click();
        expect((await refreshed).status()).toBe(200);
        await expect(page.locator('#arrivalDate')).toHaveValue(arrival);
        expect(await page.evaluate(() => performance.timeOrigin)).toBe(documentOrigin);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
        expect(errors).toEqual([]);
    });
}
