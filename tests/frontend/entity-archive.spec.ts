import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {initEntityArchive} from '../../src/public/js/modules/entity-archive';
import {showInlineAlert} from '../../src/public/js/shared/alerts';

vi.mock('../../src/public/js/shared/alerts', () => ({showInlineAlert: vi.fn()}));

// Keep the production event binding, HTTP helper, and spinner helper in the test. This narrow DOM stub
// supplies only the button properties those helpers consume; fetch/alerts remain external boundaries.
class ButtonStub extends EventTarget {
    dataset: Record<string, string>;
    disabled = false;
    attributes = new Map<string, string>();
    spinnerHidden = true;
    root?: RootStub;
    constructor(action: string, url: string, confirmation?: string) {
        super();
        this.dataset = {archiveAction: action, archiveUrl: url};
        if (confirmation) this.dataset.archiveConfirm = confirmation;
    }
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    removeAttribute(name: string) { this.attributes.delete(name); }
    querySelector() {
        // showSpinner/hideSpinner locate a spinner descendant and toggle its d-none class. Track that
        // visible outcome without reproducing the full Pug markup (covered by the browser workflow).
        return {classList: {
            add: () => { this.spinnerHidden = true; },
            remove: () => { this.spinnerHidden = false; },
        }};
    }
    closest() { return this; }
    click() {
        const event = new Event('click');
        Object.defineProperty(event, 'target', {value: this});
        this.root?.dispatchEvent(event);
    }
}

class RootStub extends EventTarget {
    constructor(public buttons: ButtonStub[]) {
        super();
        for (const button of buttons) button.root = this;
    }
    querySelectorAll() { return this.buttons; }
    contains(button: ButtonStub) { return this.buttons.includes(button); }
    append(button: ButtonStub) { this.buttons.push(button); button.root = this; }
}

const fetchMock = vi.fn<typeof fetch>();
const reload = vi.fn();
const confirmation = vi.fn();
let dispose: (() => void) | undefined;

function bind(...buttons: ButtonStub[]) {
    // A page can expose the same entity more than once. One binding must coordinate all supplied buttons.
    const root = new RootStub(buttons);
    dispose = initEntityArchive(root as unknown as HTMLElement);
    return root;
}

function response(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});
}

async function settle() {
    // Flush the asynchronous HTTP result without advancing the separate, intentional reload delay.
    await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
    // No real navigation, dialogs, or network requests escape the fixture. Restore all globals below so
    // this database-free suite cannot influence another page module's tests in the shared runner.
    vi.useFakeTimers();
    vi.clearAllMocks();
    fetchMock.mockReset();
    confirmation.mockReturnValue(true);
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('window', {confirm: confirmation});
    vi.stubGlobal('location', {reload});
});

afterEach(() => {
    dispose?.();
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('entity archival controls', () => {
    it('handles cards inserted after initialization and shares the existing mutation lock', async () => {
        const existing = new ButtonStub('hidden', '/api/users/overview/event/existing/visibility');
        const root = bind(existing);
        const inserted = new ButtonStub('shown', '/api/users/overview/event/inserted/visibility');
        root.append(inserted);
        fetchMock.mockImplementation(() => new Promise(() => {}));
        inserted.click();
        existing.click();
        expect(fetchMock).toHaveBeenCalledOnce();
        expect(fetchMock).toHaveBeenCalledWith(inserted.dataset.archiveUrl, expect.objectContaining({body: JSON.stringify({visibility: 'shown'})}));
        expect(inserted.disabled).toBe(true);
        expect(existing.disabled).toBe(true);
    });

    it('saves private visibility without a warning, locks duplicate actions, and reloads only after success', async () => {
        const hide = new ButtonStub('hidden', '/api/users/overview/event/event-1/visibility');
        const duplicate = new ButtonStub('hidden', hide.dataset.archiveUrl);
        // Hold the response open to exercise the repeat-click window before the server confirms success.
        let complete!: (result: Response) => void;
        fetchMock.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
        bind(hide, duplicate);

        hide.click();
        duplicate.click();
        expect(confirmation).not.toHaveBeenCalled();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledWith(hide.dataset.archiveUrl, expect.objectContaining({
            method: 'POST', credentials: 'same-origin', body: JSON.stringify({visibility: 'hidden'}),
        }));
        expect(hide.disabled).toBe(true);
        expect(duplicate.disabled).toBe(true);
        expect(hide.spinnerHidden).toBe(false);
        expect(hide.attributes.get('aria-busy')).toBe('true');
        expect(reload).not.toHaveBeenCalled();

        complete(response({status: 'success'}));
        await settle();
        expect(showInlineAlert).toHaveBeenCalledWith('success', 'Hidden from your main overview.');
        expect(reload).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(500);
        expect(reload).toHaveBeenCalledOnce();
        // Success does not unlock stale controls while the replacement page is still loading.
        expect(duplicate.disabled).toBe(true);
    });

    it.each(['shown', 'default'])('sends the explicit %s visibility choice without an authoritative mutation', async visibility => {
        const button = new ButtonStub(visibility, '/api/users/overview/packing/list-1/visibility');
        fetchMock.mockResolvedValue(response({status: 'success'}));
        bind(button);
        button.click();
        await settle();
        expect(fetchMock).toHaveBeenCalledWith(button.dataset.archiveUrl, expect.objectContaining({body: JSON.stringify({visibility})}));
        expect(confirmation).not.toHaveBeenCalled();
    });

    it('allows cancelling an event-wide archival confirmation before changing anything', () => {
        const button = new ButtonStub('archive', '/api/event/event-1/archive', 'Archive the event and all attached entities?');
        confirmation.mockReturnValue(false);
        bind(button);
        button.click();
        expect(confirmation).toHaveBeenCalledWith(button.dataset.archiveConfirm);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(button.disabled).toBe(false);
        expect(reload).not.toHaveBeenCalled();
    });

    it('restores controls and surfaces server conflicts without changing overview placement', async () => {
        const restore = new ButtonStub('restore', '/api/activity/plan-1/restore');
        const unavailable = new ButtonStub('archive', '/api/event/event-1/archive');
        // A failed request must restore each original disabled state, not blindly enable the whole page.
        unavailable.disabled = true;
        fetchMock.mockResolvedValueOnce(response({status: 'error', message: 'Restore the event first.'}, 409));
        bind(restore, unavailable);
        restore.click();
        await settle();
        expect(showInlineAlert).toHaveBeenCalledWith('error', 'Restore the event first.');
        expect(restore.disabled).toBe(false);
        expect(restore.spinnerHidden).toBe(true);
        expect(restore.attributes.has('aria-busy')).toBe(false);
        expect(unavailable.disabled).toBe(true);
        await vi.advanceTimersByTimeAsync(1000);
        expect(reload).not.toHaveBeenCalled();

        // The same binding remains usable after failure; a new explicit click can succeed normally.
        fetchMock.mockResolvedValueOnce(response({status: 'success'}));
        restore.click();
        await settle();
        await vi.advanceTimersByTimeAsync(500);
        expect(reload).toHaveBeenCalledOnce();
    });

    it('does not mistake a redirected login page for a successful archival response', async () => {
        // fetch follows redirects by default. An HTTP 200 HTML login page is still not the API's success
        // envelope, so the UI must not acknowledge an archive command or reload as if it had persisted.
        const archive = new ButtonStub('archive', '/api/event/event-1/archive');
        fetchMock.mockResolvedValue(new Response('<html>Login</html>', {headers: {'content-type': 'text/html'}}));
        bind(archive);
        archive.click();
        await settle();
        expect(showInlineAlert).toHaveBeenCalledWith('error', expect.stringContaining('could not be confirmed'));
        expect(archive.disabled).toBe(false);
        await vi.advanceTimersByTimeAsync(1000);
        expect(reload).not.toHaveBeenCalled();
    });

    it.each([['pause', true], ['resume', false]] as const)('sets an explicit automation value for %s', async (action, paused) => {
        // Explicit values make stale-button clicks deterministic; they must never toggle server state.
        const button = new ButtonStub(action, '/api/event/event-1/archive/automation');
        fetchMock.mockResolvedValue(response({status: 'success'}));
        bind(button);
        button.click();
        await settle();
        expect(fetchMock).toHaveBeenCalledWith(button.dataset.archiveUrl, expect.objectContaining({body: JSON.stringify({paused})}));
    });

    it('unregisters handlers when the page is left', () => {
        const archive = new ButtonStub('archive', '/api/event/event-1/archive');
        bind(archive);
        dispose?.();
        archive.click();
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
