import {describe, expect, it} from 'vitest';
import type {ApiOperationId} from '../../src/types/ApiTransportTypes';
import {contractValidator} from '../../src/backend/modules/api/contracts';
import {ApiProblem, validatedProblemBody} from '../../src/backend/modules/api/problem';
import {decodeApiParameters, validateApiInput} from '../../src/backend/modules/api/transport';
import {createTranslator} from '../../src/common/localization/translator';
import {formatFieldDiagnostic} from '../../src/common/localization/inputValidation';
import {problemMessage} from '../../src/frontend/composables/feedback';

/** Capture an actual generated transport rejection without starting an HTTP
 * listener or substituting the schema validator or response formatter. */
function rejection(operation: () => unknown): ApiProblem {
    try { operation(); } catch (error) {
        expect(error).toBeInstanceOf(ApiProblem);
        return error as ApiProblem;
    }
    throw new Error('Expected generated input validation to reject');
}

/** The production operation manifest chooses each schema, including multipart
 * metadata envelopes; no test-only schema duplicates application constraints. */
function invalidInput(operation: ApiOperationId, input: unknown): ApiProblem {
    return rejection(() => validateApiInput(operation, input));
}

/** Validate both localized server replies and the client's known-code display.
 * The same saved English receipt must follow a later German locale selection. */
function localizedReplies(problem: ApiProblem) {
    const english = validatedProblemBody(problem, 'en', 'input-diagnostic');
    const german = validatedProblemBody(problem, 'de', 'input-diagnostic');
    for (const [locale, body] of [['en', english], ['de', german]] as const) {
        expect(contractValidator('Problem')(body)).toBe(true);
        expect(body).toMatchObject({code: 'VALIDATION_FAILED', status: 400, params: {}});
        expect(problemMessage(createTranslator(locale), english)).toBe(body.detail);
    }
    return {english, german};
}

describe('safe generated input diagnostics', () => {
    it('explains the actual description limit in English and German without exposing its value or validator prose', () => {
        const value = 'PRIVATE_DESCRIPTION_'.repeat(1000);
        const problem = invalidInput('updatePackingMetadata', {description: value});
        const {english, german} = localizedReplies(problem);
        expect(problem.fieldErrors).toContainEqual({pointer: '/description', code: 'invalid',
            diagnostic: {field: 'description', rule: 'maxLength', limit: 16000}});
        for (const [locale, body] of [['en', english], ['de', german]] as const) {
            const messages = createTranslator(locale);
            expect(body.detail).toBe(messages.t('validation.fieldError', {
                field: messages.t('validation.fields.description'), reason: messages.t('validation.maxLength', {limit: 16000}),
            }));
            expect(JSON.stringify(body)).not.toContain('PRIVATE_DESCRIPTION_');
            expect(JSON.stringify(body)).not.toContain('must NOT have more than');
            expect(JSON.stringify(body)).not.toContain('schemaPath');
        }
    });

    it.each(['missing', 'blank'] as const)('identifies a %s survey title using its precise generated rule', kind => {
        const data = {description: '', combinations: [{weekday: 'MON', nthWeek: '1'}],
            ...(kind === 'blank' ? {title: '   '} : {})};
        const problem = invalidInput('createSurvey', {data});
        const {english, german} = localizedReplies(problem);
        expect(problem.fieldErrors?.find(error => error.diagnostic?.field === 'title')?.diagnostic)
            .toEqual({field: 'title', rule: kind === 'missing' ? 'required' : 'nonBlank'});
        for (const [locale, body] of [['en', english], ['de', german]] as const) {
            const messages = createTranslator(locale);
            expect(body.detail).toContain(messages.t('validation.fields.title'));
            expect(body.detail).toContain(messages.t(kind === 'missing' ? 'validation.required' : 'validation.nonBlank'));
        }
    });

    it('explains why an empty survey combination list is rejected', () => {
        const problem = invalidInput('createSurvey', {data: {title: 'Monthly meeting', description: '', combinations: []}});
        const {english, german} = localizedReplies(problem);
        expect(problem.fieldErrors?.find(error => error.diagnostic)?.diagnostic)
            .toEqual({field: 'combinations', rule: 'minItems', limit: 1});
        for (const [locale, body] of [['en', english], ['de', german]] as const) {
            const messages = createTranslator(locale);
            expect(body.detail).toContain(messages.t('validation.fields.combinations'));
            expect(body.detail).toContain(messages.t('validation.minItem'));
        }
    });

    it('explains an actual empty property patch using one field in both languages', () => {
        const problem = invalidInput('updatePackingMetadata', {});
        const {english, german} = localizedReplies(problem);
        expect(problem.fieldErrors?.find(error => error.diagnostic)?.diagnostic)
            .toEqual({field: 'request', rule: 'minProperties', limit: 1});
        for (const [locale, body] of [['en', english], ['de', german]] as const) {
            const messages = createTranslator(locale);
            expect(body.detail).toBe(messages.t('validation.fieldError', {
                field: messages.t('validation.fields.request'), reason: messages.t('validation.minProperty'),
            }));
        }
    });

    it.each([
        {rule: 'minItems', singular: 'validation.minItem', plural: 'validation.minItems'},
        {rule: 'maxItems', singular: 'validation.maxItem', plural: 'validation.maxItems'},
        {rule: 'minProperties', singular: 'validation.minProperty', plural: 'validation.minProperties'},
        {rule: 'maxProperties', singular: 'validation.maxProperty', plural: 'validation.maxProperties'},
    ] as const)('uses singular $rule wording only for one, retaining the exact bounds', ({rule, singular, plural}) => {
        for (const locale of ['en', 'de']) {
            const messages = createTranslator(locale);
            for (const limit of [0, 1, 2]) {
                expect(formatFieldDiagnostic(messages, {field: 'request', rule, limit})).toBe(messages.t('validation.fieldError', {
                    field: messages.t('validation.fields.request'),
                    reason: limit === 1 ? messages.t(singular) : messages.t(plural, {limit}),
                }));
            }
            expect(formatFieldDiagnostic(messages, {field: 'request', rule})).toBe(messages.t('validation.fieldError', {
                field: messages.t('validation.fields.request'), reason: messages.t('validation.invalid'),
            }));
        }
    });

    it('keeps a survey answer record identifier out of row numbering and does not disclose the rejected answer', () => {
        const problem = invalidInput('submitSurveyBallot', {answers: {'1489': 'PRIVATE_REJECTED_ANSWER'}});
        const {english, german} = localizedReplies(problem);
        const diagnostic = problem.fieldErrors?.find(error => error.diagnostic)?.diagnostic;
        expect(diagnostic).toEqual({field: 'answers', rule: 'enum'});
        expect(diagnostic).not.toHaveProperty('row');
        expect(JSON.stringify(diagnostic)).not.toContain('1489');
        for (const body of [english, german]) {
            expect(body.detail).not.toContain('1490');
            expect(JSON.stringify(body)).not.toContain('PRIVATE_REJECTED_ANSWER');
        }
    });

    it('does not echo an unsupported property name or its value into the public problem', () => {
        const problem = invalidInput('updatePackingMetadata', {title: 'Valid title', PRIVATE_PROPERTY_NAME: 'PRIVATE_PROPERTY_VALUE'});
        const {english, german} = localizedReplies(problem);
        expect(problem.fieldErrors?.find(error => error.diagnostic)?.diagnostic)
            .toEqual({field: 'request', rule: 'additionalProperties'});
        for (const body of [english, german]) {
            expect(JSON.stringify(body)).not.toContain('PRIVATE_PROPERTY_NAME');
            expect(JSON.stringify(body)).not.toContain('PRIVATE_PROPERTY_VALUE');
        }
    });

    it('identifies a repeated page query value at the real scalar decoding boundary', () => {
        const problem = rejection(() => decodeApiParameters('getOverview', {
            path: {}, query: {page: ['PRIVATE_FIRST_PAGE', 'PRIVATE_SECOND_PAGE']}, header: {},
        }));
        const {english, german} = localizedReplies(problem);
        expect(problem.fieldErrors).toEqual([{pointer: '/query/page', code: 'type',
            diagnostic: {field: 'page', rule: 'type', type: 'string'}}]);
        for (const [locale, body] of [['en', english], ['de', german]] as const) {
            expect(body.detail).toContain(createTranslator(locale).t('validation.fields.page'));
            expect(JSON.stringify(body)).not.toContain('PRIVATE_FIRST_PAGE');
            expect(JSON.stringify(body)).not.toContain('PRIVATE_SECOND_PAGE');
        }
    });

    it('numbers an actual combination array row from one while preserving its missing-field identity', () => {
        const problem = invalidInput('createSurvey', {data: {title: 'Monthly meeting', description: '',
            combinations: [{weekday: 'MON', nthWeek: '1'}, {nthWeek: '2'}]}});
        const {english, german} = localizedReplies(problem);
        expect(problem.fieldErrors?.find(error => error.diagnostic)?.diagnostic)
            .toEqual({field: 'weekday', rule: 'required', row: 2});
        for (const [locale, body] of [['en', english], ['de', german]] as const) {
            const messages = createTranslator(locale);
            const field = messages.t('validation.rowField', {row: messages.t('validation.entry'), number: 2,
                field: messages.t('validation.fields.weekday')});
            expect(body.detail).toBe(messages.t('validation.fieldError', {field, reason: messages.t('validation.required')}));
        }
    });

    it('recognizes the actual survey occurrence property instead of falling back to the whole combination list', () => {
        const problem = invalidInput('createSurvey', {data: {title: 'Monthly meeting', description: '',
            combinations: [{weekday: 'MON', nthWeek: 'PRIVATE_INVALID_OCCURRENCE'}]}});
        const {english, german} = localizedReplies(problem);
        expect(problem.fieldErrors?.find(error => error.diagnostic)?.diagnostic)
            .toEqual({field: 'occurrence', rule: 'enum', row: 1});
        for (const [locale, body] of [['en', english], ['de', german]] as const) {
            expect(body.detail).toContain(createTranslator(locale).t('validation.fields.occurrence'));
            expect(JSON.stringify(body)).not.toContain('PRIVATE_INVALID_OCCURRENCE');
        }
    });

    it('identifies the real activity capacity and event deadline/timezone properties through their existing labels', () => {
        const cases = [
            {operation: 'addActivitySlot', input: {day: '2026-10-24', title: 'Talk', description: '',
                startTime: null, endTime: null, maxAssignees: false, roles: []}, field: 'capacity'},
            {operation: 'updateEventMetadata', input: {bindingDeadline: false}, field: 'deadline'},
            {operation: 'updateEventMetadata', input: {deadlineTz: false}, field: 'timezone'},
        ] as const;
        for (const {operation, input, field} of cases) {
            const problem = invalidInput(operation, input);
            const {english, german} = localizedReplies(problem);
            expect(problem.fieldErrors?.find(error => error.diagnostic)?.diagnostic?.field).toBe(field);
            for (const [locale, body] of [['en', english], ['de', german]] as const)
                expect(body.detail).toContain(createTranslator(locale).t(`validation.fields.${field}`));
        }
    });
});
