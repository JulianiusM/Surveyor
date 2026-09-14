import {afterEach, describe, expect, it, vi} from 'vitest';
import {serializePoolAssignments} from '../../src/public/js/events';

class FormDataStub {
    constructor(private form: {values: Record<string, string[]>}) {}
    get(name: string): string | null { return this.form.values[name]?.[0] ?? null; }
    getAll(name: string): string[] { return this.form.values[name] ?? []; }
}

afterEach(() => vi.unstubAllGlobals());

describe('pool assignment payload', () => {
    it('preserves multiple exemptions and individual factors including zero', () => {
        vi.stubGlobal('FormData', FormDataStub);
        const form = {
            values: {registrations: ['11', '12', '13'], exemptions: ['11', '12'], subtractPersonalInvoices: ['on']},
            querySelectorAll: () => [
                {dataset: {participantFactor: '11'}, value: '1.5', disabled: false},
                {dataset: {participantFactor: '12'}, value: '0.5', disabled: false},
                {dataset: {participantFactor: '13'}, value: '0', disabled: false},
                {dataset: {participantFactor: '14'}, value: '2', disabled: true},
            ],
        } as unknown as HTMLFormElement;

        expect(serializePoolAssignments(form)).toEqual({
            registrations: ['11', '12', '13'], exemptions: ['11', '12'],
            assignAll: '', isDefault: '', subtractPersonalInvoices: 'on',
            participantFactors: {'11': '1.5', '12': '0.5', '13': '0'},
        });
    });

    it('sends factors when assign-all checkboxes are disabled and omitted from FormData', () => {
        vi.stubGlobal('FormData', FormDataStub);
        const form = {
            values: {assignAll: ['on'], isDefault: ['on']},
            querySelectorAll: () => [{dataset: {participantFactor: '11'}, value: '1.0001', disabled: false}],
        } as unknown as HTMLFormElement;

        expect(serializePoolAssignments(form)).toEqual({
            registrations: [], exemptions: [], assignAll: 'on', isDefault: 'on', subtractPersonalInvoices: '',
            participantFactors: {'11': '1.0001'},
        });
    });
});
