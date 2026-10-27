import {expect, type APIRequestContext, type APIResponse, type Locator, type Page} from '@playwright/test';
import type {E2ECreateCase, E2ECreateForm} from '../factories/e2eCoreFactory';
import 'reflect-metadata';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import bcrypt from 'bcryptjs';
import {DataSource, In} from 'typeorm';
import {createE2EPasswordResetAccount} from '../factories/e2eCoreFactory';
import {apiCompatibility} from '../../.generated/api/v1/policy.mjs';
import type {components} from '../../src/types/api/v1';
import {PERM} from '../../src/backend/modules/lib/permissions';
import {waitForFrontendHydration} from './frontendDynamicKeywords';

export interface CreatedResource {
    title: string;
    path: string;
    id: string;
}

/** Read the browser's actual input contract for matching native/Vue controls.
 * Names and DOM wrappers identify implementations rather than user behavior;
 * constraints, keyboard hints, selectable values and current state do not.
 * Callers select their meaningful control set and compare the returned order. */
export async function readControlContracts(controls: Locator) {
    const result = await controls.evaluateAll(inspectBrowserPresentation, {selectors: null, generatedToken: false});
    return result.fields;
}

/** Select explicit named form fields without making native/Vue field names part
 * of the comparison. The feature owns its meaningful field list and order. */
export async function readNamedControlContracts(surface: Locator, names: readonly string[]) {
    const contracts = [];
    for (const name of names) {
        const control = surface.locator(`[name="${name}"]`);
        await expect(control, `Expected one field named ${name}`).toHaveCount(1);
        // Native modal visibility starts before its fade has painted the field.
        // Read the same real control after that lifecycle, never an absent entry.
        await expect.poll(readPaintedField, {message: `Field ${name} must be painted before comparison`}).toHaveLength(1);
        contracts.push((await readPaintedField())[0]);

        function readPaintedField() { return readControlContracts(control); }
    }
    return contracts;
}

/** Read meaningful financial instructions and retained secondary evidence.
 * A dialog portal or independently composed personal region must keep their
 * native readability treatment. Heading layout and exact pixels stay separate. */
export async function readSecondaryInstructionColors(surface: Locator): Promise<string[]> {
    // A dialog's subtitle is new contextual presentation, not a native body
    // instruction. Ordinary history/ledger callers already select their region.
    await expect(surface).toBeVisible();
    const body = surface.locator('.modal-body');
    const content = await body.count() ? body : surface;
    // Native opening can finish asynchronously after the delegated button click.
    // Read painted instructions after that lifecycle, independent of their tag.
    await expect.poll(readColors, {message: 'Meaningful secondary instructions must be painted before comparison'})
        .not.toHaveLength(0);
    return readColors();

    function readColors(): Promise<string[]> {
        return content.locator('.text-secondary').evaluateAll(function inspectInstructions(elements) {
            return elements.filter(element => element.checkVisibility({opacityProperty: true, visibilityProperty: true})
                && !!element.textContent?.trim()).map(element => getComputedStyle(element).color);
        });
    }
}

/** Use the ordinary shared dismissal when a confirmed notification covers the
 * next control. Errors and durable reconciliation notices are never suppressed. */
export async function dismissFrontendSuccessNotifications(page: Page): Promise<void> {
    // A modal can leave background notices painted but inaccessible. Select its
    // actual accessible Close controls, excluding errors and durable feedback.
    const closes = page.getByRole('button').and(page.locator(
        '[data-frontend-notices] .frontend-notification.alert-success.alert-dismissible > button.btn-close'));
    const initialCount = await closes.count();
    for (let remaining = initialCount; remaining > 0; remaining--) {
        // Normal dismissal changes the list; retain no positional locator from
        // the previous iteration. Natural expiry can already have emptied it.
        if (!await closes.count()) return;
        const close = closes.first();
        await expect(close).toHaveAccessibleName(/\S/u);
        await close.click();
    }
}

/** The 2026-10-23 approved Refresh placement adds one compact heading action.
 * Verify its accessible target and actual geometry before projecting only that
 * deliberate addition out of the unchanged native header comparison. */
export async function expectEmbeddedFrontendRefresh(surface: Locator): Promise<void> {
    const refresh = surface.locator('.frontend-page-heading-actions').getByRole('button', {name: 'Refresh', exact: true});
    await expect(refresh).toHaveCount(1);
    await expect(refresh).toBeVisible();
    await expect(refresh).toBeEnabled();
    await expect(refresh).toHaveAttribute('title', 'Refresh');
    await expect(refresh.locator('.bi')).toHaveCount(1);
    await expect(surface.locator('.bi-arrow-clockwise')).toHaveCount(1);
    const geometry = await refresh.evaluate(function inspectRefresh(control) {
        const header = control.closest('.card-header')!.getBoundingClientRect();
        const own = control.getBoundingClientRect();
        const heading = control.closest('.frontend-page-heading')!.querySelector('h1')!.getBoundingClientRect();
        const actions = [...control.closest('.frontend-page-heading-actions')!.querySelectorAll('a,button')]
            .filter(action => action !== control).map(action => action.getBoundingClientRect());
        // Header controls can wrap together on narrow screens. They must stay
        // inside the header and cannot paint over the title or another action.
        return {width: own.width, height: own.height,
            contained: own.left >= header.left - 1 && own.right <= header.right + 1
                && own.top >= header.top - 1 && own.bottom <= header.bottom + 1,
            overlaps: [heading, ...actions].some(box => Math.min(own.right, box.right) - Math.max(own.left, box.left) > 1
                && Math.min(own.bottom, box.bottom) - Math.max(own.top, box.top) > 1)};
    });
    expect(geometry.width).toBeGreaterThanOrEqual(30);
    expect(geometry.height).toBeGreaterThanOrEqual(30);
    expect(geometry.contained).toBe(true);
    expect(geometry.overlaps).toBe(false);
}

/** Read corresponding visible controls rather than framework-specific wrappers.
 * Callers select the surface and semantic elements whose presentation they own;
 * generated bearer text may differ. Raw styling and geometry remain visual review
 * evidence rather than a requirement to reproduce native DOM or pixel positions. */
export async function readVisiblePresentation(surface: Locator, selectors: string[], generatedToken = false) {
    await expect(surface).toHaveCount(1);
    const result = await surface.evaluateAll(inspectBrowserPresentation, {selectors, generatedToken});
    return result.presentation!;
}

/** Only the native inline action pair omits this aggregate word boundary.
 * Individual action text/contracts, styles, geometry and raw captures remain
 * unchanged; the phone comparison permits their requested separate rows. */
export function projectNativeMobileOverviewActions(presentation: Awaited<ReturnType<typeof readVisiblePresentation>>) {
    for (const label of ['Duplicate', 'Delete'])
        expect(presentation.content.elements.filter(element => element.text === label)).toHaveLength(1);
    expect(presentation.content.text.split('DuplicateDelete')).toHaveLength(2);
    return {...presentation, content: {...presentation.content,
        text: presentation.content.text.replace('DuplicateDelete', 'Duplicate Delete')}};
}

/** Check the actual phone layout before continuing the real card workflows.
 * Each ordinary action occupies its own complete row without covering another. */
export async function expectMobileOverviewActionRows(card: Locator): Promise<void> {
    const row = card.locator(':scope > .card-footer > .frontend-action-row');
    const rowBounds = (await row.boundingBox())!;
    expect(rowBounds.width).toBeGreaterThan(0);
    const actions = [row.getByRole('button', {name: /^Archival and visibility for /u}),
        row.getByRole('link', {name: 'Duplicate', exact: true}),
        row.getByRole('button', {name: 'Delete', exact: true})];
    let previousBottom = rowBounds.y;
    for (const action of actions) {
        await expect(action).toBeVisible();
        await expect(action).toBeEnabled();
        const bounds = (await action.boundingBox())!;
        expect(bounds.height).toBeGreaterThan(0);
        expect(Math.abs(bounds.x - rowBounds.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(bounds.width - rowBounds.width)).toBeLessThanOrEqual(1);
        expect(bounds.y).toBeGreaterThanOrEqual(previousBottom - 1);
        previousBottom = bounds.y + bounds.height;
    }
}

/** Compare the existing creation controls after opening the directly requested
 * compact permission panel. Callers retain raw screenshots/measurements first;
 * only its one added disclosure heading/button leaves the comparison value. */
export async function projectCreationPermissionDisclosure(surface: Locator, measured: Awaited<ReturnType<typeof readVisiblePresentation>>) {
    const heading = surface.locator('[data-creation-permissions] .accordion-header');
    if (await heading.count() === 0) return measured;
    await expect(heading).toHaveCount(1);
    const toggle = heading.locator('button');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const panelId = await toggle.getAttribute('aria-controls');
    expect(panelId).not.toBeNull();
    await expect(surface.locator(`[id="${panelId}"]`)).toBeVisible();
    const label = (await heading.innerText()).replace(/\s+/gu, ' ').trim();
    expect(label).not.toBe('');

    // Refuse an ambiguous match rather than stripping an unrelated field/value.
    // No permission checkbox, label, input constraint or audience is excluded.
    expect(measured.content.text.split(label)).toHaveLength(2);
    const matches = measured.content.elements.map((element, index) => ({element, index}))
        .filter(({element}) => element.text === label);
    expect(matches.length).toBeLessThanOrEqual(1);
    const omitted = matches[0]?.index;
    return {...measured, content: {...measured.content, text: measured.content.text.replace(label, '').replace(/\s+/gu, ' ').trim(),
        elements: measured.content.elements.filter((_element, index) => index !== omitted)},
        geometry: measured.geometry.filter((_bounds, index) => omitted === undefined || index !== omitted + 1)};
}

/** Playwright serializes this one self-contained browser inspector for both
 * public readers. Paint filtering, control meaning and text selection therefore
 * share one owner without importing application code or changing the document. */
function inspectBrowserPresentation(roots: Element[], selection: {selectors: string[] | null; generatedToken: boolean}) {
    const root = roots[0] as HTMLElement | undefined;
    const origin = root?.getBoundingClientRect();
    const token = selection.generatedToken ? root?.querySelector('h3')?.textContent?.trim() : undefined;
    const elements = selection.selectors === null ? roots
        : selection.selectors.length ? [...root!.querySelectorAll<HTMLElement>(selection.selectors.join(','))] : [];
    const selected = elements.filter(controlExposed);
    const fields = selected.map(contract);
    if (selection.selectors === null) return {fields, presentation: null};

    const content = selected.map(presentationElement);
    return {fields, presentation: {content: {text: visibleText(root!), style: appearance(root!), elements: content},
        geometry: [{x: origin!.x, y: 0, width: origin!.width, height: origin!.height}, ...selected.map(bounds)]}};

    /** Button-style choices expose the real clipped input through a painted
     * associated label. Keep that input's checked/value/disabled contract; the
     * clipping correction must not erase meaningful Survey ballot assertions. */
    function controlExposed(element: Element): boolean {
        if (visible(element)) return true;
        if (element instanceof HTMLInputElement && (element.type === 'radio' || element.type === 'checkbox'))
            return Array.from(element.labels ?? []).some(visible);
        return false;
    }

    /** The browser handles closed details, display/visibility and opacity.
     * Its visibility API does not account for Bootstrap's zero-area clipping:
     * those labels remain accessible while contributing no painted wording. */
    function visible(element: Element): boolean {
        if (!element.checkVisibility({opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true})) return false;
        for (let current: Element | null = element; current; current = current.parentElement)
            if (zeroClip(current)) return false;
        return true;
    }

    /** Recognize actual empty CSS clip regions, not label names or class names.
     * Ordinary scrolling and partially clipped table cells remain meaningful. */
    function zeroClip(element: Element): boolean {
        const style = getComputedStyle(element);
        if (style.clipPath === 'inset(50%)') return true;
        if (style.position !== 'absolute' && style.position !== 'fixed') return false;
        const rectangle = /^rect\((.*)\)$/u.exec(style.clip);
        if (!rectangle) return false;
        const edges = rectangle[1]!.split(/[,\s]+/u).map(Number.parseFloat);
        return edges.length === 4 && (edges[2]! <= edges[0]! || edges[1]! <= edges[3]!);
    }

    /** Keep native innerText for ordinary subtrees. Only an actual zero-area
     * descendant needs bounded text traversal; no product node is cloned,
     * removed or restyled, and no authored wording is stripped by substring. */
    function visibleText(element: Element): string {
        const clipped = [...element.querySelectorAll('*')].filter(zeroClip);
        const text = clipped.length ? textWithoutClipped(element, clipped) : (element as HTMLElement).innerText;
        const normalized = text.replace(/\s+/gu, ' ').trim();
        return token ? normalized.replace(token, '[generated migration token]') : normalized;
    }

    /** Preserve inline text adjacency and the browser's rendered block order.
     * Unaffected child subtrees still supply their exact innerText, including
     * select wording and native whitespace, rather than a general text engine. */
    function textWithoutClipped(element: Element, clipped: Element[]): string {
        if (clipped.includes(element)) return '';
        if (!clipped.some(element.contains.bind(element))) return (element as HTMLElement).innerText;
        let text = '';
        for (const child of element.childNodes) {
            if (child.nodeType === Node.TEXT_NODE) text += child.textContent ?? '';
            else if (child instanceof HTMLElement) {
                const display = getComputedStyle(child).display;
                // A hidden subtree's own innerText can fall back to textContent.
                // Keep it omitted, while display:contents retains its painted children.
                if (!visible(child) && display !== 'contents') continue;
                if (child.tagName === 'BR') text += '\n';
                else {
                    const content = textWithoutClipped(child, clipped);
                    // Inline wrappers keep punctuation/word adjacency. Real
                    // block/table boundaries retain the separation innerText
                    // supplies to the untouched native comparator.
                    const boundary = display === 'block' || display === 'flex' || display === 'grid'
                        || display.startsWith('table') || display === 'list-item';
                    text += boundary ? '\n' + content + '\n' : content;
                }
            }
        }
        return text;
    }

    function presentationElement(element: Element, index: number) {
        return {text: visibleText(element), style: appearance(element), field: fields[index] ?? null,
            refresh: element instanceof HTMLButtonElement && !!element.querySelector('.bi-arrow-clockwise')
                && ['Refresh', 'Aktualisieren'].includes(element.getAttribute('aria-label') ?? '')};
    }

    /** Local coordinates retain wrapping/spacing while allowing the already
     * approved surrounding shell or one-time native flash to shift the card. */
    function bounds(element: Element) {
        const rectangle = element.getBoundingClientRect();
        return {x: rectangle.x - origin!.x, y: rectangle.y - origin!.y,
            width: rectangle.width, height: rectangle.height};
    }

    function appearance(element: Element) {
        const style = getComputedStyle(element);
        return {font: style.fontFamily, size: style.fontSize, weight: style.fontWeight,
            lineHeight: style.lineHeight, color: style.color, background: style.backgroundColor,
            border: style.border, radius: style.borderRadius, padding: style.padding,
            margin: style.margin, display: style.display, opacity: style.opacity,
            shadow: style.boxShadow, textAlign: style.textAlign, verticalAlign: style.verticalAlign};
    }

    /** Keep effective browser defaults, including omitted HTML bounds.
     * Checkbox/radio machine values and button submit mechanics differ
     * legitimately between document forms and explicit SPA commands. */
    function contract(element: Element) {
        // :disabled includes the actual fieldset/option-group boundary;
        // a control's own disabled property cannot establish availability.
        if (element instanceof HTMLInputElement) {
            const toggle = element.type === 'checkbox' || element.type === 'radio';
            return {type: element.type, value: toggle ? null : element.value,
                checked: element.checked, required: element.required, disabled: element.matches(':disabled'),
                readOnly: element.readOnly, min: bound(element.min, element.type), max: bound(element.max, element.type), step: step(element),
                minLength: Math.max(0, element.minLength), maxLength: element.maxLength, pattern: element.pattern,
                accept: element.accept, multiple: element.multiple, inputMode: element.inputMode,
                autocomplete: autocomplete(element), placeholder: element.placeholder};
        }
        if (element instanceof HTMLTextAreaElement) {
            return {value: element.value, required: element.required, disabled: element.matches(':disabled'),
                readOnly: element.readOnly, minLength: Math.max(0, element.minLength), maxLength: element.maxLength,
                placeholder: element.placeholder, rows: element.rows, inputMode: element.inputMode,
                autocomplete: autocomplete(element)};
        }
        if (element instanceof HTMLSelectElement) {
            return {value: element.value, required: element.required, disabled: element.matches(':disabled'),
                multiple: element.multiple, selected: [...element.selectedOptions].map(option => option.value),
                options: [...element.options].map(option => ({text: option.text, value: option.value, disabled: option.matches(':disabled')}))};
        }
        if (element instanceof HTMLButtonElement) return {disabled: element.matches(':disabled')};
        // A shared disclosure can expose the same action through semantic
        // summary markup; its wrapper must not erase disabled-state checks.
        if (element.getAttribute('role') === 'button') return {disabled: element.getAttribute('aria-disabled') === 'true'};
        return null;
    }

    /** Omitted numeric bounds stay absent; alternate decimal spellings of
     * the same browser bound do not impose an implementation identity. */
    function bound(value: string, type: string): string | number | null {
        if (!value) return null;
        return type === 'number' || type === 'range' ? Number(value) : value;
    }

    /** Compare the effective step. Missing number/date steps already mean
     * one, and a missing time/datetime-local step already means one minute. */
    function step(input: HTMLInputElement): string | number | null {
        if (input.step === 'any') return 'any';
        if (input.step) return Number(input.step);
        if (input.type === 'time' || input.type === 'datetime-local') return 60;
        return ['number', 'range', 'date', 'week', 'month'].includes(input.type) ? 1 : null;
    }

    function autocomplete(input: HTMLInputElement | HTMLTextAreaElement): string {
        return input.autocomplete || input.form?.autocomplete || 'on';
    }
}

/** Inspect actual usability in the built application. Tables may scroll inside
 * their own region; ordinary headings/forms/actions must fit their container.
 * Hidden alternate controls are represented by their visible associated labels. */
export async function expectUsableFrontendLayout(surface: Locator): Promise<void> {
    const failures = await surface.evaluate(function inspectClipping(root) {
        const failures: string[] = [];
        const rootBox = root.getBoundingClientRect();
        if (rootBox.width <= 0 || rootBox.height <= 0) failures.push('Surface has no visible area');
        for (const element of root.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6,label,button,input,select,textarea')) {
            if (!element.checkVisibility({opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true})) continue;
            const style = getComputedStyle(element);
            if (style.clip !== 'auto' || style.clipPath !== 'none') continue;
            const box = element.getBoundingClientRect();
            if (box.width <= 0 || box.height <= 0) continue;
            if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) {
                // Native mismatched/empty for attributes are not a migration
                // requirement. Check actual accessible naming in the new renderer,
                // including slotted controls and explicit ARIA references.
                const labelledBy = (element.getAttribute('aria-labelledby') ?? '').split(/\s+/u)
                    .some(id => !!document.getElementById(id)?.textContent?.trim());
                const named = !!element.getAttribute('aria-label')?.trim() || labelledBy
                    || Array.from(element.labels ?? []).some(label => !!label.textContent?.trim())
                    || !!element.getAttribute('title')?.trim();
                if (!named) failures.push(`Unnamed ${element.tagName}: ${element.id || element.getAttribute('name') || element.type}`);
            }
            // A semantic table's intentionally wide cells remain reachable through
            // its scroll owner. This check targets clipped ordinary controls.
            if (element.closest('.table-responsive, table')) continue;
            for (let parent = element.parentElement; parent && root.contains(parent); parent = parent.parentElement) {
                const overflow = getComputedStyle(parent).overflowX;
                if (overflow !== 'hidden' && overflow !== 'clip') continue;
                const boundary = parent.getBoundingClientRect();
                if (box.left < boundary.left - 2 || box.right > boundary.right + 2) {
                    failures.push(`${element.tagName}: ${element.innerText || element.getAttribute('aria-label') || element.id}`);
                    break;
                }
            }
        }
        return failures;
    });
    expect(failures, 'Visible headings, labels and actions must remain reachable').toEqual([]);
}

export async function loginForE2E(request: APIRequestContext, credentials: {username: string; password: string}): Promise<void> {
    // Fixture setup uses the same protected JSON command as the production page.
    // Reading session admission supplies its current CSRF/context pair; writes are
    // single attempts, so an uncertain response never silently replays a command.
    const response = await request.post('/api/v1/auth/login', {
        headers: await commandHeadersForE2E(request),
        data: {username: credentials.username, password: credentials.password},
    });
    expect(response.status(), await response.text()).toBe(200);
}

/** Obtain the actual admitted browser command headers for this actor context. */
export async function commandHeadersForE2E(request: APIRequestContext): Promise<Record<string, string>> {
    const response = await request.get('/api/v1/session');
    expect(response.status()).toBe(200);
    const session = await response.json() as components['schemas']['SessionView'];
    return {Origin: new URL(response.url()).origin, 'X-Surveyor-Api-Compatibility': apiCompatibility,
        'X-Surveyor-Locale': session.locale,
        ...(session.context === null ? {} : {'X-Surveyor-Context': session.context, 'X-CSRF-Token': session.csrfToken!})};
}

/** Create an additional profile without changing this actor's selected profile. */
export async function createProfileForE2E(request: APIRequestContext, name: string): Promise<void> {
    const response = await request.post('/api/v1/profiles', {headers: await commandHeadersForE2E(request), data: {name}});
    expect(response.status(), await response.text()).toBe(200);
}

/** Select a real owned profile through the protected identity transition. */
export async function selectProfileForE2E(request: APIRequestContext, profileId: string): Promise<void> {
    const response = await request.put('/api/v1/auth/profile', {headers: await commandHeadersForE2E(request), data: {profileId}});
    expect(response.status(), await response.text()).toBe(200);
}

/** Establish a guest through its resource's actual scoped identity command. */
export async function registerGuestForE2E(request: APIRequestContext, collection: string, id: string,
    input: components['schemas']['GuestRegistrationInput']): Promise<void> {
    const response = await request.post(`/api/v1/${collection}/${id}/guest`, {
        headers: await commandHeadersForE2E(request), data: input,
    });
    expect(response.status(), await response.text()).toBe(200);
}

/** Read the current field-specific comparison before one fixture settings write.
 * Callers exercise subsequent browser behavior against actual persisted records;
 * no test-only HTTP route or unchecked database mutation supplies their state. */
export async function updateEntityDefaultsForE2E(request: APIRequestContext, collection: string, id: string,
    defaults: components['schemas']['PermissionDefaultsPatch']): Promise<void> {
    const path = `/api/v1/${collection}/${id}/default-permissions`;
    const baseline = await request.get(path, {headers: await commandHeadersForE2E(request)});
    expect(baseline.status()).toBe(200);
    const {editToken} = await baseline.json() as {editToken: string};
    const response = await request.put(path, {headers: {...await commandHeadersForE2E(request), 'If-Match': editToken}, data: defaults});
    expect(response.status(), await response.text()).toBe(200);
}

/** Convert named fixture checkbox grants to the authored bit-mask command. */
export async function updateEntityDefaultKeysForE2E(request: APIRequestContext, collection: string, id: string,
    defaults: Partial<Record<keyof components['schemas']['PermissionDefaults'], readonly string[]>>): Promise<void> {
    const masks = Object.fromEntries(Object.entries(defaults).map(([audience, keys]) => [audience,
        keys.reduce((mask, key) => mask | PERM[key as keyof typeof PERM], 0)]));
    await updateEntityDefaultsForE2E(request, collection, id, masks);
}

/** Link one fixture using its currently admitted parent/settings comparison. */
export async function updateEntityEventForE2E(request: APIRequestContext, collection: string, id: string,
    data: {eventId: string | null; expectedEventId: string | null}): Promise<void> {
    const response = await request.put(`/api/v1/${collection}/${id}/event`, {
        headers: await entitySettingsHeadersForE2E(request, collection, id), data,
    });
    expect(response.status(), await response.text()).toBe(200);
}

/** Admit a setting change from its current production comparison token. */
export async function entitySettingsHeadersForE2E(request: APIRequestContext, collection: string, id: string): Promise<Record<string, string>> {
    const response = await request.get(`/api/v1/${collection}/${id}/settings`, {headers: await commandHeadersForE2E(request)});
    expect(response.status()).toBe(200);
    const {settingsToken} = await response.json() as {settingsToken: string};
    return {...await commandHeadersForE2E(request), 'If-Match': settingsToken};
}

/** Change saved metadata through its current admitted baseline. This represents
 * another actual client for stale-draft tests, without bypassing the API's
 * conditional write or the shared controller's validation. */
export async function updateEntityMetadataForE2E(request: APIRequestContext, collection: string, id: string,
    data: Record<string, unknown>): Promise<void> {
    const path = `/api/v1/${collection}/${id}/metadata`;
    const baseline = await request.get(path, {headers: await commandHeadersForE2E(request)});
    expect(baseline.status()).toBe(200);
    // Packing's metadata comparison is its HTTP representation ETag; the other
    // metadata projections carry their authored editToken in the body.
    const editToken = collection === 'packing-lists' ? baseline.headers().etag : (await baseline.json()).editToken;
    expect(editToken).toBeTruthy();
    const response = await request.patch(path, {headers: {...await commandHeadersForE2E(request), 'If-Match': editToken}, data});
    expect(response.status(), await response.text()).toBe(200);
}

/** Add an explicit grant through the admitted settings command. */
export async function addEntityAdministratorForE2E(request: APIRequestContext, collection: string, id: string,
    profileId: string, mask: number): Promise<void> {
    const response = await request.post(`/api/v1/${collection}/${id}/admins`, {
        headers: await entitySettingsHeadersForE2E(request, collection, id), data: {profileId, mask},
    });
    expect(response.status(), await response.text()).toBe(200);
}

/** Change an existing explicit grant using that administrator's current token. */
export async function updateEntityAdministratorForE2E(request: APIRequestContext, collection: string, id: string,
    profileId: string, mask: number): Promise<void> {
    const path = `/api/v1/${collection}/${id}/admins/${profileId}`;
    const baseline = await request.get(path + '/edit-baseline', {headers: await commandHeadersForE2E(request)});
    expect(baseline.status()).toBe(200);
    const {editToken} = await baseline.json();
    const response = await request.patch(path, {headers: {...await commandHeadersForE2E(request), 'If-Match': editToken}, data: {mask}});
    expect(response.status(), await response.text()).toBe(200);
}

/**
 * Supply an isolated real account/token for HTTP password-reset assertions without SMTP,
 * seed-account mutation, repository mocks, or schema resets. Use production metadata and
 * established entity factories; callers receive only HTTP credentials/token, never the
 * datasource or repositories. Verify the actual selected E2E schema before inserting
 * or deleting this fixture's records; dedicated credentials remain a setup responsibility.
 */
export async function withPasswordResetAccountForE2E(
    exercise: (username: string, password: string, token: string) => Promise<void>,
): Promise<void> {
    /** Keep fixture insertion, exercise and exact-row cleanup inside the selected connection owner. */
    async function exerciseAccount(datasource: DataSource, requireBuilt: ReturnType<typeof createRequire>): Promise<void> {
        const {User} = requireBuilt('./dist/backend/modules/database/entities/user/User.js') as typeof import('../../src/backend/modules/database/entities/user/User');
        const {Profile} = requireBuilt('./dist/backend/modules/database/entities/user/Profile.js') as typeof import('../../src/backend/modules/database/entities/user/Profile');
        let userId: number | undefined;

        try {
            // Persist only this factory's isolated account/profile after the wrapper
            // has checked the actual database selected by the test configuration.
            const password = 'Previous-password!A1';
            const fixture = createE2EPasswordResetAccount(await bcrypt.hash(password, 10));
            const user = await datasource.getRepository(User).save(fixture.user);
            userId = user.id;
            await datasource.getRepository(Profile).save({...fixture.profile, user});
            await exercise(user.username, password, fixture.user.resetToken!);
        } finally {
            if (userId !== undefined) {
                // User deletion detaches profiles in the application, so remove this fixture's
                // own profile explicitly before its account rather than leaving an orphan.
                await datasource.getRepository(Profile).delete({user: {id: userId}});
                await datasource.getRepository(User).delete(userId);
            }
        }
    }

    await withBuiltE2EDatabase(exerciseAccount);
}

/** These handles identify only this workflow's disposable rows; no ORM owner escapes the fixture. */
export interface E2EProfileWorkflowFixture {
    account: {id: number; username: string; password: string; profileId: string};
    guest: {id: string; username: string; profileId: string; loginPath: string};
}

/** Supply independent account/guest actors for destructive document and migration journeys.
 * Use the existing selected-database checks and built production metadata. Empty
 * account contact can be selected for direct account deletion, while the guest has
 * no contact. No provider credentials or externally deliverable mailbox is installed. */
export async function withProfileWorkflowFixtureForE2E(
    exercise: (fixture: E2EProfileWorkflowFixture) => Promise<void>,
    accountContact: 'ordinary' | 'absent' = 'ordinary',
): Promise<void> {
    async function exerciseWorkflow(datasource: DataSource, requireBuilt: ReturnType<typeof createRequire>): Promise<void> {
        const {User} = requireBuilt('./dist/backend/modules/database/entities/user/User.js') as typeof import('../../src/backend/modules/database/entities/user/User');
        const {Profile} = requireBuilt('./dist/backend/modules/database/entities/user/Profile.js') as typeof import('../../src/backend/modules/database/entities/user/Profile');
        const {Guest} = requireBuilt('./dist/backend/modules/database/entities/user/Guest.js') as typeof import('../../src/backend/modules/database/entities/user/Guest');
        const userService = requireBuilt('./dist/backend/modules/database/services/UserService.js') as typeof import('../../src/backend/modules/database/services/UserService');
        const suffix = randomUUID().slice(0, 8);
        const password = 'Profile-workflow-password!A1';
        let userId: number | undefined;
        let guestId: string | undefined;
        const profileIds: string[] = [];

        try {
            // Use a unique account rather than mutating the shared seeded identity.
            // Direct account deletion skips mail for this existing empty-contact case.
            const user = await datasource.getRepository(User).save({username: `workflow-${suffix}`, name: `Workflow ${suffix}`,
                email: accountContact === 'absent' ? '' : `workflow-${suffix}@example.invalid`,
                password: await bcrypt.hash(password, 10), isActive: true});
            userId = user.id;
            const profile = await datasource.getRepository(Profile).save({name: user.name, defaultForOwner: true, user});
            profileIds.push(profile.id);
            const guest = await userService.createGuest(`Guest workflow ${suffix}`, null, datasource.manager);
            guestId = guest.id;
            profileIds.push(guest.profile.id);
            await exercise({account: {id: user.id, username: user.username, password, profileId: profile.id},
                guest: {id: guest.id, username: guest.username, profileId: guest.profile.id,
                    loginPath: `/guest/${guest.id}/login/${guest.token}`}});
        } finally {
            // Profile deletion/deactivation retains historical rows, and a transfer
            // may replace their owner. Exact captured IDs keep cleanup bounded.
            if (profileIds.length) await datasource.getRepository(Profile).delete({id: In(profileIds)});
            if (guestId !== undefined) await datasource.getRepository(Guest).delete(guestId);
            if (userId !== undefined) await datasource.getRepository(User).delete(userId);
        }
    }

    await withBuiltE2EDatabase(exerciseWorkflow);
}

/** Observe this fixture's actual saved ownership/token state without returning private credentials or relations. */
export async function readProfileWorkflowFixtureForE2E(fixture: E2EProfileWorkflowFixture) {
    async function readWorkflow(datasource: DataSource, requireBuilt: ReturnType<typeof createRequire>) {
        const {User} = requireBuilt('./dist/backend/modules/database/entities/user/User.js') as typeof import('../../src/backend/modules/database/entities/user/User');
        const {Guest} = requireBuilt('./dist/backend/modules/database/entities/user/Guest.js') as typeof import('../../src/backend/modules/database/entities/user/Guest');
        const {Profile} = requireBuilt('./dist/backend/modules/database/entities/user/Profile.js') as typeof import('../../src/backend/modules/database/entities/user/Profile');
        const profiles = await datasource.getRepository(Profile).find({where: {id: In([fixture.account.profileId, fixture.guest.profileId])}});
        const accountCount = await datasource.getRepository(User).countBy({id: fixture.account.id});
        const guestCount = await datasource.getRepository(Guest).countBy({id: fixture.guest.id});

        // Return only observable fixture facts. Browser evidence never carries a
        // password hash, migration token value, guest link token or live repository.
        return {accountCount, guestCount, profiles: profiles.map(function profileState(profile) {
            return {id: profile.id, userId: profile.userId ?? null, guestId: profile.guestId ?? null,
                hasMigrationToken: !!profile.migrationToken};
        })};
    }

    return withBuiltE2EDatabase(readWorkflow);
}

/** Read only this test's unique guest/profile names through the built entity metadata.
 * Independent name counts also reveal a failed creation's orphan profile; no repository,
 * connection, persistence operation or cleanup capability escapes this keyword. */
export async function readGuestRegistrationCountsForE2E(usernames: readonly string[]): Promise<{guests: number; profiles: number}> {
    if (!usernames.length || usernames.some(username => !username)) throw new Error('Guest counts require explicit nonempty test names.');

    async function readCounts(datasource: DataSource, requireBuilt: ReturnType<typeof createRequire>) {
        const {Guest} = requireBuilt('./dist/backend/modules/database/entities/user/Guest.js') as typeof import('../../src/backend/modules/database/entities/user/Guest');
        const {Profile} = requireBuilt('./dist/backend/modules/database/entities/user/Profile.js') as typeof import('../../src/backend/modules/database/entities/user/Profile');

        // Count the related production rows independently. A join to a surviving
        // guest would hide a profile left behind by a rejected guest operation.
        const [guests, profiles] = await Promise.all([
            datasource.getRepository(Guest).countBy({username: In([...usernames])}),
            datasource.getRepository(Profile).countBy({name: In([...usernames])}),
        ]);
        return {guests, profiles};
    }

    return withBuiltE2EDatabase(readCounts);
}

/** Observe signup completeness without returning the account's activation secret or password hash.
 * Names belong to this test alone; independent profile counts also expose partial/orphan rows. */
export async function readAccountRegistrationCountsForE2E(usernames: readonly string[]):
    Promise<{accounts: number; profiles: number; activationReady: number}> {
    if (!usernames.length || usernames.some(username => !username)) throw new Error('Account counts require explicit nonempty test names.');

    async function readCounts(datasource: DataSource, requireBuilt: ReturnType<typeof createRequire>) {
        const {User} = requireBuilt('./dist/backend/modules/database/entities/user/User.js') as typeof import('../../src/backend/modules/database/entities/user/User');
        const {Profile} = requireBuilt('./dist/backend/modules/database/entities/user/Profile.js') as typeof import('../../src/backend/modules/database/entities/user/Profile');
        const [accounts, profiles] = await Promise.all([
            datasource.getRepository(User).find({where: {username: In([...usernames])},
                select: {password: true, isActive: true, activationToken: true, activationTokenExpiration: true}}),
            datasource.getRepository(Profile).countBy({name: In([...usernames])}),
        ]);

        // Export completeness only. Neither trace/assertion output nor another
        // helper caller receives a reusable token, link or credential hash.
        let activationReady = 0;
        for (const account of accounts) {
            if (!account.isActive && account.password && account.activationToken
                && account.activationTokenExpiration && account.activationTokenExpiration.getTime() > Date.now()) activationReady++;
        }
        return {accounts: accounts.length, profiles, activationReady};
    }

    return withBuiltE2EDatabase(readCounts);
}

/** Own one connection to the selected built-server schema, with no synchronization/reset.
 * Read-only observations and mutation fixtures use the same metadata/target boundary.
 * Credential restrictions and database disposability belong to test setup: a fixture-only
 * grant inspection would run after ordinary E2E preparation has already reset the schema. */
async function withBuiltE2EDatabase<Result>(
    exercise: (datasource: DataSource, requireBuilt: ReturnType<typeof createRequire>) => Promise<Result>): Promise<Result> {
    const database = process.env.E2E_DB_NAME ?? '';
    if (!/e2e/i.test(database)) throw new Error('Refusing fixture access outside the selected E2E schema.');

    // E2E exercises the built application. Load that same compiled metadata rather than
    // asking Playwright's browser-oriented transform to interpret TypeORM decorators.
    const requireBuilt = createRequire(resolve('package.json'));
    const {entities} = requireBuilt('./dist/backend/modules/database/__index__.js') as typeof import('../../src/backend/modules/database/__index__');
    const datasource = new DataSource({
        type: 'mariadb', host: process.env.E2E_DB_HOST, port: Number(process.env.E2E_DB_PORT ?? '3306'),
        username: process.env.E2E_DB_USER, password: process.env.E2E_DB_PASSWORD, database,
        timezone: 'Z', entities, synchronize: false,
    });
    await datasource.initialize();

    try {
        const [target] = await datasource.query('SELECT DATABASE() AS name') as {name: string}[];
        if (target?.name !== database) throw new Error('Refusing an unexpected E2E fixture database.');

        // Each callback owns its isolated fixture writes/cleanup or bounded observation.
        // Keep the connection here and release it even when the application workflow fails.
        return await exercise(datasource, requireBuilt);
    } finally {
        await datasource.destroy();
    }
}

export async function createResourceViaForm(request: APIRequestContext, testCase: E2ECreateCase<E2ECreateForm>): Promise<CreatedResource> {
    // Historical fixture factories describe user inputs. Serialize them through
    // the current production command, including its actual permission catalog,
    // instead of keeping retired document POST adapters alive for test setup.
    const form = testCase.form as unknown as Record<string, unknown>;
    const url = new URL(testCase.createPath, 'http://fixture.test');
    const family = url.pathname.split('/')[1]!;
    const collections: Record<string, string> = {packing: 'packing-lists', drivers: 'drivers-lists',
        activity: 'activity-plans', survey: 'surveys', event: 'events'};
    const collection = collections[family];
    if (!collection) throw new Error(`Unsupported fixture family: ${family}`);
    const fields: Record<string, unknown> = {title: form.title, description: form.description ?? ''};
    if (family === 'survey') {
        fields.combinations = Object.keys(form).filter(key => /^combinations\[\d+\]\[weekday\]$/u.test(key))
            .map(key => ({weekday: form[key], nthWeek: form[key.replace('[weekday]', '[week]')]}));
    } else {
        const contextResponse = await request.get(`/api/v1/${collection}/create-context`, {
            headers: await commandHeadersForE2E(request),
        });
        expect(contextResponse.status(), await contextResponse.text()).toBe(200);
        const context = await contextResponse.json() as components['schemas']['EntityCreationContext'];
        const defaults = {...context.defaults};
        for (const audience of Object.keys(defaults) as Array<keyof typeof defaults>) {
            const keys = Object.keys(form).filter(key => key.startsWith(`defaultPerms[${audience}][`));
            if (keys.length) defaults[audience] = keys.reduce((mask, key) => {
                const permission = context.permissions.find(candidate => candidate.key === form[key]);
                if (!permission) throw new Error(`Unknown fixture permission: ${String(form[key])}`);
                return mask | permission.bit;
            }, 0);
        }
        fields.defaultPermissions = defaults;
        if (family !== 'event') fields.eventId = form.eventId || form.event_id || url.searchParams.get('eventId') || null;
        if (family === 'packing') fields.items = JSON.parse(String(form.items));
        if (family === 'activity') {
            // Historical fixtures group slots by civil day and call order `pos`.
            // The authored command carries a flat, closed slot shape instead.
            const groups = JSON.parse(String(form.slots)) as Record<string, Array<Record<string, unknown>>>;
            const slots = Object.entries(groups).flatMap(([day, entries]) => entries.map((slot, index) => ({
                id: slot.id ?? randomUUID(), day: slot.day ?? day, position: slot.pos ?? index,
                title: slot.title, description: slot.description ?? '', startTime: slot.startTime ?? null,
                endTime: slot.endTime ?? null, maxAssignees: slot.maxAssignees ?? 1,
            })));
            Object.assign(fields, {startDate: form.startDate, endDate: form.endDate, slots});
        }
        if (family === 'event') {
            for (const key of ['startDate', 'endDate', 'location', 'bindingDeadline', 'deadlineTz', 'maxParticipants'])
                if (form[key] !== undefined) fields[key] = form[key];
            for (const key of ['requireDietaryInfo', 'allowDietComment', 'allowRegDateUpdatesAfterDeadline',
                'allowRegCancelationAfterDeadline', 'allowRegDietUpdateAfterDeadline']) fields[key] = form[key] === 'on' || form[key] === true;
        }
    }
    const response = await request.post(`/api/v1/${collection}`, {headers: await commandHeadersForE2E(request),
        multipart: {data: JSON.stringify(fields)}});
    expect(response.status(), await response.text()).toBe(201);
    const {id} = await response.json() as {id: string};
    expect(id, `${testCase.title} should have a persisted resource id`).toBeTruthy();
    return {title: testCase.title, path: `/${family}/${id}`, id};
}

export async function expectPageContains(responsePromise: Promise<APIResponse>, expectedText: string): Promise<string> {
    return await expectPageContainsAll(responsePromise, [expectedText]);
}

export async function expectPageContainsAll(responsePromise: Promise<APIResponse>, expectedTexts: string[], context = 'page'): Promise<string> {
    const response = await responsePromise;
    expect(response.status(), `${context} should load successfully`).toBe(200);
    const body = await response.text();

    for (const expectedText of expectedTexts) {
        expect(body, `${context} should include ${expectedText}`).toContain(expectedText);
    }

    return body;
}

export async function expectCreatedResourceLoaded(page: Page, resource: CreatedResource, expectedTexts: string[]): Promise<void> {
    // The canonical document initially carries a loading skeleton. A useful
    // system canary proves that the integrated client loaded persisted fields.
    const response = await page.goto(resource.path + '?locale=en');
    expect(response?.status(), `${resource.title} should load successfully`).toBe(200);
    await waitForFrontendHydration(page);
    for (const expected of expectedTexts) await expect(page.locator('main')).toContainText(expected);
}
