import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import type {Response} from 'express';
import type {FrontendPilotBootstrap, FrontendPilotRenderResult, FrontendPreparedDocument} from '../types/FrontendPilotTypes';
import {createTranslator, localeManifest} from './localization/translator';
import {frontendDevelopmentServer} from './frontendDevelopment';
import settings from './settings';

interface AssetChunk {file: string; css?: string[]; imports?: string[]}
interface PilotRenderer {render(url: string, bootstrap: FrontendPilotBootstrap): Promise<FrontendPilotRenderResult>}

const distribution = fs.existsSync(path.join(__dirname, '../frontend-server/entry-server.mjs'))
    ? path.resolve(__dirname, '..') : path.resolve(__dirname, '../../dist');

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
#surveyor-pilot[data-pilot-hydrated="true"] #surveyor-pilot-javascript-required,
#surveyor-pilot[data-pilot-startup-observed="true"]:not([data-pilot-startup-failed="true"]) #surveyor-pilot-javascript-required,
#surveyor-pilot:not([data-pilot-startup-failed="true"]) [data-pilot-startup-failure],
#surveyor-pilot:not([data-pilot-startup-recovery-ready="true"]) [data-pilot-startup-reload]{display:none}
#surveyor-pilot:not([data-pilot-hydrated="true"]):not([data-pilot-startup-observed="true"]) #pilot-main[data-pilot-interactive] > :not(.pilot-page-notices),
#surveyor-pilot:not([data-pilot-hydrated="true"])[data-pilot-startup-failed="true"] #pilot-main[data-pilot-interactive] > :not(.pilot-page-notices){display:none!important}
</style>`;
}

/** This deliberately independent classic script has no imports, authority, form
 * reads, storage or reload behavior. It observes the entry owner's success/failure
 * marker and bounded module delivery; recovery consent remains with that owner. */
function javascriptInitializationMonitor(): string {
    // Mark the root only after the independent monitor begins observing startup.
    // The shell's same-tree notice remains default-safe without this script.
    return `<script>(function monitorPilotStartup() {
    var container = document.getElementById('surveyor-pilot');
    if (!container) return;
    var timeout;
    var observer = new MutationObserver(observeInitialization);

    function showInitializationFailure() {
        if (container.getAttribute('data-pilot-hydrated') === 'true') return;
        if (container.getAttribute('data-pilot-startup-failed') !== 'true') {
            container.setAttribute('data-pilot-startup-failed', 'true');
        }
    }

    function observeInitialization() {
        if (container.getAttribute('data-pilot-hydrated') === 'true') {
            clearTimeout(timeout);
            observer.disconnect();
            window.removeEventListener('error', failedEntryModule, true);
        } else if (container.getAttribute('data-pilot-startup-failed') === 'true') {
            clearTimeout(timeout);
        }
    }

    function failedEntryModule(event) {
        if (event.target instanceof HTMLScriptElement && event.target.hasAttribute('data-pilot-entry')) {
            clearTimeout(timeout);
            showInitializationFailure();
        }
    }

    container.setAttribute('data-pilot-startup-observed', 'true');
    observer.observe(container, {attributes: true, attributeFilter: ['data-pilot-hydrated', 'data-pilot-startup-failed']});
    window.addEventListener('error', failedEntryModule, true);
    timeout = window.setTimeout(showInitializationFailure, 15000);
    observeInitialization();
}());</script>`;
}

/** Resolve only build-authored manifest paths, without importing Vite into production startup. */
function clientAssets(): {script: string; styles: string[]} {
    const manifest = JSON.parse(fs.readFileSync(path.join(distribution, 'public/app/.vite/manifest.json'), 'utf8')) as Record<string, AssetChunk>;
    const entry = manifest['src/frontend/app/entry-client.ts'];
    if (!entry) throw new Error('Frontend pilot client entry is missing from its build manifest');
    const styles = new Set<string>();
    const seen = new Set<string>();

    /** Traverse each build-authored dependency once and retain stylesheet order.
     * Shared imports and cycles must neither duplicate links nor recurse forever. */
    function collectStyles(chunk: AssetChunk): void {
        // Set insertion order preserves the manifest's first encountered styles.
        for (const css of chunk.css ?? []) styles.add(`/app/${css}`);

        // Mark dependencies before descending so a shared/cyclic edge is visited
        // once. A missing build-authored chunk remains an ordinary build error.
        for (const imported of chunk.imports ?? []) {
            if (seen.has(imported)) continue;
            seen.add(imported);
            collectStyles(manifest[imported]);
        }
    }
    collectStyles(entry);
    return {script: `/app/${entry.file}`, styles: [...styles]};
}

/**
 * Prepare one coherent SSR/static/skeleton document without sending a response.
 * Shared controllers own preceding admission/business operations; this renderer
 * owns asset selection, headers, shell assembly and development transforms.
 */
export async function prepareFrontendPilot(res: Response, url: string, bootstrap: FrontendPilotBootstrap): Promise<FrontendPreparedDocument> {
    const development = frontendDevelopmentServer();
    // Vite's HTML transform applies its configured base to source URLs exactly once.
    // Installed-release manifest paths already include that base and skip the transform.
    // The same composition imported by the client styles readable Help/startup
    // recovery before JavaScript. Ordering belongs to that authored stylesheet;
    // installed releases resolve its emitted CSS through Vite's manifest.
    const assets = development ? {script: '/src/frontend/app/entry-client.ts',
        styles: ['/src/frontend/styles/application.sass']} : clientAssets();
    // Production resolves only the current release. Development uses the same renderer
    // source through Vite so SSR and hydrated components share module invalidation/HMR.
    const renderer = development
        ? await development.ssrLoadModule('/src/frontend/app/entry-server.ts') as PilotRenderer
        : await import(pathToFileURL(path.join(distribution, 'frontend-server/entry-server.mjs')).href) as PilotRenderer;
    const rendered = await renderer.render(url, bootstrap);
    const locale = bootstrap.session.locale;
    const direction = localeManifest.find(entry => entry.locale === locale)?.direction ?? 'ltr';
    res.set('Cache-Control', 'private, no-store').set('Content-Language', locale);
    const title = escapeHtml(rendered.title);
    // Landing keeps the native discovery/social metadata. Other documents retain
    // their existing head, and private profile values never enter these fields.
    const messages = createTranslator(locale);
    const landingMetadata = bootstrap.landing ? `<meta name="description" content="${escapeHtml(messages.t('landing.metaDescription'))}">
<meta name="keywords" content="${escapeHtml(messages.t('landing.metaKeywords'))}"><meta name="author" content="Surveyor">
<meta property="og:title" content="${title}"><meta property="og:description" content="${escapeHtml(messages.t('landing.metaSocialDescription'))}">
<meta property="og:image" content="/img/logo.png"><meta property="og:url" content="${escapeHtml(settings.value.rootUrl)}">
<meta name="twitter:card" content="summary_large_image">` : '';
    const head = `<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>${landingMetadata}<link rel="icon" href="/img/favicon-32x32.png">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" integrity="sha384-QWTKZyjpPEjISv5WaRU9OFeRpok6YctnYmDr5pNlyT2bRjXh0JMhjY6hW+ALEwIH" crossorigin="anonymous">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.css">`;
    // The shell owns notice markup directly beneath its header. Independent
    // fallback styles/monitor observe the outer root without inserting Vue children.
    const body = `${javascriptInitializationStyles()}<div id="surveyor-pilot">${rendered.html}</div>
<script id="surveyor-pilot-state" type="application/json">${rendered.state}</script>${javascriptInitializationMonitor()}`;
    // Express owns static assets, help content, and all rendered navigation. Vite must
    // see only its source assets: transforming the SSR tree would prefix /app onto
    // those independent URLs and make the native DOM disagree with client hydration.
    const headMarker = '<!-- surveyor-native-head -->';
    const bodyMarker = '<!-- surveyor-native-body -->';
    const shell = `<!doctype html>
<html lang="${locale}" dir="${direction}" data-bs-theme="dark">
<head>${headMarker}${assets.styles.map(style => `<link rel="stylesheet" href="${style}">`).join('')}
</head><body class="d-flex flex-column min-vh-100 bg-secondary">${bodyMarker}
<script type="module" data-pilot-entry src="${assets.script}"></script></body></html>`;
    const transformed = development ? await development.transformIndexHtml(url, shell) : shell;
    // Replacement callbacks insert strings literally; user content containing $& or
    // other replacement tokens must not be interpreted as String.replace syntax.
    const html = transformed.replace(headMarker, () => head).replace(bodyMarker, () => body);
    return Object.freeze({html});
}

/** Send already prepared HTML; delivery cannot trigger another renderer, bootstrap or token operation. */
export function sendPreparedFrontendPilot(res: Response, prepared: FrontendPreparedDocument): void {
    res.type('html').send(prepared.html);
}

/** Ordinary responses reuse the exact same preparation owner and hydration tree. */
export async function renderFrontendPilot(res: Response, url: string, bootstrap: FrontendPilotBootstrap): Promise<void> {
    const prepared = await prepareFrontendPilot(res, url, bootstrap);
    sendPreparedFrontendPilot(res, prepared);
}
