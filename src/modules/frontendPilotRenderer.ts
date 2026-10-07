import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import type {Response} from 'express';
import type {FrontendPilotBootstrap, FrontendPilotRenderResult} from '../types/FrontendPilotTypes';
import {localeManifest} from './localization/translator';

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
    const assets = clientAssets();
    const serverPath = path.join(distribution, 'frontend-server/entry-server.mjs');
    const serverUrl = pathToFileURL(serverPath);
    // The existing development workflow rebuilds files rather than hosting a second
    // server. Refresh Node's module cache after a watch build; production imports stay stable.
    if (process.env.NODE_ENV !== 'production') serverUrl.searchParams.set('build', String(fs.statSync(serverPath).mtimeMs));
    const renderer = await import(serverUrl.href) as PilotRenderer;
    const rendered = await renderer.render(url, bootstrap);
    const locale = bootstrap.session.locale;
    const direction = localeManifest.find(entry => entry.locale === locale)?.direction ?? 'ltr';
    res.set('Cache-Control', 'private, no-store').set('Content-Language', locale);
    res.type('html').send(`<!doctype html>
<html lang="${locale}" dir="${direction}" data-bs-theme="dark">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Surveyor</title><link rel="icon" href="/img/favicon-32x32.png">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" integrity="sha384-QWTKZyjpPEjISv5WaRU9OFeRpok6YctnYmDr5pNlyT2bRjXh0JMhjY6hW+ALEwIH" crossorigin="anonymous">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.css">
<link rel="stylesheet" href="/style/style.css"><link rel="stylesheet" href="/style/help.css">${assets.styles.map(style => `<link rel="stylesheet" href="${style}">`).join('')}
</head><body class="d-flex flex-column min-vh-100 bg-secondary"><div id="surveyor-pilot">${rendered.html}</div>
<script id="surveyor-pilot-state" type="application/json">${rendered.state}</script>
<script type="module" src="${assets.script}"></script></body></html>`);
}
