import express from 'express';
import type {RequestHandler} from 'express';
import fs from 'node:fs';
import path from 'node:path';

/** Recognize the browser's ordinary equal-quality choice without interpreting
 * weighted parameters. Express remains the owner of all weighted negotiation. */
function hasUnweightedBrotliAndGzip(header: string | undefined): boolean {
    const declarations = (header ?? '').split(',').map(value => value.trim().toLowerCase());
    // Both bare tokens mean q=1. Leave weighted or duplicated declarations to
    // Express rather than reinterpret a client's explicit encoding preferences.
    for (const encoding of ['br', 'gzip']) {
        const matches = declarations.filter(value => value.split(';', 1)[0]!.trim() === encoding);
        if (matches.length !== 1 || matches[0] !== encoding) return false;
    }
    return true;
}

/** Serve the existing public frontend directory, selecting build-prepared gzip or
 * Brotli only for manifest-authored text assets. Private responses never enter this
 * owner; ordinary static delivery retains conditional, HEAD and Range behavior. */
export function createFrontendAssets(directory: string): RequestHandler {
    const root = path.resolve(directory);
    const original = express.static(root);
    const authored = new Set<string>();
    const manifestPath = path.join(root, '.vite/manifest.json');
    // Development may start before an installed build exists. Its Vite middleware
    // remains the source owner, while absent built files retain normal fallthrough.
    if (fs.existsSync(manifestPath)) {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Record<string,
            {file: string; css?: string[]; assets?: string[]}>;
        for (const chunk of Object.values(manifest)) {
            for (const filename of [chunk.file, ...chunk.css ?? [], ...chunk.assets ?? []]) {
                // Vite owns these relative paths. Reject an unexpected escaping
                // manifest rather than permitting it to widen the static root.
                const normalized = path.posix.normalize(filename);
                if (normalized !== filename || filename.includes('\\') || path.posix.isAbsolute(filename) || path.win32.isAbsolute(filename)
                    || normalized.startsWith('../')) throw new Error('Invalid frontend asset manifest path');
                if (/\.(?:js|css|svg)$/u.test(filename)) authored.add('/' + filename);
            }
        }
    }

    /** Select an available accepted representation without changing request URLs,
     * or delegate to the original static owner with its existing range semantics. */
    return function serveFrontendAsset(req, res, next): void {
        const pathname = req.url.split('?', 1)[0]!;
        // Encoded spellings and Range requests keep Express's original parser and
        // byte-range contract. No request path is decoded into a second file owner.
        if (!['GET', 'HEAD'].includes(req.method) || !authored.has(pathname)) {
            original(req, res, next);
            return;
        }
        res.vary('Accept-Encoding');
        if (req.headers.range && req.acceptsEncodings('identity')) {
            original(req, res, next);
            return;
        }

        const filename = path.join(root, pathname.slice(1));
        if (!fs.existsSync(filename)) { original(req, res, next); return; }
        const available = ['identity'];
        if (fs.existsSync(filename + '.gz')) available.unshift('gzip');
        if (fs.existsSync(filename + '.br')) available.unshift('br');
        let accepted = req.acceptsEncodings(...available);
        if (!accepted) { res.status(406).end(); return; }
        // Chromium lists gzip before br without weighting either. Prefer the
        // smaller build-prepared Brotli representation for that explicit tie;
        // higher client weights, exclusions and wildcard negotiation stay intact.
        if (accepted === 'gzip' && available.includes('br')
            && hasUnweightedBrotliAndGzip(req.headers['accept-encoding'])) accepted = 'br';
        const extension = accepted === 'br' ? '.br' : accepted === 'gzip' ? '.gz' : '';
        // A build may omit a sidecar when encoding adds bytes. Keep original files
        // usable without precompression and verify the current original still exists.
        if (!extension) {
            original(req, res, next);
            return;
        }

        res.type(path.extname(filename)).set('Content-Encoding', accepted);
        // sendFile preserves HEAD/conditional delivery without rewriting req.url.
        // A client forbidding identity receives the full negotiated encoding;
        // its Range is ignored rather than applied to a different byte sequence.
        res.sendFile(filename + extension, {acceptRanges: false}, function sentFrontendAsset(error) {
            if (!error) return;
            // A release can remove an asset between selection and streaming. Let
            // the existing static/missing-asset owner report that delivery failure.
            if (!res.headersSent) {
                for (const header of ['Content-Encoding', 'Content-Type', 'Content-Length', 'ETag',
                    'Last-Modified', 'Accept-Ranges', 'Content-Range']) res.removeHeader(header);
                if (!req.acceptsEncodings('identity')) { res.status(406).end(); return; }
                original(req, res, next);
            } else next(error);
        });
    };
}
