import {Router, type ErrorRequestHandler} from 'express';
import v1Router from './api/v1';
import {handleApiProblem} from '../modules/api/problem';

const router = Router();

// One version inventory wires normal routing and errors raised before a router
// can run, such as body-parser failures. The application root knows no version.
const versions = [{path: '/v1', router: v1Router, error: handleApiProblem}];
for (const version of versions) router.use(version.path, version.router);

/** Dispatch early API errors through the same registered version's wire boundary.
 * Mounted at /api just like the normal router, so req.path is API-relative. */
export const handleApiError: ErrorRequestHandler = function handleApiError(error, req, res, next) {
    // Do not interpret an unsupported version as v1 or change its established
    // application fallback. Supported versions retain their own error contract.
    // Match the existing Express routers' case-insensitive path semantics as
    // well as exact segment boundaries; query text never selects a version.
    const pathname = req.path.toLowerCase();
    const version = versions.find(candidate => pathname === candidate.path || pathname.startsWith(candidate.path + '/'));
    if (!version) return next(error);
    // Return the selected handler's completion so Express also observes a
    // future version handler's asynchronous failure through its normal chain.
    return version.error(error, req, res, next);
};

export default router;
