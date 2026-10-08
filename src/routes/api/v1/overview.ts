import {Router} from 'express';
import type {components, operations} from '../../../types/api/v1';
import {asyncHandler} from '../../../modules/lib/asyncHandler';
import {requireApiContext} from '../../../modules/api/session';
import {sendValidatedJson, validateOperationRequest} from '../../../modules/api/transport';
import {readOverview, setOverviewVisibility} from '../../../modules/overview/api';

const router = Router();
router.get('/', asyncHandler(async function getOverview(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'getOverview');
    const query = req.query as operations['getOverview']['parameters']['query'];
    sendValidatedJson(req, res, 'getOverview', 200, await readOverview(query, actor));
}));
router.put('/:entityType/:entityId/visibility', asyncHandler(async function setVisibility(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'setOverviewVisibility');
    sendValidatedJson(req, res, 'setOverviewVisibility', 200, await setOverviewVisibility(
        req.params.entityType as components['schemas']['OverviewCard']['type'], String(req.params.entityId), req.body, actor));
}));
export default router;
