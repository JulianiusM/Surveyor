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
        {field: 'title', direct: ['EDIT_TITLE'], parent: [], value: 'Renamed'},
        {field: 'maxAssignees', direct: ['EDIT_CAPACITY'], parent: [], value: '3'},
        {field: 'title', direct: [], parent: ['ITEM_EDIT'], value: 'Renamed'},
        {field: 'maxAssignees', direct: [], parent: ['ITEM_EDIT'], value: '3'},
    ])('saves $field with its direct or parent field grant', async ({field, direct, parent, value}) => {
        const {cell, send} = page(field, direct as PermType[], parent as PermType[]);
        cell.dispatchEvent(new MouseEvent('dblclick', {bubbles: true}));
        const input = cell.querySelector('input');
        expect(input).not.toBeNull();
        input!.value = value;
        input!.dispatchEvent(new Event('blur'));
        await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
        const [url, options] = send.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe('/api/packing/list/item/item/attr');
        expect(JSON.parse(options.body as string)).toEqual({field, value, expectedValue: field === 'maxAssignees' ? 2 : 'Original'});
    });

    it.each(['title', 'maxAssignees'])('does not allow EDIT_META alone to open packing %s', field => {
        const {cell, send} = page(field, ['EDIT_META']);
        cell.dispatchEvent(new MouseEvent('dblclick', {bubbles: true}));
        expect(cell.querySelector('input')).toBeNull();
        expect(send).not.toHaveBeenCalled();
    });

    it('captures the complete original description for the locked comparison', async () => {
        const {cell, send} = page('description', ['EDIT_DESC']);
        cell.textContent = '  Original description  ';
        cell.dispatchEvent(new MouseEvent('dblclick', {bubbles: true}));
        const input = cell.querySelector('input')!;
        input.value = 'Updated description';
        input.dispatchEvent(new Event('blur'));
        await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
        const [url, options] = send.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe('/api/packing/list/item/item/description');
        expect(JSON.parse(options.body as string)).toEqual({description: 'Updated description', expectedValue: '  Original description  '});
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
    it('advances the saved comparison after a confirmed toggle before the delayed reload', async () => {
        const {toggle, send} = everyonePage();
        toggle.checked = true;
        toggle.dispatchEvent(new Event('change', {bubbles: true}));
        await flushPromises();
        expect(toggle.defaultChecked).toBe(true);
        expect(toggle.disabled).toBe(false);
        toggle.checked = false;
        toggle.dispatchEvent(new Event('change', {bubbles: true}));
        await flushPromises();
        const bodies = send.mock.calls.map(call => JSON.parse((call as unknown as [string, RequestInit])[1].body as string));
        expect(bodies).toEqual([{flag: true, expectedValue: false}, {flag: false, expectedValue: true}]);
        expect(toggle.checked).toBe(false);
        expect(toggle.defaultChecked).toBe(false);
    });

    it('admits one pending change and restores its captured original after rejection', async () => {
        const {toggle, send} = everyonePage();
        let reject!: (reason: Error) => void;
        send.mockImplementationOnce(() => new Promise<Response>((_resolve, fail) => { reject = fail; }));
        toggle.checked = true;
        toggle.dispatchEvent(new Event('change', {bubbles: true}));
        expect(toggle.disabled).toBe(true);
        toggle.checked = false;
        toggle.dispatchEvent(new Event('change', {bubbles: true}));
        expect(toggle.checked).toBe(true);
        expect(send).toHaveBeenCalledOnce();
        reject(new Error('The saved value changed.'));
        await flushPromises();
        expect(toggle.checked).toBe(false);
        expect(toggle.defaultChecked).toBe(false);
        expect(toggle.disabled).toBe(false);
        expect(toggle.closest('tr')!.classList.contains('table-info')).toBe(false);
    });

    it('does not advance its baseline when a redirected HTML response fails to confirm saving', async () => {
        const {toggle, send} = everyonePage(true);
        send.mockResolvedValueOnce(new Response('<form>Login</form>', {headers: {'Content-Type': 'text/html'}}));
        toggle.checked = false;
        toggle.dispatchEvent(new Event('change', {bubbles: true}));
        await flushPromises();
        expect(toggle.checked).toBe(true);
        expect(toggle.defaultChecked).toBe(true);
        expect(toggle.disabled).toBe(false);
    });
});
