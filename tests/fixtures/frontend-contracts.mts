// Compiled by the foundation generation test. Negative assertions protect actual consumer declarations.
import type {components} from '../../src/types/api/v1.js';
import type {ApiResponseBody, ApiSuccessStatus} from '../../src/types/ApiTransportTypes.js';
import {validatePackingListView} from '../../.generated/api/v1/browser.mjs';
import {createTranslator} from '../../src/common/localization/translator.js';

const patch: components['schemas']['BasicEntityMetadataPatch'] = {description: null};
void patch;
// @ts-expect-error Boolean coercion is not part of the wire contract.
const invalidPatch: components['schemas']['BasicEntityMetadataPatch'] = {title: false};
// @ts-expect-error Fields outside the metadata shape must not enter a generated request.
const broadPatch: components['schemas']['BasicEntityMetadataPatch'] = {title: 'Title', archived: true};
void invalidPatch;
void broadPatch;

const readStatus: ApiSuccessStatus<'getSession'> = 200;
// @ts-expect-error Statuses are operation-specific, even if another operation accepts 201.
const wrongReadStatus: ApiSuccessStatus<'getSession'> = 201;
// @ts-expect-error An assignment result cannot be sent as a session representation.
const wrongResponse: ApiResponseBody<'getSession', 200> = {assigned: true};
void readStatus;
void wrongReadStatus;
void wrongResponse;

const params: Extract<components['schemas']['Problem'], {code: 'PACKING_ITEM_FULL'}>['params'] = {itemId: 'uuid-at-runtime'};
void params;
// @ts-expect-error A capacity problem requires its machine context even when it is omitted from prose.
const missingParams: Extract<components['schemas']['Problem'], {code: 'PACKING_ITEM_FULL'}>['params'] = {};
void missingParams;

declare const received: unknown;
if (validatePackingListView(received)) {
    const allowed: boolean = received.capabilities.selfAssign;
    void allowed;
    // @ts-expect-error Account emails are not part of the authorized list projection.
    received.items[0].assignees[0].email;
}

const {t} = createTranslator('de');
t('common.save');
t('app.activeProfile', {name: 'Guest'});
t('packing.placeCount', {count: 2});
t('api:errors.PACKING_ITEM_FULL', {itemId: 'uuid-at-runtime'});
const {rich} = createTranslator('de');
rich('activity.progressFree', {count: 2});
rich('activity.recommendations.scheduleHint', {});
// @ts-expect-error Plain messages do not declare authored Vue nodes.
rich('common.save', {});
// @ts-expect-error Rich plural selection retains its numeric parameter contract.
rich('activity.progressFree', {count: '2'});
// @ts-expect-error Catalog keys are generated, not arbitrary strings.
t('common.doesNotExist');
// @ts-expect-error Required interpolation cannot be omitted.
t('app.activeProfile');
// @ts-expect-error Plural selection requires a number.
t('packing.placeCount', {count: '2'});
