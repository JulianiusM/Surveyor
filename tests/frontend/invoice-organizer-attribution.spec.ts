import {describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import * as pug from 'pug';
import {invoicePresentation} from '../../src/modules/invoice/presentation';

const participants = [{id: 1, name: 'Participant who paid', email: 'paid@example.com'},
    {id: 2, name: 'Other participant', email: 'other@example.com'}];

/** Render only fixed test-owned invocations against the production mixins and explicit feature data. */
function renderAttribution(fragment: string, pool: Record<string, unknown>): string {
    const filename = resolve('src/views/modules/module_invoice_pool.pug');
    return pug.render(readFileSync(filename, 'utf8') + '\n' + fragment,
        {filename, pool, participants, ev: {id: 'event'}, ui: invoicePresentation});
}

/** Supply ordinary pool inputs so the real management modal also renders its neighboring existing forms. */
function poolFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {id: 'attribution-pool', name: 'Shared costs', status: 'OPEN', distributionMethod: 'EQUAL',
        assignAll: true, assignments: [], takeovers: [], surcharges: [], invoices: [], subtractPersonalInvoices: true,
        ...overrides};
}

describe('organizer invoice paid-by presentation', () => {
    it.each(['OPEN', 'ORGANIZER_ONLY', 'CLOSED'])('offers optional participant attribution in %s without changing proof requirements', (status) => {
        const output = renderAttribution('+poolManagementModals(ev, pool, participants, ui)', poolFixture({status}));
        const expense = /<form[^>]*class="pool-expense-form"[^>]*>([\s\S]*?)<\/form>/.exec(output)![1];
        const selection = /<select([^>]*)name="registrationId"([^>]*)>([\s\S]*?)<\/select>/.exec(expense)!;
        expect(selection[1] + selection[2]).not.toContain('required');
        expect(selection[3]).toContain('<option value="">' + invoicePresentation.text('sharedOrganizerExpense') + '</option>');
        expect(selection[3]).toContain('<option value="1">Participant who paid</option>');
        expect(selection[3]).toContain('<option value="2">Other participant</option>');
        expect(expense).toContain(invoicePresentation.text('paidByParticipantOptional'));
        expect(expense).toContain('Deduct submitter invoices from their share');
        expect(expense).toContain('invoice history');
        const proof = /<input[^>]*name="proof"[^>]*>/.exec(expense)![0];
        expect(proof).not.toContain('required');
    });

    it('limits paid-by choices to current explicit pool members without adding a registration', () => {
        const output = renderAttribution('+poolManagementModals(ev, pool, participants, ui)',
            poolFixture({assignAll: false, assignments: [{registrationId: 1}]}));
        const selection = /<select[^>]*name="registrationId"[^>]*>([\s\S]*?)<\/select>/.exec(output)![1];
        expect(selection).toContain('value="1"');
        expect(selection).not.toContain('value="2"');
        expect(selection).toContain('value=""');
    });

    it('displays the paid-by participant and independent saved organizer audit in administration and own history', () => {
        const invoice = {id: 5, poolId: 'attribution-pool', registrationId: 1, recordedByProfileId: 'organizer',
            recordedByName: 'Recorder <script>', amount: '20.00', description: 'Participant receipt', status: 'APPROVED'};
        const pool = poolFixture({invoices: [invoice]});
        const admin = renderAttribution("+adminInvoiceOverview(pool, ev.id, participants, ui)", pool);
        expect(admin).toContain('Participant who paid');
        expect(admin).toContain('Recorded by Recorder &lt;script&gt;');
        expect(admin).toContain('paid@example.com');
        expect(admin).toContain(invoicePresentation.text('noProofAttached'));
        expect(admin).not.toContain(invoicePresentation.text('proofExpired'));
        expect(admin).not.toContain('Recorder <script>');
        const creationCell = /<td data-label="Invoice">([\s\S]*?)<\/td>/.exec(admin)![1];
        expect(creationCell).toContain('Recorded ');
        expect(creationCell).not.toContain('Submitted ');
        const personal = renderAttribution('+participantInvoiceOverview(pool.invoices, [pool], ev.id, ui)', pool);
        expect(personal).toContain('Participant receipt');
        expect(personal).toContain('Recorded by Recorder &lt;script&gt;');
        expect(personal).toContain(invoicePresentation.text('noProofAttached'));
        expect(personal).toContain('invoice-close-self');
    });

    it('keeps an unattributed organizer entry labeled as a shared pool expense', () => {
        const pool = poolFixture({invoices: [{id: 6, registrationId: null, recordedByName: 'Shared recorder',
            amount: '30.00', description: 'Unattributed shared expense', status: 'APPROVED'}]});
        const output = renderAttribution('+adminInvoiceOverview(pool, ev.id, participants, ui)', pool);
        expect(output).toContain(invoicePresentation.text('poolExpense'));
        expect(output).toContain('Recorded by Shared recorder');
        expect(output).not.toContain('Participant who paid');
    });
});
