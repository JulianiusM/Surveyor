const express = require('express');
const router = express.Router();

const validationErrorHandler = require('../middleware/validationErrorHandler');

const activityApiRouter = require('./api/activity');
const packingApiRouter = require('./api/packing');

router.use('/activity', activityApiRouter);
router.use('/packing', packingApiRouter);

router.use(validationErrorHandler);

module.exports = router;