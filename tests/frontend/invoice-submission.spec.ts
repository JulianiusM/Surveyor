import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {bindInvoiceSubmission} from '../../src/public/js/modules/invoice-submission';
import {cancelAlertDismissal} from '../../src/public/js/shared/alerts';

class ElementStub extends EventTarget {
    parentElement: ElementStub | null = null;
    hidden = false;
    disabled = false;
    childNodes: {textContent: string | null}[] = [];
    get textContent(): string { return this.childNodes.map(node => node.textContent).join(''); }
    set textContent(value: string | null) { this.childNodes = [{textContent: value}]; }
    className = '';
    classList = {add: (...values: string[]) => { this.className = `${this.className} ${values.join(' ')}`.trim(); }};
    style = {width: ''};
    value = 0;
    attributes = new Map<string, string>();
    focus = vi.fn();
    scrollIntoView = vi.fn();
    appendChild(node: ElementStub) { this.childNodes.push(node); node.parentElement = this; return node; }
    remove() {
        if (this.parentElement) this.parentElement.childNodes = this.parentElement.childNodes.filter(node => node !== this);
        this.parentElement = null;
    }
    replaceChildren(...nodes: {textContent: string | null}[]) { this.childNodes = nodes; }
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    removeAttribute(name: string) { this.attributes.delete(name); }
}

class ProofStub {
    file: File | null = null;
    get value() { return this.file ? `C:\\fakepath\\${this.file.name}` : ''; }
    set value(value: string) {
        if (value !== '') throw new Error('A file input can only be cleared programmatically');
        this.file = null;
    }
}

class FormStub extends ElementStub {
    dataset: Record<string, string> = {};
    fields = new ElementStub();
    icon = {textContent: '', className: 'bi bi-cloud-upload me-1'};
    button = Object.assign(new ElementStub(), {childNodes: [this.icon, {textContent: 'Submit invoice'}]});
    feedback = new ElementStub();
    status = new ElementStub();
    progress = new ElementStub();
    progressBar = new ElementStub();
    history = new ElementStub();
    pool = {value: 'pool-1', options: [{value: 'pool-1'}, {value: 'chosen-pool'}]};
    amount = {value: '12.34'};
    description = {value: 'First invoice'};
    proof = Object.assign(new ProofStub(), {file: new File(['first proof'], 'first.pdf', {type: 'application/pdf'})});
    elements = {namedItem: (name: string) => {
        const inputs: Record<string, {value: string}> = {
            poolId: this.pool, amount: this.amount, description: this.description, proof: this.proof,
        };
        return inputs[name] ?? null;
    }};
    reportValidity = vi.fn(() => true);
    querySelector(selector: string) {
        return ({
            '[data-invoice-fields]': this.fields,
            '[type="submit"]': this.button,
            '[data-invoice-feedback]': this.feedback,
            '[data-invoice-status]': this.status,
            '[data-invoice-progress]': this.progress,
            '[data-invoice-progress-bar]': this.progressBar,
            '[data-invoice-history]': this.history,
        } as Record<string, ElementStub>)[selector];
    }
    submit() { this.dispatchEvent(new Event('submit', {cancelable: true})); }
}

class FormDataStub {
    fieldsCaptured: boolean;
    values: Map<string, string | File | null>;
    constructor(form: FormStub) {
        this.fieldsCaptured = !form.fields.disabled;
        this.values = new Map<string, string | File | null>([
            ['poolId', form.pool.value], ['amount', form.amount.value],
            ['description', form.description.value], ['proof', form.proof.file],
        ]);
    }
    get(name: string) { return this.values.get(name); }
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
let storage: Map<string, string>;
let alerts: ElementStub;
let createdElements: ElementStub[];

function latestAlert() {
    return alerts.childNodes[alerts.childNodes.length - 1] as ElementStub;
}

beforeEach(() => {
    vi.useFakeTimers();
    RequestStub.requests = [];
    browser = Object.assign(new EventTarget(), {location: {hash: '', reload: vi.fn()}});
    storage = new Map();
    alerts = new ElementStub();
    createdElements = [];
    vi.stubGlobal('document', {
        getElementById: (id: string) => id === 'liveAlerts' ? alerts : null,
        createElement: () => {
            const element = new ElementStub();
            createdElements.push(element);
            return element;
        },
        createTextNode: (textContent: string) => ({textContent}),
    });
    vi.stubGlobal('window', browser);
    vi.stubGlobal('sessionStorage', {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
    });
    vi.stubGlobal('FormData', FormDataStub);
    vi.stubGlobal('XMLHttpRequest', RequestStub);
});

afterEach(() => {
    createdElements.forEach(element => cancelAlertDismissal(element as unknown as HTMLElement));
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
        expect(form.status.className).toBe('alert alert-info mb-2');
        expect(form.status.scrollIntoView).toHaveBeenCalledWith({block: 'nearest'});
        expect(form.button.childNodes[0]).toMatchObject({className: 'spinner-border spinner-border-sm me-2'});
        expect(form.progressBar.style.width).toBe('100%');
        expect(form.progress.attributes.has('aria-valuenow')).toBe(false);
        const leave = new Event('beforeunload', {cancelable: true});
        browser.dispatchEvent(leave);
        expect(leave.defaultPrevented).toBe(true);
    });

    it('reports upload progress, then saving, and explains a slow response without claiming success', () => {
        const form = bind();
        form.submit();
        const request = RequestStub.requests[0];
        request.upload.onprogress?.({loaded: 43, total: 100, lengthComputable: true});
        expect(form.progress.attributes.get('aria-valuenow')).toBe('43');
        expect(form.progressBar.style.width).toBe('43%');
        expect(form.progressBar.textContent).toBe('43%');
        expect(form.status.textContent).toContain('40%');
        request.upload.onload?.();
        expect(form.status.textContent).toContain('Saving your invoice');
        expect(form.progress.attributes.get('aria-valuenow')).toBe('100');
        expect(form.status.textContent).not.toContain('successfully');
        vi.advanceTimersByTime(10000);
        expect(form.status.textContent).toContain('Saving is taking longer');
        expect(form.status.textContent).toContain('do not submit again');
        expect(form.button.disabled).toBe(true);
        expect(form.status.scrollIntoView).toHaveBeenCalledOnce();
        expect(alerts.childNodes).toHaveLength(0);
    });

    it('confirms success, clears invoice inputs and keeps the form locked until the automatic history refresh', () => {
        const form = bind();
        form.submit();
        RequestStub.requests[0].respond(200, {status: 'success', message: 'invoice submitted'});

        expect(latestAlert().textContent).toContain('Invoice submitted successfully');
        expect(latestAlert().textContent).toContain('awaiting organizer review');
        expect(latestAlert().className).toContain('alert-success');
        expect(latestAlert().focus).toHaveBeenCalledOnce();
        expect(alerts.scrollIntoView).toHaveBeenCalledWith(true);
        expect(form.history.hidden).toBe(false);
        expect(form.history.textContent).toBe('View invoice history');
        expect(form.progress.hidden).toBe(true);
        expect(form.fields.attributes.get('aria-busy')).toBe('false');
        expect(form.status.textContent).toContain('Refreshing your invoice history');
        expect(form.fields.disabled).toBe(true);
        expect(form.button.disabled).toBe(true);
        expect(form.button.textContent).toBe('Submitted');
        expect(form.amount.value).toBe('');
        expect(form.description.value).toBe('');
        expect(form.proof.value).toBe('');
        expect(form.proof.file).toBeNull();
        const leave = new Event('beforeunload', {cancelable: true});
        browser.dispatchEvent(leave);
        expect(leave.defaultPrevented).toBe(false);
        form.submit();
        expect(RequestStub.requests).toHaveLength(1);
        vi.advanceTimersByTime(999);
        expect(browser.location.reload).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(browser.location.hash).toBe('invoiceHistory');
        expect(browser.location.reload).toHaveBeenCalledOnce();
        vi.advanceTimersByTime(10000);
        expect(alerts.childNodes).toHaveLength(0);
        expect(browser.location.reload).toHaveBeenCalledOnce();
    });

    it('restores the chosen pool with blank enabled fields after refresh and accepts a new invoice', () => {
        const form = bind();
        form.pool.value = 'chosen-pool';
        const firstProof = form.proof.file;
        form.submit();
        const first = RequestStub.requests[0];
        first.respond(200, {status: 'success'});
        expect(form.pool.value).toBe('chosen-pool');
        vi.advanceTimersByTime(1000);
        const freshForm = new FormStub();
        freshForm.fields.disabled = true;
        freshForm.button.disabled = true;
        bind(freshForm);
        expect(freshForm.pool.value).toBe('chosen-pool');
        expect(freshForm.amount.value).toBe('');
        expect(freshForm.description.value).toBe('');
        expect(freshForm.proof.file).toBeNull();
        expect(freshForm.fields.disabled).toBe(false);
        expect(freshForm.button.disabled).toBe(false);
        expect(freshForm.button.childNodes[0]).toBe(freshForm.icon);
        expect(storage.size).toBe(0);
        expect(latestAlert().textContent).toContain('Invoice submitted successfully');
        expect(latestAlert().focus).toHaveBeenCalledOnce();
        expect(alerts.scrollIntoView).toHaveBeenCalledTimes(2);

        const secondProof = new File(['second proof'], 'second.png', {type: 'image/png'});
        freshForm.amount.value = '56.78';
        freshForm.description.value = 'Second invoice';
        freshForm.proof.file = secondProof;
        freshForm.submit();
        freshForm.submit();

        expect(RequestStub.requests).toHaveLength(2);
        const second = RequestStub.requests[1];
        expect(second.open).toHaveBeenCalledWith('POST', '/api/event/event-1/invoice-pools/chosen-pool/submit');
        const payload = second.send.mock.calls[0][0] as FormDataStub;
        expect(payload.fieldsCaptured).toBe(true);
        expect(payload.get('poolId')).toBe('chosen-pool');
        expect(payload.get('amount')).toBe('56.78');
        expect(payload.get('description')).toBe('Second invoice');
        expect(payload.get('proof')).toBe(secondProof);
        expect(first.send.mock.calls[0][0].get('proof')).toBe(firstProof);
        expect(freshForm.history.hidden).toBe(true);
        expect(freshForm.button.disabled).toBe(true);

        second.respond(200, {status: 'success'});
        expect(freshForm.proof.file).toBeNull();
        expect(freshForm.button.disabled).toBe(true);
    });

    it('ignores late callbacks from a completed request while waiting to refresh its history', () => {
        const form = bind();
        form.submit();
        const first = RequestStub.requests[0];
        first.respond(200, {status: 'success'});
        form.submit();
        const pendingStatus = form.status.textContent;

        first.upload.onprogress?.({loaded: 100, total: 100, lengthComputable: true});
        first.upload.onload?.();
        first.respond(200, {status: 'success'});
        first.respond(400, {status: 'error', message: 'Stale failure'});
        first.onerror?.();
        first.ontimeout?.();
        first.onabort?.();

        expect(form.status.textContent).toBe(pendingStatus);
        expect(form.amount.value).toBe('');
        expect(form.proof.file).toBeNull();
        expect(form.fields.disabled).toBe(true);
        expect(form.button.disabled).toBe(true);
        expect(form.fields.attributes.get('aria-busy')).toBe('false');
        expect(form.history.hidden).toBe(false);
        const leave = new Event('beforeunload', {cancelable: true});
        browser.dispatchEvent(leave);
        expect(leave.defaultPrevented).toBe(false);

        vi.advanceTimersByTime(10000);
        expect(form.status.textContent).toContain('Refreshing your invoice history');
        expect(browser.location.reload).toHaveBeenCalledOnce();
        expect(RequestStub.requests).toHaveLength(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('lets the history action refresh sooner without scheduling a second navigation', () => {
        const form = bind();
        form.submit();
        RequestStub.requests[0].respond(200, {status: 'success'});
        form.history.dispatchEvent(new Event('click'));
        expect(form.history.disabled).toBe(true);
        expect(form.history.textContent).toBe('Refreshing history…');
        expect(form.history.childNodes[0]).toMatchObject({className: 'spinner-border spinner-border-sm me-2'});
        form.history.dispatchEvent(new Event('click'));
        vi.advanceTimersByTime(10000);
        expect(browser.location.reload).toHaveBeenCalledOnce();
        expect(browser.location.hash).toBe('invoiceHistory');
    });

    it('ignores a saved pool that is no longer available and still refreshes when browser storage is blocked', () => {
        storage.set('surveyor:invoice-submission:event-1', 'closed-pool');
        const form = bind();
        expect(form.pool.value).toBe('pool-1');
        expect(form.amount.value).toBe('');
        vi.stubGlobal('sessionStorage', {setItem: () => { throw new Error('Storage blocked'); }});
        form.submit();
        RequestStub.requests[0].respond(200, {status: 'success'});
        vi.advanceTimersByTime(1000);
        expect(browser.location.reload).toHaveBeenCalledOnce();
    });

    it('allows correction after a definite rejection and displays server errors as text', () => {
        const form = bind();
        const proof = form.proof.file;
        form.submit();
        RequestStub.requests[0].respond(400, {status: 'error', message: 'Invalid <amount>'});

        expect(latestAlert().textContent).toBe('Invalid <amount>');
        expect(latestAlert().className).toContain('alert-danger');
        expect(alerts.scrollIntoView).toHaveBeenCalledWith(true);
        expect(form.feedback.hidden).toBe(true);
        expect(form.status.textContent).toBe('');
        expect(form.fields.disabled).toBe(false);
        expect(form.button.disabled).toBe(false);
        expect(form.button.textContent).toBe('Submit invoice');
        expect(form.button.childNodes[0]).toBe(form.icon);
        expect(form.amount.value).toBe('12.34');
        expect(form.description.value).toBe('First invoice');
        expect(form.proof.file).toBe(proof);
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
            expect(form.status.className).toBe('alert alert-danger mb-2');
            expect(form.status.scrollIntoView).toHaveBeenCalledTimes(2);
            expect(form.status.focus).toHaveBeenCalledOnce();
            expect(form.fields.disabled).toBe(true);
            expect(form.button.disabled).toBe(true);
            expect(browser.location.reload).not.toHaveBeenCalled();
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
        expect(latestAlert().textContent).toContain('must be registered');
        expect(unregistered.fields.disabled).toBe(false);
    });
});
