// @vitest-environment happy-dom
import {describe, expect, it} from 'vitest';
import * as pug from 'pug';
import {resolve} from 'node:path';

const render = pug.compileFile(resolve('src/views/packing/packing-view.pug'));

/** Exercise the actual view with independent root and child grants, without a database. */
function packingView(rootKeys: string[] = [], itemKeys: string[] = []): HTMLElement {
    const root = new Set(rootKeys);
    const child = new Set(itemKeys);
    const container = document.createElement('div');
    container.innerHTML = render({
        status: undefined, messages: {}, version: 'test', nxtUrl: '/packing/list',
        settings: {imprintUrl: '/imprint', privacyPolicyUrl: '/privacy'},
        profile: {name: 'Reader', guestId: 'guest'}, admins: [], perms: {},
        permData: {entity: {has: (key: string) => root.has(key)},
            itemAllow: (_id: string, key: string, parentKey: string | string[] = key) =>
                child.has(key) || [parentKey].flat().some(candidate => root.has(candidate))},
        data: {list: {id: 'list', title: 'Shared equipment', description: 'First paragraph\n<Second line>'},
            archive: null, entityProperties: null, assignments: [],
            counters: {participants: 1, open: 1, empty: 0},
            items: [{id: 'tent', title: 'Tent', description: 'Two people', maxAssignees: 2,
                assignedCount: 1, requiredByAll: false, position: 0}],
            assigneeLists: {tent: [{id: 'assignment', name: 'Other participant'}]}},
    });
    return container;
}

describe('native packing permission-specific presentation', () => {
    it('retains escaped multiline description and visible assignees for an admitted read-only profile', () => {
        const page = packingView();
        expect(page.querySelector('#planDesc')?.innerHTML).toBe('First paragraph<br>&lt;Second line&gt;');
        expect(page.querySelector('tbody')?.textContent).toContain('Other participant');
        expect(page.querySelector('.card-body > .d-flex > span.fs-6.fw-semibold')?.textContent).toBe('Participants:1');
        expect(page.querySelectorAll('[data-edit], [data-required-toggle], [data-owner-remove], [data-delete-item]')).toHaveLength(0);
        // Original admission displays personal assignment controls independently
        // of their HTTP write grant. Preserve that baseline, including its hint.
        expect(page.querySelector('[data-action="assign"]')?.textContent).toBe('Take');
        expect(page.querySelector('#quickAddForm')).toBeNull();
        expect(page.textContent).toContain('Double click to edit');
        expect(page.querySelector('[data-packed]')).not.toBeNull();
    });

    it('keeps item creation independent from self-assignment or editing existing rows', () => {
        const page = packingView(['ITEM_ADD']);
        expect(page.querySelector('#quickAddForm')).not.toBeNull();
        expect(page.querySelectorAll('[data-edit], [data-required-toggle]')).toHaveLength(0);
        expect(page.querySelector('[data-action="assign"]')?.textContent).toBe('Take');
        expect(packingView(['ACCESS_VIEW']).querySelector('[data-action="assign"]')?.textContent).toBe('Take');
    });

    it.each([
        ['EDIT_TITLE', 'title'], ['EDIT_DESC', 'description'], ['EDIT_CAPACITY', 'maxAssignees'],
    ])('offers only the child field authorized by %s', (permission, field) => {
        const page = packingView([], [permission]);
        expect(Array.from(page.querySelectorAll('[data-edit]'), element => element.getAttribute('data-edit'))).toEqual([field]);
        expect(page.querySelector('[data-required-toggle]')).toBeNull();
        expect(page.querySelector('#quickAddForm')).toBeNull();
    });

    it('keeps broad child editing, assignee removal and deletion separate', () => {
        const editor = packingView(['ITEM_EDIT']);
        expect(editor.querySelectorAll('[data-edit]')).toHaveLength(3);
        expect(editor.querySelector('[data-required-toggle]')).not.toBeNull();
        expect(editor.querySelector('[data-owner-remove], [data-delete-item]')).toBeNull();
        const manager = packingView(['MANAGE_ASSIGNMENTS']);
        expect(manager.querySelector('[data-owner-remove]')).not.toBeNull();
        expect(manager.querySelector('[data-edit], [data-delete-item]')).toBeNull();
        const deleter = packingView(['ITEM_DELETE']);
        expect(deleter.querySelector('[data-delete-item]')).not.toBeNull();
        expect(deleter.querySelector('[data-edit], [data-owner-remove]')).toBeNull();
    });
});
