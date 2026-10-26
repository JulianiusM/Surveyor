import {apiCompatibility} from '../../.generated/api/v1/policy.mjs';
import {afterEach, describe, expect, it, vi} from 'vitest';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import {brotliCompressSync, brotliDecompressSync, gzipSync} from 'node:zlib';
import {frontendDevelopmentMiddleware, frontendDevelopmentServer, initializeFrontendDevelopment} from '../../src/backend/modules/frontendDevelopment';
import {createFrontendAssets} from '../../src/backend/modules/frontendAssets';
import {renderFrontend} from '../../src/backend/modules/frontendRenderer';
import type {FrontendBootstrap} from '../../src/types/FrontendTypes';
import {frontendBoundary} from '../../src/backend/modules/frontendBoundary';
import {createPublicAssets} from '../../src/backend/modules/publicAssets';

afterEach(() => { vi.unstubAllEnvs(); });

/** Remove only a fixture's canonical, directly owned temporary directory. */
async function removeBoundaryFixture(directory: string, prefix: string): Promise<void> {
    // Resolve both parents before recursive removal. A junction or an unexpected
    // caller path must not redirect cleanup outside this explicitly named fixture.
    const temporaryRoot = await fs.realpath(os.tmpdir());
    const target = await fs.realpath(directory);
    if (path.dirname(target) !== temporaryRoot || !path.basename(target).startsWith(prefix)) {
        throw new Error('Refusing to remove an unexpected frontend fixture directory');
    }
    await fs.rm(target, {recursive: true, force: true});
}

describe('frontend public asset delivery', () => {
    it('confines installed frontend and general static files to the public tree', async function confinesInstalledPublicFiles() {
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'surveyor-public-boundary-'));
        const publicRoot = path.join(directory, 'public');
        const frontendRoot = path.join(publicRoot, 'app');
        const privateRoot = path.join(directory, 'backend');
        const app = express();
        const server = http.createServer(app);
        try {
            // Both real production static owners see junctions that would expose
            // private bytes through plain express.static, including manifest assets.
            await fs.mkdir(path.join(frontendRoot, '.vite'), {recursive: true});
            await fs.mkdir(path.join(publicRoot, 'node_modules/private'), {recursive: true});
            await fs.mkdir(privateRoot);
            await fs.writeFile(path.join(publicRoot, 'visible.txt'), 'public fixture');
            await fs.writeFile(path.join(privateRoot, 'private.js'), 'private fixture');
            await fs.writeFile(path.join(privateRoot, 'private.js.br'), 'private sidecar fixture');
            await fs.writeFile(path.join(publicRoot, 'node_modules/private/package.json'), '{"private":true}');
            await fs.symlink(privateRoot, path.join(publicRoot, 'linked'), 'junction');
            await fs.symlink(privateRoot, path.join(frontendRoot, 'linked'), 'junction');
            await fs.writeFile(path.join(frontendRoot, '.vite/manifest.json'), JSON.stringify({entry: {file: 'linked/private.js'}}));
            app.use('/app', createFrontendAssets(frontendRoot));
            app.use('/public', createPublicAssets(publicRoot));
            app.use('/aliased-root', createPublicAssets(path.join(publicRoot, 'linked')));
            app.use((_req, res) => res.status(404).end());
            await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
            const address = server.address();
            if (!address || typeof address === 'string') throw new Error('The static boundary fixture listener has no port');
            const origin = `http://127.0.0.1:${address.port}`;
            const admitted = await fetch(origin + '/public/visible.txt');
            expect(admitted.status).toBe(200);
            expect(await admitted.text()).toBe('public fixture');
            for (const target of ['/public/linked/private.js', '/public/linked/private.js.br',
                '/app/linked/private.js', '/app/linked/private.js.br', '/public/node_modules/private/package.json',
                '/aliased-root/private.js']) {
                const denied = await fetch(origin + target, {headers: {'Accept-Encoding': 'br'}});
                expect(denied.status, target).toBe(404);
                expect(await denied.text(), target).not.toContain('private');
            }
        } finally {
            if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
            await removeBoundaryFixture(directory, 'surveyor-public-boundary-');
        }
    });

    it('denies private files and dependency directories before real Vite HTTP transforms', async function deniesPrivateHttpFiles() {
        const {createServer} = await import('vite');
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'surveyor-http-boundary with spaces-'));
        const app = express();
        const server = http.createServer(app);
        try {
            // Vite's ordinary root includes these private files. The production
            // boundary must reject them independently of compiler/plugin routing.
            await fs.mkdir(path.join(directory, 'src/frontend'), {recursive: true});
            await fs.mkdir(path.join(directory, 'src/backend'), {recursive: true});
            await fs.mkdir(path.join(directory, 'node_modules/private'), {recursive: true});
            await fs.writeFile(path.join(directory, 'src/frontend/entry.ts'), 'export const visible = "public fixture";');
            await fs.writeFile(path.join(directory, 'src/backend/private.ts'), 'export const secret = "private fixture";');
            await fs.writeFile(path.join(directory, 'node_modules/private/package.json'), '{"private":true}');
            await fs.symlink(path.join(directory, 'src/backend'), path.join(directory, 'src/frontend/linked'), 'junction');
            const vite = await createServer({configFile: false, root: directory, base: '/app/',
                appType: 'custom', plugins: [frontendBoundary(directory)],
                optimizeDeps: {noDiscovery: true, include: []}, server: {middlewareMode: true, ws: {server}},
            });
            app.use(vite.middlewares);
            app.use((_req, res) => res.status(404).end());
            await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
            const address = server.address();
            if (!address || typeof address === 'string') throw new Error('The boundary fixture listener has no port');
            const origin = `http://127.0.0.1:${address.port}`;
            try {
                const admitted = await fetch(origin + '/app/src/frontend/entry.ts');
                expect(admitted.status).toBe(200);
                expect(await admitted.text()).toContain('public fixture');
                // Absolute Vite URLs must work in ordinary checkouts with spaces
                // while encoded separators/aliases still cannot widen ownership.
                const publicFile = path.join(directory, 'src/frontend/entry.ts').split(path.sep).join('/');
                const absolute = await fetch(origin + encodeURI(`/app/@fs/${publicFile}`));
                expect(absolute.status).toBe(200);
                expect(await absolute.text()).toContain('public fixture');
                const privateFile = path.join(directory, 'src/backend/private.ts').split(path.sep).join('/');
                for (const target of ['/app/src/backend/private.ts', '/app/src/backend/private.ts?raw',
                    '/app/src/backend/private.ts?url', '/app/src/backend/private.ts.map',
                    '/app/src/frontend/linked/private.ts?raw', '/app/node_modules/private/package.json',
                    `/app/@fs/${privateFile}?raw`, '/app/@id/private', '/app/@id/__x00__src/backend/private.ts',
                    '/app/src%2fbackend%2fprivate.ts?raw', '/app/src%5cbackend%5cprivate.ts?raw',
                    '/app/src%252fbackend%252fprivate.ts?raw', '/app/src/frontend/%2e%2e/backend/private.ts?raw',
                    `/app/__open-in-editor?file=${encodeURIComponent(privateFile)}`]) {
                    const denied = await fetch(origin + target);
                    expect(denied.status, target).toBe(404);
                    expect(await denied.text(), target).not.toContain('private fixture');
                }
            } finally { await vite.close(); }
        } finally {
            if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
            await removeBoundaryFixture(directory, 'surveyor-http-boundary with spaces-');
        }
    });

    it('rejects private sources and dependency paths in the actual browser build graph', async function rejectsPrivateBrowserImports() {
        const {build} = await import('vite');
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'surveyor-browser-boundary-'));
        try {
            // Compile real imports in a disposable source-shaped checkout. No
            // database, application setup or repository source edits are needed.
            await fs.mkdir(path.join(directory, 'src/frontend'), {recursive: true});
            await fs.mkdir(path.join(directory, 'src/backend'), {recursive: true});
            await fs.writeFile(path.join(directory, 'src/backend/private.ts'), 'export const secret = "private fixture";');
            const input = path.join(directory, 'src/frontend/entry.ts');
            await fs.writeFile(input, 'export {secret} from "../backend/private.ts";');
            await expect(build({configFile: false, root: directory, logLevel: 'silent',
                plugins: [frontendBoundary(directory)], build: {write: false, rollupOptions: {input}},
            })).rejects.toThrow('Private source cannot enter the browser module graph');
            // A junction/symlink inside the public folder cannot make a private
            // target public. Directory junctions also work on unprivileged Windows.
            await fs.symlink(path.join(directory, 'src/backend'), path.join(directory, 'src/frontend/linked'), 'junction');
            await fs.writeFile(input, 'export {secret} from "./linked/private.ts";');
            await expect(build({configFile: false, root: directory, logLevel: 'silent',
                plugins: [frontendBoundary(directory)], build: {write: false, rollupOptions: {input}},
            })).rejects.toThrow('Private source cannot enter the browser module graph');
        } finally { await removeBoundaryFixture(directory, 'surveyor-browser-boundary-'); }
    });

    it('negotiates prepared encodings and retains original, HEAD, Range and missing-asset delivery', async function servesPreparedEncodings() {
        const fontBytes = await fs.readFile('node_modules/bootstrap-icons/font/fonts/bootstrap-icons.woff2');
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'surveyor-frontend-assets-'));
        const source = 'export const message = "A compressible application module";\n'.repeat(100);
        const style = '.fixture { color: white; }\n'.repeat(100);
        const scriptBytes = Buffer.from(source);
        const app = express();
        const server = http.createServer(app);
        try {
            // This isolated build-shaped directory owns public files and its
            // manifest. The actual Express middleware selects their encodings.
            await fs.mkdir(path.join(directory, 'assets'));
            await fs.mkdir(path.join(directory, '.vite'));
            await fs.writeFile(path.join(directory, '.vite/manifest.json'), JSON.stringify({entry: {
                file: 'assets/entry-hash.js', css: ['assets/entry-hash.css'], assets: ['assets/icons-hash.woff2'],
            }}));
            await fs.writeFile(path.join(directory, 'assets/entry-hash.js'), scriptBytes);
            await fs.writeFile(path.join(directory, 'assets/entry-hash.js.br'), brotliCompressSync(scriptBytes));
            await fs.writeFile(path.join(directory, 'assets/entry-hash.js.gz'), gzipSync(scriptBytes));
            await fs.writeFile(path.join(directory, 'assets/entry-hash.css'), style);
            await fs.writeFile(path.join(directory, 'assets/entry-hash.css.gz'), gzipSync(style));
            await fs.writeFile(path.join(directory, 'assets/icons-hash.woff2'), fontBytes);
            await fs.writeFile(path.join(directory, 'assets/unlisted.js'), source);
            await fs.writeFile(path.join(directory, 'assets/unlisted.js.br'), brotliCompressSync(scriptBytes));
            app.use('/app', createFrontendAssets(directory));
            app.use((_req, res) => res.status(404).end());
            await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
            const address = server.address();
            if (!address || typeof address === 'string') throw new Error('The asset fixture listener has no port');
            const origin = `http://127.0.0.1:${address.port}/app`;

            // Fetch decodes the real HTTP body. Its encoding/type/length headers
            // establish which stored representation supplied these same bytes.
            for (const encoding of ['br', 'gzip', 'identity']) {
                const response = await fetch(`${origin}/assets/entry-hash.js`, {headers: {'Accept-Encoding': encoding}});
                expect(response.status).toBe(200);
                expect(response.headers.get('content-encoding')).toBe(encoding === 'identity' ? null : encoding);
                expect(response.headers.get('content-type')).toContain('javascript');
                expect(response.headers.get('vary')).toContain('Accept-Encoding');
                expect(await response.text()).toBe(source);
            }
            // Actual browsers commonly list gzip first at the same quality as
            // Brotli. That order must not hide the smaller prepared encoding;
            // explicit weights/exclusions still keep their existing semantics.
            for (const [encoding, expected] of [
                ['gzip, deflate, br, zstd', 'br'],
                ['GZip, DEFLATE, BR', 'br'],
                ['gzip;q=1, br;q=0.5', 'gzip'],
                ['gzip;q=0.5, br;q=1', 'br'],
                ['gzip, br;q=0', 'gzip'],
                ['gzip, br, br;q=0.2', 'gzip'],
            ]) {
                const response = await fetch(`${origin}/assets/entry-hash.js`, {headers: {'Accept-Encoding': encoding!}});
                expect(response.headers.get('content-encoding'), encoding).toBe(expected);
                expect(await response.text()).toBe(source);
            }
            const head = await fetch(`${origin}/assets/entry-hash.js`, {method: 'HEAD', headers: {'Accept-Encoding': 'br'}});
            expect(head.status).toBe(200);
            expect(head.headers.get('content-encoding')).toBe('br');
            expect(head.headers.get('content-length')).toBe(String(brotliCompressSync(scriptBytes).length));
            expect(await head.text()).toBe('');
            const revalidated = await fetch(`${origin}/assets/entry-hash.js`, {
                // Explicit revalidation avoids Fetch adding Cache-Control:no-cache,
                // which intentionally requests a complete response from Express.
                headers: {'Accept-Encoding': 'br', 'If-None-Match': head.headers.get('etag')!, 'Cache-Control': 'max-age=0'},
            });
            expect(revalidated.status).toBe(304);
            expect(revalidated.headers.get('vary')).toContain('Accept-Encoding');
            expect(await revalidated.text()).toBe('');

            const fallback = await fetch(`${origin}/assets/entry-hash.css`, {headers: {'Accept-Encoding': 'br, gzip'}});
            expect(fallback.headers.get('content-encoding')).toBe('gzip');
            expect(fallback.headers.get('content-type')).toContain('text/css');
            expect(await fallback.text()).toBe(style);
            // WOFF2 is already a compressed binary format. The actual public
            // owner must preserve its font MIME, bytes and ordinary HEAD delivery.
            const font = await fetch(`${origin}/assets/icons-hash.woff2`, {headers: {'Accept-Encoding': 'br, gzip'}});
            expect(font.status).toBe(200);
            expect(font.headers.get('content-type')).toContain('font/woff2');
            expect(font.headers.get('content-encoding')).toBeNull();
            expect(Buffer.from(await font.arrayBuffer())).toEqual(fontBytes);
            const fontHead = await fetch(`${origin}/assets/icons-hash.woff2`, {method: 'HEAD'});
            expect(fontHead.status).toBe(200);
            expect(fontHead.headers.get('content-length')).toBe(String(fontBytes.length));
            expect(await fontHead.text()).toBe('');
            const range = await fetch(`${origin}/assets/entry-hash.js`, {headers: {'Accept-Encoding': 'br', Range: 'bytes=0-5'}});
            expect(range.status).toBe(206);
            expect(range.headers.get('content-encoding')).toBeNull();
            expect(await range.text()).toBe(source.slice(0, 6));
            // Fetch adds identity to Range requests itself. Use the actual HTTP
            // headers here to exercise a client explicitly forbidding identity.
            const encodedRange = await new Promise<http.IncomingMessage>((resolve, reject) => {
                http.get(`${origin}/assets/entry-hash.js`, {
                    headers: {'Accept-Encoding': 'br, identity;q=0', Range: 'bytes=0-5'},
                }, resolve).once('error', reject);
            });
            const chunks: Buffer[] = [];
            for await (const chunk of encodedRange) chunks.push(Buffer.from(chunk));
            expect(encodedRange.statusCode).toBe(200);
            expect(encodedRange.headers['content-encoding']).toBe('br');
            expect(brotliDecompressSync(Buffer.concat(chunks)).toString()).toBe(source);
            const weighted = await fetch(`${origin}/assets/entry-hash.js`, {
                headers: {'Accept-Encoding': 'br;q=0, gzip;q=0.8, identity;q=0.1'},
            });
            expect(weighted.headers.get('content-encoding')).toBe('gzip');
            expect(await weighted.text()).toBe(source);

            const unlisted = await fetch(`${origin}/assets/unlisted.js`, {headers: {'Accept-Encoding': 'br'}});
            expect(unlisted.headers.get('content-encoding')).toBeNull();
            expect(await unlisted.text()).toBe(source);
            expect((await fetch(`${origin}/assets/missing.js`)).status).toBe(404);
            expect((await fetch(`${origin}/assets/entry-hash.js`, {
                headers: {'Accept-Encoding': 'identity;q=0, br;q=0, gzip;q=0'},
            })).status).toBe(406);
            for (const file of ['../outside.js', 'C:/outside.js']) {
                await fs.writeFile(path.join(directory, '.vite/manifest.json'), JSON.stringify({entry: {file}}));
                expect(() => createFrontendAssets(directory)).toThrow('Invalid frontend asset manifest path');
            }
        } finally {
            // Close the owned listener before removing its named temporary root;
            // a failed assertion must not leave streams referencing that fixture.
            if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
            if (path.dirname(path.resolve(directory)) !== path.resolve(os.tmpdir())
                || !path.basename(directory).startsWith('surveyor-frontend-assets-')) throw new Error('Unexpected asset fixture cleanup path');
            await fs.rm(directory, {recursive: true, force: true});
        }
    });
});

// This fixture integrates actual Express/Vite middleware and shared SSR through
// HTTP. It owns only synthetic bootstrap data and a temporary local listener;
// the database-free Vitest project runs it without an ORM connection or reset.
describe('Express-integrated frontend development', () => {
    it('does not initialize Vite in an installed production release', async () => {
        vi.stubEnv('NODE_ENV', 'production');
        vi.stubEnv('SURVEYOR_FRONTEND_DEV', '1');
        const server = http.createServer();
        await initializeFrontendDevelopment(server);
        expect(frontendDevelopmentServer()).toBeUndefined();
    });

    // This real HTTP case compiles the cold Vite SSR/client graph and Sass.
    // Include cold compilation and owned cleanup in this infrastructure case's
    // budget without widening ordinary test or hook deadlines.
    it('renders source SSR and serves Vue HMR through the existing HTTP origin', async () => {
        vi.stubEnv('NODE_ENV', 'development');
        vi.stubEnv('SURVEYOR_FRONTEND_DEV', '1');
        const app = express();
        app.use(frontendDevelopmentMiddleware);
        const bootstrap: FrontendBootstrap = {session: {kind: 'anonymous', context: 'dev-context',
            csrfToken: 'dev-csrf', locale: 'en', activeProfile: null, profiles: [], loginUrl: '/users/login',
            logoutUrl: null, deployment: {buildId: 'dev-fixture', apiCompatibility},
            shell: {version: 'fixture', imprintUrl: '/imprint', privacyPolicyUrl: '/privacy',
                localLoginEnabled: true, oidcEnabled: false, oidcName: 'Provider'}},
            help: {locale: 'en', title: 'Development guide', content: '<h2 id="task">A synthetic task</h2><img src="/help/assets/diagram.png?locale=en" alt="A task diagram">',
                currentDoc: 'fixture.md', docsList: [], docsGroups: [], toc: [{id: 'task', title: 'A synthetic task', level: 2}]}};
        app.get('/help', (req, res, next) => {
            void renderFrontend(res, req.originalUrl, bootstrap).catch(next);
        });
        app.get('/packing/create', (req, res, next) => {
            const locale = req.query.locale === 'de' ? 'de' : 'en';
            void renderFrontend(res, req.originalUrl, {session: {...bootstrap.session, locale},
                packingCreateContext: {defaults: {public: 0, guest: 0, authenticated: 0, participant: 0}, permissions: [], presets: []},
            }).catch(next);
        });
        app.get('/users/login', (req, res, next) => {
            void renderFrontend(res, req.originalUrl, {session: bootstrap.session}).catch(next);
        });
        app.get('/app/fallthrough-fixture', (req, res) => {
            res.json({url: req.url, originalUrl: req.originalUrl});
        });
        const server = http.createServer(app);
        const projectRoot = process.cwd();
        // Initialization must use the application's maintained config even when its
        // caller launches from elsewhere. Restore the observable process boundary
        // before the HTTP checks; no actual working directory or files are changed.
        const currentDirectory = vi.spyOn(process, 'cwd').mockReturnValue(path.join(os.tmpdir(), 'surveyor-unrelated-launch'));
        try {
            await initializeFrontendDevelopment(server);
        } finally {
            currentDirectory.mockRestore();
        }
        expect(path.resolve(frontendDevelopmentServer()!.config.root)).toBe(projectRoot);
        expect(path.resolve(frontendDevelopmentServer()!.config.configFile!)).toBe(path.join(projectRoot, 'vite.config.mts'));
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('The development listener has no port');
        const origin = `http://127.0.0.1:${address.port}`;
        try {
            const page = await fetch(`${origin}/help`);
            expect(page.status).toBe(200);
            const html = await page.text();
            expect(html).toContain('A synthetic task');
            expect(html).toContain('/app/@vite/client');
            // Fetch what the rendered page actually requests. A hardcoded valid source
            // path would miss duplicated bases in HTML, leaving every visible control inert.
            const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/gu)].map(match => match[1]);
            const entryUrl = scripts.find(source => source.includes('/src/frontend/app/entry-client.ts'));
            expect(entryUrl).toBeDefined();
            const entry = await fetch(new URL(entryUrl!, origin));
            expect(entry.status).toBe(200);
            expect(entry.headers.get('content-type')).toContain('javascript');
            expect(await entry.text()).toContain('createFrontendApp');
            const styles = [...html.matchAll(/<link\b[^>]*\bhref="([^"]+)"/gu)].map(match => match[1]);
            // Fetch the actual composition link through Express/Vite. It styles
            // the SSR document before entry execution; a JS-only style import
            // would leave static Help unstyled and duplicate the cascade policy.
            const sourceStyles = styles.filter(source => source.includes('/src/frontend/styles/'));
            expect(sourceStyles.map(source => new URL(source, origin).pathname)).toEqual([
                '/app/src/frontend/styles/application.sass',
            ]);
            // HTTP readiness must include the linked CSS representation. Vite's
            // JavaScript style wrapper has a different cache key and cannot
            // prevent a cold Sass compilation at the first stylesheet request.
            const directStyle = await frontendDevelopmentServer()!.environments.client.moduleGraph
                .getModuleByUrl('/src/frontend/styles/application.sass?direct');
            expect(directStyle?.transformResult?.code).toContain('.frontend-app');
            const stylesheet = await fetch(new URL(sourceStyles[0]!, origin), {headers: {Accept: 'text/css'}});
            expect(stylesheet.status).toBe(200);
            expect(stylesheet.headers.get('content-type')).toContain('css');
            const compiledStyle = await stylesheet.text();
            expect(compiledStyle).toContain('Bootstrap  v5.3.8');
            expect(compiledStyle).toContain('.accordion-dark');
            expect(compiledStyle).toContain('.tz-picker');
            expect(compiledStyle).toContain('.help-content');
            expect(compiledStyle).toContain('.help-toc');
            expect(compiledStyle).toContain('.frontend-app');
            expect(compiledStyle.indexOf('.accordion-dark')).toBeLessThan(compiledStyle.indexOf('.tz-picker'));
            expect(compiledStyle.indexOf('.tz-picker')).toBeLessThan(compiledStyle.indexOf('.help-content'));
            expect(compiledStyle.indexOf('.help-content')).toBeLessThan(compiledStyle.indexOf('.frontend-app'));
            // Use the font URL the real Sass/Vite response supplies. This catches
            // missing local font publication and incorrect development URL bases,
            // rather than proving an unrelated hardcoded package path is readable.
            const fontReferences = [...compiledStyle.matchAll(/url\(["']?([^\s)"']+\.woff2(?:\?[^\s)"']*)?)["']?\)/gu)]
                .map(match => new URL(match[1]!, stylesheet.url));
            expect(fontReferences).toHaveLength(1);
            const iconUrl = fontReferences[0]!;
            expect(iconUrl.origin).toBe(origin);
            expect(iconUrl.pathname.startsWith('/app/')).toBe(true);
            const iconFont = await fetch(iconUrl);
            expect(iconFont.status).toBe(200);
            expect(iconFont.headers.get('content-type')).toContain('font/woff2');
            expect(Buffer.from(await iconFont.arrayBuffer())).toEqual(await fs.readFile('node_modules/bootstrap-icons/font/fonts/bootstrap-icons.woff2'));
            for (const source of [...styles, ...scripts]) expect(new URL(source, origin).origin).toBe(origin);
            expect(html).not.toContain('href="/style/');
            expect(html).toContain('href="/img/favicon-32x32.png"');
            expect(html).toContain('src="/img/logo.png"');
            expect(html).toContain('src="/help/assets/diagram.png?locale=en"');
            expect(html).toContain('href="/');
            expect(html).not.toContain('/app/app/');
            expect(html).not.toMatch(/(?:src|href)="\/app\/(?:style|img|help|frontend)\//u);
            expect(html).not.toContain('file:///');
            expect(html).toContain('id="surveyor-frontend-javascript-required"');
            expect(html).not.toContain('data-frontend-initial-loading');
            // SSR and hydration share one notice beneath the shell header. The
            // renderer monitor controls visibility without replacing that markup;
            // local Help and the source entry survive Vite's transform unchanged.
            for (const locale of ['en', 'de']) {
                const packing = await fetch(`${origin}/packing/create?locale=${locale}`);
                expect(packing.status).toBe(200);
                const packingHtml = await packing.text();
                expect(packingHtml).toContain(locale === 'de'
                    ? 'Interaktive Funktionen dieser Website benötigen JavaScript.' : 'Interactive features on this site require JavaScript.');
                expect(packingHtml).toContain(`<a class="btn btn-outline-light" href="/help?locale=${locale}">`);
                const rootAt = packingHtml.indexOf('<div id="surveyor-frontend">');
                const headerEndAt = packingHtml.indexOf('</header>', rootAt);
                const noticeAt = packingHtml.indexOf('id="surveyor-frontend-javascript-required"');
                const mainAt = packingHtml.indexOf('<main id="frontend-main"');
                expect(rootAt).toBeGreaterThanOrEqual(0);
                expect(headerEndAt).toBeGreaterThan(rootAt);
                expect(noticeAt).toBeGreaterThan(headerEndAt);
                expect(noticeAt).toBeLessThan(mainAt);
                expect(packingHtml.match(/id="surveyor-frontend-javascript-required"/gu)).toHaveLength(1);
                expect(packingHtml).toContain('data-frontend-initial-loading');
                expect(packingHtml).not.toContain('id="create-title"');
                expect(packingHtml).not.toContain('/app/app/');
                expect(packingHtml).toContain(entryUrl);
            }
            const identityHtml = await (await fetch(`${origin}/users/login`)).text();
            expect(identityHtml).toContain('id="surveyor-frontend-javascript-required"');
            expect(identityHtml).toContain('Interactive features on this site require JavaScript.');
            expect(identityHtml).toContain('data-frontend-initial-loading');
            expect(identityHtml).not.toContain('action="/users/login"');
            expect(identityHtml).not.toContain('id="username"');
            const component = await fetch(`${origin}/app/src/frontend/features/help/HelpPage.vue`);
            expect(component.status).toBe(200);
            const componentSource = await component.text();
            expect(componentSource).toContain('__VUE_HMR_RUNTIME__');
            // A valid entry/component response does not prove that its imports can
            // execute. Follow the compiler-authored virtual helper in the actual
            // transformed SFC, rather than testing an unrelated hardcoded URL.
            const helperImport = componentSource.match(/from\s+["']([^"']*plugin-vue:export-helper)["']/u)?.[1];
            expect(helperImport).toBeDefined();
            const helperUrl = new URL(helperImport!, component.url);
            expect(helperUrl.origin).toBe(origin);
            expect(helperUrl.pathname).toBe('/app/@id/__x00__plugin-vue:export-helper');
            const helper = await fetch(helperUrl);
            expect(helper.status).toBe(200);
            expect(helper.headers.get('content-type')).toContain('javascript');
            expect(await helper.text()).toContain('export default');
            const websocket = frontendDevelopmentServer()?.config.server.ws;
            if (!websocket) throw new Error('Expected the development WebSocket configuration');
            expect(websocket.server).toBe(server);
            const fallthrough = await fetch(`${origin}/app/fallthrough-fixture?locale=en`);
            expect(fallthrough.status).toBe(200);
            expect(await fallthrough.json()).toEqual({url: '/app/fallthrough-fixture?locale=en',
                originalUrl: '/app/fallthrough-fixture?locale=en'});
            // The development file server is confined to its asset namespace and
            // must not capture unrelated application routes or unprefixed source files.
            const unprefixedEntry = await fetch(`${origin}/src/frontend/app/entry-client.ts`);
            expect(unprefixedEntry.status).toBe(404);
            // The asset prefix is not an authorization boundary by itself.
            // Exercise Vite's raw/URL transforms, filesystem/ID aliases, maps,
            // encodings and arbitrary installed packages through actual HTTP.
            const privateFile = path.join(projectRoot, 'src/backend/modules/settings.ts').split(path.sep).join('/');
            for (const target of ['/app/src/backend/modules/settings.ts', '/app/src/backend/modules/settings.ts?raw',
                '/app/src/backend/modules/settings.ts?url', '/app/src/backend/modules/settings.ts.map',
                '/app/src/frontend/app/entry-server.ts', '/app/src/types/FrontendTypes.d.ts?raw',
                '/app/package.json', '/app/.generated/api/v1/server.cjs?raw',
                '/app/node_modules/express/package.json', '/app/node_modules/vite/package.json',
                `/app/@fs/${privateFile}?raw`, '/app/@id/express', '/app/@id/__x00__src/backend/modules/settings.ts',
                '/app/@id/__x00__plugin-vue:export-helper-private', '/app/@id/__x00__plugin-vue:export-helper/secret',
                '/app/src%2fbackend%2fmodules%2fsettings.ts?raw', '/app/src%5cbackend%5cmodules%5csettings.ts?raw',
                '/app/src%252fbackend%252fmodules%252fsettings.ts?raw', '/app/src/frontend/%2e%2e/backend/modules/settings.ts?raw']) {
                const denied = await fetch(origin + target);
                expect(denied.status, target).toBe(404);
                expect(await denied.text(), target).not.toContain('sessionSecret');
            }
        } finally {
            await frontendDevelopmentServer()?.close();
            await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        }
    }, 60_000);
});
