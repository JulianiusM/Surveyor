import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {bindInvoiceSubmission} from '../../src/public/js/modules/invoice-submission';

class ElementStub extends EventTarget {
    hidden = false;
    disabled = false;
    textContent: string | null = '';
    className = '';
    value = 0;
    attributes = new Map<string, string>();
    focus = vi.fn();
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    removeAttribute(name: string) { this.attributes.delete(name); }
}

class FormStub extends ElementStub {
    dataset: Record<string, string> = {};
    fields = new ElementStub();
    button = Object.assign(new ElementStub(), {textContent: 'Submit invoice'});
    feedback = new ElementStub();
    status = new ElementStub();
    progress = new ElementStub();
    history = new ElementStub();
    pool = {value: 'pool-1'};
    elements = {namedItem: (name: string) => name === 'poolId' ? this.pool : null};
    reportValidity = vi.fn(() => true);
    querySelector(selector: string) {
        return ({
            '[data-invoice-fields]': this.fields,
            '[type="submit"]': this.button,
            '[data-invoice-feedback]': this.feedback,
            '[data-invoice-status]': this.status,
            '[data-invoice-progress]': this.progress,
            '[data-invoice-history]': this.history,
        } as Record<string, ElementStub>)[selector];
    }
    submit() { this.dispatchEvent(new Event('submit', {cancelable: true})); }
}

class FormDataStub {
    fieldsCaptured: boolean;
    constructor(form: FormStub) { this.fieldsCaptured = !form.fields.disabled; }
}

class RequestStub {
    static requests: RequestStub[] = [];
    upload: {
        onprogress?: (event: {loaded: number; total: number; lengthComputable: boolean}) => void;
        onload?: () => void;
    } = {};
    onload?: () => void;
    onerror?: () => void;
    ontimeout?: () => void;
    onabort?: () => void;
    status = 0;
    responseText = '';
    timeout = 0;
    open = vi.fn();
    setRequestHeader = vi.fn();
    send = vi.fn();
    constructor() { RequestStub.requests.push(this); }
    respond(status: number, body: unknown) {
        this.status = status;
        this.responseText = JSON.stringify(body);
        this.onload?.();
    }
}

let browser: EventTarget & {location: {hash: string; reload: ReturnType<typeof vi.fn>}};

beforeEach(() => {
    vi.useFakeTimers();
    RequestStub.requests = [];
    browser = Object.assign(new EventTarget(), {location: {hash: '', reload: vi.fn()}});
    vi.stubGlobal('window', browser);
    vi.stubGlobal('FormData', FormDataStub);
    vi.stubGlobal('XMLHttpRequest', RequestStub);
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

function bind(form = new FormStub(), registered = true) {
    bindInvoiceSubmission(form as unknown as HTMLFormElement, {eventId: 'event-1', registered});
    return form;
}

describe('invoice submission feedback', () => {
    it('captures proof before locking fields and prevents duplicate requests or listener initialization', () => {
        const form = bind();
        bind(form);
        form.submit();
        form.submit();

        expect(RequestStub.requests).toHaveLength(1);
        expect(RequestStub.requests[0].send.mock.calls[0][0].fieldsCaptured).toBe(true);
        expect(RequestStub.requests[0].open).toHaveBeenCalledWith('POST', '/api/event/event-1/invoice-pools/pool-1/submit');
        expect(form.fields.disabled).toBe(true);
        expect(form.button.disabled).toBe(true);
        expect(form.fields.attributes.get('aria-busy')).toBe('true');
        expect(form.status.textContent).toContain('Uploading');
        expect(form.feedback.hidden).toBe(false);
        const leave = new Event('beforeunload', {cancelable: true});
        browser.dispatchEvent(leave);
        expect(leave.defaultPrevented).toBe(true);
    });

    it('reports upload progress, then saving, and explains a slow response without claiming success', () => {
        const form = bind();
        form.submit();
        const request = RequestStub.requests[0];
        request.upload.onprogress?.({loaded: 43, total: 100, lengthComputable: true});
        expect(form.progress.value).toBe(43);
        expect(form.status.textContent).toContain('40%');
        request.upload.onload?.();
        expect(form.status.textContent).toContain('Saving your invoice');
        expect(form.status.textContent).not.toContain('successfully');
        vi.advanceTimersByTime(10000);
        expect(form.status.textContent).toContain('Saving is taking longer');
        expect(form.status.textContent).toContain('do not submit again');
        expect(form.button.disabled).toBe(true);
    });

    it('keeps success visible with a history action and clears pending progress announcements', () => {
        const form = bind();
        form.submit();
        RequestStub.requests[0].respond(200, {status: 'success', message: 'invoice submitted'});
        vi.advanceTimersByTime(10000);

        expect(form.status.textContent).toContain('Invoice submitted successfully');
        expect(form.status.textContent).toContain('awaiting organizer review');
        expect(form.history.hidden).toBe(false);
        expect(form.history.textContent).toBe('View invoice history');
        expect(form.progress.hidden).toBe(true);
        expect(form.fields.attributes.get('aria-busy')).toBe('false');
        form.submit();
        expect(RequestStub.requests).toHaveLength(1);
        const leave = new Event('beforeunload', {cancelable: true});
        browser.dispatchEvent(leave);
        expect(leave.defaultPrevented).toBe(false);
        form.history.dispatchEvent(new Event('click'));
        expect(browser.location.hash).toBe('invoiceHistory');
        expect(browser.location.reload).toHaveBeenCalledOnce();
    });

    it('allows correction after a definite rejection and displays server errors as text', () => {
        const form = bind();
        form.submit();
        RequestStub.requests[0].respond(400, {status: 'error', message: 'Invalid <amount>'});

        expect(form.status.textContent).toBe('Invalid <amount>');
        expect(form.fields.disabled).toBe(false);
        expect(form.button.disabled).toBe(false);
        expect(form.button.textContent).toBe('Submit invoice');
        expect(form.history.hidden).toBe(true);
        form.submit();
        expect(RequestStub.requests).toHaveLength(2);
        expect(RequestStub.requests[1].send.mock.calls[0][0].fieldsCaptured).toBe(true);
    });

    it.each(['network', 'timeout', 'abort', 'server', 'unexpected response'])(
        'keeps an uncertain %s result locked and directs the participant to history before retrying', (failure) => {
            const form = bind();
            form.submit();
            const request = RequestStub.requests[0];
            if (failure === 'network') request.onerror?.();
            else if (failure === 'timeout') request.ontimeout?.();
            else if (failure === 'abort') request.onabort?.();
            else if (failure === 'server') request.respond(500, {status: 'error', message: 'Service unavailable'});
            else request.respond(200, '<html>Sign in</html>');
            vi.advanceTimersByTime(10000);

            expect(form.status.textContent).toContain('could not confirm');
            expect(form.status.textContent).toContain('Check invoice history before uploading it again');
            expect(form.history.textContent).toBe('Check invoice history');
            expect(form.history.hidden).toBe(false);
            expect(form.fields.disabled).toBe(true);
            expect(form.button.disabled).toBe(true);
            form.submit();
            expect(RequestStub.requests).toHaveLength(1);
        },
    );

    it('does not upload invalid forms or forms without a registration', () => {
        const invalid = bind();
        invalid.reportValidity.mockReturnValue(false);
        invalid.submit();
        expect(RequestStub.requests).toHaveLength(0);
        expect(invalid.fields.disabled).toBe(false);

        const unregistered = bind(new FormStub(), false);
        unregistered.submit();
        expect(RequestStub.requests).toHaveLength(0);
        expect(unregistered.status.textContent).toContain('must be registered');
        expect(unregistered.fields.disabled).toBe(false);
    });
});
