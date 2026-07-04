import express, {NextFunction} from 'express';
import createError from "http-errors";
import {handleValidationError, wrapErrorApi} from '../middleware/validationErrorHandler';

import activityApiRouter from './api/activity';
import driverApiRouter from './api/drivers';
import eventApiRouter from './api/event';
import packingApiRouter from './api/packing';
import surveyApiRouter from './api/survey';
import userApiRouter from './api/users';

const router = express.Router();

router.use('/activity', activityApiRouter);
router.use('/packing', packingApiRouter);
router.use('/drivers', driverApiRouter);
router.use('/event', eventApiRouter);
router.use('/users', userApiRouter);
router.use('/survey', surveyApiRouter);

router.use(handleValidationError);
// catch 404 and forward to error handler
router.use(function (req: express.Request, res: express.Response, next: NextFunction) {
    next(createError(404));
});
router.use(wrapErrorApi);

export default router;