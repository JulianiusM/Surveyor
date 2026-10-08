/*
 * Copyright 2026 Julian Malovanij
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

/** Optional focused visual evidence against a caller-verified, already running isolated runtime.
 * Usage: node scripts/capture-frontend-rectification-readonly.cjs <env-file> <packing-id> <http-port> <disposable-schema> [full|corrections]
 * This never initializes fixtures, resets a schema or controls the server. One native login of an
 * existing fictional account establishes the review session; credentials/cookies remain memory-only.
 * Every browser mutation is blocked before dispatch. Recovery pictures therefore show a simulated
 * transport failure followed by real, unchanged read authority, not evidence of a backend write.
 */
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');
const {chromium, expect} = require('@playwright/test');

const [envPath, fixtureId, rawPort, expectedSchema, scope = 'full'] = process.argv.slice(2);
const port = Number(rawPort);
const baseURL = `http://127.0.0.1:${port}`;
const evidence = {baseURL, fixtureId, scope, status: 'incomplete', captures: [], errors: [], assetFailures: [],
    failedRequests: [], blockedMutations: [], hydrationChecks: [], recoveryChecks: [],
    limitation: 'Existing fictional account login is the sole session-establishment exception. All browser writes are aborted before dispatch. Recovery response loss is simulated against real read-only authority. No fixture creation, schema reset or server lifecycle changes.'};

/** Prove the selected credentials are restricted to the explicitly named disposable target.
 * The runtime owner must separately verify that the existing HTTP process uses this same target. */
async function verifyTarget(configuration) {
    if (!['full', 'corrections'].includes(scope)) throw new Error('Capture scope must be full or corrections.');
    if (!Number.isSafeInteger(port) || port < 1024 || port > 65535
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(fixtureId ?? '')
        || !expectedSchema || configuration.E2E_DB_NAME !== expectedSchema || !/e2e/i.test(expectedSchema)
        || !['127.0.0.1', 'localhost', '::1'].includes(configuration.E2E_DB_HOST)) {
        throw new Error('Explicit isolated HTTP port, existing packing UUID and matching local disposable schema are required.');
    }
    const connection = await mysql.createConnection({host: configuration.E2E_DB_HOST,
        port: Number(configuration.E2E_DB_PORT), database: expectedSchema,
        user: configuration.E2E_DB_USER, password: configuration.E2E_DB_PASSWORD, connectTimeout: 5000});
    try {
        const [rows] = await connection.query('SHOW GRANTS');
        const exactSchema = expectedSchema.replace(/[\\_%]/g, character => '\\' + character);
        for (const row of rows) {
            const grantScope = String(Object.values(row)[0]).split(' TO ')[0];
            if (grantScope === 'GRANT USAGE ON *.*') continue;
            const match = grantScope.match(/ ON `([^`]+)`\.\*$/);
            if (!match || match[1] !== exactSchema) throw new Error('Review credentials must have grants only on the exact selected schema.');
        }
        const [[target]] = await connection.query('SELECT DATABASE() AS name');
        if (target.name !== expectedSchema) throw new Error('Selected database target changed.');
    } finally {
        await connection.end();
    }
}

/** Native icons add decorative glyphs to names; match the complete visible label on both sides. */
function label(value) {
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^[\\s\\p{Co}]*${escaped}[\\s\\p{Co}]*$`, 'u');
}

/** This interception is installed before any page opens and applies to all browser pages. */
async function blockMutations(route) {
    const request = route.request();
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method())) return route.continue();
    evidence.blockedMutations.push({method: request.method(), path: new URL(request.url()).pathname});
    await route.abort('connectionfailed');
}

/** Report hydration/render failures independently from intended HTTP admission/error pages. */
function observe(page, scene) {
    page.on('pageerror', error => evidence.errors.push({scene, message: error.message}));
    page.on('console', message => {
        if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) {
            evidence.errors.push({scene, message: message.text()});
        }
    });
    page.on('response', response => {
        if (new URL(response.url()).pathname.startsWith('/app/') && response.status() >= 400) {
            evidence.assetFailures.push({scene, path: new URL(response.url()).pathname, status: response.status()});
        }
    });
    page.on('requestfailed', request => evidence.failedRequests.push({scene,
        host: new URL(request.url()).host, path: new URL(request.url()).pathname, failure: request.failure()?.errorText}));
}

/** Keep renderer/asset stalls bounded and identifiable without accepting a partially loaded picture. */
async function bounded(operation, phase) {
    let rejectTimeout;
    const timeout = new Promise((_resolve, reject) => { rejectTimeout = reject; });
    function expire() { rejectTimeout(new Error('Capture wait exceeded 15 seconds: ' + phase)); }
    const timer = setTimeout(expire, 15_000);
    try {
        return await Promise.race([operation, timeout]);
    } finally {
        clearTimeout(timer);
    }
}

/** Generate progress checkpoints too, so a failed optional collection retains honest partial evidence. */
function recordPhase(output, name, phase) {
    evidence.currentScene = name;
    evidence.currentPhase = phase;
    fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify({scene: name, phase}));
}

/** Generate originals and scalar observations only; no cookies, request bodies or actor secrets. */
async function capture(page, output, name, response, viewportOnly = false) {
    recordPhase(output, name, 'fonts');
    await bounded(page.evaluate(async () => { await document.fonts.ready; }), name + ': fonts');
    recordPhase(output, name, 'transitions');
    await bounded(page.waitForFunction(transitionsComplete), name + ': finite transitions');
    const filename = name + '.png';
    // Match the established baseline: fixed dialogs use the real viewport, not a taller stitched page.
    recordPhase(output, name, 'screenshot');
    await bounded(page.screenshot({path: path.join(output, filename), fullPage: !viewportOnly, animations: 'disabled'}), name + ': screenshot');
    const presentation = await bounded(page.evaluate(readPresentation), name + ': scalar presentation');
    evidence.captures.push({name, filename, captureMode: viewportOnly ? 'viewport' : 'full-page',
        status: response?.status(), path: new URL(page.url()).pathname, ...presentation});
    recordPhase(output, name, 'captured');
}

/** Finite native collapse/modal transitions settle before measurement; spinners never block a picture. */
function transitionsComplete() {
    if (document.querySelector('.collapsing')) return false;
    for (const animation of document.getAnimations()) {
        if (animation.playState === 'running' && animation.effect?.getTiming().iterations !== Infinity) return false;
    }
    return true;
}

/** Playwright serializes this named operation into the document; it uses no outer/module state. */
function readPresentation() {
    const headings = [];
    const alerts = [];
    const helpImages = [];
    for (const node of document.querySelectorAll('h1')) headings.push(node.textContent.trim());
    for (const node of document.querySelectorAll('[role="alert"]')) alerts.push(node.textContent.trim());
    for (const node of document.querySelectorAll('main img')) {
        helpImages.push({src: node.getAttribute('src'), complete: node.complete, naturalWidth: node.naturalWidth});
    }
    return {headings, alerts, helpImages, viewport: innerWidth,
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth};
}

/** Read a complete native/pilot/fallback document and retain its actual response status. */
async function visit(context, viewport, output, name, destination, verifyHydration = false) {
    const page = await context.newPage();
    await page.setViewportSize(viewport);
    page.setDefaultTimeout(15_000);
    observe(page, name);
    // External assets can delay full-load/networkidle. DOM readiness precedes explicit
    // font/transition readiness below; a timeout still fails instead of approving partial SSR.
    recordPhase(output, name, 'navigation');
    const response = await bounded(page.goto(destination, {waitUntil: 'domcontentloaded'}), name + ': DOM navigation');
    if (verifyHydration) await checkPackingHydration(page, output, name);
    await capture(page, output, name, response);
    await page.close();
}

/** A real read-only Refresh interaction proves live Vue handling rather than a readable SSR shell. */
async function checkPackingHydration(page, output, name) {
    recordPhase(output, name, 'hydrated-refresh');
    const refresh = page.getByRole('button', {name: 'Refresh', exact: true});
    await expect(refresh).toBeEnabled();
    const read = page.waitForResponse(isPackingRead);
    await refresh.click();
    const response = await bounded(read, name + ': hydrated packing read');
    if (![200, 304].includes(response.status())) throw new Error('Hydrated packing Refresh did not return successful authority.');
    await expect(refresh).toBeEnabled();
    evidence.hydrationChecks.push({scene: name, method: 'GET', status: response.status()});
}

function isPackingRead(response) {
    return response.request().method() === 'GET'
        && new URL(response.url()).pathname === '/api/v1/packing-lists/' + fixtureId;
}

/** Metadata recovery reads current authority; neither Refresh nor Review may replay the lost PATCH. */
function isMetadataRead(response) {
    return response.request().method() === 'GET'
        && new URL(response.url()).pathname === '/api/v1/packing-lists/' + fixtureId + '/metadata';
}

function scrollModalBodyToTop(body) {
    body.scrollTop = 0;
}

/** Check the scrollable body too: the fixed footer must not cover the Review control. */
function reviewFitsVisibleBody(button) {
    const body = button.closest('.modal-body');
    if (!body) return false;
    const buttonBounds = button.getBoundingClientRect();
    const bodyBounds = body.getBoundingClientRect();
    return buttonBounds.top >= bodyBounds.top && buttonBounds.bottom <= bodyBounds.bottom;
}

/** Capture the reachable acknowledgement and prove that it releases uncertainty without writing.
 * The retained dirty draft can be saved deliberately afterward, but this helper never submits it again. */
async function acknowledgeRecovery(page, dialog, output, name, retainedTitle, mutationsBefore, readStatus) {
    const review = dialog.getByRole('button', {name: 'Review changes', exact: true});
    await review.scrollIntoViewIfNeeded();
    await expect(review).toBeInViewport({ratio: 1});
    if (!await review.evaluate(reviewFitsVisibleBody)) throw new Error('Review is obscured by the fixed dialog boundary.');
    await capture(page, output, name + '-reachable-review-control', undefined, true);

    await review.click();
    await expect(review).toHaveCount(0);
    await expect(dialog.getByRole('button', {name: 'Refresh', exact: true})).toHaveCount(0);
    await expect(dialog.locator('[name="title"]')).toHaveValue(retainedTitle);
    await expect(dialog.getByRole('button', {name: 'Save properties', exact: true})).toBeEnabled();
    await dialog.locator('.modal-body').evaluate(scrollModalBodyToTop);
    await capture(page, output, name + '-reviewed-retained-draft', undefined, true);

    const blockedCount = evidence.blockedMutations.length - mutationsBefore;
    if (blockedCount !== 1) throw new Error('Recovery replayed a mutation after the original intercepted PATCH.');
    evidence.recoveryChecks.push({scene: name, method: 'GET', status: readStatus,
        blockedMutations: blockedCount, reviewed: true, retainedDraft: true, saveEnabled: true, noReplay: true});
}

/** Opening settings reads existing authority. The local draft's PATCH is intercepted, never sent. */
async function settings(context, viewport, output, name, pilot, recovery) {
    const page = await context.newPage();
    await page.setViewportSize(viewport);
    page.setDefaultTimeout(15_000);
    observe(page, name);
    recordPhase(output, name, 'navigation');
    await bounded(page.goto((pilot ? '/frontend-pilot' : '') + '/packing/' + fixtureId + '?locale=en',
        {waitUntil: 'domcontentloaded'}), name + ': settings DOM navigation');
    await page.getByRole('button', {name: label('Entity settings')}).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('[name="title"]')).toBeVisible();
    if (scope === 'full') await capture(page, output, name, undefined, true);
    if (recovery) {
        const retainedTitle = 'Unsent local title for recovery review';
        const mutationsBefore = evidence.blockedMutations.length;
        await dialog.locator('[name="title"]').fill(retainedTitle);
        await dialog.locator('#packing-metadata-form').evaluate(form => form.requestSubmit());
        await expect(dialog.getByText('The result is uncertain.', {exact: false})).toBeVisible();
        await expect(dialog.getByRole('button', {name: 'Refresh', exact: true})).toBeEnabled();
        await capture(page, output, name + '-simulated-unknown', undefined, true);
        const authorityRead = page.waitForResponse(isMetadataRead);
        await dialog.getByRole('button', {name: 'Refresh', exact: true}).click();
        const response = await bounded(authorityRead, name + ': unchanged metadata authority');
        if (![200, 304].includes(response.status())) throw new Error('Recovery did not read successful metadata authority.');
        await expect(dialog.getByRole('button', {name: 'Review changes', exact: true})).toBeEnabled();
        if (scope === 'corrections') await dialog.locator('.modal-body').evaluate(scrollModalBodyToTop);
        await capture(page, output, name + '-unchanged-authority-review', undefined, true);
        if (scope === 'corrections') {
            await acknowledgeRecovery(page, dialog, output, name, retainedTitle, mutationsBefore, response.status());
        }
    }
    await page.close();
}

/** Reuse the runtime owner's existing fixture; generate a separate bounded evidence collection. */
async function run() {
    if (!envPath) throw new Error('Pass the isolated runtime environment file explicitly.');
    const configuration = dotenv.parse(fs.readFileSync(envPath));
    await verifyTarget(configuration);
    const output = path.resolve('test-results/frontend-rectification-readonly', new Date().toISOString().replace(/[:.]/g, '-'));
    fs.mkdirSync(output, {recursive: true});
    const browser = await chromium.launch({headless: true});
    try {
        const account = await browser.newContext({baseURL, locale: 'en-GB', timezoneId: 'UTC', serviceWorkers: 'block'});
        const health = await account.request.get('/healthz');
        if (!health.ok()) throw new Error('Caller-selected existing runtime is not healthy.');
        const login = await account.request.post('/users/login', {form: {
            username: configuration.E2E_ADMIN_USERNAME, password: configuration.E2E_ADMIN_PASSWORD,
        }, maxRedirects: 0});
        if (login.status() !== 302 || !login.headers().location?.includes('/users/dashboard')) {
            throw new Error('Existing fixture account login did not reach its native dashboard.');
        }
        await account.request.get('/users/dashboard');
        await account.route('**/*', blockMutations);
        // The narrow correction run needs no fallback context. Full-scope storage state is
        // copied directly in memory, never written as a reusable login artifact.
        let noScript;
        if (scope === 'full') {
            noScript = await browser.newContext({baseURL, locale: 'en-GB', timezoneId: 'UTC',
                javaScriptEnabled: false, serviceWorkers: 'block', storageState: await account.storageState()});
            await noScript.route('**/*', blockMutations);
        }
        const viewports = [{name: 'desktop', width: 1440, height: 1000}, {name: 'mobile', width: 390, height: 844}];
        for (const viewport of viewports) {
            // Recheck only the observed corrections against the rebuilt frozen runtime. The
            // earlier complete collection remains history; untouched scenes need no recapture.
            if (scope === 'corrections') {
                await visit(account, viewport, output, `${viewport.name}-missing-native`, '/packing/not-a-uuid?locale=en');
                await visit(account, viewport, output, `${viewport.name}-missing-pilot`, '/frontend-pilot/packing/not-a-uuid?locale=en');
                await settings(account, viewport, output, `${viewport.name}-settings-pilot`, true, true);
                continue;
            }
            for (const locale of ['en', 'de']) {
                await visit(account, viewport, output, `${viewport.name}-help-${locale}-native`, '/help?locale=' + locale);
                await visit(account, viewport, output, `${viewport.name}-help-${locale}-pilot`, '/frontend-pilot/help?locale=' + locale);
            }
            await visit(account, viewport, output, `${viewport.name}-packing-native`, '/packing/' + fixtureId + '?locale=en');
            await visit(account, viewport, output, `${viewport.name}-packing-pilot`, '/frontend-pilot/packing/' + fixtureId + '?locale=en', true);
            await settings(account, viewport, output, `${viewport.name}-settings-native`, false, false);
            await settings(account, viewport, output, `${viewport.name}-settings-pilot`, true, true);
            await visit(noScript, viewport, output, `${viewport.name}-packing-noscript`, '/frontend-pilot/packing/' + fixtureId + '?locale=en');
            await visit(noScript, viewport, output, `${viewport.name}-create-noscript`, '/frontend-pilot/packing/create?locale=en');
            await visit(noScript, viewport, output, `${viewport.name}-duplicate-noscript`, '/frontend-pilot/packing/' + fixtureId + '/duplicate?locale=en');
            await visit(noScript, viewport, output, `${viewport.name}-help-noscript`, '/frontend-pilot/help?locale=en');
            await visit(account, viewport, output, `${viewport.name}-missing-native`, '/packing/not-a-uuid?locale=en');
            await visit(account, viewport, output, `${viewport.name}-missing-pilot`, '/frontend-pilot/packing/not-a-uuid?locale=en');
        }
        await noScript?.close();
        await account.close();
        evidence.status = 'complete';
    } finally {
        fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(evidence, null, 2));
        await bounded(browser.close(), 'browser cleanup');
        console.log(JSON.stringify({output, captures: evidence.captures.length,
            browserErrors: evidence.errors.length, assetFailures: evidence.assetFailures.length,
            blockedMutations: evidence.blockedMutations.length}));
    }
}

run().catch(error => { console.error(error.message); process.exitCode = 1; });
