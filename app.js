const createError = require('http-errors');
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const logger = require('morgan');
const session = require('express-session');
const flash = require('express-flash');

const indexRouter = require('./routes/index');
const apiRouter = require('./routes/api');
const usersRouter = require('./routes/users');
const surveyRouter = require('./routes/survey');
const packingRouter = require('./routes/packing');
const activityRouter = require('./routes/activity');
const driversRouter = require('./routes/drivers');

const settings = require('./modules/settings');
const genericErrorHandler = require('./middleware/genericErrorHandler');

const app = express();

// Version aus package.json lesen
const {version} = require('./package.json');

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({extended: true}));
app.use(cookieParser());
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

app.use(function (req, res, next) {
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
app.use(function (req, res, next) {
    next(createError(404));
});

// error handler
app.use(genericErrorHandler);

module.exports = app;