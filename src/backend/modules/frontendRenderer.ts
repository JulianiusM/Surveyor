import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import type {Response} from 'express';
import type {FrontendBootstrap, FrontendRenderResult, FrontendPreparedDocument} from '../../types/FrontendTypes';
import {createTranslator, localeManifest} from '../../common/localization/translator';
import {frontendDevelopmentServer} from './frontendDevelopment';
import settings from './settings';

interface AssetChunk {file: string; name?: string; isDynamicEntry?: boolean; css?: string[]; imports?: string[]}
interface FrontendRenderer {render(url: string, bootstrap: FrontendBootstrap): Promise<FrontendRenderResult>}

const distribution = fs.existsSync(path.join(__dirname, '../../frontend-server/entry-server.mjs'))
    ? path.resolve(__dirname, '../..') : path.resolve(__dirname, '../../../dist');

/** Load the installed renderer's code through Node's ordinary module cache.
 * Every render still creates its own application and private request state. */
async function loadInstalledFrontendRenderer(): Promise<FrontendRenderer> {
    // Startup and requests share this exact release path, without an additional
    // renderer instance, private cache or synthetic request to warm the module.
    return await import(pathToFileURL(path.join(distribution, 'frontend-server/entry-server.mjs')).href) as FrontendRenderer;
}

/** Move installed renderer import/parse work before HTTP readiness. Source
 * development keeps Vite's own warmup and module invalidation lifecycle. */
export async function initializeFrontendRenderer(): Promise<void> {
    // Import definitions only: no router resolution, session, query or render.
    // A missing/broken release artifact fails the existing startup error path.
    if (!frontendDevelopmentServer()) await loadInstalledFrontendRenderer();
}

/** Escape plain text for HTML; bootstrap JSON has its own script-element serializer. */
function escapeHtml(value: string): string {
    const entities: Record<string, string> = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'};
    return value.replace(/[&<>"']/g, function replaceCharacter(character) {return entities[character]!;});
}

/** Keep startup presentation independent of module/CSS delivery. App.vue owns
 * the same escaped notice markup in SSR and hydration; only root startup markers
 * select visibility, so the monitor never races Vue's attribute reconciliation. */
function javascriptInitializationStyles(): string {
    // The default remains safe without either script. Observed startup may show
    // skeletons while waiting, but definite failure hides dead interactive content.
    // Static Help, GET search and real links retain their existing fallback.
    return `<style>
#surveyor-frontend[data-frontend-hydrated="true"] #surveyor-frontend-javascript-required,
#surveyor-frontend[data-frontend-startup-observed="true"]:not([data-frontend-startup-failed="true"]) #surveyor-frontend-javascript-required,
#surveyor-frontend:not([data-frontend-startup-failed="true"]) [data-frontend-startup-failure],
#surveyor-frontend:not([data-frontend-startup-recovery-ready="true"]) [data-frontend-startup-reload]{display:none}
#surveyor-frontend:not([data-frontend-hydrated="true"]):not([data-frontend-startup-observed="true"]) #frontend-main[data-frontend-interactive] > :not(.frontend-page-notices),
#surveyor-frontend:not([data-frontend-hydrated="true"])[data-frontend-startup-failed="true"] #frontend-main[data-frontend-interactive] > :not(.frontend-page-notices){display:none!important}
</style>`;
}

/** This deliberately independent classic script has no imports, authority, form
 * reads, storage or reload behavior. It observes the entry owner's success/failure
 * marker and bounded module delivery; recovery consent remains with that owner. */
function javascriptInitializationMonitor(): string {
    // Mark the root only after the independent monitor begins observing startup.
    // The shell's same-tree notice remains default-safe without this script.
    return `<script>(function monitorFrontendStartup() {
    var container = document.getElementById('surveyor-frontend');
    if (!container) return;
    var timeout;
    var observer = new MutationObserver(observeInitialization);

    function showInitializationFailure() {
        if (container.getAttribute('data-frontend-hydrated') === 'true') return;
        if (container.getAttribute('data-frontend-startup-failed') !== 'true') {
            container.setAttribute('data-frontend-startup-failed', 'true');
        }
    }

    function observeInitialization() {
        if (container.getAttribute('data-frontend-hydrated') === 'true') {
            clearTimeout(timeout);
            observer.disconnect();
            window.removeEventListener('error', failedEntryModule, true);
        } else if (container.getAttribute('data-frontend-startup-failed') === 'true') {
            clearTimeout(timeout);
        }
    }

    function failedEntryModule(event) {
        if (event.target instanceof HTMLScriptElement && event.target.hasAttribute('data-frontend-entry')) {
            clearTimeout(timeout);
            showInitializationFailure();
        }
    }

    container.setAttribute('data-frontend-startup-observed', 'true');
    observer.observe(container, {attributes: true, attributeFilter: ['data-frontend-hydrated', 'data-frontend-startup-failed']});
    window.addEventListener('error', failedEntryModule, true);
    timeout = window.setTimeout(showInitializationFailure, 15000);
    observeInitialization();
}());</script>`;
}

/** Resolve only build-authored manifest paths, without importing Vite into production startup. */
function clientAssets(routeComponentNames: readonly string[] = []): {script: string; styles: string[]; modules: string[]} {
    const manifest = JSON.parse(fs.readFileSync(path.join(distribution, 'public/app/.vite/manifest.json'), 'utf8')) as Record<string, AssetChunk>;
    const entry = manifest['src/frontend/app/entry-client.ts'];
    if (!entry) throw new Error('Frontend client entry is missing from its build manifest');
    const styles = new Set<string>();
    const modules = new Set<string>();
    const seen = new Set<string>(['src/frontend/app/entry-client.ts']);

    /** Traverse each build-authored dependency once and retain stylesheet order.
     * Shared imports and cycles must neither duplicate links nor recurse forever. */
    function collectAssets(chunk: AssetChunk, includeStyles = true): void {
        // Head preloads let the browser fetch the shared runtime alongside the
        // entry rather than discovering it only after downloading/parsing entry JS.
        modules.add(`/app/${chunk.file}`);
        // Set insertion order preserves the manifest's first encountered styles.
        if (includeStyles) for (const css of chunk.css ?? []) styles.add(`/app/${css}`);

        // Mark dependencies before descending so a shared/cyclic edge is visited
        // once. A missing build-authored chunk remains an ordinary build error.
        for (const imported of chunk.imports ?? []) {
            if (seen.has(imported)) continue;
            seen.add(imported);
            collectAssets(manifest[imported], includeStyles);
        }
    }
    collectAssets(entry);
    // Match only a unique compiler/build name. Missing or ambiguous hints retain
    // ordinary lazy loading; they never select a different route or load siblings.
    // Route CSS keeps Vite's established dynamic-import cascade and load ownership.
    for (const name of routeComponentNames) {
        const matches = Object.values(manifest).filter(chunk => chunk.isDynamicEntry && chunk.name === name);
        if (matches.length === 1) collectAssets(matches[0]!, false);
    }
    return {script: `/app/${entry.file}`, styles: [...styles], modules: [...modules]};
}

/** Only Home owns discovery metadata. Other documents reuse the app's existing
 * locale instance without initializing another complete translation store. */
function landingMetadata(bootstrap: FrontendBootstrap, escapedTitle: string): string {
    if (!bootstrap.landing) return '';
    const messages = createTranslator(bootstrap.session.locale);
    // Attribute values stay escaped independently of the title already prepared
    // for this document's ordinary head. No private profile data enters metadata.
    return `<meta name="description" content="${escapeHtml(messages.t('landing.metaDescription'))}">
<meta name="keywords" content="${escapeHtml(messages.t('landing.metaKeywords'))}"><meta name="author" content="Surveyor">
<meta property="og:title" content="${escapedTitle}"><meta property="og:description" content="${escapeHtml(messages.t('landing.metaSocialDescription'))}">
<meta property="og:image" content="/img/logo.png"><meta property="og:url" content="${escapeHtml(settings.value.rootUrl)}">
<meta name="twitter:card" content="summary_large_image">`;
}

/**
 * Prepare one coherent SSR/static/skeleton document without sending a response.
 * Shared controllers own preceding admission/business operations; this renderer
 * owns asset selection, headers, shell assembly and development transforms.
 */
export async function prepareFrontend(res: Response, url: string, bootstrap: FrontendBootstrap): Promise<FrontendPreparedDocument> {
    const development = frontendDevelopmentServer();
    // Vite's HTML transform applies its configured base to source URLs exactly once.
    // Installed-release manifest paths already include that base and skip the transform.
    // The same composition imported by the client styles readable Help/startup
    // recovery before JavaScript. Ordering belongs to that authored stylesheet;
    // installed releases resolve its emitted CSS through Vite's manifest.
    // Production resolves only the current release. Development uses the same renderer
    // source through Vite so SSR and hydrated components share module invalidation/HMR.
    const renderer = development
        ? await development.ssrLoadModule('/src/frontend/app/entry-server.ts') as FrontendRenderer
        : await loadInstalledFrontendRenderer();
    const rendered = await renderer.render(url, bootstrap);
    const assets = development ? {script: '/src/frontend/app/entry-client.ts',
        styles: ['/src/frontend/styles/application.sass'], modules: []} : clientAssets(rendered.routeComponentNames);
    const locale = bootstrap.session.locale;
    const direction = localeManifest.find(entry => entry.locale === locale)?.direction ?? 'ltr';
    res.set('Cache-Control', 'private, no-store').set('Content-Language', locale);
    const title = escapeHtml(rendered.title);
    // Landing keeps the discovery/social metadata. Other documents retain
    // their existing head, and private profile values never enter these fields.
    const head = `<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>${landingMetadata(bootstrap, title)}<link rel="icon" href="/img/favicon-32x32.png">`;
    // The shell owns notice markup directly beneath its header. Independent
    // fallback styles/monitor observe the outer root without inserting Vue children.
    const body = `${javascriptInitializationStyles()}<div id="surveyor-frontend">${rendered.html}</div>
<script id="surveyor-frontend-state" type="application/json">${rendered.state}</script>${javascriptInitializationMonitor()}`;
    // Express owns static assets, help content, and all rendered navigation. Vite must
    // see only its source assets: transforming the SSR tree would prefix /app onto
    // those independent URLs and make the server DOM disagree with client hydration.
    const headMarker = '<!-- surveyor-document-head -->';
    const bodyMarker = '<!-- surveyor-document-body -->';
    const shell = `<!doctype html>
<html lang="${locale}" dir="${direction}" data-bs-theme="dark">
<head>${headMarker}${assets.styles.map(style => `<link rel="stylesheet" href="${style}">`).join('')}
${assets.modules.map(module => `<link rel="modulepreload" crossorigin href="${module}">`).join('')}
</head><body class="d-flex flex-column min-vh-100 bg-secondary">${bodyMarker}
<script type="module" data-frontend-entry src="${assets.script}"></script></body></html>`;
    const transformed = development ? await development.transformIndexHtml(url, shell) : shell;
    // Replacement callbacks insert strings literally; user content containing $& or
    // other replacement tokens must not be interpreted as String.replace syntax.
    const html = transformed.replace(headMarker, () => head).replace(bodyMarker, () => body);
    return Object.freeze({html});
}

/** Send already prepared HTML; delivery cannot trigger another renderer, bootstrap or token operation. */
export function sendPreparedFrontend(res: Response, prepared: FrontendPreparedDocument): void {
    res.type('html').send(prepared.html);
}

/** Ordinary responses reuse the exact same preparation owner and hydration tree. */
export async function renderFrontend(res: Response, url: string, bootstrap: FrontendBootstrap): Promise<void> {
    const prepared = await prepareFrontend(res, url, bootstrap);
    sendPreparedFrontend(res, prepared);
}
