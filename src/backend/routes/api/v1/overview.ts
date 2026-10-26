import {Router} from 'express';
import type {components, operations} from '../../../../types/api/v1';
import {asyncHandler} from '../../../modules/lib/asyncHandler';
import {requireApiContext} from '../../../modules/api/session';
import {prepareValidatedJson, sendPreparedJson, sendValidatedJson, validateOperationRequest} from '../../../modules/api/transport';
import {readOverview, setOverviewVisibility} from '../../../modules/overview/api';

const router = Router();
router.get('/', asyncHandler(async function getOverview(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'getOverview');
    const query = req.query as operations['getOverview']['parameters']['query'];
    sendValidatedJson(req, res, 'getOverview', 200, await readOverview(query, actor));
}));
/** Prepare the versioned visibility receipt inside its existing locked write, then deliver committed bytes. */
router.put('/:entityType/:entityId/visibility', asyncHandler(async function setVisibility(req, res) {
    // Admission captures this request's actor before interpreting its command.
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'setOverviewVisibility');

    /** Validate/serialize the exact public projection before its private preference commits. */
    function prepareResult(result: components['schemas']['OverviewVisibilityResult']) {
        return prepareValidatedJson(req, 'setOverviewVisibility', 200, result);
    }
    const prepared = await setOverviewVisibility(req.params.entityType as components['schemas']['OverviewCard']['type'],
        String(req.params.entityId), req.body, actor, prepareResult);

    // Only delivery remains; no later projection, validation or JSON serialization
    // can turn this committed preference into a reported business rejection.
    sendPreparedJson(req, res, prepared);
}));
export default router;
