import type {NextFunction, Request, Response} from 'express';
import type {Server} from 'node:http';
import path from 'node:path';
import type {ViteDevServer} from 'vite';

let developmentServer: ViteDevServer | undefined;

/** Source URLs shared by document delivery and startup preparation. */
export const frontendDevelopmentAssets = {script: '/src/frontend/app/entry-client.ts',
    styles: ['/src/frontend/styles/application.sass'], modules: [] as string[]};

/** Development is explicit: installed releases never import Vite or need dev dependencies.
 * Its middleware and WebSocket share Express's HTTP server and session origin. */
export async function initializeFrontendDevelopment(server: Server): Promise<void> {
    if (process.env.SURVEYOR_FRONTEND_DEV !== '1' || process.env.NODE_ENV === 'production') return;
    const {createServer} = await import('vite');
    // Source and compiled server modules share this project-relative layout. Bind
    // Vite to the maintained configuration so another launch directory or a stray
    // compiler output cannot silently select a different application configuration.
    const projectRoot = path.resolve(__dirname, '../../..');
    const viteServer = await createServer({
        root: projectRoot,
        configFile: path.join(projectRoot, 'vite.config.mts'),
        appType: 'custom',
        server: {middlewareMode: true, ws: {server}},
    });
    try {
        // Prepare the exact document assets before advertising HTTP readiness.
        // A linked stylesheet uses Vite's direct CSS representation; warming its
        // JavaScript wrapper would compile Sass again on the first browser visit.
        const client = viteServer.environments.client;
        await client.transformRequest(frontendDevelopmentAssets.script);
        for (const style of frontendDevelopmentAssets.styles) {
            await client.transformRequest(style + '?direct');
        }
        await client.waitForRequestsIdle();
    } catch (error) {
        // A failed source graph must not leave a watcher/WebSocket server alive
        // or let bootstrap report a usable application after a compile failure.
        await viteServer.close();
        throw error;
    }
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
