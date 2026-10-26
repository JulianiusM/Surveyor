import {apiCompatibility} from '../../.generated/api/v1/policy.mjs';
import {afterEach, describe, expect, it, vi} from 'vitest';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import {brotliCompressSync, brotliDecompressSync, gzipSync} from 'node:zlib';
import {frontendDevelopmentMiddleware, frontendDevelopmentServer, initializeFrontendDevelopment} from '../../src/modules/frontendDevelopment';
import {createFrontendAssets} from '../../src/modules/frontendAssets';
import {renderFrontend} from '../../src/modules/frontendRenderer';
import type {FrontendBootstrap} from '../../src/types/FrontendTypes';

afterEach(() => { vi.unstubAllEnvs(); });

describe('frontend public asset delivery', () => {
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
            expect(await component.text()).toContain('__VUE_HMR_RUNTIME__');
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
        } finally {
            await frontendDevelopmentServer()?.close();
            await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        }
    }, 60_000);
});
