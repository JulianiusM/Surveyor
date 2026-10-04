/*
 * Copyright 2026 Julian Malovanij
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

/**
 * Optional migration evidence capture against the built application and an existing disposable E2E schema.
 * This does not run the schema initializer, reset data, send mail, or install a CI prerequisite.
 * Each run adds synthetic fixtures through production HTTP routes and retains them for manual inspection.
 * Screenshots and the manifest stay under ignored test-results; no credentials or session state are written.
 */
const fs = require('node:fs');
const path = require('node:path');
const {spawn, execFileSync} = require('node:child_process');
const {randomUUID} = require('node:crypto');
const {setTimeout: delay} = require('node:timers/promises');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');
const {chromium, expect} = require('@playwright/test');

require('ts-node').register({project: 'tsconfig.test.json', transpileOnly: true});
const factories = require('../tests/factories/e2eCoreFactory');
const {createResourceViaForm, loginForE2E} = require('../tests/keywords/e2eCoreKeywords');

const workspace = path.resolve(__dirname, '..');
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const output = path.join(workspace, 'test-results', 'frontend-baseline', runId);
const envFile = path.resolve(workspace, process.env.E2E_DOTENV_FILE || '.env.e2e');
const captureEnv = {...dotenv.parse(fs.readFileSync(envFile)), ...process.env};
// Freeze the same complete target for both preflight and the child's settings loader.
captureEnv.E2E_DB_PORT = captureEnv.E2E_DB_PORT || '3306';
const port = Number(process.env.FRONTEND_BASELINE_PORT || 3104);
const baseURL = `http://127.0.0.1:${port}`;
const viewports = [{name: 'desktop', width: 1440, height: 1000}, {name: 'mobile', width: 390, height: 844}];
const manifest = {runId, sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: workspace, encoding: 'utf8'}).trim(),
    node: process.version, playwright: require('@playwright/test/package.json').version,
    baseURL, viewports, fixtures: {}, captures: [], checks: [], browserErrors: [], failedRequests: [], status: 'incomplete'};

/** Verify the effective local target and grants before starting an application capable of writing sessions/fixtures. */
async function verifyTarget() {
    if (!['127.0.0.1', 'localhost', '::1'].includes(captureEnv.E2E_DB_HOST)
        || !/e2e/i.test(captureEnv.E2E_DB_NAME || '')) {
        throw new Error('Capture requires an explicitly configured local disposable E2E database.');
    }
    if (!captureEnv.E2E_ADMIN_USERNAME || !captureEnv.E2E_ADMIN_PASSWORD) throw new Error('E2E login credentials are required.');
    if (!captureEnv.E2E_DB_USER || !captureEnv.E2E_DB_PASSWORD) throw new Error('Explicit E2E database credentials are required.');
    if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid capture port.');
    if (!fs.existsSync(path.join(workspace, 'dist', 'app.js'))) throw new Error('Run npm run build before capture.');
    const connection = await mysql.createConnection({host: captureEnv.E2E_DB_HOST,
        port: Number(captureEnv.E2E_DB_PORT || 3306), database: captureEnv.E2E_DB_NAME,
        user: captureEnv.E2E_DB_USER, password: captureEnv.E2E_DB_PASSWORD, connectTimeout: 5000});
    try {
        // These checks reject broad/global grants; they do not establish that an operator's data is disposable.
        // The selected .env.e2e must already designate an explicitly disposable schema under the testing guide.
        const [rows] = await connection.query('SHOW GRANTS');
        const scopes = rows.map(row => String(Object.values(row)[0]).split(' TO ')[0]);
        for (const scope of scopes) {
            if (scope === 'GRANT USAGE ON *.*') continue;
            const match = scope.match(/ ON `([^`]+)`\.\*$/);
            if (!match || !/(test|e2e)/i.test(match[1]) || match[1].includes('%')) {
                throw new Error('Capture credentials must be restricted to disposable test schemas.');
            }
        }
        const [[target]] = await connection.query('SELECT DATABASE() AS name, VERSION() AS version');
        manifest.database = {host: captureEnv.E2E_DB_HOST, port: Number(captureEnv.E2E_DB_PORT || 3306), ...target, grantScopes: scopes};
    } finally {
        await connection.end();
    }
}

/** Start only the built HTTP application; archival/retention startup jobs are deliberately outside visual capture. */
function startCaptureServer(log) {
    const serverEnv = {...captureEnv, NODE_ENV: 'e2e', E2E_APP_PORT: String(port), E2E_ROOT_URL: baseURL,
        E2E_LOCAL_LOGIN_ENABLED: '1', E2E_OIDC_ENABLED: '0', E2E_AUTO_ARCHIVE_ENABLED: 'false',
        E2E_SMTP_HOST: '127.0.0.1', E2E_SMTP_PORT: '9', E2E_SMTP_SECURE: 'false', E2E_SMTP_POOL: 'false',
        E2E_HEADER_IMG_DIR: path.join(output, 'uploads', 'headers'), E2E_INVOICE_DIR: path.join(output, 'uploads', 'invoices'),
        SETTINGS_FILE: path.join(output, 'unused-settings.csv'), TZ: 'UTC'};
    // The server imports the same app, middleware, views and services as production. Only process-level jobs differ.
    const bootstrap = `
        (async function start() {
            await require('./dist/modules/settings').default.read();
            await require('./dist/modules/database/dataSource').initDataSource();
            require('./dist/app').default.listen(${port}, '127.0.0.1', () => {
                process.send({type: 'capture-ready', pid: process.pid});
            });
        })().catch(error => { console.error(error); process.exit(1); });
    `;
    const server = spawn(process.execPath, ['-e', bootstrap], {cwd: workspace, env: serverEnv,
        windowsHide: true, stdio: ['ignore', log, log, 'ipc']});
    return server;
}

/** Wait for our child only; a failed bind must never redirect fixture writes into another running server. */
async function waitForServer(server) {
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => fail(new Error('Capture server did not become ready.')), 25_000);
        function clean() {
            clearTimeout(timer);
            server.off('message', ready);
            server.off('exit', exited);
            server.off('error', fail);
        }
        function fail(error) { clean(); reject(error); }
        function exited() { fail(new Error('Capture server exited; inspect server.log.')); }
        function ready(message) {
            if (message?.type !== 'capture-ready' || message.pid !== server.pid) return;
            clean();
            resolve();
        }
        server.on('message', ready);
        server.once('exit', exited);
        server.once('error', fail);
    });
    expect((await fetch(`${baseURL}/healthz`, {signal: AbortSignal.timeout(5000)})).ok).toBe(true);
}

/** Use the existing response envelope and reject followed redirects or unsuccessful commands. */
async function command(request, url, data) {
    const response = await request.post(url, {data, maxRedirects: 0});
    expect(response.ok(), url).toBe(true);
    const body = await response.json();
    expect(body.status, url).toBe('success');
    return body.data;
}

/** Create a fresh profile so old E2E entities do not enter this run's personal overview. */
async function selectSyntheticProfile(page) {
    const before = await (await page.request.get('/users/profile/manage')).text();
    const existing = new Set(Array.from(before.matchAll(/\/users\/profile\/change\/([\w-]+)/g), match => match[1]));
    expect((await page.request.post('/users/profile/create', {form: {name: 'Baseline organizer'}, maxRedirects: 0})).status()).toBe(302);
    const after = await (await page.request.get('/users/profile/manage')).text();
    const created = Array.from(after.matchAll(/\/users\/profile\/change\/([\w-]+)/g), match => match[1]).filter(id => !existing.has(id));
    expect(created).toHaveLength(1);
    expect((await page.request.get(`/users/profile/change/${created[0]}`, {maxRedirects: 0})).status()).toBe(302);
    manifest.fixtures.profileId = created[0];
}

/** Seed through existing HTTP workflows; disable notification options and use synthetic guests without email. */
async function seedFixtures(organizer, guest) {
    const eventInput = factories.createE2EEvent();
    eventInput.title = eventInput.form.title = 'Autumn community weekend';
    Object.assign(eventInput.form, {description: 'A shared weekend with meals, activities and equipment.',
        startDate: '2099-10-09', endDate: '2099-10-11', location: 'Lakeside camp',
        'defaultPerms[public][0]': 'ACCESS_REGISTRATION', 'defaultPerms[public][1]': 'ACCESS_VIEW'});
    const event = await createResourceViaForm(organizer.request, eventInput);
    const surveyInput = factories.createE2ESurvey();
    surveyInput.title = surveyInput.form.title = 'Choose our monthly meeting';
    Object.assign(surveyInput.form, {'combinations[1][weekday]': 'FRI', 'combinations[1][week]': 'LAST'});
    const survey = await createResourceViaForm(organizer.request, surveyInput);
    const packingInput = factories.createE2EPackingList();
    packingInput.title = packingInput.form.title = 'Weekend equipment';
    packingInput.form.items = JSON.stringify([{title: 'Tent', description: 'Two person tent', maxAssignees: 1, requiredByAll: false},
        {title: 'Drinking water', description: 'Bring your own bottle', maxAssignees: 1, requiredByAll: true},
        {title: 'Cooking equipment', description: 'One shared stove', maxAssignees: 2, requiredByAll: false}]);
    const packing = await createResourceViaForm(organizer.request, packingInput);
    const driversInput = factories.createE2EDriversList();
    driversInput.title = driversInput.form.title = 'Rides to camp';
    const drivers = await createResourceViaForm(organizer.request, driversInput);
    await command(organizer.request, `/api/drivers/${drivers.id}/items`, {title: 'Baseline organizer', description: 'Friday afternoon from the station', maxAssignees: 3});
    const activityInput = factories.createE2EActivityPlan();
    activityInput.title = activityInput.form.title = 'Weekend activities';
    Object.assign(activityInput.form, {startDate: '2099-10-09', endDate: '2099-10-11', event_id: event.id,
        slots: JSON.stringify({'2099-10-09': [{id: randomUUID(), day: '2099-10-09', pos: 0, title: 'Breakfast help',
            description: 'Prepare breakfast together', startTime: '08:00', endTime: '09:00', maxAssignees: 2}]})});
    const activity = await createResourceViaForm(organizer.request, activityInput);
    const registration = {arrivalDate: eventInput.form.startDate, departureDate: eventInput.form.endDate, dietary: ['MEAT']};
    await command(organizer.request, `/api/event/${event.id}/register`, registration);
    expect((await guest.request.post(`${event.path}/guest`, {form: {username: 'Jamie Guest'}, maxRedirects: 0})).status()).toBe(302);
    await command(guest.request, `/api/event/${event.id}/register`, {...registration, dietary: ['VEGETARIAN']});
    const pool = await command(organizer.request, `/api/event/${event.id}/invoice-pools`, {name: 'Shared food costs',
        distribution: 'EQUAL', assignAll: true, subtractPersonalInvoices: true, sendCalculationEmails: false});
    const poolEndpoint = `/api/event/${event.id}/invoice-pools/${pool.id}`;
    await command(organizer.request, `${poolEndpoint}/invoices/organizer`, {amount: '120.00', description: 'Food for the weekend'});
    Object.assign(manifest.fixtures, {event, survey, packing, drivers, activity, poolId: pool.id, poolEndpoint});
    // Consume setup-only flashes, including the guest's private return URL, before recording matched viewport states.
    await organizer.request.get('/users/dashboard');
    await guest.request.get(event.path);
}

/** Record a complete rendered state, including viewport overflow and loaded external stylesheet evidence. */
async function capture(page, scene, viewport, prepare) {
    const entry = {scene: scene.id, viewport: viewport.name, role: scene.role || 'organizer', path: scene.path,
        captureMode: scene.viewportOnly ? 'viewport' : 'full-page', status: 'incomplete'};
    manifest.captures.push(entry);
    try {
        await page.setViewportSize({width: viewport.width, height: viewport.height});
        const response = await page.goto(scene.path, {waitUntil: 'networkidle'});
        expect(response.status()).toBe(200);
        if (scene.text) await expect(page.getByText(scene.text, {exact: true}).first()).toBeVisible();
        if (prepare) await prepare(page);
        await page.evaluate(() => document.fonts.ready);
        await delay(250);
        entry.render = await page.evaluate(() => ({title: document.title, language: document.documentElement.lang,
            viewportWidth: innerWidth, documentWidth: document.documentElement.scrollWidth,
            bootstrapLoaded: Array.from(document.styleSheets).some(sheet => sheet.href?.includes('bootstrap@'))}));
        entry.file = `${scene.id}-${viewport.name}.png`;
        // Fixed-position dialogs must be captured at the actual viewport, not stitched into a taller document.
        await page.screenshot({path: path.join(output, entry.file), fullPage: !scene.viewportOnly, animations: 'disabled'});
        entry.status = 'captured';
        console.log(`Captured ${entry.file}`);
    } catch (error) {
        entry.status = 'failed';
        entry.error = error.message;
        console.log(`Failed ${scene.id} (${viewport.name}): ${error.message.split('\n')[0]}`);
    }
}

/** Open an existing Bootstrap accordion through its public control, preserving actual application behavior. */
async function openPool(page) {
    const pool = page.locator(`.invoice-pool[data-pool="${manifest.fixtures.poolId}"]`);
    const button = pool.locator('.accordion-button').first();
    if (await button.getAttribute('aria-expanded') !== 'true') await button.click();
    const content = pool.locator('.accordion-collapse').first();
    await expect(content).toBeVisible();
    await expect(content).toHaveClass(/\bshow\b/);
    await expect(content).not.toHaveClass(/\bcollapsing\b/);
    return pool;
}

/** Wait for a loaded preview and completed Bootstrap transition before recording either scroll position. */
async function openCalculation(page) {
    const pool = await openPool(page);
    await pool.getByRole('button', {name: 'Preview calculation', exact: true}).click();
    const modal = page.locator(`#pool-${manifest.fixtures.poolId}-calculation`);
    await expect(modal).toBeVisible();
    await expect(modal).toHaveAttribute('data-preview-revision', /\d+/);
    await page.waitForFunction(() => !document.getAnimations().some(animation => animation.playState === 'running'));
    return modal;
}

/** Capture representative pages and critical state variants without pretending this is an exhaustive E2E suite. */
async function captureScenes(browser, organizer, guest) {
    const f = manifest.fixtures;
    const anonymous = await browser.newContext({baseURL, locale: 'en-GB', timezoneId: 'UTC'});
    const anonymousPage = await anonymous.newPage();
    const page = await organizer.newPage();
    const guestPage = await guest.newPage();
    const scenes = [
        {id: 'login', path: '/users/login', role: 'anonymous', page: anonymousPage},
        {id: 'overview', path: '/users/dashboard'},
        {id: 'event-create', path: '/event/create'},
        {id: 'survey', path: f.survey.path, text: f.survey.title},
        {id: 'packing', path: f.packing.path, text: f.packing.title, prepare: async page => {
            for (const checkbox of await page.locator('[data-packed]').all()) await checkbox.uncheck();
        }},
        {id: 'packing-checked', path: f.packing.path, prepare: async page => {
            const checkbox = page.locator('[data-packed]').first();
            await checkbox.check();
            await page.reload({waitUntil: 'networkidle'});
            await expect(page.locator('[data-packed]').first()).toBeChecked();
        }},
        {id: 'drivers', path: f.drivers.path, text: f.drivers.title},
        {id: 'activity', path: f.activity.path, text: f.activity.title},
        {id: 'event-participant', path: f.event.path, page: guestPage, role: 'guest'},
        {id: 'event-admin', path: `${f.event.path}/admin`},
        {id: 'entity-settings', path: f.event.path, viewportOnly: true, prepare: async page => {
            await page.getByRole('button', {name: 'Entity settings', exact: true}).click();
            await expect(page.locator('#entityPropertiesModal')).toBeVisible();
        }},
        {id: 'invoice-open', path: `${f.event.path}/admin`, prepare: openPool},
        {id: 'invoice-preview', path: `${f.event.path}/admin`, viewportOnly: true, prepare: openCalculation},
        {id: 'invoice-preview-actions', path: `${f.event.path}/admin`, viewportOnly: true, prepare: async page => {
            const modal = await openCalculation(page);
            await modal.getByRole('button', {name: 'Close pool & calculate', exact: true}).scrollIntoViewIfNeeded();
        }},
        {id: 'help', path: '/help'},
    ];
    for (const viewport of viewports) {
        for (const scene of scenes) await capture(scene.page || page, scene, viewport, scene.prepare);
    }
    const previewResponse = await organizer.request.get(`${f.poolEndpoint}/preview`);
    expect(previewResponse.ok()).toBe(true);
    const preview = (await previewResponse.json()).data;
    await command(organizer.request, `${f.poolEndpoint}/close`, {expectedRevision: preview.revision, sendEmails: false});
    for (const viewport of viewports) {
        await capture(page, {id: 'invoice-closed', path: `${f.event.path}/admin`}, viewport, openPool);
    }

    // JavaScript-disabled navigation is an explicit existing overview fallback; exercise its ordinary form.
    const noScript = await browser.newContext({baseURL, javaScriptEnabled: false, locale: 'en-GB', timezoneId: 'UTC',
        storageState: await organizer.storageState()});
    const fallbackPage = await noScript.newPage();
    for (const viewport of viewports) {
        await capture(fallbackPage, {id: 'overview-no-javascript', path: '/users/dashboard'}, viewport, async page => {
            const region = page.locator('#sec-own-parts-main');
            await region.getByRole('searchbox').fill(f.survey.title);
            await Promise.all([page.waitForNavigation({waitUntil: 'networkidle'}), region.getByRole('searchbox').press('Enter')]);
            await expect(region.locator(`.js-item[data-id="${f.survey.id}"]`)).toBeVisible();
            expect(new URL(page.url()).searchParams.get('owner_main_q')).toBe(f.survey.title);
        });
    }
    manifest.checks.push({name: 'native overview search with JavaScript disabled',
        passed: manifest.captures.filter(entry => entry.scene === 'overview-no-javascript').every(entry => entry.status === 'captured')});
    await noScript.close();
    await anonymous.close();
}

/** Keep partial results on failure and always stop the browser and this run's child server. */
async function main() {
    await verifyTarget();
    // Refuse reuse: a listening port could be a development process with a different database.
    const net = require('node:net');
    await new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.once('error', reject);
        probe.listen(port, '127.0.0.1', () => probe.close(resolve));
    });
    fs.mkdirSync(output, {recursive: true});
    const log = fs.openSync(path.join(output, 'server.log'), 'w');
    const server = startCaptureServer(log);
    let browser;
    try {
        await waitForServer(server);
        browser = await chromium.launch({headless: true});
        manifest.browser = browser.version();
        const organizer = await browser.newContext({baseURL, locale: 'en-GB', timezoneId: 'UTC'});
        const guest = await browser.newContext({baseURL, locale: 'en-GB', timezoneId: 'UTC'});
        for (const context of [organizer, guest]) {
            context.on('page', page => {
                page.setDefaultTimeout(10_000);
                page.on('pageerror', error => manifest.browserErrors.push(error.message));
                page.on('requestfailed', request => manifest.failedRequests.push({url: request.url(), failure: request.failure()?.errorText}));
            });
        }
        await loginForE2E(organizer.request, {username: captureEnv.E2E_ADMIN_USERNAME, password: captureEnv.E2E_ADMIN_PASSWORD});
        const setupPage = await organizer.newPage();
        await selectSyntheticProfile(setupPage);
        await setupPage.close();
        await seedFixtures(organizer, guest);
        await captureScenes(browser, organizer, guest);
        manifest.status = manifest.captures.every(entry => entry.status === 'captured') ? 'captured-awaiting-visual-review' : 'partial';
        if (manifest.status === 'partial') process.exitCode = 1;
    } catch (error) {
        manifest.error = error.message;
        process.exitCode = 1;
        console.error(error.message);
    } finally {
        try {
            if (browser) await browser.close();
        } finally {
            if (server.exitCode === null && server.signalCode === null) {
                const exited = new Promise(resolve => server.once('exit', resolve));
                server.kill();
                await exited;
            }
            fs.closeSync(log);
            manifest.finishedAt = new Date().toISOString();
            fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
            writeGallery();
            console.log(`Evidence: ${path.relative(workspace, output)}`);
        }
    }
}

/** Produce a local index of generated evidence; the manifest retains failed states even when no image exists. */
function writeGallery() {
    function escape(value) { return String(value).replace(/[&<>"']/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character])); }
    const cards = manifest.captures.map(entry => `<article><h2>${escape(entry.scene)} · ${escape(entry.viewport)}</h2>
        <p>${escape(entry.role)} · ${escape(entry.status)}</p>${entry.file
        ? `<a href="${escape(entry.file)}"><img loading="lazy" src="${escape(entry.file)}" alt="${escape(entry.scene)} ${escape(entry.viewport)}"></a>`
        : `<p>${escape(entry.error || 'Not captured')}</p>`}</article>`).join('\n');
    fs.writeFileSync(path.join(output, 'index.html'), `<!doctype html><html lang="en"><meta charset="utf-8">
        <meta name="viewport" content="width=device-width,initial-scale=1"><title>Surveyor frontend baseline</title>
        <style>body{font:16px system-ui;background:#15171b;color:#eee;margin:2rem}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:1rem}article{padding:1rem;background:#252932;border-radius:8px}h2{font-size:1rem}img{width:100%;max-height:600px;object-fit:contain;object-position:top}a{color:#aaf}</style>
        <h1>Surveyor frontend baseline</h1><p>${escape(runId)} · ${escape(manifest.status)}</p>
        <p>Click an image to inspect its original size. <a href="manifest.json">Capture manifest</a></p><main>${cards}</main></html>`);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
