// @vitest-environment happy-dom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {DOMWrapper, flushPromises} from '@vue/test-utils';
import type {components} from '../../src/types/api/v1';
import FinanceSettlement from '../../src/frontend/features/finance/FinanceSettlement.vue';
import FinanceShares from '../../src/frontend/features/finance/FinanceShares.vue';
import {ApiFailure} from '../../src/frontend/app/transport';
import {frontendEventId as eventId} from '../factories/frontendEventFactory';
import {frontendEventButton as button, frontendEventJson as json, mountFrontendEvent} from '../keywords/frontendEventKeywords';

const poolId = '22222222-2222-4222-8222-222222222222';
const saved: components['schemas']['FinanceShare'] = {id: '2', poolId, poolName: '<Saved pool>', payerName: '<Alice>',
    notes: [], needsRecalculation: true, amount: '30.00', status: 'due', statusLabel: 'Payment due', isPaid: false,
    caption: 'Amount to collect', settledShareNotice: null, coveredNames: [], coverageKnown: true};
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
    vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = '';
});

/** Exercise the real dialog, command guard and generated settlement transport.
 * Only the external HTTP delivery and parent-owned saved read are supplied. */
async function mountSettlement(share = saved, handler = async (_request: Request) => json({changed: true}),
    refresh = vi.fn(async () => {})) {
    const mounted = await mountFrontendEvent(FinanceSettlement, handler,
        {eventId, share, currentShare: share, open: true, active: true, refresh});
    cleanups.push(mounted.dispose);
    const dialog = new DOMWrapper(document.querySelector<HTMLElement>('[role="dialog"]')!);
    return {...mounted, dialog, refresh};
}

/** Mount the shared organizer/personal ledger without replacing its display
 * selection, rendered controls, common footer or admitted application context. */
async function mountLedger(shares = [saved], extra: Record<string, unknown> = {}) {
    const mounted = await mountFrontendEvent(FinanceShares, async () => json({changed: true}),
        {shares, admin: true, settlement: true, ...extra});
    cleanups.push(mounted.dispose);
    return mounted;
}

describe('P9 signed saved-share settlement', () => {
    it.each([
        ['30.00', false, 'due', 'Record payment', true],
        ['-60.00', false, 'refund', 'Record refund', true],
        ['30.00', true, 'settled', 'Undo payment', false],
        ['-60.00', true, 'settled', 'Undo refund', false],
    ] as const)('captures %s paid=%s for explicit confirmation and sends the intended marker once', async (amount, isPaid, status, label, desired) => {
        const mounted = await mountSettlement({...saved, amount, isPaid, status});
        expect(mounted.request).not.toHaveBeenCalled();
        expect(mounted.dialog.get('.modal-title').text()).toBe('Confirm invoice action');
        expect(mounted.dialog.text()).toContain(amount);
        expect(mounted.dialog.text()).toContain('<Alice>');
        expect(mounted.dialog.find('alice').exists()).toBe(false);

        // Same-row reads cannot replace the original signed review or operation.
        await mounted.wrapper.setProps({share: {...saved, amount: '99.00', isPaid: !isPaid, status: 'settled'}});
        expect(mounted.dialog.get('[data-finance-confirm-settlement]').text()).toBe(label);
        await mounted.dialog.get('[data-finance-confirm-settlement]').trigger('click'); await flushPromises();
        const request = mounted.request.mock.calls[0]![0] as Request;
        expect(new URL(request.url).pathname).toBe(`/api/v1/events/${eventId}/finance/pools/${poolId}/shares/2/settlement`);
        expect(await request.json()).toEqual({isPaid: desired});
        expect(mounted.request).toHaveBeenCalledTimes(1);
        expect(mounted.wrapper.emitted('close')).toHaveLength(1);
    });

    it('canceling the signed review sends nothing and leaves saved stale balances eligible', async () => {
        const mounted = await mountSettlement();
        expect(mounted.dialog.get<HTMLButtonElement>('[data-finance-confirm-settlement]').element.disabled).toBe(false);
        await button(mounted.dialog, 'Cancel').trigger('click'); await flushPromises();
        expect(mounted.request).not.toHaveBeenCalled();
        expect(mounted.wrapper.emitted('close')).toHaveLength(1);
    });

    it('locks pending confirmation and retains a completed save through a failed following read', async () => {
        let deliver: ((response: Response) => void) | undefined;
        const refresh = vi.fn(async () => {throw new Error('Saved read unavailable');});
        const mounted = await mountSettlement(saved, () => new Promise(resolve => {deliver = resolve;}), refresh);
        await mounted.dialog.get('[data-finance-confirm-settlement]').trigger('click'); await flushPromises();
        expect(mounted.dialog.get<HTMLButtonElement>('[data-finance-confirm-settlement]').element.disabled).toBe(true);
        expect(mounted.dialog.find('.spinner-border').exists()).toBe(true);
        await mounted.dialog.get('[data-finance-confirm-settlement]').trigger('click');
        expect(mounted.request).toHaveBeenCalledTimes(1);
        deliver!(json({changed: true})); await flushPromises();
        expect(mounted.dialog.text()).toContain('Your change was saved, but the refreshed data could not be loaded.');
        expect(mounted.dialog.find('[data-finance-confirm-settlement]').exists()).toBe(false);
        expect(mounted.wrapper.emitted('pending')).toEqual([[true], [false]]);
        await button(mounted.dialog, 'Close').trigger('click');
        expect(mounted.wrapper.emitted('close')).toHaveLength(1);
        expect(mounted.request).toHaveBeenCalledTimes(1);
    });

    it('keeps a rejected review available but locks unknown delivery until deliberate inspection without replay', async () => {
        let rejection = true;
        const mounted = await mountSettlement(saved, async () => {
            if (rejection) throw new ApiFailure(400, null, null, 'Rejected payment', true);
            throw new Error('Delivery lost');
        });
        await mounted.dialog.get('[data-finance-confirm-settlement]').trigger('click'); await flushPromises();
        expect(mounted.dialog.get<HTMLButtonElement>('[data-finance-confirm-settlement]').element.disabled).toBe(false);
        rejection = false;
        await mounted.dialog.get('[data-finance-confirm-settlement]').trigger('click'); await flushPromises();
        expect(mounted.dialog.get<HTMLButtonElement>('[data-finance-confirm-settlement]').element.disabled).toBe(true);
        await mounted.dialog.get('[data-finance-confirm-settlement]').trigger('click'); await flushPromises();
        expect(mounted.request).toHaveBeenCalledTimes(2);
        await mounted.wrapper.setProps({currentShare: {...saved, status: 'settled', isPaid: true, statusLabel: 'Payment received'}});
        await button(mounted.dialog, 'Refresh').trigger('click'); await flushPromises();
        expect(mounted.dialog.get('[data-finance-settlement-inspection]').text()).toContain('Payment received');
        expect(mounted.dialog.get<HTMLButtonElement>('[data-finance-confirm-settlement]').element.disabled).toBe(true);
        await button(mounted.dialog, 'I have checked the saved shares').trigger('click'); await flushPromises();
        expect(mounted.request).toHaveBeenCalledTimes(2);
        expect(mounted.wrapper.emitted('close')).toHaveLength(1);
    });

    it('keeps confirmed status changes in place under a status filter until Refresh list and acknowledges unchanged refreshes', async () => {
        const mounted = await mountLedger([saved, {...saved, id: '3', payerName: 'Bob'}]);
        await mounted.wrapper.findAll('select')[0]!.setValue('due');
        const original = mounted.wrapper.get('[data-finance-share="2"]').element;
        await mounted.wrapper.setProps({shares: [{...saved, status: 'settled', isPaid: true, statusLabel: 'Payment received'},
            {...saved, id: '3', payerName: 'Bob'}]});
        expect(mounted.wrapper.get('[data-finance-share="2"]').element).toBe(original);
        expect(mounted.wrapper.get('[data-finance-share="2"]').text()).toContain('Payment received');
        expect(mounted.wrapper.get('[data-finance-ledger-refresh]').classes()).toContain('btn-warning');
        await mounted.wrapper.get('[data-finance-ledger-refresh]').trigger('click'); await flushPromises();
        expect(mounted.wrapper.find('[data-finance-share="2"]').exists()).toBe(false);
        expect(mounted.wrapper.get('[data-finance-ledger-refresh]').classes()).toContain('btn-outline-light');
        expect(document.body.textContent).toContain('The current filters and ordering have been applied.');
        await mounted.wrapper.get('[data-finance-ledger-refresh]').trigger('click'); await flushPromises();
        expect(mounted.wrapper.emitted('refresh')).toHaveLength(2);
    });

    it('reapplies deferred filtering on explicit controls and exposes a stationary local spinner while locking the ledger', async () => {
        const mounted = await mountLedger([saved]);
        await mounted.wrapper.findAll('select')[0]!.setValue('due');
        await mounted.wrapper.setProps({pendingShareId: '2'});
        expect(mounted.wrapper.find('[data-finance-settlement-pending]').exists()).toBe(true);
        expect(mounted.wrapper.get<HTMLInputElement>('input[type="search"]').element.disabled).toBe(true);
        expect(mounted.wrapper.findAll<HTMLButtonElement>('button').every(control => control.element.disabled)).toBe(true);
        await mounted.wrapper.setProps({pendingShareId: null, shares: [{...saved, status: 'settled', isPaid: true}]});
        expect(mounted.wrapper.find('[data-finance-share="2"]').exists()).toBe(true);
        await mounted.wrapper.findAll('select')[1]!.setValue('amount-desc');
        expect(mounted.wrapper.find('[data-finance-share="2"]').exists()).toBe(false);
    });

    it('keeps participant ledgers read-only and omits organizer transfer controls for zero balances', async () => {
        const personal = await mountLedger([saved], {admin: false});
        expect(personal.wrapper.find('[data-finance-settle]').exists()).toBe(false);
        const organizer = await mountLedger([{...saved, amount: '0.00', status: 'settled'}]);
        expect(organizer.wrapper.find('[data-finance-settle]').exists()).toBe(false);
        expect(personal.wrapper.emitted('settle')).toBeUndefined();
    });

    it('shows current saved rows during calculation recovery without opening nested details or settlement commands', async () => {
        const mounted = await mountLedger([saved], {readOnly: true});
        expect(mounted.wrapper.text()).toContain('<Alice>');
        expect(mounted.wrapper.text()).toContain('30.00');
        expect(mounted.wrapper.find('[data-finance-settle]').exists()).toBe(false);
        expect(mounted.wrapper.findAll('th').map(cell => cell.text())).toEqual(['Payer', 'Calculated balance', 'Status']);
        expect(mounted.wrapper.findAll('button').some(control => control.text().includes('View breakdown'))).toBe(false);
        expect(mounted.wrapper.find('[data-finance-ledger-refresh]').exists()).toBe(true);
    });

    it('retains the current ledger page when a deliberate section refresh reapplies saved rows', async () => {
        const rows = Array.from({length: 30}, (_, index) => ({...saved, id: String(index + 1), payerName: `Payer ${String(index + 1).padStart(2, '0')}`}));
        const mounted = await mountLedger(rows);
        await button(mounted.wrapper, 'Next').trigger('click');
        expect(mounted.wrapper.findAll('[data-finance-share]')).toHaveLength(5);
        expect(mounted.wrapper.find('[data-finance-share="26"]').exists()).toBe(true);
        await mounted.wrapper.setProps({refreshVersion: 1});
        expect(mounted.wrapper.findAll('[data-finance-share]')).toHaveLength(5);
        expect(mounted.wrapper.find('[data-finance-share="26"]').exists()).toBe(true);
    });
});
