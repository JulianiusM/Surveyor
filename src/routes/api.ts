import express from 'express';
import {handleValidationError} from '../middleware/validationErrorHandler';

import activityApiRouter from './api/activity';
import packingApiRouter from './api/packing';
import driverApiRouter from './api/drivers';
import eventApiRouter from './api/event';

const router = express.Router();

router.use('/activity', activityApiRouter);
router.use('/packing', packingApiRouter);
router.use('/drivers', driverApiRouter);
router.use('/event', eventApiRouter);

router.use(handleValidationError);

export default router;