const express = require('express');
const router = express.Router();

const validationErrorHandler = require('../middleware/validationErrorHandler');

const activityApiRouter = require('./api/activity');
const packingApiRouter = require('./api/packing');
const driverApiRouter = require('./api/drivers');

router.use('/activity', activityApiRouter);
router.use('/packing', packingApiRouter);
router.use('/drivers', driverApiRouter);

router.use(validationErrorHandler);

module.exports = router;