// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'express'.
const express = require('express');
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'router'.
const router = express.Router();

/* GET home page. */
router.get('/', function (req: any, res: any, next: any) {
    res.render('index');
});

// @ts-expect-error TS(2552): Cannot find name 'module'. Did you mean 'modules'?
module.exports = router;
