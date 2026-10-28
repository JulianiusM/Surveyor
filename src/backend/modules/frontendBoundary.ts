import fs from 'node:fs';
import path from 'node:path';
import type {Plugin, ViteDevServer} from 'vite';

/** Only these package entry points are admitted from application browser code.
 * Their bundled transitive dependencies remain owned by Vite, never a static
 * publication of the dependency directory. Keep SSR-only entries out of this list. */
export const frontendBrowserDependencies = ['vue', 'vue-router', '@tanstack/vue-query',
    'i18next', 'i18next-vue', 'openapi-fetch', 'reka-ui'];

const sharedFiles = new Set(['src/common/lib/frontendIdentity.ts', 'src/common/lib/helpNavigation.ts',
    'src/common/lib/fileMedia.ts', 'src/common/lib/utf8.ts',
    'src/common/lib/civilDate.ts', 'src/common/activity/requirements.ts',
    'src/common/generated/domainChoices.ts', 'src/common/generated/passwordPolicy.ts',
    'src/common/localization/translator.ts', 'src/common/localization/inputValidation.ts',
    'src/common/localization/permissionLabels.ts', 'src/common/localization/generated/resources.json',
    'src/common/localization/generated/manifest.json', 'src/common/localization/generated/permissions.ts',
    '.generated/api/v1/policy.mjs']);
const publicDependencyFiles = new Set(['node_modules/vite/dist/client/client.mjs',
    'node_modules/vite/dist/client/env.mjs', 'node_modules/bootstrap-icons/font/fonts/bootstrap-icons.woff',
    'node_modules/bootstrap-icons/font/fonts/bootstrap-icons.woff2']);

/** Compare resolved filesystem owners, including symlinks, with the public source
 * inventory. Filename prefixes alone must never authorize a private symlink target. */
function relativeFile(root: string, filename: string): string {
    const absolute = path.resolve(filename);
    const resolved = fs.existsSync(absolute) ? fs.realpathSync(absolute) : absolute;
    return path.relative(fs.realpathSync(root), resolved).split(path.sep).join('/');
}

/** Shared/browser source is an explicit executable inventory, excluding SSR,
 * declarations, raw catalogs and the backend even while they share one checkout. */
function isPublicSource(relative: string): boolean {
    if (sharedFiles.has(relative)) return true;
    if (/^\.generated\/api\/v1\/browser\/validate[\w]+\.mjs$/u.test(relative)) return true;
    return relative.startsWith('src/frontend/') && relative !== 'src/frontend/app/entry-server.ts'
        && !relative.endsWith('.d.ts') && /\.(?:ts|vue|sass|scss|css)$/u.test(relative);
}

/** Admit one canonical request path before any Vite transform or raw-file handler.
 * Optimized JS is restricted to the actual compiler metadata, not a directory or
 * caller-supplied module identifier; only the icon fonts and Vite runtime bypass it. */
export function isFrontendDevelopmentRequest(server: ViteDevServer, url: string): boolean {
    // Decode ordinary spaces/Unicode once for filesystem paths. Encoded URL
    // separators stay escaped under decodeURI and are rejected below, as are
    // double encodings; no later decoder can reveal another owner or query.
    let pathname: string;
    try { pathname = decodeURI(url.split('?', 1)[0]!); }
    catch { return false; }
    if (pathname.includes('%') || pathname.includes('\\') || pathname.includes('\0')
        || !pathname.startsWith(server.config.base)) return false;
    const source = pathname.slice(server.config.base.length);
    if (source.split('/').some(segment => segment === '.' || segment === '..' || segment === '')) return false;
    if (source === '@vite/client' || source === '@vite/env') return true;
    // Vue's compiler imports this fixed virtual helper from transformed SFCs.
    // Its plugin supplies code directly; it cannot resolve a requested file or
    // package. Keep this exact exception separate from arbitrary module aliases.
    if (source === '@id/__x00__plugin-vue:export-helper') return true;
    // Arbitrary @id aliases can ask Vite to resolve an otherwise private module.
    // Filesystem aliases still use the exact same resolved ownership check below.
    if (source.startsWith('@id/')) return false;
    const filesystemPath = source.slice(4);
    const filename = source.startsWith('@fs/')
        ? path.isAbsolute(filesystemPath) ? filesystemPath : '/' + filesystemPath
        : path.resolve(server.config.root, source);
    const relative = relativeFile(server.config.root, filename);
    if (isPublicSource(relative) || publicDependencyFiles.has(relative)) return true;
    const metadata = server.environments.client.depsOptimizer?.metadata;
    if (!metadata) return false;
    // Entries may be requested while Vite finishes their initial optimization.
    // noDiscovery confines this inventory to the configured browser entry points.
    for (const dependency of Object.values({...metadata.optimized, ...metadata.chunks})) {
        const emitted = relativeFile(server.config.root, dependency.file);
        if (relative === emitted || relative === emitted + '.map') return true;
    }
    return false;
}

/** Apply the same source owners to the actual client graph at development/build
 * time. A new private import must fail before it enters JS, raw output or maps. */
export function frontendBoundary(projectRoot: string): Plugin {
    const root = path.resolve(projectRoot);
    return {
        name: 'surveyor-frontend-boundary',
        enforce: 'pre',
        configureServer(server) {
            // This also protects direct Vite launches; Express adds its own base
            // admission and preserves ordinary application-route fallthrough.
            server.middlewares.use(/** Preserve missing ordinary-route fallthrough
             * while source files and aliases require the reviewed public inventory;
             * denied source requests receive an uncached 404. */
            function guardFrontendSource(req, res, next) {
                // Nonexistent extensionless paths retain Vite's ordinary route
                // fallthrough. Existing files and all source/alias namespaces
                // still require the inventory even without an extension.
                const pathname = req.url?.split('?', 1)[0] ?? '';
                const relative = pathname.startsWith(server.config.base) ? pathname.slice(server.config.base.length) : '';
                if (/^[a-zA-Z0-9][\w-]*$/u.test(relative) && !fs.existsSync(path.join(root, relative))) {
                    next();
                    return;
                }
                if (!req.url || !isFrontendDevelopmentRequest(server, req.url)) {
                    res.statusCode = 404;
                    res.setHeader('Cache-Control', 'no-store');
                    res.end('Not found');
                    return;
                }
                next();
            });
        },
        /** Enforce reviewed package-entry resolution for public client importers.
         * Other environments retain their normal resolution and no private file
         * becomes public merely through a relative dependency path. */
        async resolveId(source, importer) {
            if (this.environment.name !== 'client' || !importer || importer.startsWith('\0')) return null;
            const owner = relativeFile(root, importer.split('?', 1)[0]!);
            if (!isPublicSource(owner)) return null;
            // Application code selects only reviewed browser package entries.
            // Resolving a relative/absolute dependency path cannot bypass that grant.
            const resolved = await this.resolve(source, importer, {skipSelf: true});
            if (!resolved) return null;
            const dependency = relativeFile(root, resolved.id.split('?', 1)[0]!);
            if (dependency.startsWith('node_modules/') && !frontendBrowserDependencies.includes(source)
                && !publicDependencyFiles.has(dependency)) {
                this.error('Browser imports must use an admitted frontend dependency entry');
            }
            return null;
        },
        load(id) {
            if (this.environment.name !== 'client' || id.startsWith('\0')) return null;
            // Dependency internals are reached only through the admitted package
            // graph. HTTP cannot select arbitrary files from this directory.
            const relative = relativeFile(root, id.split('?', 1)[0]!);
            if (!relative.startsWith('node_modules/') && !isPublicSource(relative)) {
                this.error('Private source cannot enter the browser module graph');
            }
            return null;
        },
    };
}
