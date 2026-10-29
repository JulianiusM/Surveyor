/*
 * Copyright 2026 Julian Malovanij
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import cookieParser from 'cookie-parser';
import express, {NextFunction, Request, Response} from 'express';
import flash from 'express-flash';
import session from 'express-session';
import path from 'node:path';
import {handleGenericError} from './middleware/genericErrorHandler';
import {AppDataSource} from './modules/database/dataSource';
import {createSessionStore} from './modules/database/services/UserService';
import settings from './modules/settings';
import {frontendDevelopmentMiddleware} from './modules/frontendDevelopment';
import {createFrontendAssets} from './modules/frontendAssets';
import {createPublicAssets} from './modules/publicAssets';
import apiRouter, {handleApiError} from './routes/api';
import indexRouter from './routes';
import usersRouter from './routes/users';
import surveyRouter from './routes/survey';
import packingRouter from './routes/packing';
import activityRouter from './routes/activity';
import driversRouter from './routes/drivers';
import eventRouter from './routes/event';
import helpRouter from './routes/help';
import guestsRouter from './routes/guests';
import {admitFrontendDocument, renderFrontendError} from './middleware/frontendDocuments';
import {APIError} from './modules/lib/errors';
import {createAccessLogger} from './modules/lib/http';

const app = express();
app.disable("x-powered-by");

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');

// Keep the full existing access-log format. Only secret values in the original
// URL are projected away; routing, harmless query spelling and timing stay intact.
app.use(createAccessLogger());
// Allow long descriptions and item collections, including URL-encoded Unicode text.
app.use(express.json({limit: '1mb'}));
app.use(express.urlencoded({extended: true, limit: '1mb'}));
app.use(cookieParser());
app.use(frontendDevelopmentMiddleware);
// The development server runs source TS, while both frontend builds share their normal dist outputs.
// Select frontend encodings before the general public root can serve /app files.
app.use('/app', createFrontendAssets(path.resolve(__dirname, '../../dist/public/app')));
// An old document may request a chunk removed by a release. Keep missing assets
// outside document rendering so its recovery can observe the real failed load.
app.use('/app', function missingFrontendAsset(_req, res) {
    res.status(404).set('Cache-Control', 'no-store').type('text/plain').send('Not found');
});
app.use(createPublicAssets(path.join(__dirname, '../public')));

// ensure dataSource is initialized before this
const sessionStore = createSessionStore(AppDataSource.manager);

// If behind a proxy (Heroku/NGINX), enable this so secure cookies work:
app.set("trust proxy", 1);

app.use(
    session({
        secret: settings.value.sessionSecret,
        resave: false,
        saveUninitialized: false,
        cookie: {
            // 1 day (match store TTL below)
            maxAge: 1000 * 60 * 60 * 24,
            secure: process.env.NODE_ENV === "production", // HTTPS only in prod
            sameSite: "lax",
        },
        store: sessionStore,
    })
);

app.use(flash());

// The API owns structured expiry/errors; document admission uses the same actor
// owner before the domain routers without adding a second session lifecycle.
app.use('/api', apiRouter);
app.get('/healthz', (_req, res) => res.status(200).send('ok'));

// Admit documents once before the established domain branches. Each router owns
// its own entry, parameter loading and output ordering; none consumes siblings.
app.use(admitFrontendDocument);
app.use('/', indexRouter);
app.use('/users', usersRouter);
app.use('/survey', surveyRouter);
app.use('/packing', packingRouter);
app.use('/activity', activityRouter);
app.use('/drivers', driversRouter);
app.use('/event', eventRouter);
app.use('/help', helpRouter);
app.use('/guest', guestsRouter);

// catch 404 and forward to error handler
app.use(function (req: Request, res: Response, next: NextFunction) {
    next(new APIError('Not found', {}, 404));
});

// error handler
// JSON parsing can fail before a request reaches the router or even the session middleware.
app.use('/api', handleApiError);
app.use(renderFrontendError);
app.use(handleGenericError);

export default app;
