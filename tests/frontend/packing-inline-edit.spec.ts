// @vitest-environment happy-dom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {flushPromises} from '@vue/test-utils';
import {init as initPacking} from '../../src/public/js/packing';
import {startInlineEdit} from '../../src/public/js/shared/inline-edit';
import {createPermissionBundle} from '../factories/frontendCoreDynamicFactory';
import type {PermType} from '../../src/types/PermissionTypes';

const originalSurveyor = window.Surveyor;
const listeners: {type: string; listener: EventListenerOrEventListenerObject; options?: boolean | AddEventListenerOptions}[] = [];

afterEach(() => {
    for (const entry of listeners.splice(0)) document.removeEventListener(entry.type, entry.listener, entry.options);
    document.body.innerHTML = '';
    window.Surveyor = originalSurveyor;
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

/** Exercise the real packing initializer, browser permission engine and shared editor. */
function page(field: string, direct: PermType[], parent: PermType[] = []) {
    vi.useFakeTimers();
    const addListener = document.addEventListener.bind(document);
    vi.spyOn(document, 'addEventListener').mockImplementation((type, listener, options) => {
        listeners.push({type, listener: listener as EventListener, options});
        addListener(type, listener, options);
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const send = vi.fn(async () => new Response(JSON.stringify({status: 'success', message: 'Saved'}),
        {headers: {'Content-Type': 'application/json'}}));
    vi.stubGlobal('fetch', send);
    window.Surveyor = {entityId: 'list', permissions: createPermissionBundle(parent, direct, 'item')};
    document.body.innerHTML = '<table data-assignable><tbody data-reorderable><tr data-itemid="item" class="draggable">'
        + `<td data-edit="${field}" data-id="item">`
        + (field === 'maxAssignees' ? '<span data-count>0</span> / <span data-max>2</span>' : 'Original')
        + '</td></tr></tbody></table>';
    const cell = document.querySelector<HTMLElement>('td')!;
    initPacking();
    return {cell, send};
}

describe('native packing inline field permissions', () => {
    it.each([
        {field: 'title', direct: ['EDIT_META'], parent: [], value: 'Renamed'},
        {field: 'maxAssignees', direct: ['EDIT_META'], parent: [], value: '3'},
        {field: 'title', direct: [], parent: ['ITEM_EDIT'], value: 'Renamed'},
        {field: 'maxAssignees', direct: [], parent: ['ITEM_EDIT'], value: '3'},
    ])('saves $field with the original direct metadata or parent grant', async ({field, direct, parent, value}) => {
        const {cell, send} = page(field, direct as PermType[], parent as PermType[]);
        cell.dispatchEvent(new MouseEvent('dblclick', {bubbles: true}));
        const input = cell.querySelector('input');
        expect(input).not.toBeNull();
        input!.value = value;
        input!.dispatchEvent(new Event('blur'));
        await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
        const [url, options] = send.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe('/api/packing/list/item/item/attr');
        expect(JSON.parse(options.body as string)).toEqual({field, value});
    });

    it.each([
        {field: 'title', grant: 'EDIT_TITLE' as const},
        {field: 'maxAssignees', grant: 'EDIT_CAPACITY' as const},
    ])('retains the original metadata guard despite the $grant display affordance', ({field, grant}) => {
        const {cell, send} = page(field, [grant]);
        cell.dispatchEvent(new MouseEvent('dblclick', {bubbles: true}));
        expect(cell.querySelector('input')).toBeNull();
        expect(send).not.toHaveBeenCalled();
    });

    it('retains the original description payload without migration comparison fields', async () => {
        const {cell, send} = page('description', ['EDIT_DESC']);
        cell.textContent = '  Original description  ';
        cell.dispatchEvent(new MouseEvent('dblclick', {bubbles: true}));
        const input = cell.querySelector('input')!;
        input.value = 'Updated description';
        input.dispatchEvent(new Event('blur'));
        await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
        const [url, options] = send.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe('/api/packing/list/item/item/description');
        expect(JSON.parse(options.body as string)).toEqual({description: 'Updated description'});
    });

    it.each(['/api/drivers/list/item', '/api/activity/plan/slot'])('preserves the existing metadata guard for %s', baseUrl => {
        const {cell} = page('maxAssignees', ['EDIT_CAPACITY']);
        startInlineEdit(cell, baseUrl);
        expect(cell.querySelector('input')).toBeNull();
        window.Surveyor.permissions = createPermissionBundle([], ['EDIT_META'], 'item');
        startInlineEdit(cell, baseUrl);
        expect(cell.querySelector('input')).not.toBeNull();
    });
});

/** Reuse the real initializer and permission bundle; replace only its HTTP side effect. */
function everyonePage(required = false) {
    const result = page('description', [], ['ITEM_EDIT']);
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.dataset.requiredToggle = '';
    toggle.dataset.itemid = 'item';
    toggle.defaultChecked = required;
    result.cell.append(toggle);
    return {...result, toggle};
}

describe('native packing Everyone baseline', () => {
    it('retains boolean flag collection and the original page-load default before delayed reload', async () => {
        const {toggle, send} = everyonePage();
        toggle.checked = true;
        toggle.dispatchEvent(new Event('change', {bubbles: true}));
        await flushPromises();
        expect(toggle.defaultChecked).toBe(false);
        expect(toggle.disabled).toBe(false);
        toggle.checked = false;
        toggle.dispatchEvent(new Event('change', {bubbles: true}));
        await flushPromises();
        const bodies = send.mock.calls.map(call => JSON.parse((call as unknown as [string, RequestInit])[1].body as string));
        expect(bodies).toEqual([{flag: true}, {flag: false}]);
        expect(toggle.checked).toBe(false);
        expect(toggle.defaultChecked).toBe(false);
    });

    it('retains native overlapping toggle delivery and its late-rejection rollback', async () => {
        const {toggle, send} = everyonePage();
        let reject!: (reason: Error) => void;
        send.mockImplementationOnce(() => new Promise<Response>((_resolve, fail) => { reject = fail; }));
        toggle.checked = true;
        toggle.dispatchEvent(new Event('change', {bubbles: true}));
        expect(toggle.disabled).toBe(false);
        toggle.checked = false;
        toggle.dispatchEvent(new Event('change', {bubbles: true}));
        expect(toggle.checked).toBe(false);
        expect(send).toHaveBeenCalledTimes(2);
        // Complete the newer request before delivering the late rejection. The
        // native success branch reads the checkbox's current value after await.
        await flushPromises();
        expect(toggle.closest('tr')!.classList.contains('table-info')).toBe(false);
        // The existing native handler rolls back the current checkbox when the
        // earlier request fails. Migration must preserve it rather than adding
        // a pending lock or captured-original semantics to the native browser.
        reject(new Error('The saved value changed.'));
        await flushPromises();
        expect(toggle.checked).toBe(true);
        expect(toggle.defaultChecked).toBe(false);
        expect(toggle.disabled).toBe(false);
        expect(toggle.closest('tr')!.classList.contains('table-info')).toBe(false);
    });

    it('preserves the original native HTML-success delivery without adding an envelope check', async () => {
        const {toggle, send} = everyonePage(true);
        send.mockResolvedValueOnce(new Response('<form>Login</form>', {headers: {'Content-Type': 'text/html'}}));
        toggle.checked = false;
        toggle.dispatchEvent(new Event('change', {bubbles: true}));
        await flushPromises();
        // The original HTTP helper permits successful text, and this native
        // handler has no success-envelope guard. The pilot's v1 boundary is separate.
        expect(toggle.checked).toBe(false);
        expect(toggle.defaultChecked).toBe(true);
        expect(toggle.disabled).toBe(false);
        expect(send).toHaveBeenCalledOnce();
        expect(toggle.closest('tr')!.classList.contains('table-info')).toBe(false);
    });
});
