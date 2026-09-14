import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {cancelAlertDismissal, initAlertDismissal, scheduleAlertDismissal, showInlineAlert} from '../../src/public/js/shared/alerts';

class ElementStub extends EventTarget {
    parentElement: ElementStub | null = null;
    children: ElementStub[] = [];
    attributes = new Map<string, string>();
    classes = new Set<string>();
    textContent = '';
    hidden = false;
    removed = false;
    isRoot = false;
    focus = vi.fn();
    scrollIntoView = vi.fn();
    classList = {
        add: (...values: string[]) => values.forEach(value => this.classes.add(value)),
        contains: (value: string) => this.classes.has(value),
    };
    get isConnected(): boolean { return this.isRoot || (!!this.parentElement?.isConnected && !this.removed); }
    get role() { return this.attributes.get('role') ?? ''; }
    set role(value: string) { this.attributes.set('role', value); }
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    getAttribute(name: string) { return this.attributes.get(name) ?? null; }
    appendChild(element: ElementStub) { this.children.push(element); element.parentElement = this; return element; }
    contains(element: ElementStub): boolean { return element === this || this.children.some(child => child.contains(element)); }
    remove() { this.removed = true; this.parentElement!.children = this.parentElement!.children.filter(child => child !== this); this.parentElement = null; }
    matches(selector: string): boolean {
        return selector.includes('[role="alert"]') ? this.classes.has('alert') || this.role === 'alert'
            : this.hidden || this.classes.has('d-none') || this.attributes.get('aria-hidden') === 'true';
    }
    closest(selector: string): ElementStub | null { return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null; }
    querySelectorAll(selector: string): ElementStub[] {
        return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
    }
    getClientRects() { return this.closest('[hidden], .d-none, [aria-hidden="true"]') ? [] : [{}]; }
}

class ObserverStub {
    static current: ObserverStub;
    observe = vi.fn();
    disconnect = vi.fn();
    constructor(private callback: MutationCallback) { ObserverStub.current = this; }
    emit(target: ElementStub, type = 'childList', addedNodes: ElementStub[] = []) {
        this.callback([{target, type, addedNodes} as unknown as MutationRecord], this as unknown as MutationObserver);
    }
}

let root: ElementStub;
let dispose: (() => void) | undefined;
const elements: ElementStub[] = [];
const html = (element: ElementStub) => element as unknown as HTMLElement;

function alert(role = 'alert'): ElementStub {
    const element = root.appendChild(new ElementStub());
    element.classes.add('alert');
    element.role = role;
    elements.push(element);
    return element;
}

beforeEach(() => {
    vi.useFakeTimers();
    root = new ElementStub();
    root.isRoot = true;
    vi.stubGlobal('HTMLElement', ElementStub);
    vi.stubGlobal('MutationObserver', ObserverStub);
    vi.stubGlobal('document', {
        getElementById: () => root,
        createElement: () => { const element = new ElementStub(); elements.push(element); return element; },
    });
});

afterEach(() => {
    dispose?.();
    dispose = undefined;
    elements.forEach(element => cancelAlertDismissal(html(element)));
    elements.length = 0;
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('transient alert lifetime', () => {
    it('dismisses existing server alerts after ten seconds while preserving persistent status messages', () => {
        const flash = alert();
        const progress = alert('status');
        dispose = initAlertDismissal(html(root));
        vi.advanceTimersByTime(9999);
        expect(flash.removed).toBe(false);
        vi.advanceTimersByTime(1);
        expect(flash.removed).toBe(true);
        expect(progress.removed).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('starts a fresh ten seconds when a dynamic alert is inserted or its content is renewed', () => {
        dispose = initAlertDismissal(html(root));
        const message = alert();
        ObserverStub.current.emit(root, 'childList', [message]);
        vi.advanceTimersByTime(9000);
        message.textContent = 'A newer result';
        ObserverStub.current.emit(message);
        vi.advanceTimersByTime(9999);
        expect(message.removed).toBe(false);
        vi.advanceTimersByTime(1);
        expect(message.removed).toBe(true);
    });

    it('does not extend other alerts when unrelated DOM content changes or an older alert disappears', () => {
        const first = alert();
        dispose = initAlertDismissal(html(root));
        vi.advanceTimersByTime(2000);
        const second = alert();
        ObserverStub.current.emit(root, 'childList', [second]);
        vi.advanceTimersByTime(5000);
        const unrelated = root.appendChild(new ElementStub());
        ObserverStub.current.emit(root, 'childList', [unrelated]);
        vi.advanceTimersByTime(3000);
        expect(first.removed).toBe(true);
        expect(second.removed).toBe(false);
        ObserverStub.current.emit(root);
        vi.advanceTimersByTime(2000);
        expect(second.removed).toBe(true);
    });

    it('waits until an initially hidden alert becomes visible and cancels its timer when it becomes ongoing status', () => {
        const message = alert();
        message.hidden = true;
        dispose = initAlertDismissal(html(root));
        vi.advanceTimersByTime(10000);
        expect(message.removed).toBe(false);
        message.hidden = false;
        ObserverStub.current.emit(message, 'attributes');
        vi.advanceTimersByTime(5000);
        message.role = 'status';
        ObserverStub.current.emit(message, 'attributes');
        vi.advanceTimersByTime(10000);
        expect(message.removed).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('preserves reusable-region clearing callbacks across observer renewal and allows explicit cancellation', () => {
        const message = alert();
        const clear = vi.fn();
        const obsoleteCancel = scheduleAlertDismissal(html(message), clear);
        dispose = initAlertDismissal(html(root));
        obsoleteCancel();
        vi.advanceTimersByTime(10000);
        expect(clear).toHaveBeenCalledOnce();
        expect(message.removed).toBe(false);
        const cancel = scheduleAlertDismissal(html(message), clear);
        cancel();
        vi.advanceTimersByTime(10000);
        expect(clear).toHaveBeenCalledOnce();
    });

    it('cleans up pending timers for manually removed alerts and when the page observer stops', () => {
        const first = alert();
        alert();
        dispose = initAlertDismissal(html(root));
        first.remove();
        ObserverStub.current.emit(root);
        expect(vi.getTimerCount()).toBe(1);
        dispose();
        expect(ObserverStub.current.disconnect).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
        dispose = undefined;
    });

    it('renders inline feedback as text and schedules it without requiring the global observer', () => {
        showInlineAlert('error', '<img src=x onerror=alert(1)>');
        const message = root.children[0];
        expect(message.textContent).toBe('<img src=x onerror=alert(1)>');
        expect(message.children).toHaveLength(1);
        expect(message.children[0].getAttribute('aria-label')).toBe('Dismiss notification');
        vi.advanceTimersByTime(10000);
        expect(message.removed).toBe(true);
    });
});
