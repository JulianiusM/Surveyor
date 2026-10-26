import {Router} from 'express';
import {ApiProblem, handleApiProblem} from '../../modules/api/problem';
import sessionRouter from './v1/session';
import helpRouter from './v1/help';
import packingRouter from './v1/packing';
import driversRouter from './v1/drivers';
import surveysRouter from './v1/surveys';
import activityRouter from './v1/activity';
import authRouter from './v1/auth';
import overviewRouter from './v1/overview';
import eventRouter from './v1/events';

const router = Router();

// Compose domains only. Endpoint implementation and business calls stay in the
// matching version-specific router; this layer owns their common error boundary.
router.use(sessionRouter);
router.use('/help', helpRouter);
router.use(authRouter);
router.use('/overview', overviewRouter);
router.use('/packing-lists', packingRouter);
router.use('/drivers-lists', driversRouter);
router.use('/surveys', surveysRouter);
router.use('/activity-plans', activityRouter);
router.use('/events', eventRouter);
router.use(function missingOperation(_req, _res, next) {next(new ApiProblem('NOT_FOUND'));});
router.use(handleApiProblem);

export default router;
