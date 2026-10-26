/*
 * Copyright 2026 Julian Malovanij
 * Licensed under the Apache License, Version 2.0.
 */

import type {RequestHandler} from 'express';
import {safeFrontendReturn} from '../../common/lib/frontendIdentity';
import settings from '../modules/settings';

/**
 * Recover the original identity-entry return from a legitimate internal Referer
 * only when no explicit next was supplied. The shared safe-return owner remains
 * authoritative; this middleware never changes identity or provider state.
 */
export function addNextQuery(localPart: string, notStartsWith?: string): RequestHandler {
    /** Redirect to the same entry with bounded navigation before its existing work. */
    return function preserveInternalReferrer(req, res, next): void {
        // Explicit values, including malformed values, belong to the existing
        // entry sanitizer. A referrer must never replace that caller's choice.
        if (req.query.next !== undefined && req.query.next !== '') return next();
        const source = req.get('referer');
        if (!source) return next();

        let configuredRoot: URL;
        let referrer: URL;
        try {
            configuredRoot = new URL(settings.value.rootUrl);
            referrer = new URL(source);
        } catch { return next(); }

        // URL origins and path-segment boundaries replace the old permissive
        // string-prefix test. Another host or application cannot choose a return.
        if (referrer.origin !== configuredRoot.origin) return next();
        const rootPath = configuredRoot.pathname.replace(/\/+$/u, '');
        if (rootPath && referrer.pathname !== rootPath && !referrer.pathname.startsWith(rootPath + '/')) return next();
        const pathname = referrer.pathname.slice(rootPath.length) || '/';
        if (pathname === '/' || pathname.startsWith(localPart)
            || notStartsWith && pathname.startsWith(notStartsWith)) return next();

        const destination = pathname + referrer.search + referrer.hash;
        // Invalid route families fall through. Manufacturing the sanitizer's
        // default here would incorrectly override the existing logout/provider
        // destination when there was no eligible internal referrer.
        if (safeFrontendReturn(destination) !== destination) return next();

        // Keep the request's presentation and other query choices when adding
        // next. The identity operation still runs only on the following request.
        const query = new URL(req.originalUrl, 'https://surveyor.invalid').searchParams;
        query.set('next', destination);
        res.redirect(`${localPart}?${query}`);
    };
}
