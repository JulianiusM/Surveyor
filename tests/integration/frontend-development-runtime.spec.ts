import {apiCompatibility} from '../../.generated/api/v1/policy.mjs';
import {afterEach, describe, expect, it, vi} from 'vitest';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import {frontendDevelopmentMiddleware, frontendDevelopmentServer, initializeFrontendDevelopment} from '../../src/modules/frontendDevelopment';
import {renderFrontendPilot} from '../../src/modules/frontendPilotRenderer';
import type {FrontendPilotBootstrap} from '../../src/types/FrontendPilotTypes';

afterEach(() => { vi.unstubAllEnvs(); });

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

    it('renders source SSR and serves Vue HMR through the existing HTTP origin', async () => {
        vi.stubEnv('NODE_ENV', 'development');
        vi.stubEnv('SURVEYOR_FRONTEND_DEV', '1');
        const app = express();
        app.use(frontendDevelopmentMiddleware);
        const bootstrap: FrontendPilotBootstrap = {session: {kind: 'anonymous', context: 'dev-context',
            csrfToken: 'dev-csrf', locale: 'en', activeProfile: null, profiles: [], loginUrl: '/users/login',
            logoutUrl: null, deployment: {buildId: 'dev-fixture', apiCompatibility},
            shell: {version: 'fixture', imprintUrl: '/imprint', privacyPolicyUrl: '/privacy',
                localLoginEnabled: true, oidcEnabled: false, oidcName: 'Provider'}},
            help: {locale: 'en', title: 'Development guide', content: '<h2 id="task">A synthetic task</h2><img src="/frontend-pilot/help/assets/diagram.png?locale=en" alt="A task diagram">',
                currentDoc: 'fixture.md', docsList: [], docsGroups: [], toc: [{id: 'task', title: 'A synthetic task', level: 2}]}};
        app.get('/frontend-pilot/help', (req, res, next) => {
            void renderFrontendPilot(res, req.originalUrl, bootstrap).catch(next);
        });
        app.get('/frontend-pilot/packing/create', (req, res, next) => {
            const locale = req.query.locale === 'de' ? 'de' : 'en';
            void renderFrontendPilot(res, req.originalUrl, {session: {...bootstrap.session, locale},
                packingCreateContext: {defaults: {public: 0, guest: 0, authenticated: 0, participant: 0}, permissions: [], presets: []},
            }).catch(next);
        });
        app.get('/frontend-pilot/users/login', (req, res, next) => {
            void renderFrontendPilot(res, req.originalUrl, {session: bootstrap.session}).catch(next);
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
            const page = await fetch(`${origin}/frontend-pilot/help`);
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
            expect(await entry.text()).toContain('createPilotApp');
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
            expect(compiledStyle).toContain('.pilot-app');
            expect(compiledStyle.indexOf('.accordion-dark')).toBeLessThan(compiledStyle.indexOf('.tz-picker'));
            expect(compiledStyle.indexOf('.tz-picker')).toBeLessThan(compiledStyle.indexOf('.help-content'));
            expect(compiledStyle.indexOf('.help-content')).toBeLessThan(compiledStyle.indexOf('.pilot-app'));
            const bootstrapLayer = styles.find(source => source.includes('bootstrap@5.3.3/dist/css/bootstrap.min.css'));
            expect(bootstrapLayer).toBeDefined();
            expect(html.indexOf(bootstrapLayer!)).toBeLessThan(html.indexOf(sourceStyles[0]!));
            expect(html).not.toContain('href="/style/');
            expect(html).toContain('href="/img/favicon-32x32.png"');
            expect(html).toContain('src="/img/logo.png"');
            expect(html).toContain('src="/frontend-pilot/help/assets/diagram.png?locale=en"');
            expect(html).toContain('href="/frontend-pilot');
            expect(html).not.toContain('/app/app/');
            expect(html).not.toMatch(/(?:src|href)="\/app\/(?:style|img|help|frontend-pilot)\//u);
            expect(html).not.toContain('file:///');
            expect(html).toContain('id="surveyor-pilot-javascript-required"');
            expect(html).not.toContain('data-pilot-initial-loading');
            // The independent initialization notice lives outside the hydrated tree.
            // Its local Help URL and source entry survive Vite's transform unchanged.
            for (const locale of ['en', 'de']) {
                const packing = await fetch(`${origin}/frontend-pilot/packing/create?locale=${locale}`);
                expect(packing.status).toBe(200);
                const packingHtml = await packing.text();
                expect(packingHtml).toContain(locale === 'de'
                    ? 'Interaktive Funktionen dieser Website benötigen JavaScript.' : 'Interactive features on this site require JavaScript.');
                expect(packingHtml).toContain(`<a class="btn btn-outline-light" href="/frontend-pilot/help?locale=${locale}">`);
                expect(packingHtml.indexOf('id="surveyor-pilot-javascript-required"')).toBeLessThan(packingHtml.indexOf('<div id="surveyor-pilot">'));
                expect(packingHtml).toContain('data-pilot-initial-loading');
                expect(packingHtml).not.toContain('id="create-title"');
                expect(packingHtml).not.toContain('/app/app/');
                expect(packingHtml).toContain(entryUrl);
            }
            const identityHtml = await (await fetch(`${origin}/frontend-pilot/users/login`)).text();
            expect(identityHtml).toContain('id="surveyor-pilot-javascript-required"');
            expect(identityHtml).toContain('Interactive features on this site require JavaScript.');
            expect(identityHtml).toContain('data-pilot-initial-loading');
            expect(identityHtml).not.toContain('action="/frontend-pilot/users/login"');
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
    }, 30_000);
});
