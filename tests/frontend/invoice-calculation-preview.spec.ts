import {afterEach, describe, expect, it, vi} from 'vitest';
import {renderPoolCalculationPreview} from '../../src/public/js/events';

type Preview = Parameters<typeof renderPoolCalculationPreview>[1];

class NodeStub {
    hidden = true;
    dataset: Record<string, string> = {};
    children: NodeStub[] = [];
    className = '';
    attributes = new Map([['hidden', '']]);
    private content = '';
    get textContent(): string { return this.content + this.children.map(child => child.textContent).join(''); }
    set textContent(value: string) { this.content = value; this.children = []; }
    appendChild(child: NodeStub) { this.children.push(child); return child; }
    append(...children: NodeStub[]) { this.children.push(...children); }
    replaceChildren() { this.children = []; this.content = ''; }
    removeAttribute(name: string) { this.attributes.delete(name); }
}

function previewModal() {
    const elements = Object.fromEntries([
        'rows', 'outstanding', 'refunds', 'table', 'summary', 'reconciliation', 'rounding-note',
        'total:invoiceAmount', 'total:roundingDifference', 'total:expectedNetAmount', 'total:calculatedAmount', 'total:remainingAmount',
    ].map(name => [name, new NodeStub()]));
    const modal = Object.assign(new NodeStub(), {
        querySelector(selector: string) {
            const total = /^\[data-preview-total="(.+)"\]$/.exec(selector)?.[1];
            if (total) return elements[`total:${total}`];
            if (selector === '[data-preview-rounding-note]') return elements['rounding-note'];
            const name = /^\[data-pool-preview-(.+)]$/.exec(selector)?.[1];
            return name ? elements[name] : null;
        },
    });
    vi.stubGlobal('document', {createElement: () => new NodeStub()});
    return {modal: modal as unknown as HTMLElement, elements};
}

function share(overrides: Partial<Preview['shares'][number]> = {}): Preview['shares'][number] {
    return {
        registrationId: 1, payerName: 'Participant', baseShareAmount: 75, extraAmount: 0,
        invoiceCreditAmount: 0, paymentCreditAmount: 50, shareAmount: 25, isPaid: false, ...overrides,
    };
}

afterEach(() => vi.unstubAllGlobals());

describe('invoice calculation preview', () => {
    it.each([
        [0.01, 100.01, 'up adds 0.01'],
        [-0.01, 99.99, 'down leaves a shortfall of 0.01'],
    ] as const)('explains the rounding difference %s separately from recorded settlements', (roundingDifference, calculatedAmount, note) => {
        const {modal, elements} = previewModal();
        const remaining = Math.round((calculatedAmount - 50) * 100) / 100;
        renderPoolCalculationPreview(modal, {revision: 7, shares: [share({shareAmount: remaining})], totals: {
            invoiceAmount: 100, redistributedAmount: -20, distributableAmount: 120,
            allocatedBaseAmount: calculatedAmount + 20, roundingDifference, adjustmentAmount: -20,
            grossAmount: calculatedAmount, invoiceCreditAmount: 0, expectedNetAmount: 100,
            calculatedAmount, paymentCreditAmount: 50, outstandingAmount: remaining, creditAmount: 0,
        }});
        expect(elements['total:invoiceAmount'].textContent).toBe('100.00');
        expect(elements['total:expectedNetAmount'].textContent).toBe('100.00');
        expect(elements['total:calculatedAmount'].textContent).toBe(calculatedAmount.toFixed(2));
        expect(elements['total:remainingAmount'].textContent).toBe(remaining.toFixed(2));
        expect(elements['rounding-note'].textContent).toContain(note);
        expect(elements.reconciliation.hidden).toBe(false);
    });

    it('rejects incomplete reconciliation totals before allowing the preview revision to be applied', () => {
        const {modal} = previewModal();
        expect(() => renderPoolCalculationPreview(modal, {
            revision: 1, shares: [share()], totals: {invoiceAmount: 100} as Preview['totals'],
        })).toThrow('totals could not be verified');
        expect(modal.dataset.previewRevision).toBeUndefined();
    });

    it('shows settlement credits, remaining payments and refunds with participant details rendered as text', () => {
        const {modal, elements} = previewModal();
        const payerName = '<img src=x onerror=alert(1)> & Participant';
        const note = '<script>alert(1)</script> • Paid train tickets';
        renderPoolCalculationPreview(modal, {revision: 4, shares: [
            share({payerName, note}),
            share({registrationId: 2, baseShareAmount: 30, paymentCreditAmount: 40, shareAmount: -10}),
            share({registrationId: 3, baseShareAmount: 20, paymentCreditAmount: 20, shareAmount: 0, isPaid: true}),
        ]});
        const rows = elements.rows.children;
        expect(rows).toHaveLength(3);
        expect(rows[0].textContent).toContain(payerName);
        expect(rows[0].textContent).toContain('<script>alert(1)</script>');
        expect(rows[0].children.find(cell => cell.dataset.label === 'Previously settled')!.textContent).toBe('50.00');
        expect(rows[0].children.find(cell => cell.dataset.label === 'Remaining due / refund')!.textContent).toBe('25.00To pay');
        expect(rows[1].children.find(cell => cell.dataset.label === 'Remaining due / refund')!.textContent).toBe('-10.00Refund due');
        expect(rows[2].children.find(cell => cell.dataset.label === 'Remaining due / refund')!.textContent).toBe('0.00Settled');
        expect(elements.outstanding.textContent).toBe('25.00');
        expect(elements.refunds.textContent).toBe('10.00');
        expect(elements.table.attributes.has('hidden')).toBe(false);
        expect(modal.dataset.previewRevision).toBe('4');
    });

    it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects an invalid revision of %s', (revision) => {
        const {modal, elements} = previewModal();
        expect(() => renderPoolCalculationPreview(modal, {revision, shares: [share()]})).toThrow('could not be verified');
        expect(modal.dataset.previewRevision).toBeUndefined();
        expect(elements.rows.children).toHaveLength(0);
    });

    it.each([NaN, Infinity, '', null])('rejects an invalid settlement amount %s', (amount) => {
        const {modal} = previewModal();
        const invalidShare = share({paymentCreditAmount: amount as number});
        expect(() => renderPoolCalculationPreview(modal, {revision: 1, shares: [invalidShare]})).toThrow('could not be verified');
        expect(modal.dataset.previewRevision).toBeUndefined();
    });
});
