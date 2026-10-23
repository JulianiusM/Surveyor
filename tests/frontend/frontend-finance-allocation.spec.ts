// @vitest-environment happy-dom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {DOMWrapper, flushPromises} from '@vue/test-utils';
import type {components} from '../../src/types/api/v1';
import FinanceAssignments from '../../src/frontend/features/finance/FinanceAssignments.vue';
import FinanceAdjustments from '../../src/frontend/features/finance/FinanceAdjustments.vue';
import FinanceTakeovers from '../../src/frontend/features/finance/FinanceTakeovers.vue';
import FinancePoolActions from '../../src/frontend/features/finance/FinancePoolActions.vue';
import {frontendEventId as eventId} from '../factories/frontendEventFactory';
import {frontendEventButton as button, frontendEventJson as json, mountFrontendEvent} from '../keywords/frontendEventKeywords';

const poolId = '22222222-2222-4222-8222-222222222222';
const participants = [{id: '7', name: 'Original payer', email: 'payer@example.test'},
    {id: '8', name: 'Second participant', email: 'second@example.test'},
    {id: '9', name: 'Covered participant', email: null}, {id: '10', name: 'Free participant', email: null}];
const pool: components['schemas']['FinancePool'] = {id: poolId, name: 'Saved pool', description: '', status: 'CLOSED',
    isDefault: false, needsRecalculation: false, hasPendingTakeovers: false, revision: 7, canSubmit: false, summary: null,
    calculation: null, exampleCalculation: null, coverageKnown: true, coverageGroups: [], pendingCoverageGroups: [], assignedCount: 1, assignAll: false,
    settings: {distribution: 'EQUAL', subtractPersonalInvoices: true, sendCalculationEmails: false, roundUpShares: false},
    assignments: [{registrationId: '7', factor: '1.0000', isExempt: false}], registrationIds: ['7'], surcharges: [],
    coverageChoices: participants, currentCoverageGroups: []};
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
    vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = '';
});

/** Dialogs use their real portal and controls; only HTTP delivery is supplied. */
function body(): DOMWrapper<Element> { return new DOMWrapper(document.body); }
function valid(form: {element: Element}): void { vi.spyOn(form.element as HTMLFormElement, 'reportValidity').mockReturnValue(true); }

describe('P8 independently saved allocation inputs', () => {
    it('confirms submission access independently and submits the captured pool revision exactly once', async () => {
        const confirm = vi.fn(() => false);
        vi.stubGlobal('confirm', confirm);
        const writes: unknown[] = [];
        const mounted = await mountFrontendEvent(FinancePoolActions, async request => {
            expect(new URL(request.url).pathname).toBe(`/api/v1/events/${eventId}/finance/pools/${poolId}/submission-state`);
            writes.push(await request.json()); return json({changed: true});
        }, {eventId, pool: {...pool, status: 'OPEN'}, active: true, refresh: vi.fn(async () => {})});
        cleanups.push(mounted.dispose);
        await button(mounted.wrapper, 'Close participant invoices').trigger('click');
        expect(writes).toEqual([]);
        confirm.mockReturnValue(true);
        await button(mounted.wrapper, 'Close participant invoices').trigger('click'); await flushPromises();
        expect(writes).toEqual([{status: 'ORGANIZER_ONLY', expectedRevision: 7}]);
        await mounted.wrapper.setProps({pool: {...pool, status: 'CLOSED'}});
        expect(mounted.wrapper.text()).not.toContain('Open participant invoices');
        expect(mounted.wrapper.text()).not.toContain('Close participant invoices');
    });

    it('restores individual enrollment after assign-all and retains confirmed lexical factors after a failed follow-up read', async () => {
        const writes: unknown[] = [];
        const refresh = vi.fn(async () => {throw new Error('Saved read unavailable');});
        const mounted = await mountFrontendEvent(FinanceAssignments, async request => {
            writes.push(await request.json()); return json({changed: true});
        }, {eventId, pool, participants, open: true, active: true, refresh});
        cleanups.push(mounted.dispose);
        const surface = body();
        const second = surface.get('[data-finance-assignment="8"] input[type="checkbox"]');
        expect((second.element as HTMLInputElement).checked).toBe(false);
        await surface.get('input[id$="-all"]').setValue(true);
        expect((second.element as HTMLInputElement).checked).toBe(true);
        await surface.get('input[id$="-all"]').setValue(false);
        expect((second.element as HTMLInputElement).checked).toBe(false);
        const factor = surface.get<HTMLInputElement>('[data-finance-assignment="7"] input[type="number"]');
        expect(factor.element.value).toBe('1');
        await factor.setValue('002.5000'); await factor.trigger('blur');
        await surface.get('[data-finance-assignment="7"] input[id*="-exempt-"]').setValue(true);
        // A refreshed DTO must not overwrite this form's independently owned edit.
        await mounted.wrapper.setProps({pool: {...pool, assignments: [{registrationId: '7', factor: '4.0000', isExempt: false}]}});
        expect(factor.element.value).toBe('002.5000');
        const form = surface.get('form[data-finance-assignments]'); valid(form);
        await form.trigger('submit'); await flushPromises();
        expect(writes).toEqual([{assignAll: false, isDefault: false, subtractPersonalInvoices: true,
            registrations: ['7'], exemptions: ['7'], participantFactors: {'7': '2.5000'}}]);
        expect(refresh).toHaveBeenCalledTimes(1);
        expect(factor.element.value).toBe('002.5000');
        expect((surface.get('[data-finance-assignment="7"] input[id*="-exempt-"]').element as HTMLInputElement).checked).toBe(true);
        expect(surface.text()).toContain('Saved');
        // Closing/reopening cannot reseed the confirmed input from stale props;
        // a later independent change must keep the already saved factor/exemption.
        await button(surface, 'Close').trigger('click');
        await mounted.wrapper.setProps({open: false});
        await mounted.wrapper.setProps({open: true});
        expect(surface.get<HTMLInputElement>('[data-finance-assignment="7"] input[type="number"]').element.value).toBe('002.5000');
        await surface.get('input[id$="-default"]').setValue(true);
        const reopened = surface.get('form[data-finance-assignments]'); valid(reopened);
        await reopened.trigger('submit'); await flushPromises();
        expect(writes[1]).toEqual({assignAll: false, isDefault: true, subtractPersonalInvoices: true,
            registrations: ['7'], exemptions: ['7'], participantFactors: {'7': '2.5000'}});
    });

    it('excludes disabled deselected values while keeping filtered factor controls and their lexical drafts mounted', async () => {
        const writes: unknown[] = [];
        const mounted = await mountFrontendEvent(FinanceAssignments, async request => {
            writes.push(await request.json()); return json({changed: true});
        }, {eventId, pool: {...pool, assignments: [...pool.assignments!, {registrationId: '8', factor: '3.0000', isExempt: true}]},
            participants, open: true, active: true, refresh: vi.fn(async () => {})});
        cleanups.push(mounted.dispose);
        const surface = body();
        const second = surface.get('[data-finance-assignment="8"]');
        const factor = second.get<HTMLInputElement>('input[type="number"]');
        await factor.setValue('003.1250');
        await surface.get('input[type="search"]').setValue('Original payer');
        expect(second.element.isConnected).toBe(true);
        expect(factor.element.isConnected).toBe(true);
        await surface.get('input[type="search"]').setValue('');
        expect(factor.element.value).toBe('003.1250');
        await second.get('input[type="checkbox"]').setValue(false);
        expect(factor.element.disabled).toBe(true);
        const form = surface.get('form'); valid(form); await form.trigger('submit'); await flushPromises();
        expect(writes).toEqual([{assignAll: false, isDefault: false, subtractPersonalInvoices: true,
            registrations: ['7'], exemptions: [], participantFactors: {'7': '1.0000'}}]);
        expect(factor.element.value).toBe('003.1250');
        await button(surface, 'Discard edits').trigger('click');
        expect(surface.get<HTMLInputElement>('[data-finance-assignment="8"] input[type="number"]').element.value).toBe('1');
        expect(surface.get<HTMLInputElement>('[data-finance-assignment="8"] input[type="checkbox"]').element.checked).toBe(false);
    });

    it('adopts confirmed assign-all membership for close and reopen even when the following saved read fails', async () => {
        const writes: unknown[] = [];
        const mounted = await mountFrontendEvent(FinanceAssignments, async request => {
            writes.push(await request.json()); return json({changed: true});
        }, {eventId, pool, participants, open: true, active: true,
            refresh: vi.fn(async () => {throw new Error('Read unavailable');})});
        cleanups.push(mounted.dispose);
        const surface = body();
        await surface.get('input[id$="-all"]').setValue(true);
        const form = surface.get('form'); valid(form);
        await form.trigger('submit'); await flushPromises();
        await button(surface, 'Close').trigger('click');
        await mounted.wrapper.setProps({open: false});
        await mounted.wrapper.setProps({open: true});
        await surface.get('input[id$="-all"]').setValue(false);
        expect(surface.get<HTMLInputElement>('[data-finance-assignment="8"] input[type="checkbox"]').element.checked).toBe(true);
        const reopened = surface.get('form'); valid(reopened);
        await reopened.trigger('submit'); await flushPromises();
        expect(writes[1]).toEqual({assignAll: false, isDefault: false, subtractPersonalInvoices: true,
            registrations: ['7', '8', '9', '10'], exemptions: [], participantFactors: {'7': '1.0000', '8': '1.0000', '9': '1.0000', '10': '1.0000'}});
    });

    it('admits roster additions during editing and the post-save read without replacing a surviving lexical factor', async () => {
        const newcomer = {id: '11', name: 'New during editing', email: null};
        const later = {id: '12', name: 'New during saved read', email: null};
        const writes: unknown[] = [];
        const refresh = vi.fn<() => Promise<void>>(async () => {
            await mounted.wrapper.setProps({participants: [...participants, newcomer, later]});
        });
        const mounted = await mountFrontendEvent(FinanceAssignments, async request => {
            writes.push(await request.json()); return json({changed: true});
        }, {eventId, pool: {...pool, assignAll: true}, participants, open: true, active: true, refresh});
        cleanups.push(mounted.dispose);
        const surface = body();
        await surface.get('[data-finance-assignment="7"] input[type="number"]').setValue('002.5000');
        await mounted.wrapper.setProps({participants: [...participants, newcomer]});
        expect(surface.get<HTMLInputElement>('[data-finance-assignment="7"] input[type="number"]').element.value).toBe('002.5000');
        expect(surface.get<HTMLInputElement>('[data-finance-assignment="11"] input[type="checkbox"]').element.checked).toBe(true);
        const form = surface.get('form'); valid(form);
        await form.trigger('submit'); await flushPromises();
        expect(writes[0]).toMatchObject({registrations: ['7', '8', '9', '10', '11'], participantFactors: {'7': '2.5000', '11': '1.0000'}});
        expect(surface.get<HTMLInputElement>('[data-finance-assignment="12"] input[type="checkbox"]').element.checked).toBe(true);
        await button(surface, 'Close').trigger('click');
        await mounted.wrapper.setProps({open: false});
        await mounted.wrapper.setProps({open: true});
        expect(surface.get<HTMLInputElement>('[data-finance-assignment="12"] input[type="number"]').element.value).toBe('1');
        expect(surface.get<HTMLInputElement>('[data-finance-assignment="7"] input[type="number"]').element.value).toBe('002.5000');
    });

    it('keeps a signed additive adjustment blocked after unknown delivery until fresh inspection and explicit acknowledgement', async () => {
        const writes: unknown[] = [];
        const refresh = vi.fn(async () => {});
        const mounted = await mountFrontendEvent(FinanceAdjustments, async request => {
            writes.push(await request.json()); throw new TypeError('Lost response');
        }, {eventId, pool, participants, open: true, active: true, refresh});
        cleanups.push(mounted.dispose);
        const surface = body();
        await surface.get('select').setValue('7');
        await surface.get('input[type="number"]').setValue('-003.25');
        await surface.get('input[id$="-note"]').setValue('Retained rebate');
        await surface.get('input[type="checkbox"]').setValue(false);
        const form = surface.get('form'); valid(form);
        await form.trigger('submit'); await flushPromises();
        await form.trigger('submit'); await flushPromises();
        expect(writes).toEqual([{registrationId: '7', amount: '-3.25', note: 'Retained rebate', subtractFromPool: false}]);
        expect(surface.get<HTMLInputElement>('input[type="number"]').element.value).toBe('-003.25');
        expect(button(surface, 'Add surcharge or rebate').attributes('disabled')).toBeDefined();
        await button(surface, 'Refresh').trigger('click'); await flushPromises();
        expect(writes).toHaveLength(1);
        expect(refresh).toHaveBeenCalled();
        await button(surface, 'I have reviewed the saved adjustments').trigger('click'); await flushPromises();
        expect(surface.get<HTMLInputElement>('input[type="number"]').element.value).toBe('');
        expect(button(surface, 'Add surcharge or rebate').attributes('disabled')).toBeUndefined();
    });

    it('protects one held inspection of an uncertain removal before allowing another Refresh or Close', async () => {
        vi.stubGlobal('confirm', vi.fn(() => true));
        let finishRead!: () => void;
        const refresh = vi.fn(() => new Promise<void>(resolve => { finishRead = resolve; }));
        const mounted = await mountFrontendEvent(FinanceAdjustments, async request => {
            expect(new URL(request.url).pathname).toContain('/adjustments/51/remove');
            throw new TypeError('Removal response lost');
        }, {eventId, pool: {...pool, surcharges: [{id: '51', registrationId: '7', amount: '3.00', note: 'Saved adjustment',
            subtractFromPool: true}]}, participants, open: true, active: true, refresh});
        cleanups.push(mounted.dispose);
        const surface = body();
        await surface.get('input[id$="-note"]').setValue('Independent unfinished addition');
        await button(surface, 'Remove').trigger('click');
        await flushPromises();
        expect(mounted.request).toHaveBeenCalledOnce();
        const inspection = button(surface, 'Refresh');
        await inspection.trigger('click');
        await flushPromises();
        try {
            // Removal owns the unknown receipt. Its first saved-data GET must
            // already protect dismissal and repeat recovery, even though the
            // additive sibling command itself has a healthy history.
            expect(refresh).toHaveBeenCalledOnce();
            expect(inspection.attributes('aria-busy')).toBe('true');
            expect(inspection.attributes('disabled')).toBeDefined();
            expect(button(surface, 'Close').attributes('disabled')).toBeDefined();
            await inspection.trigger('click');
            await button(surface, 'Close').trigger('click');
            await flushPromises();
            expect(refresh).toHaveBeenCalledOnce();
            expect(mounted.wrapper.emitted('close')).toBeUndefined();
            expect(surface.get<HTMLInputElement>('input[id$="-note"]').element.value).toBe('Independent unfinished addition');
        } finally {
            finishRead();
            await flushPromises();
        }
        expect(mounted.request).toHaveBeenCalledOnce();
        expect(button(surface, 'Add surcharge or rebate').attributes('disabled')).toBeUndefined();
        expect(surface.get<HTMLInputElement>('input[id$="-note"]').element.value).toBe('Independent unfinished addition');
    });

    it('keeps participant coverage self-owned and blocks covered people or existing payers while retaining the confirmed selection', async () => {
        const writes: Array<{path: string; data: unknown}> = [];
        const mounted = await mountFrontendEvent(FinanceTakeovers, async request => {
            writes.push({path: new URL(request.url).pathname, data: await request.json()}); return json({changed: true});
        }, {eventId, pool: {...pool, status: 'OPEN', currentCoverageGroups: [{payerId: '8', payerName: 'Second participant', beneficiaries: [{id: '9', name: 'Covered participant'}]}]},
            registrationId: '7', admin: false, open: true, active: true, refresh: vi.fn(async () => {throw new Error('Read failed');})});
        cleanups.push(mounted.dispose);
        const surface = body();
        expect(surface.find('select').exists()).toBe(false);
        expect(surface.find('[data-finance-beneficiary="7"]').exists()).toBe(false);
        expect(surface.get<HTMLInputElement>('[data-finance-beneficiary="8"] input').element.disabled).toBe(true);
        expect(surface.get<HTMLInputElement>('[data-finance-beneficiary="9"] input').element.disabled).toBe(true);
        const choice = surface.get<HTMLInputElement>('[data-finance-beneficiary="10"] input');
        await choice.setValue(true);
        const form = surface.get('form'); valid(form); await form.trigger('submit'); await flushPromises();
        expect(writes).toEqual([{path: `/api/v1/events/${eventId}/finance/pools/${poolId}/takeovers`, data: {payerId: '7', beneficiaries: ['10']}}]);
        expect(choice.element.checked).toBe(true);
        expect(writes).toHaveLength(1);
        await button(surface, 'Close').trigger('click');
        await mounted.wrapper.setProps({open: false});
        await mounted.wrapper.setProps({open: true});
        const reopenedChoice = surface.get<HTMLInputElement>('[data-finance-beneficiary="10"] input');
        expect(reopenedChoice.element.checked).toBe(true);
        await reopenedChoice.setValue(false);
        const reopenedForm = surface.get('form'); valid(reopenedForm);
        await reopenedForm.trigger('submit'); await flushPromises();
        expect(writes[1].data).toEqual({payerId: '7', beneficiaries: []});
    });

    it('requires protected fresh coverage before switching away from a confirmed payer whose saved read failed', async () => {
        const writes: unknown[] = [];
        const refresh = vi.fn<() => Promise<void>>(async () => {throw new Error('Read unavailable');});
        const mounted = await mountFrontendEvent(FinanceTakeovers, async request => {
            writes.push(await request.json()); return json({changed: true});
        }, {eventId, pool, registrationId: null, admin: true, initialPayerId: '7', open: true, active: true, refresh});
        cleanups.push(mounted.dispose);
        const surface = body();
        await surface.get('[data-finance-beneficiary="10"] input').setValue(true);
        const form = surface.get('form'); valid(form);
        await form.trigger('submit'); await flushPromises();
        expect(writes).toEqual([{payerId: '7', beneficiaries: ['10']}]);
        await button(surface, 'Close').trigger('click');
        await mounted.wrapper.setProps({open: false});
        await mounted.wrapper.setProps({open: true});
        expect(surface.get<HTMLInputElement>('[data-finance-beneficiary="10"] input').element.checked).toBe(true);

        await surface.get('select').setValue('8'); await flushPromises();
        expect(surface.get<HTMLSelectElement>('select').element.value).toBe('7');
        expect(surface.get<HTMLInputElement>('[data-finance-beneficiary="10"] input').element.checked).toBe(true);
        expect(writes).toHaveLength(1);

        let finishRead!: () => void;
        const heldRead = new Promise<void>(resolve => { finishRead = resolve; });
        refresh.mockImplementationOnce(async () => {
            await heldRead;
            await mounted.wrapper.setProps({pool: {...pool, currentCoverageGroups: [
                {payerId: '7', payerName: 'Original payer', beneficiaries: [{id: '10', name: 'Free participant'}]},
            ]}});
        });
        await surface.get('select').setValue('8'); await flushPromises();
        expect(surface.get<HTMLSelectElement>('select').element.value).toBe('7');
        expect(button(surface, 'Close').attributes('disabled')).toBeDefined();
        expect(button(surface, 'Save changes').attributes('disabled')).toBeDefined();
        await surface.get('form').trigger('submit');
        expect(writes).toHaveLength(1);
        finishRead(); await flushPromises();
        expect(surface.get<HTMLSelectElement>('select').element.value).toBe('8');
        await surface.get('select').setValue('7'); await flushPromises();
        expect(surface.get<HTMLInputElement>('[data-finance-beneficiary="10"] input').element.checked).toBe(true);
        expect(writes).toHaveLength(1);
    });
});
