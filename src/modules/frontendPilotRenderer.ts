import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import type {Response} from 'express';
import type {FrontendPilotBootstrap, FrontendPilotRenderResult} from '../types/FrontendPilotTypes';
import {localeManifest} from './localization/translator';
import {frontendDevelopmentServer} from './frontendDevelopment';

interface AssetChunk {file: string; css?: string[]; imports?: string[]}
interface PilotRenderer {render(url: string, bootstrap: FrontendPilotBootstrap): Promise<FrontendPilotRenderResult>}

const distribution = fs.existsSync(path.join(__dirname, '../frontend-server/entry-server.mjs'))
    ? path.resolve(__dirname, '..') : path.resolve(__dirname, '../../dist');

/** Resolve only build-authored manifest paths, without importing Vite into production startup. */
function clientAssets(): {script: string; styles: string[]} {
    const manifest = JSON.parse(fs.readFileSync(path.join(distribution, 'public/app/.vite/manifest.json'), 'utf8')) as Record<string, AssetChunk>;
    const entry = manifest['src/frontend/app/entry-client.ts'];
    if (!entry) throw new Error('Frontend pilot client entry is missing from its build manifest');
    const styles = new Set<string>();
    const seen = new Set<string>();
    function collectStyles(chunk: AssetChunk): void {
        for (const css of chunk.css ?? []) styles.add(`/app/${css}`);
        for (const imported of chunk.imports ?? []) {
            if (seen.has(imported)) continue;
            seen.add(imported);
            collectStyles(manifest[imported]);
        }
    }
    collectStyles(entry);
    return {script: `/app/${entry.file}`, styles: [...styles]};
}

/** Same Vue component tree for native responses and hydration; each renderer invocation owns its request state. */
export async function renderFrontendPilot(res: Response, url: string, bootstrap: FrontendPilotBootstrap): Promise<void> {
    const development = frontendDevelopmentServer();
    // Vite's HTML transform applies its configured base to source URLs exactly once.
    // Installed-release manifest paths already include that base and skip the transform.
    const assets = development ? {script: '/src/frontend/app/entry-client.ts',
        styles: ['/src/frontend/styles/pilot.css']} : clientAssets();
    // Production resolves only the current release. Development uses the same renderer
    // source through Vite so SSR and hydrated components share module invalidation/HMR.
    const renderer = development
        ? await development.ssrLoadModule('/src/frontend/app/entry-server.ts') as PilotRenderer
        : await import(pathToFileURL(path.join(distribution, 'frontend-server/entry-server.mjs')).href) as PilotRenderer;
    const rendered = await renderer.render(url, bootstrap);
    const locale = bootstrap.session.locale;
    const direction = localeManifest.find(entry => entry.locale === locale)?.direction ?? 'ltr';
    res.set('Cache-Control', 'private, no-store').set('Content-Language', locale);
    const title = rendered.title.replace(/[&<>"']/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;',
        '"': '&quot;', "'": '&#39;'}[character]!));
    const head = `<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title><link rel="icon" href="/img/favicon-32x32.png">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" integrity="sha384-QWTKZyjpPEjISv5WaRU9OFeRpok6YctnYmDr5pNlyT2bRjXh0JMhjY6hW+ALEwIH" crossorigin="anonymous">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.css">
<link rel="stylesheet" href="/style/style.css"><link rel="stylesheet" href="/style/help.css">`;
    const body = `<div id="surveyor-pilot">${rendered.html}</div>
<script id="surveyor-pilot-state" type="application/json">${rendered.state}</script>`;
    // Express owns static assets, help content, and all rendered navigation. Vite must
    // see only its source assets: transforming the SSR tree would prefix /app onto
    // those independent URLs and make the native DOM disagree with client hydration.
    const headMarker = '<!-- surveyor-native-head -->';
    const bodyMarker = '<!-- surveyor-native-body -->';
    const shell = `<!doctype html>
<html lang="${locale}" dir="${direction}" data-bs-theme="dark">
<head>${headMarker}${assets.styles.map(style => `<link rel="stylesheet" href="${style}">`).join('')}
</head><body class="d-flex flex-column min-vh-100 bg-secondary">${bodyMarker}
<script type="module" src="${assets.script}"></script></body></html>`;
    const transformed = development ? await development.transformIndexHtml(url, shell) : shell;
    // Replacement callbacks insert strings literally; user content containing $& or
    // other replacement tokens must not be interpreted as String.replace syntax.
    const html = transformed.replace(headMarker, () => head).replace(bodyMarker, () => body);
    res.type('html').send(html);
}
