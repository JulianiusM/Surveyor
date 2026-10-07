// @vitest-environment happy-dom
import {afterEach, describe, expect, it, vi} from 'vitest';
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
        expect(JSON.parse(options.body as string)).toEqual({field, value});
    });

    it.each(['title', 'maxAssignees'])('does not allow EDIT_META alone to open packing %s', field => {
        const {cell, send} = page(field, ['EDIT_META']);
        cell.dispatchEvent(new MouseEvent('dblclick', {bubbles: true}));
        expect(cell.querySelector('input')).toBeNull();
        expect(send).not.toHaveBeenCalled();
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
