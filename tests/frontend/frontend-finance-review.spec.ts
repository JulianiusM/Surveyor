// @vitest-environment happy-dom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {DOMWrapper, flushPromises} from '@vue/test-utils';
import type {Component} from 'vue';
import type {components} from '../../src/types/api/v1';
import FinanceInvoiceReview from '../../src/frontend/features/finance/FinanceInvoiceReview.vue';
import FinanceOrganizerInvoice from '../../src/frontend/features/finance/FinanceOrganizerInvoice.vue';
import FinancePoolEditor from '../../src/frontend/features/finance/FinancePoolEditor.vue';
import FinanceSection from '../../src/frontend/features/finance/FinanceSection.vue';
import {ApiFailure} from '../../src/frontend/app/transport';
import {createFrontendEventSession, frontendEventId as eventId} from '../factories/frontendEventFactory';
import {frontendEventButton as button, frontendEventJson as json, mountFrontendEvent} from '../keywords/frontendEventKeywords';

const poolId = '22222222-2222-4222-8222-222222222222';
const pool: components['schemas']['FinancePool'] = {id: poolId, name: 'Saved pool', description: 'Saved description', status: 'CLOSED',
    isDefault: false, assignAll: false, assignedCount: 1, registrationIds: ['7'], revision: 7, canSubmit: false,
    needsRecalculation: false, hasPendingTakeovers: false, coverageKnown: true, coverageGroups: [], pendingCoverageGroups: [],
    calculation: null, exampleCalculation: null, summary: null,
    settings: {distribution: 'TIME_BASED', roundUpShares: true, sendCalculationEmails: true, subtractPersonalInvoices: true}};
const invoice: components['schemas']['FinanceInvoice'] = {id: '12', poolId, poolName: pool.name, revision: 7, status: 'APPROVED',
    amount: '10.00', description: '<Original evidence>', correctedAmount: null, correctedDescription: null, rejectionReason: null,
    organizerRecorded: false, recordedByName: null, participantName: 'Alice', participantEmail: 'alice@example.test',
    createdAt: '2026-10-20T10:00:00Z', proofOriginalName: 'saved.pdf', proofUrl: '/proof-output', canRetract: false, canClose: true};
const participants = [{id: '7', name: 'Alice', email: 'alice@example.test'}, {id: '8', name: 'Bob', email: null}];
const snapshot: components['schemas']['FinanceView'] = {audience: 'organizer', registrationId: null,
    pools: [pool], participants, invoices: [invoice], shares: []};
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
    vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = '';
});

/** Mount actual forms and generated transport contracts; only server delivery
 * and happy-dom's incomplete native form validity are supplied by the test. */
async function mountForm(component: Component, props: Record<string, unknown>, handler = async (_request: Request) => json({changed: true})) {
    const mounted = await mountFrontendEvent(component, handler, {eventId, pool, open: true, active: true,
        participants, refresh: vi.fn(async () => {}), ...props});
    cleanups.push(mounted.dispose);
    const dialog = new DOMWrapper(document.querySelector<HTMLElement>('[role="dialog"]')!);
    vi.spyOn(dialog.get('form').element as HTMLFormElement, 'reportValidity').mockReturnValue(true);
    return {...mounted, dialog};
}

/** Select exact browser File bytes while preserving the real mounted chooser. */
async function selectProof(dialog: DOMWrapper<HTMLElement>) {
    const chooser = dialog.get<HTMLInputElement>('input[name="proof"]');
    const file = new File(['retained bytes'], 'proof.pdf', {type: 'application/pdf'});
    Object.defineProperty(chooser.element, 'files', {value: [file], configurable: true});
    await chooser.trigger('change');
    return {file, chooser: chooser.element};
}

describe('P8A organizer finance forms', () => {
    it('retains the source draft and captured revision through Back, fresh saved props and the final retroactive confirmation', async () => {
        const mounted = await mountForm(FinanceInvoiceReview, {invoice, action: 'revise'});
        const amount = mounted.dialog.get<HTMLInputElement>('input[name="correctedAmount"]');
        expect(amount.element.value).toBe('10');
        await amount.setValue('013.50'); await amount.trigger('change'); await amount.trigger('blur');
        await mounted.dialog.get('textarea[name="correctedDescription"]').setValue('<Proposed correction>');
        await mounted.dialog.get('form').trigger('submit'); await flushPromises();
        expect(mounted.request).not.toHaveBeenCalled();
        expect(mounted.dialog.text()).toContain('Existing shares and payments stay unchanged.');
        expect(mounted.dialog.find('Proposed').exists()).toBe(false);
        await mounted.wrapper.setProps({invoice: {...invoice, revision: 99, amount: '30.00'}, pool: {...pool, revision: 99}});
        await button(mounted.dialog, 'Back to edit').trigger('click');
        expect(amount.element.value).toBe('013.50');
        expect(mounted.dialog.get<HTMLTextAreaElement>('textarea[name="correctedDescription"]').element.value).toBe('<Proposed correction>');
        await mounted.dialog.get('form').trigger('submit'); await flushPromises();
        await mounted.dialog.get('form').trigger('submit'); await flushPromises();
        const request = mounted.request.mock.calls[0]![0] as Request;
        expect(new URL(request.url).pathname).toContain('/invoices/12/revise');
        expect(await request.json()).toEqual({confirmed: true, expectedRevision: 7, correctedAmount: '13.5', correctedDescription: '<Proposed correction>'});
        expect(mounted.wrapper.emitted('close')).toHaveLength(1);
    });

    it('rejects only after its explicit confirmation, preserves reason on a canceled close and keeps original evidence as escaped text', async () => {
        const confirm = vi.fn(() => false); vi.stubGlobal('confirm', confirm);
        const mounted = await mountForm(FinanceInvoiceReview, {invoice: {...invoice, status: 'NEW'}, action: 'decline'});
        await mounted.dialog.get('textarea[name="rejectionReason"]').setValue('Missing receipt');
        await button(mounted.dialog, 'Cancel').trigger('click');
        expect(mounted.wrapper.emitted('close')).toBeUndefined();
        expect(mounted.request).not.toHaveBeenCalled();
        expect(mounted.dialog.text()).toContain('<Original evidence>');
        expect(mounted.dialog.find('original').exists()).toBe(false);
        await mounted.dialog.get('form').trigger('submit'); await flushPromises();
        expect(await (mounted.request.mock.calls[0]![0] as Request).json()).toEqual({rejectionReason: 'Missing receipt'});
        expect(mounted.request).toHaveBeenCalledTimes(1);
    });

    it('preserves native acceptance of a positive correction beyond the suggested input precision, leaving validation with the shared operation', async () => {
        const mounted = await mountForm(FinanceInvoiceReview, {invoice: {...invoice, status: 'NEW'}, action: 'approve'});
        const form = mounted.dialog.get('form').element as HTMLFormElement;
        vi.mocked(form.reportValidity).mockReturnValue(false);
        await mounted.dialog.get('input[name="correctedAmount"]').setValue('0.00123');
        await mounted.dialog.get('form').trigger('submit'); await flushPromises();
        expect(new URL((mounted.request.mock.calls[0]![0] as Request).url).pathname).toContain('/invoices/12/approve');
        expect(await (mounted.request.mock.calls[0]![0] as Request).json()).toEqual({correctedAmount: '0.00123'});
        expect(form.reportValidity).not.toHaveBeenCalled();
        expect(mounted.wrapper.emitted('close')).toHaveLength(1);
    });

    it('keeps a completed retroactive save locked with its failed-read warning and allows closing without a dirty-draft prompt', async () => {
        const confirm = vi.fn(() => false); vi.stubGlobal('confirm', confirm);
        const refresh = vi.fn(async () => {throw new Error('Saved read unavailable');});
        const mounted = await mountForm(FinanceInvoiceReview, {invoice, action: 'revise', refresh});
        await mounted.dialog.get('input[name="correctedAmount"]').setValue('15.00');
        await mounted.dialog.get('form').trigger('submit'); await flushPromises();
        await mounted.dialog.get('form').trigger('submit'); await flushPromises();
        expect(mounted.dialog.text()).toContain('Your change was saved, but the refreshed data could not be loaded.');
        expect(mounted.wrapper.emitted('close')).toBeUndefined();
        await mounted.dialog.get('form').trigger('submit'); await flushPromises();
        expect(mounted.request).toHaveBeenCalledTimes(1);
        await button(mounted.dialog, 'Close').trigger('click');
        expect(confirm).not.toHaveBeenCalled();
        expect(mounted.wrapper.emitted('close')).toHaveLength(1);

    });

    it('retains exact optional proof, paid-by selection and lexical amount after rejection and unknown delivery, then inspects without replay', async () => {
        const mounted = await mountForm(FinanceOrganizerInvoice, {invoices: [invoice]});
        const upload = vi.spyOn(mounted.context.api, 'uploadJson').mockRejectedValue(new ApiFailure(400, null, null, 'Rejected proof', true));
        const amount = mounted.dialog.get<HTMLInputElement>('input[name="amount"]');
        await amount.setValue('013.50'); await amount.trigger('change'); await amount.trigger('blur');
        await mounted.dialog.get('textarea[name="description"]').setValue('Organizer expense');
        await mounted.dialog.get('select[name="registrationId"]').setValue('7');
        expect(mounted.dialog.find('option[value="8"]').exists()).toBe(false);
        const {file, chooser} = await selectProof(mounted.dialog);
        await mounted.dialog.get('form').trigger('submit'); await flushPromises();
        expect(amount.element.value).toBe('013.50');
        expect(chooser.files?.[0]).toBe(file);
        expect(mounted.dialog.get<HTMLInputElement>('input[name="proof"]').element).toBe(chooser);
        expect(JSON.parse(upload.mock.calls[0]![2].get('data') as string)).toEqual({amount: '13.5', description: 'Organizer expense', registrationId: '7'});
        // FormData may wrap the same bytes in its own File object. Draft/DOM
        // identity is asserted above; transport must preserve name/type/content.
        const sent = upload.mock.calls[0]![2].get('proof') as File;
        expect(sent.name).toBe(file.name);
        expect(sent.type).toBe(file.type);
        expect(await sent.text()).toBe('retained bytes');
        upload.mockRejectedValue(new Error('Delivery lost'));
        await mounted.dialog.get('form').trigger('submit'); await flushPromises();
        await mounted.dialog.get('form').trigger('submit'); await flushPromises();
        expect(upload).toHaveBeenCalledTimes(2);
        await button(mounted.dialog, 'Check invoice history').trigger('click'); await flushPromises();
        expect(mounted.dialog.find('[data-finance-history]').exists()).toBe(true);
        expect(chooser.files?.[0]).toBe(file);
        await button(mounted.dialog, 'I have checked the invoice history').trigger('click'); await flushPromises();
        expect(amount.element.value).toBe('');
        expect(chooser.value).toBe('');
        expect(upload).toHaveBeenCalledTimes(2);
    });

    it('omits unselected optional proof and paid-by attribution, releasing completed expense fields even when saved reads fail', async () => {
        const mounted = await mountForm(FinanceOrganizerInvoice, {refresh: vi.fn(async () => {throw new Error('Read unavailable');})});
        const upload = vi.spyOn(mounted.context.api, 'uploadJson').mockResolvedValue({changed: true});
        await mounted.dialog.get('input[name="amount"]').setValue('15.20');
        await mounted.dialog.get('textarea[name="description"]').setValue('Shared organizer cost');
        await mounted.dialog.get('form').trigger('submit'); await flushPromises();
        const form = upload.mock.calls[0]![2];
        expect(JSON.parse(form.get('data') as string)).toEqual({amount: '15.2', description: 'Shared organizer cost'});
        expect(form.has('proof')).toBe(false);
        expect(mounted.dialog.get<HTMLInputElement>('input[name="amount"]').element.value).toBe('');
        expect(mounted.dialog.get<HTMLTextAreaElement>('textarea[name="description"]').element.value).toBe('');
        expect(mounted.dialog.text()).toContain('Your change was saved, but the refreshed data could not be loaded.');
    });

    it('saves settings independently and retains the confirmed submitted values after failed refresh instead of restoring stale props', async () => {
        const confirm = vi.fn(() => false); vi.stubGlobal('confirm', confirm);
        const mounted = await mountForm(FinancePoolEditor, {refresh: vi.fn(async () => {throw new Error('Read failed');})});
        await mounted.dialog.get('input[name="description"]').setValue('Confirmed settings');
        await mounted.dialog.get('select[name="distribution"]').setValue('NIGHTS');
        await mounted.dialog.get('input[name="sendCalculationEmails"]').setValue(false);
        await mounted.dialog.get('form').trigger('submit'); await flushPromises();
        expect(await (mounted.request.mock.calls[0]![0] as Request).json()).toEqual({description: 'Confirmed settings',
            distribution: 'NIGHTS', roundUpShares: true, sendCalculationEmails: false});
        expect(mounted.dialog.get<HTMLInputElement>('input[name="description"]').element.value).toBe('Confirmed settings');
        expect(mounted.dialog.text()).toContain('Your change was saved, but the refreshed data could not be loaded.');
        await button(mounted.dialog, 'Close').trigger('click');
        expect(confirm).not.toHaveBeenCalled();
        expect(mounted.wrapper.emitted('close')).toHaveLength(1);

        // Closing releases the visible dialog, not the confirmed form baseline.
        // An unrelated later edit must not resend the precommand cached settings.
        await mounted.wrapper.setProps({open: false});
        await mounted.wrapper.setProps({open: true}); await flushPromises();
        const reopened = new DOMWrapper(document.querySelector<HTMLElement>('[role="dialog"]')!);
        expect(reopened.get<HTMLInputElement>('input[name="description"]').element.value).toBe('Confirmed settings');
        expect(reopened.get<HTMLSelectElement>('select[name="distribution"]').element.value).toBe('NIGHTS');
        expect(reopened.get<HTMLInputElement>('input[name="sendCalculationEmails"]').element.checked).toBe(false);
        await reopened.get('input[name="roundUpShares"]').setValue(false);
        vi.spyOn(reopened.get('form').element as HTMLFormElement, 'reportValidity').mockReturnValue(true);
        await reopened.get('form').trigger('submit'); await flushPromises();
        expect(await (mounted.request.mock.calls[1]![0] as Request).json()).toEqual({description: 'Confirmed settings',
            distribution: 'NIGHTS', roundUpShares: false, sendCalculationEmails: false});
        expect(mounted.request).toHaveBeenCalledTimes(2);
    });

    it('keeps creation status and allocation as unsaved input until Add pool and sends only the selected enrollment', async () => {
        const mounted = await mountForm(FinancePoolEditor, {pool: undefined});
        await mounted.dialog.get('input[name="name"]').setValue('Organizer pool');
        await mounted.dialog.get('select[name="status"]').setValue('ORGANIZER_ONLY');
        const next = [...participants, {id: '9', name: 'New participant', email: null}];
        await mounted.wrapper.setProps({participants: next});
        expect(mounted.dialog.get<HTMLInputElement>('input[name="registrations"][value="9"]').element.checked).toBe(true);
        expect(mounted.dialog.get<HTMLInputElement>('input[name="name"]').element.value).toBe('Organizer pool');
        await mounted.dialog.get('input[name="assignAll"]').setValue(false);
        await mounted.dialog.get('input[name="registrations"][value="8"]').setValue(false);
        await mounted.wrapper.setProps({participants: [...next, {id: '10', name: 'Later participant', email: null}]});
        expect(mounted.dialog.get<HTMLInputElement>('input[name="registrations"][value="10"]').element.checked).toBe(false);
        await mounted.dialog.get('input[name="isDefault"]').setValue(true);
        expect(mounted.dialog.get<HTMLInputElement>('input[name="assignAll"]').element.checked).toBe(false);
        expect(mounted.dialog.get<HTMLInputElement>('input[name="registrations"][value="8"]').element.checked).toBe(false);
        expect(mounted.dialog.get<HTMLInputElement>('input[name="registrations"][value="10"]').element.checked).toBe(false);
        expect(mounted.request).not.toHaveBeenCalled();
        await mounted.dialog.get('form').trigger('submit'); await flushPromises();
        expect(await (mounted.request.mock.calls[0]![0] as Request).json()).toEqual({name: 'Organizer pool', status: 'ORGANIZER_ONLY',
            distribution: 'TIME_BASED', description: '', roundUpShares: true, sendCalculationEmails: true,
            assignAll: false, isDefault: true, subtractPersonalInvoices: true, registrations: ['7', '9']});
        expect(mounted.request).toHaveBeenCalledTimes(1);
    });

    it('retains the mounted organizer File and draft while a new language is read, blocking commands until its current receipt arrives', async () => {
        let finish: (() => void) | undefined;
        const mounted = await mountFrontendEvent(FinanceSection, async request => {
            if (new URL(request.url).pathname === '/api/v1/locale') return json({...createFrontendEventSession(), locale: 'de'});
            if (request.headers.get('X-Surveyor-Locale') === 'de') return new Promise<Response>(resolve => {finish = () => resolve(json(snapshot));});
            return json(snapshot);
        }, {eventId, admin: true, enabled: true});
        cleanups.push(mounted.dispose);
        await vi.waitFor(() => expect(mounted.context.queryClient.isFetching()).toBe(0));
        await mounted.wrapper.get('[data-finance-pool] .accordion-button').trigger('click');
        await button(mounted.wrapper, 'Add invoice / amount').trigger('click'); await flushPromises();
        const dialog = new DOMWrapper(document.querySelector<HTMLElement>('[role="dialog"]')!);
        await dialog.get('input[name="amount"]').setValue('013.50');
        await dialog.get('textarea[name="description"]').setValue('Keep this expense');
        const {chooser, file} = await selectProof(dialog);
        const form = dialog.get('form').element;
        const switching = mounted.context.changeLocale('de');
        await vi.waitFor(() => expect(finish).toBeDefined());
        expect(document.querySelector('[data-finance-organizer-invoice]')).toBe(form);
        expect(chooser.files?.[0]).toBe(file);
        expect(dialog.get<HTMLInputElement>('input[name="amount"]').element.value).toBe('013.50');
        expect(dialog.get('fieldset').attributes('disabled')).toBeDefined();
        finish!(); await switching; await flushPromises();
        await vi.waitFor(() => expect(mounted.context.queryClient.isFetching()).toBe(0));
        expect(document.querySelector('[data-finance-organizer-invoice]')).toBe(form);
        expect(chooser.files?.[0]).toBe(file);
        expect(dialog.get('fieldset').attributes('disabled')).toBeUndefined();
    });
});
