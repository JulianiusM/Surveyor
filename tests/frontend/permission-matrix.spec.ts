import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {initPermMatrix} from '../../src/public/js/modules/perm-matrix';
import {initAdminMatrix} from '../../src/public/js/modules/admin-matrix';
import {registerEntityCommandHost} from '../../src/public/js/shared/ui-helpers';

/**
 * A small explicit DOM fixture keeps the production delegated handlers, command-host lookup and
 * HTTP serialization intact. Browser layout/focus stays in the built-page workflow; the renderer
 * check below separately exercises the actual grouped Pug markup and supplied permission metadata.
 */
class ElementStub extends EventTarget {
    id = '';
    dataset: Record<string, string> = {};
    classes = new Set<string>();
    children: ElementStub[] = [];
    parentElement: ElementStub | null = null;
    form: ElementStub | null = null;
    value = '';
    type = '';
    checked = false;
    disabled = false;
    hidden = false;
    label = '';

    constructor(public tagName = 'div', classes = '') {
        super();
        for (const name of classes.split(' ')) if (name) this.classes.add(name);
    }

    appendChild(child: ElementStub): ElementStub {
        child.parentElement = this;
        this.children.push(child);
        return child;
    }

    replaceChildren(): void { this.children = []; }
    get options(): ElementStub[] { return this.children; }

    matches(selector: string): boolean {
        if (selector.includes(', ')) {
            for (const part of selector.split(', ')) if (this.matches(part)) return true;
            return false;
        }
        if (selector.includes(':checked')) return this.checked && this.matches(selector.replace(':checked', ''));
        const audience = selector.match(/^\[data-permission-audience(?:="([^"]+)")?\]$/);
        if (audience) return this.dataset.permissionAudience !== undefined && (!audience[1] || audience[1] === this.dataset.permissionAudience);
        const id = selector.indexOf('#');
        if (id >= 0) return this.id === selector.slice(id + 1) && (!id || this.matches(selector.slice(0, id)));
        const typed = selector.match(/^(\w+)\[type="([^"]+)"\]$/);
        if (typed) return this.tagName === typed[1] && this.type === typed[2];
        const parts = selector.split('.');
        if (parts[0] && parts[0] !== this.tagName) return false;
        for (const name of parts.slice(1)) if (!this.classes.has(name)) return false;
        return true;
    }

    closest(selector: string): ElementStub | null {
        if (this.matches(selector)) return this;
        return this.parentElement?.closest(selector) || null;
    }

    querySelectorAll(selector: string): ElementStub[] {
        const found: ElementStub[] = [];
        for (const child of this.children) {
            if (child.matches(selector)) found.push(child);
            found.push(...child.querySelectorAll(selector));
        }
        return found;
    }

    querySelector(selector: string): ElementStub | null { return this.querySelectorAll(selector)[0] || null; }

    trigger(type: string, target: ElementStub = this): void {
        const event = new Event(type, {cancelable: true});
        Object.defineProperty(event, 'target', {value: target});
        this.dispatchEvent(event);
    }
}

const fetchMock = vi.fn<typeof fetch>();
const success = vi.fn();
const error = vi.fn();
let documentRoot: ElementStub;

function response(data: unknown = null): Response {
    return new Response(JSON.stringify({status: 'success', data}), {headers: {'content-type': 'application/json'}});
}

async function settle(): Promise<void> { await vi.advanceTimersByTimeAsync(0); }

beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockReset();
    success.mockReset();
    error.mockReset();
    documentRoot = new ElementStub('document');
    Object.assign(documentRoot, {createElement: (tag: string) => new ElementStub(tag)});
    vi.stubGlobal('document', documentRoot);
    vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

function permissionFixture() {
    const root = documentRoot.appendChild(new ElementStub('div', 'perm-matrix'));
    root.dataset.fieldBase = 'defaultPerms';
    const selector = root.appendChild(new ElementStub('select', 'perm-audience'));
    const panels: Record<string, ElementStub> = {};
    for (const audience of ['participant', 'guest', 'authenticated', 'public']) {
        const panel = root.appendChild(new ElementStub());
        panel.dataset.permissionAudience = audience;
        panel.hidden = audience !== 'participant';
        panels[audience] = panel;
        for (const [key, bit] of [['ACCESS_VIEW', '1'], ['EDIT_TITLE', '2']]) {
            const checkbox = panel.appendChild(new ElementStub('input', 'perm-box'));
            checkbox.value = key;
            checkbox.dataset.bit = bit;
        }
    }
    const save = root.appendChild(new ElementStub('button', 'btn-perm-update'));
    save.dataset.api = '/api/event/root/settings';
    registerEntityCommandHost(root as unknown as HTMLElement, {
        begin() { return {success, error}; },
        reportError: error,
    });
    initPermMatrix();

    function action(audience: string, className: string, mask?: string): void {
        const button = panels[audience].appendChild(new ElementStub('button', className));
        button.dataset.aud = audience;
        if (mask) button.dataset.mask = mask;
        documentRoot.trigger('click', button);
    }

    return {root, selector, panels, save, action};
}

describe('grouped permission editing', () => {
    it('preserves hidden audience drafts, applies presets within one audience, and submits empty masks', async () => {
        const view = permissionFixture();
        view.action('participant', 'perm-select-all');
        view.selector.value = 'guest';
        documentRoot.trigger('change', view.selector);
        expect(view.panels.participant.hidden).toBe(true);
        expect(view.panels.guest.hidden).toBe(false);
        view.action('guest', 'perm-preset', '1');
        view.action('public', 'perm-select-all');
        view.action('public', 'perm-clear');
        view.selector.value = 'participant';
        documentRoot.trigger('change', view.selector);
        expect(view.panels.participant.querySelectorAll('input.perm-box:checked')).toHaveLength(2);

        fetchMock.mockResolvedValue(response());
        documentRoot.trigger('click', view.save);
        await settle();
        expect(fetchMock).toHaveBeenCalledWith('/api/event/root/settings', expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({defaultPerms: {
                participant: ['ACCESS_VIEW', 'EDIT_TITLE'], guest: ['ACCESS_VIEW'], authenticated: [], public: [],
            }}),
        }));
        expect(success).toHaveBeenCalledWith('Permissions updated');
    });

    it('binds once and leaves drafts intact when a denied write is reported by its command host', async () => {
        const view = permissionFixture();
        initPermMatrix();
        view.action('guest', 'perm-select-all');
        view.save.disabled = true;
        documentRoot.trigger('click', view.save);
        expect(fetchMock).not.toHaveBeenCalled();
        view.save.disabled = false;
        fetchMock.mockRejectedValue(new Error('Not allowed'));
        documentRoot.trigger('click', view.save);
        await settle();
        expect(fetchMock).toHaveBeenCalledOnce();
        expect(error).toHaveBeenCalledWith(expect.objectContaining({message: 'Not allowed'}));
        expect(view.panels.guest.querySelectorAll('input.perm-box:checked')).toHaveLength(2);
    });

    it('does not discard permission drafts when an expired session redirects to an HTML login page', async () => {
        const view = permissionFixture();
        view.action('participant', 'perm-select-all');
        fetchMock.mockResolvedValue(new Response('<html>Sign in</html>', {headers: {'content-type': 'text/html'}}));
        documentRoot.trigger('click', view.save);
        await settle();
        expect(success).not.toHaveBeenCalled();
        expect(error).toHaveBeenCalledWith(expect.objectContaining({message: 'The change could not be confirmed. Please reload and try again.'}));
        expect(view.panels.participant.querySelectorAll('input.perm-box:checked')).toHaveLength(2);
    });

    it('renders every supplied permission once per audience, including unknown categories', () => {
        const require = createRequire(resolve('package.json'));
        const pug = require('pug');
        const source = 'include module_perm_matrix\n+permMatrix(audiences, permissions, defaults, presets, "defaultPerms", {inline:true,apiUrl:"/api/event/root/settings"})';
        const html = pug.render(source, {
            filename: resolve('src/views/modules/permission-matrix-fixture.pug'),
            audiences: ['participant', 'guest'], defaults: {participant: 1, guest: 4}, presets: [],
            permissions: [
                {key: 'ACCESS_VIEW', bit: 1, label: 'View'},
                {key: 'EDIT_TITLE', bit: 2, label: 'Title'},
                {key: 'NEW_CAPABILITY', bit: 4, label: 'New capability', desc: 'Explanation'},
            ],
        });
        expect((html.match(/class="form-check-input perm-box/g) || [])).toHaveLength(6);
        expect(html).toContain('Other permissions');
        expect(html).toContain('Permission help');
        expect(html).toContain('data-permission-audience="guest" hidden');
        expect(html).toContain('data-entity-draft-ignore');
        expect(html).not.toContain('<table');
    });
});

function administratorFixture() {
    const root = documentRoot.appendChild(new ElementStub('div', 'admin-matrix'));
    root.dataset.apiSearch = '/api/users/search';
    const editor = root.appendChild(new ElementStub('div', 'admin-inline'));
    editor.id = 'admin-add-modal';
    const form = editor.appendChild(new ElementStub('form'));
    const search = form.appendChild(new ElementStub('input'));
    search.type = 'text';
    search.form = form;
    const hidden = form.appendChild(new ElementStub('input'));
    hidden.id = 'admin-userId';
    hidden.type = 'hidden';
    const list = form.appendChild(new ElementStub('datalist'));
    initAdminMatrix();
    documentRoot.trigger('shown.bs.collapse', editor);
    return {form, search, hidden, list};
}

describe('inline administrator search', () => {
    it('rejects stale search responses and clears the hidden profile when the editor is cancelled', async () => {
        let completeOld!: (result: Response) => void;
        fetchMock.mockImplementationOnce(() => new Promise(resolve => { completeOld = resolve; }));
        fetchMock.mockResolvedValueOnce(response([{id: 'new', username: 'new-user'}]));
        const view = administratorFixture();
        view.search.value = 'old-user';
        view.search.trigger('input');
        view.search.value = 'new-user';
        view.search.trigger('input');
        await settle();
        expect(view.hidden.value).toBe('new');
        completeOld(response([{id: 'old', username: 'old-user'}]));
        await settle();
        expect(view.list.options[0].dataset.userId).toBe('new');
        view.form.trigger('reset');
        expect(view.hidden.value).toBe('');
        expect(view.list.options).toHaveLength(0);
    });

    it('allows the same search to retry after a failed request without retaining an old profile', async () => {
        fetchMock.mockRejectedValueOnce(new Error('Temporary failure'));
        fetchMock.mockResolvedValueOnce(response([{id: 'profile', username: 'user'}]));
        const view = administratorFixture();
        view.hidden.value = 'stale-profile';
        view.search.value = 'user';
        view.search.trigger('input');
        await settle();
        expect(view.hidden.value).toBe('');
        view.search.trigger('input');
        await settle();
        expect(view.hidden.value).toBe('profile');
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});
