import type {NextFunction, Request, Response} from 'express';
import type {Server} from 'node:http';
import path from 'node:path';
import type {ViteDevServer} from 'vite';

let developmentServer: ViteDevServer | undefined;

/** Development is explicit: installed releases never import Vite or need dev dependencies.
 * Its middleware and WebSocket share Express's HTTP server and session origin. */
export async function initializeFrontendDevelopment(server: Server): Promise<void> {
    if (process.env.SURVEYOR_FRONTEND_DEV !== '1' || process.env.NODE_ENV === 'production') return;
    const {createServer} = await import('vite');
    // Source and compiled server modules share this project-relative layout. Bind
    // Vite to the maintained configuration so another launch directory or a stray
    // compiler output cannot silently select a different application configuration.
    const projectRoot = path.resolve(__dirname, '../..');
    const viteServer = await createServer({
        root: projectRoot,
        configFile: path.join(projectRoot, 'vite.config.mts'),
        appType: 'custom',
        server: {middlewareMode: true, ws: {server}},
    });
    developmentServer = viteServer;
    server.once('close', () => {
        if (developmentServer === viteServer) developmentServer = undefined;
        void viteServer.close();
    });
}

/** Mounted before static assets and application routes; Vite handles only its development requests. */
export function frontendDevelopmentMiddleware(req: Request, res: Response, next: NextFunction): void {
    if (!developmentServer || !req.url.startsWith(developmentServer.config.base)) {
        next();
        return;
    }
    // Vite strips its base from req.url in-place. Restore it on fallthrough so
    // Express still resolves its own /app assets/routes using the original URL.
    const originalUrl = req.url;
    developmentServer.middlewares(req, res, (error?: unknown) => {
        req.url = originalUrl;
        next(error);
    });
}

/** The renderer loads current source modules for development SSR, using Vite's own invalidation. */
export function frontendDevelopmentServer(): ViteDevServer | undefined {
    return developmentServer;
}
