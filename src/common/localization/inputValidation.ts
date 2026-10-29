import type {ErrorObject} from 'ajv';
import type {FieldDiagnostic, InputDiagnostic, ScalarParameterResult} from '../../types/InputValidationTypes';
import type {LocalizationContext, MessageKey} from '../../types/LocalizationTypes';
import {formatCivilDate} from '../lib/civilDate';
import {isPlainMessageKey} from './translator';

// This is a display vocabulary for authored request fields, not another schema.
// Aliases identify the same visible input across JSON, multipart and query forms;
// unknown names never become labels or expose submitted keys/values.
const fieldNames: Readonly<Record<string, FieldDiagnostic['field']>> = {
    title: 'title', name: 'name', displayname: 'displayname', displayName: 'displayname',
    description: 'description', correctedDescription: 'description', text: 'description',
    username: 'username', email: 'email', password: 'password', newPassword: 'password',
    password_repeat: 'passwordConfirmation', confirmPassword: 'passwordConfirmation',
    startDate: 'startDate', endDate: 'endDate', from: 'startDate', to: 'endDate', date: 'date', day: 'date',
    startTime: 'startTime', endTime: 'endTime', deadline: 'deadline', hardDeadline: 'deadline', bindingDeadline: 'deadline',
    timezone: 'timezone', timeZone: 'timezone', deadlineTz: 'timezone', maxUsers: 'capacity', maxParticipants: 'capacity', maxAssignees: 'capacity',
    capacity: 'capacity', seats: 'capacity', amount: 'amount', correctedAmount: 'amount',
    note: 'note', reason: 'reason', rejectionReason: 'reason', distribution: 'distribution',
    factor: 'factor', participantFactors: 'factor', registrations: 'participants',
    registrationId: 'participant', profileId: 'participant', participantId: 'participant',
    payerId: 'payer', beneficiaries: 'beneficiaries', registration: 'registration',
    role: 'role', roleId: 'role', roleName: 'role', roles: 'roles', permissions: 'permissions', defaultPermissions: 'permissions',
    image: 'image', proof: 'proof', q: 'search', search: 'search', page: 'page',
    childPage: 'page', locale: 'language', eventId: 'event', selectedId: 'event', combinations: 'combinations',
    weekday: 'weekday', nth: 'occurrence', nthWeek: 'occurrence', answers: 'answers', answer: 'selection',
    arrival: 'arrival', arrivalDate: 'arrival', departure: 'departure', departureDate: 'departure',
    diet: 'diet', dietary: 'diet', allergy: 'allergy', allergies: 'allergy', allergyNotes: 'allergy',
    comment: 'comment', dietComment: 'comment', travel: 'travel',
    breakfast: 'meal', lunch: 'meal', dinner: 'meal', itemId: 'activity', slotId: 'activity',
    sourceItemId: 'sourceActivity', sourceSlotId: 'sourceActivity', requirements: 'requirements',
    roleRequirements: 'requirements', stayRequirements: 'requirements',
    stayDuration: 'stay', stays: 'stay', stayDays: 'stay', overrides: 'overrides', removedOverrideIds: 'overrides', recommendations: 'recommendations',
    confirmation: 'confirmation', confirmed: 'confirmation', overlapConfirmation: 'confirmation', expectedRevision: 'revision',
    revision: 'revision', token: 'token', regToken: 'token', status: 'status', type: 'type', items: 'items', itemIds: 'items',
    position: 'position', quantity: 'quantity', count: 'quantity', visibility: 'visibility',
    url: 'url', link: 'url', targetProfileId: 'transfer',
    location: 'location',
    assignmentMode: 'assignmentMode',
    generalRequiredShifts: 'baselineRequirement',
    requiredShifts: 'requiredActivities',
    roundingMode: 'roundingMode',
    allowOverfillAfterFull: 'allowOverfillAfterFull',
    allowExternalAssignees: 'allowExternalAssignees',
    allowArrivalDayEvening: 'allowArrivalDayEvening',
    allowDepartureDayMorning: 'allowDepartureDayMorning',
    requiredByAll: 'requiredByAll',
    assignAll: 'assignAll',
    isDefault: 'defaultSetting',
    subtractPersonalInvoices: 'subtractPersonalInvoices',
    sendCalculationEmails: 'sendCalculationEmails',
    roundUpShares: 'roundUpShares',
    sendEmails: 'sendEmails',
    subtractFromPool: 'subtractFromPool',
    exemptions: 'exemptions',
    requireDietaryInfo: 'requireDietaryInfo',
    allowDietComment: 'allowDietComment',
    allowRegDateUpdatesAfterDeadline: 'allowRegDateUpdatesAfterDeadline',
    allowRegCancelationAfterDeadline: 'allowRegCancelationAfterDeadline',
    allowRegDietUpdateAfterDeadline: 'allowRegDietUpdateAfterDeadline',
    maxUses: 'maxUses',
    expiresAt: 'expiresAt',
    operation: 'operation',
    assigned: 'assigned',
    isPaid: 'settlementStatus',
    paused: 'automaticArchival',
};
const rules = new Set<FieldDiagnostic['rule']>(['required', 'type', 'format', 'maxLength', 'minLength',
    'maximum', 'minimum', 'exclusiveMaximum', 'exclusiveMinimum', 'minItems', 'maxItems',
    'minProperties', 'maxProperties', 'pattern', 'enum', 'uniqueItems', 'additionalProperties', 'invalid']);
const valueTypes = new Set<NonNullable<FieldDiagnostic['type']>>(
    ['integer', 'number', 'string', 'boolean', 'array', 'object', 'email', 'date', 'time', 'uuid']);

/** Decode the API's authored scalar serialization without coercing malformed
 * numbers, repeated values or structured parameters into valid input. Callers
 * retain their own field pointers and error presentation. */
export function decodeScalarParameter(value: unknown, type: unknown): ScalarParameterResult {
    if (typeof value !== 'string') return {valid: false};
    if (type === 'boolean') return value === 'true' || value === 'false'
        ? {valid: true, value: value === 'true'} : {valid: false};
    if (type === 'integer' || type === 'number') {
        const pattern = type === 'integer' ? /^-?(?:0|[1-9]\d*)$/u : /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u;
        const number = Number(value);
        if (!pattern.test(value) || !Number.isFinite(number) || type === 'integer' && !Number.isSafeInteger(number))
            return {valid: false};
        return {valid: true, value: number};
    }
    return {valid: true, value};
}

/** Retain only safe generated metadata for one actionable validation failure.
 * Branch summaries carry no field/rule explanation and are deliberately skipped.
 * No value, validator prose, schema path or arbitrary additional-property name is
 * retained; row positions are limited to actual known array collections. */
export function fieldDiagnostic(error: ErrorObject): FieldDiagnostic | undefined {
    if (['anyOf', 'oneOf', 'if', 'discriminator'].includes(error.keyword)) return;

    // Required failures point at the parent, so include the missing authored
    // property for label selection. Other pointers already identify the field.
    const path = error.instancePath + (error.keyword === 'required'
        ? '/' + String(error.params.missingProperty ?? '') : '');
    const segments = path.split('/').filter(Boolean);
    const knownName = [...segments].reverse().find(segment => Object.hasOwn(fieldNames, segment));
    const field = knownName ? fieldNames[knownName]! : 'request';
    const rule = error.keyword === 'pattern' && error.params.pattern === '\\S' ? 'nonBlank'
        : rules.has(error.keyword as FieldDiagnostic['rule'])
            ? error.keyword as FieldDiagnostic['rule'] : 'invalid';
    const diagnostic: FieldDiagnostic = {field, rule};

    // Constraints come from this actual validator failure. The display layer
    // neither copies limits nor rounds/normalizes the rejected draft.
    if (typeof error.params.limit === 'number' && Number.isFinite(error.params.limit)) diagnostic.limit = error.params.limit;
    const candidate = error.keyword === 'format' ? error.params.format
        : Array.isArray(error.params.type) ? error.params.type.find(type => type !== 'null') : error.params.type;
    if (valueTypes.has(candidate)) diagnostic.type = candidate;

    const match = /\/(?:items|combinations|overrides|roleRequirements|entries)\/(\d+)(?:\/|$)/u.exec(path);
    const row = match ? Number(match[1]) + 1 : undefined;
    if (row && Number.isSafeInteger(row) && row <= 1_000_000) diagnostic.row = row;
    return diagnostic;
}

/** Render the same wire diagnostic in server replies and retained client errors,
 * translating at display time so switching language never freezes old prose. */
export function formatFieldDiagnostic(messages: LocalizationContext, diagnostic: FieldDiagnostic): string {
    return formatInputDiagnostic(messages, fieldDiagnosticInput(diagnostic));
}

/** Convert the contract's finite field vocabulary into the common feature
 * presentation shape without translating early or retaining submitted values. */
export function fieldDiagnosticInput(diagnostic: FieldDiagnostic): InputDiagnostic {
    const label = ('validation.fields.' + diagnostic.field) as MessageKey;
    return {
        field: {label, ...(diagnostic.row ? {row: {label: 'validation.entry', number: diagnostic.row}} : {})},
        rule: diagnostic.rule, limit: diagnostic.limit, type: diagnostic.type,
    };
}

/** Explain safe generated metadata using the feature's visible labels. Feature
 * labels can be more specific than the generic transport vocabulary, including
 * an actual row/day, while sharing this one localized rule presentation. */
export function formatInputDiagnostic(messages: LocalizationContext, diagnostic: InputDiagnostic): string {
    const {field, rule, limit, type} = diagnostic;
    // Labels must be complete plain messages. A future invalid identity falls
    // back to Form rather than exposing a key or unresolved catalog parameters.
    const plain = messages.t as (key: MessageKey) => string;
    let label = plain(isPlainMessageKey(field.label) ? field.label : 'validation.fields.request');
    if (field.row) {
        const row = plain(isPlainMessageKey(field.row.label) ? field.row.label : 'validation.entry');
        label = field.row.day
            ? messages.t('validation.dayRowField', {day: formatCivilDate(field.row.day, messages.locale) ?? field.row.day,
                row, number: field.row.number, field: label})
            : messages.t('validation.rowField', {row, number: field.row.number, field: label});
    }

    // Every limit belongs to the originating schema. Unknown future rules still
    // identify the field without publishing parser details or submitted values.
    let reason = messages.t('validation.invalid');
    if (rule === 'maxLength' && limit !== undefined) reason = messages.t('validation.maxLength', {limit});
    else if ((rule === 'minLength' && limit === 1) || rule === 'required') reason = messages.t('validation.required');
    else if (rule === 'minLength' && limit !== undefined) reason = messages.t('validation.minLength', {limit});
    else if (rule === 'maximum' && limit !== undefined) reason = messages.t('validation.maximum', {limit});
    else if (rule === 'minimum' && limit !== undefined) reason = messages.t('validation.minimum', {limit});
    else if (rule === 'exclusiveMaximum' && limit !== undefined) reason = messages.t('validation.lessThan', {limit});
    else if (rule === 'exclusiveMinimum' && limit !== undefined) reason = messages.t('validation.greaterThan', {limit});
    else if (rule === 'minItems' && limit !== undefined) reason = limit === 1
        ? messages.t('validation.minItem') : messages.t('validation.minItems', {limit});
    else if (rule === 'maxItems' && limit !== undefined) reason = limit === 1
        ? messages.t('validation.maxItem') : messages.t('validation.maxItems', {limit});
    else if (rule === 'minProperties' && limit !== undefined) reason = limit === 1
        ? messages.t('validation.minProperty') : messages.t('validation.minProperties', {limit});
    else if (rule === 'maxProperties' && limit !== undefined) reason = limit === 1
        ? messages.t('validation.maxProperty') : messages.t('validation.maxProperties', {limit});
    else if (rule === 'uniqueItems') reason = messages.t('validation.uniqueItems');
    else if (rule === 'additionalProperties') reason = messages.t('validation.unsupported');
    else if (rule === 'nonBlank') reason = messages.t('validation.nonBlank');
    else if (rule === 'type' && type === 'integer') reason = messages.t('validation.integer');
    else if (rule === 'type' && type === 'number') reason = messages.t('validation.number');
    else if (rule === 'type' && type === 'boolean') reason = messages.t('validation.boolean');
    else if (rule === 'type' && type === 'array') reason = messages.t('validation.array');
    else if (rule === 'format' && type === 'email') reason = messages.t('validation.email');
    else if (rule === 'format' && type === 'date') reason = messages.t('validation.date');
    else if (rule === 'format' && type === 'time') reason = messages.t('validation.time');
    else if (rule === 'format' && type === 'uuid') reason = messages.t('validation.uuid');
    return messages.t('validation.fieldError', {field: label, reason});
}
