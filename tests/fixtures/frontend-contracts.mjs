import { validatePackingListView } from '../../.generated/api/v1/browser.mjs';
import { createTranslator } from '../../src/modules/localization/translator.js';
const patch = { description: null };
void patch;
// @ts-expect-error Boolean coercion is not part of the wire contract.
const invalidPatch = { title: false };
// @ts-expect-error Fields outside the metadata shape must not enter a generated request.
const broadPatch = { title: 'Title', archived: true };
void invalidPatch;
void broadPatch;
const params = { itemId: 'uuid-at-runtime' };
void params;
// @ts-expect-error A capacity problem requires its machine context even when it is omitted from prose.
const missingParams = {};
void missingParams;
if (validatePackingListView(received)) {
    const allowed = received.capabilities.selfAssign;
    void allowed;
    // @ts-expect-error Account emails are not part of the authorized list projection.
    received.items[0].assignees[0].email;
}
const { t } = createTranslator('de');
t('common.save');
t('app.activeProfile', { name: 'Guest' });
t('packing.placeCount', { count: 2 });
t('api:errors.PACKING_ITEM_FULL', { itemId: 'uuid-at-runtime' });
// @ts-expect-error Catalog keys are generated, not arbitrary strings.
t('common.doesNotExist');
// @ts-expect-error Required interpolation cannot be omitted.
t('app.activeProfile');
// @ts-expect-error Plural selection requires a number.
t('packing.placeCount', { count: '2' });
