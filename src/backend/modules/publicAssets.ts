import express from 'express';
import type {RequestHandler} from 'express';
import fs from 'node:fs';
import path from 'node:path';

/** A public filename must resolve inside its configured public directory, including
 * the target of every symlink/junction. A public root cannot alias a private tree. */
export function isPublicFile(directory: string, filename: string): boolean {
    try {
        // Compare the actual file with the intended root rather than resolving
        // that root into a potentially private symlink destination as well.
        const relative = path.relative(path.resolve(directory), fs.realpathSync(filename));
        return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)
            && !relative.split(path.sep).some(segment => segment.toLowerCase() === 'node_modules');
    } catch { return false; }
}

/** Serve the public tree with Express's ordinary HTTP semantics while denying
 * filesystem aliases into private application/dependency files. Missing paths
 * still fall through to the application's existing routes or missing-asset owner. */
export function createPublicAssets(directory: string): RequestHandler {
    const root = path.resolve(directory);
    const original = express.static(root);
    return /** Constrain actual files and implicit indexes before static delivery. */ function servePublicAsset(req, res, next): void {
        // Express remains responsible for malformed URI/method diagnostics. Decode
        // only its pathname once so encoded separators receive the same root check.
        let pathname: string;
        try { pathname = decodeURIComponent(req.url.split('?', 1)[0]!); }
        catch { original(req, res, next); return; }
        if (!['GET', 'HEAD'].includes(req.method) || pathname.includes('\0')) {
            original(req, res, next);
            return;
        }
        const filename = path.resolve(root, '.' + pathname);
        // An absent target cannot disclose a file. Preserve static fallthrough
        // instead of intercepting a legitimate document/API route at this layer.
        if (!fs.existsSync(filename)) { original(req, res, next); return; }
        if (!isPublicFile(root, filename)) {
            res.status(404).set('Cache-Control', 'no-store').end();
            return;
        }
        // Express may select index.html after a directory request. Check that
        // implicit filename too; validating the directory alone is insufficient.
        const index = path.join(filename, 'index.html');
        if (fs.existsSync(index) && !isPublicFile(root, index)) {
            res.status(404).set('Cache-Control', 'no-store').end();
            return;
        }
        original(req, res, next);
    };
}
