import {describe, expect, it} from 'vitest';
import {contractValidator} from '../../src/modules/api/contracts';

describe('Activity legacy identity wire contracts', () => {
    it('uses canonical strings for role catalogs, slot edits and attendance membership', () => {
        const role = contractValidator('ActivityRole');
        expect(role({id: '7', title: 'Kitchen lead', description: null})).toBe(true);
        expect(role({id: 7, title: 'Kitchen lead', description: null})).toBe(false);
        const slot = contractValidator('ActivitySlotPatch');
        expect(slot({roles: ['7']})).toBe(true);
        expect(slot({roles: [7]})).toBe(false);
        expect(slot({roles: ['07']})).toBe(false);

        const attendance = contractValidator('ActivityRequirementAttendance');
        const person = {profileId: null, name: 'Alex', arrivalDate: null, departureDate: null, roleIds: ['7']};
        expect(attendance(person)).toBe(true);
        expect(attendance({...person, roleIds: [7]})).toBe(false);
    });

    it('retains zero requirement counts while rejecting numeric role and override identities', () => {
        const validate = contractValidator('ActivityRequirementsInput');
        const input = {assignmentMode: 'REQUIRED', generalRequiredShifts: 0, roundingMode: 'CEIL', bindingDeadline: null,
            allowOverfillAfterFull: false, allowExternalAssignees: false, allowArrivalDayEvening: true, allowDepartureDayMorning: true,
            roleRequirements: [{roleId: '7', requiredShifts: 0}], stayRequirements: [],
            overrides: [{id: '8', profileId: '22222222-2222-4222-8222-222222222222', roleId: '7', requiredShifts: 0}]};
        expect(validate(input)).toBe(true);
        expect(validate({...input, roleRequirements: [{roleId: 7, requiredShifts: 0}]})).toBe(false);
        expect(validate({...input, overrides: [{...input.overrides[0], id: 8}]})).toBe(false);
    });
});
