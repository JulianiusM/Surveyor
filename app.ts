// @ts-expect-error TS(2580): Cannot find name 'require'. Do you need to install... Remove this comment to see the full error message
const createError = require('http-errors');
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'express'.
const express = require('express');
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'path'.
const path = require('path');
// @ts-expect-error TS(2580): Cannot find name 'require'. Do you need to install... Remove this comment to see the full error message
const cookieParser = require('cookie-parser');
// @ts-expect-error TS(2580): Cannot find name 'require'. Do you need to install... Remove this comment to see the full error message
const logger = require('morgan');
// @ts-expect-error TS(2580): Cannot find name 'require'. Do you need to install... Remove this comment to see the full error message
const session = require('express-session');
// @ts-expect-error TS(2580): Cannot find name 'require'. Do you need to install... Remove this comment to see the full error message
const flash = require('express-flash');

// @ts-expect-error TS(2580): Cannot find name 'require'. Do you need to install... Remove this comment to see the full error message
const indexRouter = require('./routes/index');
// @ts-expect-error TS(2580): Cannot find name 'require'. Do you need to install... Remove this comment to see the full error message
const apiRouter = require('./routes/api');
// @ts-expect-error TS(2580): Cannot find name 'require'. Do you need to install... Remove this comment to see the full error message
const usersRouter = require('./routes/users');
// @ts-expect-error TS(2580): Cannot find name 'require'. Do you need to install... Remove this comment to see the full error message
const surveyRouter = require('./routes/survey');
// @ts-expect-error TS(2580): Cannot find name 'require'. Do you need to install... Remove this comment to see the full error message
const packingRouter = require('./routes/packing');
// @ts-expect-error TS(2580): Cannot find name 'require'. Do you need to install... Remove this comment to see the full error message
const activityRouter = require('./routes/activity');
// @ts-expect-error TS(2580): Cannot find name 'require'. Do you need to install... Remove this comment to see the full error message
const driversRouter = require('./routes/drivers');

// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'settings'.
const settings = require('./modules/settings');
// @ts-expect-error TS(2580): Cannot find name 'require'. Do you need to install... Remove this comment to see the full error message
const genericErrorHandler = require('./middleware/genericErrorHandler');

// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'app'.
const app = express();

// Version aus package.json lesen
// @ts-expect-error TS(2580): Cannot find name 'require'. Do you need to install... Remove this comment to see the full error message
const {version} = require('./package.json');

// view engine setup
// @ts-expect-error TS(2304): Cannot find name '__dirname'.
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({extended: true}));
app.use(cookieParser());
// @ts-expect-error TS(2304): Cannot find name '__dirname'.
app.use(express.static(path.join(__dirname, 'public')));

// Session-Setup
app.use(
    session({
        secret: settings.sessionSecret,
        resave: false,
        saveUninitialized: true,
        cookie: {maxAge: 1000 * 60 * 60}
    })
);

app.use(flash());

app.use(function (req: any, res: any, next: any) {
    res.locals.user = req.session.user;
    res.locals.guest = req.session.guest;
    res.locals.version = version;
    next();
});

app.use('/', indexRouter);
app.use('/api', apiRouter);
app.use('/users', usersRouter);
app.use('/survey', surveyRouter);
app.use('/packing', packingRouter);
app.use('/activity', activityRouter);
app.use('/drivers', driversRouter);

// catch 404 and forward to error handler
app.use(function (req: any, res: any, next: any) {
    next(createError(404));
});

// error handler
app.use(genericErrorHandler);

// @ts-expect-error TS(2580): Cannot find name 'module'. Do you need to install ... Remove this comment to see the full error message
module.exports = app;