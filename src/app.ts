import createError from 'http-errors';
import express from 'express';
import path from 'path';
import cookieParser from 'cookie-parser';
import logger from 'morgan';
import session from 'express-session';
import flash from 'express-flash';

import indexRouter from './routes';
import apiRouter from './routes/api';
import usersRouter from './routes/users';
import surveyRouter from './routes/survey';
import packingRouter from './routes/packing';
import activityRouter from './routes/activity';
import driversRouter from './routes/drivers';
import settings from './modules/settings';
import {handleGenericError} from './middleware/genericErrorHandler';

// Version aus package.json lesen
import {version} from '../package.json';

const app = express();

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
app.use(handleGenericError);

export default app;