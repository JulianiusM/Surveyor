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

import rateLimit from 'express-rate-limit';
import {APIError} from '../modules/lib/errors';

/** Administrator discovery shares one per-IP search budget across feature routes.
 * This is a transport limit, not a permission decision. Routes admit their
 * authoritative context first, then controllers evaluate resource grants. */
export const searchLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, // 10 minutes
    limit: 120, // 120 searches / 10 minutes per IP
    standardHeaders: true,
    legacyHeaders: false,
    handler: function handleSearchRateLimit(req, res, next, options) {
        // All retained callers use the existing Problem classifier/localization owner.
        next(new APIError('Search rate limit exceeded', {}, options.statusCode));
    },
});
