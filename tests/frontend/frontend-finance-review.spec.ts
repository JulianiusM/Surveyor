// @vitest-environment happy-dom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {DOMWrapper} from '@vue/test-utils';
import type {Component} from 'vue';
import type {components} from '../../src/types/api/v1';
import FinanceInvoiceReview from '../../src/frontend/features/finance/FinanceInvoiceReview.vue';
import FinanceOrganizerInvoice from '../../src/frontend/features/finance/FinanceOrganizerInvoice.vue';
import FinancePoolEditor from '../../src/frontend/features/finance/FinancePoolEditor.vue';
import FinanceSection from '../../src/frontend/features/finance/FinanceSection.vue';
import FinanceHistory from '../../src/frontend/features/finance/FinanceHistory.vue';
import {ApiFailure} from '../../src/frontend/app/transport';
import {createFrontendEventSession, frontendEventId as eventId} from '../factories/frontendEventFactory';
import {flushFrontendPromises as flushPromises, frontendEventButton as button, frontendEventJson as json, mountFrontendEvent} from '../keywords/frontendUiKeywords';

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
    it('keeps participant Close recovery available after unknown delivery becomes a saved closed invoice without replay', async () => {
        const refresh = vi.fn(async () => {});
        const mounted = await mountForm(FinanceInvoiceReview, {invoice, currentInvoice: invoice,
            action: 'close', participant: true, refresh}, async request => {
            expect(new URL(request.url).pathname).toBe(`/api/v1/events/${eventId}/finance/pools/${poolId}/invoices/12/close`);
            throw new TypeError('Close response lost');
        });
        await mounted.dialog.get('form').trigger('submit'); await flushPromises();
        expect(mounted.dialog.get('.modal-footer button[type="submit"]').attributes('disabled')).toBeDefined();
        refresh.mockImplementation(async () => {
            await mounted.wrapper.setProps({currentInvoice: {...invoice, status: 'CLOSED', canClose: false}});
        });
        await button(mounted.dialog, 'Refresh').trigger('click'); await flushPromises();
        expect(mounted.dialog.text()).toContain('Your invoice history');
        expect(mounted.dialog.text()).not.toContain('Invoice administration');
        expect(mounted.dialog.get('[data-finance-history] thead').text()).toContain('Pool');
        expect(mounted.dialog.get('[data-finance-history] thead').text()).not.toContain('Participant / source');
        expect(mounted.dialog.get('.modal-footer button[type="submit"]').attributes('disabled')).toBeDefined();
        expect(button(mounted.dialog, 'Refresh').attributes('disabled')).toBeUndefined();
        await button(mounted.dialog, mounted.context.messages.value.t('draft.review')).trigger('click');
        await mounted.dialog.get('form').trigger('submit'); await flushPromises();
        expect(mounted.wrapper.emitted('close')).toHaveLength(1);
        expect(refresh).toHaveBeenCalledOnce();
        expect(mounted.request).toHaveBeenCalledOnce();
    });

    it('does not admit an organizer revision through participant review inputs', async () => {
        const mounted = await mountForm(FinanceInvoiceReview, {invoice, currentInvoice: invoice, action: 'revise', participant: true});
        expect(mounted.dialog.get('.modal-footer button[type="submit"]').attributes('disabled')).toBeDefined();
        await mounted.dialog.get('form').trigger('submit'); await flushPromises();
        expect(mounted.request).not.toHaveBeenCalled();
    });

    it('presents accepted Close as the native original-amount warning gate while retaining its standalone command', async () => {
        const mounted = await mountForm(FinanceInvoiceReview, {invoice: {...invoice, correctedAmount: '7.50'}, action: 'close'});
        expect(mounted.dialog.get('.modal-title').text()).toBe('Confirm invoice action');
        expect(mounted.dialog.get('p.fw-semibold').text()).toBe('Invoice #12');
        expect(mounted.dialog.text()).toContain('Close this accepted invoice for 10.00?');
        expect(mounted.dialog.text()).not.toContain('7.50');
        expect(mounted.dialog.text()).not.toContain('<Original evidence>');
        expect(mounted.dialog.text()).not.toContain('Saved pool');
        const confirmation = mounted.dialog.get('.modal-footer button[type="submit"]');
        expect(confirmation.text()).toBe('Close');
        expect(confirmation.classes()).toContain('btn-warning');
        expect(mounted.request).not.toHaveBeenCalled();
        await confirmation.trigger('click');
        await flushPromises();
        expect(new URL((mounted.request.mock.calls[0]![0] as Request).url).pathname).toContain('/invoices/12/organizer-close');
        expect(mounted.request).toHaveBeenCalledOnce();
    });

    it.each(['revise', 'reject'] as const)('keeps the native %s editor/review hierarchy and final warning priority', async action => {
        const mounted = await mountForm(FinanceInvoiceReview, {invoice, action});
        expect(mounted.dialog.get('p.fw-semibold').text()).toContain('Invoice #12');
        expect(mounted.dialog.text()).not.toContain('Saved pool');
        expect(mounted.dialog.find('p.invoice-description').exists()).toBe(false);
        if (action === 'reject') {
            expect(button(mounted.dialog, 'Continue').classes()).toContain('btn-danger');
            await mounted.dialog.get('textarea[name="rejectionReason"]').setValue('Reviewed rejection');
        } else await mounted.dialog.get('input[name="correctedAmount"]').setValue('12.50');
        expect(button(mounted.dialog, 'Continue').attributes('type')).toBe('submit');
        // As in the other dialog tests, submit the mounted form through the
        // supplied reportValidity boundary; real click behavior is covered by P8.
        await mounted.dialog.get('form').trigger('submit');
        await flushPromises();
        expect(mounted.dialog.get('.modal-title').text()).toBe('Confirm invoice change');
        expect(button(mounted.dialog, action === 'revise' ? 'Confirm correction' : 'Confirm rejection').classes()).toContain('btn-warning');
        expect(mounted.dialog.find('p.small.invoice-description').exists()).toBe(false);
        expect(mounted.dialog.text()).not.toContain('Saved pool');
        expect(mounted.request).not.toHaveBeenCalled();
    });

    it('captures only native inline approval values before a summary-only gate without imposing HTML amount precision', async () => {
        const refresh = vi.fn(async () => {});
        const mounted = await mountFrontendEvent(FinanceHistory, async () => json({changed: true}), {
            eventId, pool, reviewComponent: FinanceInvoiceReview, invoices: [{...invoice, status: 'NEW'}], admin: true, refreshSaved: refresh,
        });
        cleanups.push(mounted.dispose);
        const row = mounted.wrapper.get('[data-finance-invoice="12"]');
        expect(row.get('td[data-label="Submitted details"]').text()).toContain('<Original evidence>');
        const fields = row.get('td[data-label="Organizer review"]');
        expect(fields.get('textarea[id$="-inline-description"]').attributes('maxlength')).toBe('4000');
        expect(fields.get('textarea[id$="-inline-reason"]').attributes('maxlength')).toBe('4000');
        const amount = fields.get<HTMLInputElement>('input[type="number"]');
        await amount.setValue('000.00123');
        await fields.get('textarea[id$="-inline-description"]').setValue('  Reviewed correction  ');
        await fields.get('textarea[id$="-inline-reason"]').setValue('Not an approval field');
        const validity = vi.spyOn(HTMLFormElement.prototype, 'reportValidity').mockReturnValue(false);
        await button(row, 'Accept').trigger('click');
        const dialog = new DOMWrapper(document.querySelector<HTMLElement>('[role="dialog"]')!);
        expect(dialog.get('.modal-title').text()).toBe('Confirm invoice action');
        expect(dialog.get('p.fw-semibold').text()).toBe('Invoice #12');
        expect(dialog.text()).toContain('000.00123');
        expect(dialog.find('input, textarea').exists()).toBe(false);
        expect(mounted.request).not.toHaveBeenCalled();

        // Even a programmatically changed background field cannot replace the
        // command already captured for this explicit final confirmation.
        amount.element.value = '999.00';
        await amount.trigger('input');
        await button(dialog, 'Accept').trigger('click');
        await flushPromises();
        expect(await (mounted.request.mock.calls[0]![0] as Request).json()).toEqual({
            correctedAmount: '0.00123', correctedDescription: 'Reviewed correction',
        });
        expect(validity).not.toHaveBeenCalled();
        expect(refresh).toHaveBeenCalledOnce();
        expect(mounted.request).toHaveBeenCalledOnce();
        expect(document.querySelector('[role="dialog"]')).toBeNull();
        expect((button(row, 'Reject').element as HTMLButtonElement).disabled).toBe(true);
    });

    it('adopts native inline fields in the live Section and retains its draft when rejection is missing or confirmation is canceled', async () => {
        const mounted = await mountFrontendEvent(FinanceSection, async () => json({...snapshot,
            invoices: [{...invoice, status: 'NEW'}]}), {eventId, admin: true, enabled: true});
        cleanups.push(mounted.dispose);
        await vi.waitFor(() => expect(mounted.context.queryClient.isFetching()).toBe(0));
        await mounted.wrapper.get('[data-finance-pool] .accordion-button').trigger('click');
        const row = mounted.wrapper.get('[data-finance-invoice="12"]');
        const amount = row.get<HTMLInputElement>('input[type="number"]');
        const reason = row.get<HTMLTextAreaElement>('textarea[id$="-inline-reason"]');
        await amount.setValue('0013.50');
        await button(row, 'Reject').trigger('click');
        expect(document.querySelector('[role="dialog"]')).toBeNull();
        expect(document.body.textContent).toContain('Enter a rejection reason before rejecting this invoice.');
        await reason.setValue('Missing receipt');
        await button(row, 'Reject').trigger('click');
        const dialog = new DOMWrapper(document.querySelector<HTMLElement>('[role="dialog"]')!);
        expect(dialog.find('textarea').exists()).toBe(false);
        await button(dialog, 'Cancel').trigger('click');
        await flushPromises();
        expect(row.get('input[type="number"]').element).toBe(amount.element);
        expect(amount.element.value).toBe('0013.50');
        expect(reason.element.value).toBe('Missing receipt');
        expect(mounted.request.mock.calls.every(([request]) => (request as Request).method === 'GET')).toBe(true);
    });

    it('uses the displayed German submitted amount for untouched approval and rejection summaries', async () => {
        const mounted = await mountFrontendEvent(FinanceHistory, async () => json({changed: true}), {
            eventId, pool, reviewComponent: FinanceInvoiceReview, invoices: [{...invoice, status: 'NEW'}], admin: true, refreshSaved: vi.fn(async () => {}),
        });
        cleanups.push(mounted.dispose);
        mounted.context.locale.value = 'de';
        await flushPromises();
        const row = mounted.wrapper.get('[data-finance-invoice="12"]');
        for (const action of ['accept', 'reject'] as const) {
            if (action === 'reject') await row.get('textarea[id$="-inline-reason"]').setValue('Fehlender Beleg');
            await button(row, mounted.context.messages.value.t(`finance.${action}`)).trigger('click');
            const dialog = new DOMWrapper(document.querySelector<HTMLElement>('[role="dialog"]')!);
            expect(dialog.text()).toContain('10,00');
            expect(dialog.text()).not.toContain('10.00');
            await button(dialog, mounted.context.messages.value.t('common.cancel')).trigger('click');
            await flushPromises();
        }
        expect(mounted.request).not.toHaveBeenCalled();
    });

    it('retains sorted inline row owners through paging, filtering and saved reads, retiring removed and actor-scoped input', async () => {
        const rows = Array.from({length: 27}, (_, index) => ({...invoice, id: String(index + 20), status: 'NEW' as const,
            createdAt: `2026-10-${String(index + 1).padStart(2, '0')}T10:00:00Z`}));
        const mounted = await mountFrontendEvent(FinanceHistory, async () => json({changed: true}), {
            eventId, pool, reviewComponent: FinanceInvoiceReview, invoices: rows, admin: true, refreshSaved: vi.fn(async () => {}),
        });
        cleanups.push(mounted.dispose);
        const original = mounted.wrapper.get('[data-finance-invoice="20"]');
        const amount = original.get<HTMLInputElement>('input[type="number"]');
        expect(mounted.wrapper.findAll('[data-finance-invoice]').filter(row => row.isVisible())[0]!.attributes('data-finance-invoice')).toBe('46');
        await button(mounted.wrapper, 'Next').trigger('click');
        expect(original.isVisible()).toBe(true);
        await amount.setValue('0012.345');
        await mounted.wrapper.get('input[type="search"]').setValue('No matching invoice');
        expect(original.isVisible()).toBe(false);
        await mounted.wrapper.setProps({invoices: rows.map(row => ({...row, description: 'Fresh admitted evidence'}))});
        await mounted.wrapper.get('input[type="search"]').setValue('');
        await button(mounted.wrapper, 'Next').trigger('click');
        expect(original.isVisible()).toBe(true);
        expect(original.get('input[type="number"]').element).toBe(amount.element);
        expect(amount.element.value).toBe('0012.345');

        await mounted.wrapper.setProps({invoices: rows.slice(1)});
        expect(amount.element.isConnected).toBe(false);
        await mounted.wrapper.setProps({invoices: rows});
        const replacement = mounted.wrapper.get<HTMLInputElement>('[data-finance-invoice="20"] input');
        expect(replacement.element.value).toBe('');
        await replacement.setValue('009.00');
        mounted.context.epoch.value++;
        await flushPromises();
        expect(replacement.element.isConnected).toBe(false);
        expect(mounted.wrapper.get<HTMLInputElement>('[data-finance-invoice="20"] input').element.value).toBe('');
        expect(mounted.request).not.toHaveBeenCalled();
    });

    it('retains a pending row owner across a saved status transition and keeps its completed failed-read receipt without enabling replay', async () => {
        let finish!: (response: Response) => void;
        const mounted = await mountFrontendEvent(FinanceHistory, () => new Promise<Response>(resolve => {finish = resolve;}), {
            eventId, pool, reviewComponent: FinanceInvoiceReview, invoices: [{...invoice, status: 'NEW'}], admin: true,
            refreshSaved: vi.fn(async () => {throw new Error('Saved read unavailable');}),
        });
        cleanups.push(mounted.dispose);
        const row = mounted.wrapper.get('[data-finance-invoice="12"]');
        await button(row, 'Accept').trigger('click');
        const dialog = new DOMWrapper(document.querySelector<HTMLElement>('[role="dialog"]')!);
        await button(dialog, 'Accept').trigger('click');
        await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
        await mounted.wrapper.setProps({invoices: [invoice]});
        expect(mounted.wrapper.get('[data-finance-invoice="12"]').element).toBe(row.element);
        expect(row.findAll<HTMLButtonElement>('button').every(button => button.element.disabled)).toBe(true);
        finish(json({changed: true}));
        await flushPromises();
        expect(dialog.text()).toContain('Your change was saved, but the refreshed data could not be loaded.');
        await button(dialog, 'Close').trigger('click');
        await flushPromises();
        expect(document.body.textContent).toContain('Your change was saved, but the refreshed data could not be loaded.');
        expect((button(row, 'Correct').element as HTMLButtonElement).disabled).toBe(false);
        expect(mounted.request).toHaveBeenCalledOnce();
    });

    it('releases externally retired unsent NEW fields without leaving an invisible dirty navigation blocker', async () => {
        const mounted = await mountFrontendEvent(FinanceHistory, async () => json({changed: true}), {
            eventId, pool, reviewComponent: FinanceInvoiceReview, invoices: [{...invoice, status: 'NEW'}], admin: true, refreshSaved: vi.fn(async () => {}),
        });
        cleanups.push(mounted.dispose);
        const row = mounted.wrapper.get('[data-finance-invoice="12"]');
        await row.get('input[type="number"]').setValue('0013.25');
        await row.get('textarea[id$="-inline-reason"]').setValue('Unsent explanation');
        await mounted.wrapper.setProps({invoices: [invoice]});
        expect(row.find('input, textarea').exists()).toBe(false);
        expect((button(row, 'Correct').element as HTMLButtonElement).disabled).toBe(false);
        const discard = vi.fn(() => false);
        vi.stubGlobal('confirm', discard);
        await mounted.router.push('/packing/another-list');
        expect(mounted.router.currentRoute.value.path).toBe('/packing/another-list');
        expect(discard).not.toHaveBeenCalled();
        expect(mounted.request).not.toHaveBeenCalled();
    });

    it('keeps a status-updated row locked after unknown delivery until explicit fresh inspection and acknowledgement', async () => {
        const refresh = vi.fn(async () => {});
        const mounted = await mountFrontendEvent(FinanceHistory, async () => {throw new TypeError('Response lost');}, {
            eventId, pool, reviewComponent: FinanceInvoiceReview, invoices: [{...invoice, status: 'NEW'}], admin: true, refreshSaved: refresh,
        });
        cleanups.push(mounted.dispose);
        const row = mounted.wrapper.get('[data-finance-invoice="12"]');
        await button(row, 'Accept').trigger('click');
        const dialog = new DOMWrapper(document.querySelector<HTMLElement>('[role="dialog"]')!);
        await button(dialog, 'Accept').trigger('click');
        await flushPromises();
        await mounted.wrapper.setProps({invoices: [invoice]});
        expect(row.findAll<HTMLButtonElement>('button').every(button => button.element.disabled)).toBe(true);
        await button(dialog, 'Refresh').trigger('click');
        await flushPromises();
        await button(dialog, mounted.context.messages.value.t('draft.review')).trigger('click');
        await flushPromises();
        expect(document.querySelector('[role="dialog"]')).toBeNull();
        expect((button(row, 'Correct').element as HTMLButtonElement).disabled).toBe(false);
        expect(refresh).toHaveBeenCalledOnce();
        expect(mounted.request).toHaveBeenCalledOnce();
    });

    it('identifies an overlong saved participant description during revision without writing or losing the reviewed draft', async () => {
        // Participant descriptions intentionally have no generated length cap.
        // Opening one for organizer correction can therefore seed this value
        // directly, without a user typing past the correction control's limit.
        const description = 'Original participant evidence '.repeat(150);
        const mounted = await mountForm(FinanceInvoiceReview, {invoice: {...invoice, description}, action: 'revise'});
        const control = mounted.dialog.get<HTMLTextAreaElement>('textarea[name="correctedDescription"]');
        expect(control.element.value).toBe(description);
        await mounted.dialog.get('form').trigger('submit');
        await mounted.dialog.get('form').trigger('submit');
        await flushPromises();
        expect(mounted.request).not.toHaveBeenCalled();
        const feedback = mounted.dialog.get('.frontend-notification.alert-danger');
        for (const locale of ['en', 'de'] as const) {
            mounted.context.locale.value = locale;
            await flushPromises();
            expect(mounted.dialog.get('.frontend-notification.alert-danger').element).toBe(feedback.element);
            expect(feedback.text()).toContain(mounted.context.messages.value.t('validation.fieldError', {
                field: mounted.context.messages.value.t('finance.description'),
                reason: mounted.context.messages.value.t('validation.maxLength', {limit: 4000}),
            }));
            expect(mounted.dialog.get('textarea[name="correctedDescription"]').element).toBe(control.element);
            expect(control.element.value).toBe(description);
        }

        await button(mounted.dialog, mounted.context.messages.value.t('finance.backToEdit')).trigger('click');
        await control.setValue('Reviewed correction');
        await mounted.dialog.get('form').trigger('submit');
        await mounted.dialog.get('form').trigger('submit');
        await flushPromises();
        expect(mounted.request).toHaveBeenCalledTimes(1);
        expect(await (mounted.request.mock.calls[0]![0] as Request).json()).toEqual({
            confirmed: true, expectedRevision: 7, correctedAmount: '10', correctedDescription: 'Reviewed correction',
        });
        expect(mounted.wrapper.emitted('close')).toHaveLength(1);
    });

    it('preserves the intentionally unbounded description when creating a pool', async () => {
        const description = 'Shared pool information '.repeat(250);
        const mounted = await mountForm(FinancePoolEditor, {pool: undefined});
        await mounted.dialog.get('input[name="name"]').setValue('Weekend pool');
        await mounted.dialog.get('input[name="description"]').setValue(description);
        await mounted.dialog.get('form').trigger('submit');
        await flushPromises();
        expect(mounted.request).toHaveBeenCalledTimes(1);
        expect(await (mounted.request.mock.calls[0]![0] as Request).json()).toMatchObject({name: 'Weekend pool', description});
        expect(mounted.wrapper.emitted('saved')).toHaveLength(1);
        expect(mounted.wrapper.emitted('close')).toHaveLength(1);
    });

    it('closes confirmed creation after a failed saved read without replaying the write', async () => {
        const refresh = vi.fn(async () => {throw new Error('Saved pool read unavailable');});
        const mounted = await mountForm(FinancePoolEditor, {pool: undefined, refresh});
        await mounted.dialog.get('input[name="name"]').setValue('Confirmed pool');
        await mounted.dialog.get('form').trigger('submit');
        await flushPromises();

        expect(mounted.request).toHaveBeenCalledTimes(1);
        expect(refresh).toHaveBeenCalledTimes(1);
        expect(mounted.wrapper.emitted('saved')).toHaveLength(1);
        expect(mounted.wrapper.emitted('close')).toHaveLength(1);
        expect(mounted.dialog.get<HTMLInputElement>('input[name="name"]').element.value).toBe('');
    });

    it.each(['rejected', 'unknown'] as const)('retains the creation draft and dialog after %s delivery', async outcome => {
        const refresh = vi.fn(async () => {});
        const mounted = await mountForm(FinancePoolEditor, {pool: undefined, refresh}, async () => {
            if (outcome === 'unknown') throw new TypeError('Creation response lost');
            return new Response(JSON.stringify({type: 'urn:surveyor:problem:validation-failed', title: 'Invalid input',
                status: 400, code: 'VALIDATION_FAILED', messageKey: 'api:errors.VALIDATION_FAILED', params: {},
                detail: 'Check the submitted values.', requestId: 'rejected-pool'}),
            {status: 400, headers: {'Content-Type': 'application/problem+json'}});
        });
        await mounted.dialog.get('input[name="name"]').setValue('Retained pool');
        await mounted.dialog.get('form').trigger('submit');
        await flushPromises();

        expect(mounted.request).toHaveBeenCalledTimes(1);
        expect(refresh).not.toHaveBeenCalled();
        expect(mounted.wrapper.emitted('close')).toBeUndefined();
        expect(mounted.wrapper.emitted('saved')).toBeUndefined();
        expect(mounted.dialog.get<HTMLInputElement>('input[name="name"]').element.value).toBe('Retained pool');
        if (outcome === 'unknown') {
            await mounted.dialog.get('form').trigger('submit');
            await flushPromises();
            expect(mounted.request).toHaveBeenCalledTimes(1);
        }
    });

    it.each([false, true])('closes the section creation dialog and retains one receipt when saved read fails=%s', async failRead => {
        let reads = 0;
        let writes = 0;
        const mounted = await mountFrontendEvent(FinanceSection, async request => {
            if (request.method === 'POST') { writes++; return json({changed: true}); }
            reads++;
            // A real server cooldown makes the following read fail immediately;
            // this case targets creation finality rather than Query retry timing.
            if (reads > 1 && failRead) return new Response('Saved Finance read unavailable', {
                status: 503, headers: {'Retry-After': '60'},
            });
            return json(snapshot);
        }, {eventId, admin: true, enabled: true});
        cleanups.push(mounted.dispose);
        await vi.waitFor(() => expect(mounted.context.queryClient.isFetching()).toBe(0));
        await button(mounted.wrapper, 'Create pool').trigger('click');
        const dialog = new DOMWrapper(document.querySelector<HTMLElement>('[role="dialog"]')!);
        const form = dialog.get('form');
        vi.spyOn(form.element as HTMLFormElement, 'reportValidity').mockReturnValue(true);
        await dialog.get('input[name="name"]').setValue('Confirmed section pool');
        await form.trigger('submit');
        await flushPromises();
        await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());

        expect(writes).toBe(1);
        const notices = [...document.querySelectorAll('.alert-success, .status-notice.alert-warning')]
            .filter(element => element.textContent?.includes(failRead ? 'Your change was saved' : 'Pool created.'));
        expect(notices).toHaveLength(1);
        const retries = [...notices[0]!.querySelectorAll<HTMLButtonElement>('button')]
            .filter(control => control.textContent?.trim() === mounted.context.messages.value.t('common.retry'));
        expect(retries).toHaveLength(failRead ? 1 : 0);
        if (failRead) expect(retries[0]!.disabled).toBe(true);
    });

    it.each([false, true])('retries only the failed Finance read through its one common receipt; repeated failure=%s', async failAgain => {
        // Happy DOM supplies no layout; production still checks disclosure and
        // hidden ancestors while joining only the matching visible receipt.
        vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
        let reads = 0;
        let writes = 0;
        let deliver: ((response: Response) => void) | undefined;
        function limited(deadline = false): Response {
            return new Response(JSON.stringify({type: 'urn:surveyor:problem:rate-limited', status: 429,
                title: 'Read limited', detail: 'Read limited', requestId: 'finance-read-recovery',
                code: 'RATE_LIMITED', messageKey: 'api:errors.RATE_LIMITED', params: {}}), {
                status: 429, headers: {'Content-Type': 'application/problem+json', ...(deadline ? {'Retry-After': '60'} : {})},
            });
        }
        const mounted = await mountFrontendEvent(FinanceSection, async request => {
            if (request.method === 'POST') { writes++; return json({changed: true}); }
            reads++;
            if (reads === 1) return json(snapshot);
            if (reads === 2) return limited();
            return new Promise<Response>(resolve => { deliver = resolve; });
        }, {eventId, admin: true, enabled: true});
        cleanups.push(mounted.dispose);
        await vi.waitFor(() => expect(mounted.context.queryClient.isFetching()).toBe(0));
        await button(mounted.wrapper, 'Create pool').trigger('click');
        const dialog = new DOMWrapper(document.querySelector<HTMLElement>('[role="dialog"]')!);
        const form = dialog.get('form');
        vi.spyOn(form.element as HTMLFormElement, 'reportValidity').mockReturnValue(true);
        await dialog.get('input[name="name"]').setValue('Confirmed pool before failed read');
        await form.trigger('submit'); await flushPromises();
        expect(document.querySelector('[role="dialog"]')).toBeNull();

        const surface = new DOMWrapper(document.body);
        const common = surface.get('.frontend-notification.status-notice.alert-warning');
        expect(surface.findAll('.status-notice.alert-warning')).toHaveLength(1);
        expect(common.text()).toContain(mounted.context.messages.value.t('state.savedRefreshFailed'));
        expect(common.find('[data-read-issue]').exists()).toBe(true);
        expect(common.find('[data-last-successful-refresh]').exists()).toBe(true);
        const query = mounted.context.queryClient.getQueryCache().getAll().find(entry => entry.state.error)!;
        const originalFailure = query.state.error;
        expect(originalFailure).toBeInstanceOf(ApiFailure);
        expect(query.state.data).toMatchObject({audience: 'organizer', pools: [{id: poolId}]});
        const retry = button(common, mounted.context.messages.value.t('common.retry'));
        await retry.trigger('click');
        await vi.waitFor(() => expect(deliver).toBeTypeOf('function'));
        try {
            expect(retry.attributes('aria-busy')).toBe('true');
            expect((retry.element as HTMLButtonElement).disabled).toBe(true);
            await retry.trigger('click'); await flushPromises();
            expect(reads).toBe(3);
            expect(writes).toBe(1);
        } finally {
            deliver!(failAgain ? limited(true) : json(snapshot));
            await flushPromises();
        }

        expect(writes).toBe(1);
        expect(reads).toBe(3);
        if (failAgain) {
            expect(query.state.error).not.toBe(originalFailure);
            expect(surface.findAll('.status-notice.alert-warning')).toHaveLength(1);
            const retained = surface.get('.frontend-notification.status-notice.alert-warning');
            expect(retained.find('[data-read-issue]').exists()).toBe(true);
            expect(retained.find('[data-read-retry-at]').exists()).toBe(true);
            expect((button(retained, mounted.context.messages.value.t('common.retry')).element as HTMLButtonElement).disabled).toBe(true);
        } else {
            expect(query.state.error).toBeNull();
            expect(surface.find('.status-notice.alert-warning').exists()).toBe(false);
        }
    });

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
        expect(mounted.dialog.get('textarea[name="rejectionReason"]').attributes('maxlength')).toBe('4000');
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
        expect(button(mounted.dialog, 'Add expense').attributes('type')).toBe('submit');
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

    it('retires removed explicit creation selections without adding newly admitted participants', async () => {
        const mounted = await mountForm(FinancePoolEditor, {pool: undefined});
        await mounted.dialog.get('input[name="name"]').setValue('Retained creation draft');
        await mounted.dialog.get('input[name="assignAll"]').setValue(false);
        const newcomer = {id: '9', name: 'New participant', email: null};
        await mounted.wrapper.setProps({participants: [participants[0]!, newcomer]});
        expect(mounted.dialog.find('input[name="registrations"][value="8"]').exists()).toBe(false);
        expect(mounted.dialog.get<HTMLInputElement>('input[name="registrations"][value="7"]').element.checked).toBe(true);
        expect(mounted.dialog.get<HTMLInputElement>('input[name="registrations"][value="9"]').element.checked).toBe(false);
        expect(mounted.dialog.get<HTMLInputElement>('input[name="name"]').element.value).toBe('Retained creation draft');
        await mounted.dialog.get('form').trigger('submit');
        await flushPromises();
        expect(await (mounted.request.mock.calls[0]![0] as Request).json()).toMatchObject({assignAll: false, registrations: ['7']});
        expect(mounted.request).toHaveBeenCalledOnce();
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
