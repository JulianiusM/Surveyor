/*
 * Copyright 2026 Julian Malovanij
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

/**
 * Optional migration evidence capture against the selected application runtime and an existing disposable E2E schema.
 * This does not run the schema initializer, reset data, send mail, or install a CI prerequisite.
 * Each run adds synthetic fixtures through production HTTP routes and retains them for manual inspection.
 * Screenshots and the manifest stay under ignored test-results; no credentials or session state are written.
 */
const fs = require('node:fs');
const path = require('node:path');
const {spawn, execFileSync} = require('node:child_process');
const {createHash, randomUUID} = require('node:crypto');
const {setTimeout: delay} = require('node:timers/promises');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');
const {chromium, expect} = require('@playwright/test');

require('ts-node').register({project: 'tsconfig.test.json', transpileOnly: true});
const factories = require('../tests/factories/e2eCoreFactory');
const {createResourceViaForm, loginForE2E} = require('../tests/keywords/e2eCoreKeywords');

const workspace = path.resolve(__dirname, '..');
const runId = new Date().toISOString().replace(/[:.]/g, '-');
// A gallery can be regenerated from retained evidence without contacting or changing the database.
const galleryArgument = process.argv.indexOf('--gallery');
const galleryOnly = galleryArgument >= 0;
const output = galleryOnly ? path.resolve(process.argv[galleryArgument + 1])
    : path.join(workspace, 'test-results', 'frontend-baseline', runId);
const envFile = process.env.E2E_DOTENV_FILE ? path.resolve(workspace, process.env.E2E_DOTENV_FILE) : undefined;
// Capture writes fixtures and sessions. Never silently inherit the ordinary E2E target:
// the caller must select and explicitly acknowledge one disposable schema. The selected
// file owns its database settings even if this terminal has inherited other test values.
const captureEnv = {...process.env, ...(envFile ? dotenv.parse(fs.readFileSync(envFile)) : {})};
// Freeze the same complete target for both preflight and the child's settings loader.
const port = Number(process.env.FRONTEND_BASELINE_PORT || 3104);
const baseURL = `http://127.0.0.1:${port}`;
const pilotComparison = process.env.FRONTEND_BASELINE_MODE === 'pilot';
// Production and development load different entrypoints. Capture the emitted Vite
// graph explicitly rather than treating a successful built-page review as HMR evidence.
const runtime = process.env.FRONTEND_BASELINE_RUNTIME || 'built';
// Identity diagnosis uses the same guarded server/mail boundary without unrelated
// packing fixtures. The default remains the complete comparison collection.
const identityOnly = process.env.FRONTEND_BASELINE_SCOPE === 'identity';
const viewports = [{name: 'desktop', width: 1440, height: 1000}, {name: 'mobile', width: 390, height: 844}];
const manifest = galleryOnly ? JSON.parse(fs.readFileSync(path.join(output, 'manifest.json'), 'utf8'))
    : {runId, sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: workspace, encoding: 'utf8'}).trim(),
    node: process.version, playwright: require('@playwright/test/package.json').version,
    baseURL, runtime, viewports, fixtures: {}, captures: [], checks: [], browserErrors: [], failedRequests: [],
    assetFailures: [], status: 'incomplete'};

// Capability links are only carried in memory between the mail boundary and browser.
// They must never become evidence URLs, logged errors or saved fixture properties.
const identityMail = [];
const identityCapabilities = new Set();
function redactCaptureText(value) {
    let text = String(value);
    for (const token of identityCapabilities) text = text.split(token).join('[redacted]');
    return text.replace(/(\/users\/(?:reset-password|activate)\/)[^\s/?#"'<>]+/g, '$1[redacted]')
        .replace(/(\/guest\/[^\s/?#"'<>]+\/login\/)[^\s/?#"'<>]+/g, '$1[redacted]');
}

/** Keep server output useful while ensuring split stream chunks cannot leak a capability. */
function retainRedactedServerOutput(stream, log) {
    let pending = '';
    stream.setEncoding('utf8');
    stream.on('data', chunk => {
        pending += chunk;
        const lines = pending.split('\n');
        pending = lines.pop();
        for (const line of lines) fs.writeSync(log, redactCaptureText(line) + '\n');
    });
    stream.on('end', () => { if (pending) fs.writeSync(log, redactCaptureText(pending)); });
}

/** Framework render errors may be caught and logged instead of surfacing as pageerror. */
function observeCapturePage(page) {
    page.setDefaultTimeout(10_000);
    page.on('pageerror', error => manifest.browserErrors.push(redactCaptureText(error.message)));
    page.on('console', message => {
        // HTTP failures are inspected through request/response assertions; retain actual JS/render errors here.
        if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) {
            manifest.browserErrors.push(redactCaptureText(message.text()));
        }
    });
    page.on('requestfailed', request => manifest.failedRequests.push({url: redactCaptureText(request.url()), failure: request.failure()?.errorText}));
    page.on('response', response => {
        // A failed entry can leave usable-looking SSR without raising pageerror.
        // Assert the actual module graph independently of rendered screenshot success.
        if (new URL(response.url()).pathname.startsWith('/app/')
            && (response.status() >= 400 || response.headers()['content-type']?.includes('text/html'))) {
            manifest.assetFailures.push({url: redactCaptureText(response.url()), status: response.status(),
                contentType: response.headers()['content-type'] ?? ''});
        }
    });
}

/** Verify the effective local target and grants before starting an application capable of writing sessions/fixtures. */
async function verifyTarget() {
    if (!['built', 'development'].includes(runtime)) throw new Error('Capture runtime must be built or development.');
    if (!envFile || !process.env.FRONTEND_BASELINE_DISPOSABLE_DATABASE
        || captureEnv.E2E_DB_NAME !== process.env.FRONTEND_BASELINE_DISPOSABLE_DATABASE) {
        throw new Error('Set E2E_DOTENV_FILE and FRONTEND_BASELINE_DISPOSABLE_DATABASE to the explicitly disposable capture schema.');
    }
    if (!['127.0.0.1', 'localhost', '::1'].includes(captureEnv.E2E_DB_HOST)
        || !/e2e/i.test(captureEnv.E2E_DB_NAME || '')) {
        throw new Error('Capture requires an explicitly configured local disposable E2E database.');
    }
    if (!captureEnv.E2E_ADMIN_USERNAME || !captureEnv.E2E_ADMIN_PASSWORD) throw new Error('E2E login credentials are required.');
    if (!captureEnv.E2E_DB_USER || !captureEnv.E2E_DB_PASSWORD) throw new Error('Explicit E2E database credentials are required.');
    if (!/^\d+$/.test(captureEnv.E2E_DB_PORT || '') || Number(captureEnv.E2E_DB_PORT) < 1
        || Number(captureEnv.E2E_DB_PORT) > 65535) throw new Error('An explicit valid E2E database port is required.');
    if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid capture port.');
    if (!fs.existsSync(path.join(workspace, 'dist', 'app.js'))) throw new Error('Run npm run build before capture.');
    manifest.build = buildFingerprint();
    const connection = await mysql.createConnection({host: captureEnv.E2E_DB_HOST,
        port: Number(captureEnv.E2E_DB_PORT), database: captureEnv.E2E_DB_NAME,
        user: captureEnv.E2E_DB_USER, password: captureEnv.E2E_DB_PASSWORD, connectTimeout: 5000});
    try {
        // Test-like names do not establish disposal authority. Reject access to any
        // schema other than the caller's explicit target, including peer test schemas.
        const [rows] = await connection.query('SHOW GRANTS');
        const scopes = rows.map(row => String(Object.values(row)[0]).split(' TO ')[0]);
        for (const scope of scopes) {
            if (scope === 'GRANT USAGE ON *.*') continue;
            const match = scope.match(/ ON `([^`]+)`\.\*$/);
            const exactSchema = captureEnv.E2E_DB_NAME.replace(/[\\_%]/g, character => '\\' + character);
            if (!match || match[1] !== exactSchema) {
                throw new Error('Capture credentials must be restricted to the single selected disposable schema.');
            }
        }
        const [[target]] = await connection.query('SELECT DATABASE() AS name, VERSION() AS version');
        if (target.name !== process.env.FRONTEND_BASELINE_DISPOSABLE_DATABASE) throw new Error('Capture database target changed.');
        manifest.database = {host: captureEnv.E2E_DB_HOST, port: Number(captureEnv.E2E_DB_PORT), ...target, grantScopes: scopes};
    } finally {
        await connection.end();
    }
}

/** Commit IDs alone do not identify an uncommitted review. Record the exact built
 * entrypoints and shared styles used by both sides without copying generated output. */
function buildFingerprint() {
    const assetManifest = JSON.parse(fs.readFileSync(path.join(workspace, 'dist/public/app/.vite/manifest.json'), 'utf8'));
    const client = assetManifest['src/frontend/app/entry-client.ts'];
    const files = ['dist/app.js', 'dist/frontend-server/entry-server.mjs', 'dist/api-contracts/openapi.json',
        'dist/public/style/style.css', 'dist/public/style/help.css',
        'dist/views/modules/module_entity_header.pug', 'dist/views/packing/packing-view.pug',
        ...Object.values(assetManifest).flatMap(chunk => [chunk.file, ...(chunk.css || [])])
            .map(file => 'dist/public/app/' + file)];
    // The entry file imports routes/controllers, and help loads its trusted corpus at
    // runtime. Freeze those inputs too: unchanged entry bytes alone cannot prove an
    // unchanged server or translated article body during a long comparison.
    function directoryFingerprint(relativeDirectory) {
        const digest = createHash('sha256');
        let count = 0;
        function visit(relativePath) {
            for (const entry of fs.readdirSync(path.join(workspace, relativePath), {withFileTypes: true})
                .sort((left, right) => left.name.localeCompare(right.name))) {
                const filename = `${relativePath}/${entry.name}`;
                if (entry.isDirectory()) visit(filename);
                else if (entry.isFile()) {
                    digest.update(filename).update('\0').update(fs.readFileSync(path.join(workspace, filename))).update('\0');
                    count++;
                }
            }
        }
        visit(relativeDirectory);
        return {files: count, sha256: digest.digest('hex')};
    }
    const directories = ['dist/controller', 'dist/middleware', 'dist/modules', 'dist/routes', 'dist/views',
        'dist/public/js', 'docs/user-guide'];
    if (runtime === 'development') {
        // Freeze source SSR, browser modules, native templates/assets, and generated
        // inputs too. A live edit during this collection invalidates the comparison.
        directories.push('src', '.generated/api', 'contracts/api/v1');
        files.push('vite.config.mts', 'tsconfig.server.json');
    }
    return {mode: runtime, clientEntry: runtime === 'development' ? '/app/src/frontend/app/entry-client.ts' : client.file,
        runtime: Object.fromEntries(directories.map(directory => [directory, directoryFingerprint(directory)])),
        hashes: Object.fromEntries([...new Set(files)].map(file => [file,
            createHash('sha256').update(fs.readFileSync(path.join(workspace, file))).digest('hex')]))};
}

/** Start the selected HTTP application; startup jobs stay outside visual capture.
 * Development uses source Express plus its real Vite/SSR integration, not a second asset server. */
function startCaptureServer(log) {
    const serverEnv = {...captureEnv, NODE_ENV: runtime === 'development' ? 'development' : 'e2e',
        SURVEYOR_FRONTEND_DEV: runtime === 'development' ? '1' : '0',
        E2E_APP_PORT: String(port), E2E_ROOT_URL: baseURL,
        E2E_LOCAL_LOGIN_ENABLED: '1', E2E_OIDC_ENABLED: '0', E2E_AUTO_ARCHIVE_ENABLED: 'false',
        E2E_SMTP_HOST: '127.0.0.1', E2E_SMTP_PORT: '9', E2E_SMTP_SECURE: 'false', E2E_SMTP_POOL: 'false',
        // The existing upload owner joins configured directories to cwd; use relative task-owned paths.
        E2E_HEADER_IMG_DIR: path.relative(workspace, path.join(output, 'uploads', 'headers')),
        E2E_INVOICE_DIR: path.relative(workspace, path.join(output, 'uploads', 'invoices')),
        SETTINGS_FILE: path.join(output, 'unused-settings.csv'), TZ: 'UTC'};
    if (runtime === 'development') {
        // Normal development settings read ordinary names, while E2E uses overrides.
        // Map the already verified target before importing settings; never fall back
        // to the operator's .env or silently use another database in source mode.
        for (const [name, value] of Object.entries(serverEnv)) {
            if (name.startsWith('E2E_')) serverEnv[name.slice(4)] = value;
        }
    }
    const applicationDirectory = runtime === 'development' ? 'src' : 'dist';
    // The server imports the same app, middleware, views and services as production. Only process-level jobs differ.
    const bootstrap = `
        (async function start() {
            ${runtime === 'development' ? "require('ts-node').register({project: 'tsconfig.server.json'});" : ''}
            await require('./${applicationDirectory}/modules/settings').default.read();
            await require('./${applicationDirectory}/modules/database/dataSource').initDataSource();
            // Replace only outbound delivery. Registration, token persistence, validation
            // and browser submissions still execute the real application workflows.
            const mailer = require('./${applicationDirectory}/modules/email').default;
            for (const [method, kind] of [['sendActivationEmail', 'activation'], ['sendPasswordResetEmail', 'reset']]) {
                mailer[method] = async (recipient, link) => {
                    process.send({type: 'capture-identity-mail', kind, address: recipient.address, link});
                };
            }
            const server = require('node:http').createServer(require('./${applicationDirectory}/app').default);
            await require('./${applicationDirectory}/modules/frontendDevelopment').initializeFrontendDevelopment(server);
            server.listen(${port}, '127.0.0.1', () => {
                process.send({type: 'capture-ready', pid: process.pid});
            });
        })().catch(error => { console.error(error); process.exit(1); });
    `;
    const server = spawn(process.execPath, ['-e', bootstrap], {cwd: workspace, env: serverEnv,
        windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc']});
    retainRedactedServerOutput(server.stdout, log);
    retainRedactedServerOutput(server.stderr, log);
    server.on('message', message => {
        if (message?.type !== 'capture-identity-mail') return;
        const token = new URL(message.link).pathname.split('/').pop();
        identityCapabilities.add(token);
        identityMail.push({kind: message.kind, address: message.address, link: message.link});
    });
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

/** The pilot comparison deliberately uses the same records and actors on both routes. */
async function seedPilotFixtures(organizer, guest) {
    const input = factories.createE2EPackingList();
    input.title = input.form.title = 'Weekend equipment';
    Object.assign(input.form, {description: 'Shared equipment for our weekend.\nBring your own essentials.',
        'defaultPerms[public][0]': 'ACCESS_VIEW', items: JSON.stringify([
            {title: 'Tent', description: 'Two person tent', maxAssignees: 1, requiredByAll: false},
            {title: 'Drinking water', description: 'Bring your own bottle', maxAssignees: 1, requiredByAll: true},
            {title: 'Cooking equipment', description: 'One shared stove', maxAssignees: 2, requiredByAll: false},
        ])});
    const packing = await createResourceViaForm(organizer.request, input);
    expect((await guest.request.post(`${packing.path}/guest`, {form: {username: 'Jamie Guest'}, maxRedirects: 0})).status()).toBe(302);
    const session = await (await organizer.request.get('/api/v1/session')).json();
    const response = await organizer.request.get(`/api/v1/packing-lists/${packing.id}`, {headers: {'X-Surveyor-Context': session.context}});
    expect(response.status()).toBe(200);
    const data = await response.json();
    const tent = data.items.find(item => item.title === 'Tent');
    await command(guest.request, `/api/packing/${packing.id}/assign`, {itemId: tent.id});
    const emptyInput = factories.createE2EPackingList();
    emptyInput.title = emptyInput.form.title = 'Empty equipment list';
    Object.assign(emptyInput.form, {description: '', 'defaultPerms[public][0]': 'ACCESS_VIEW'});
    const empty = await createResourceViaForm(organizer.request, emptyInput);
    const emptyData = await (await organizer.request.get(`/api/v1/packing-lists/${empty.id}`, {headers: {'X-Surveyor-Context': session.context}})).json();
    await command(organizer.request, `/api/packing/${empty.id}/item/${emptyData.items[0].id}/delete`, {});
    const imageInput = factories.createE2EPackingList();
    imageInput.title = imageInput.form.title = 'Equipment with a header image';
    Object.assign(imageInput.form, {'defaultPerms[public][0]': 'ACCESS_VIEW'});
    const image = await createResourceViaForm(organizer.request, imageInput);
    const uploaded = await organizer.request.put(`/api/packing/${image.id}/header`, {multipart: {
        image: {name: 'surveyor.png', mimeType: 'image/png', buffer: fs.readFileSync(path.join(workspace, 'src/public/img/logo.png'))},
    }});
    expect(uploaded.ok()).toBe(true);
    const archivedInput = factories.createE2EPackingList();
    archivedInput.title = archivedInput.form.title = 'Archived equipment';
    Object.assign(archivedInput.form, {'defaultPerms[public][0]': 'ACCESS_VIEW'});
    const archived = await createResourceViaForm(organizer.request, archivedInput);
    await command(organizer.request, `/api/packing/${archived.id}/archive`, {});

    // Child access and parent navigation are separate permissions. One archived parent covers
    // both allowed/denied links and inherited archival without registering the guest for it.
    const parentInput = factories.createE2EEvent();
    parentInput.title = parentInput.form.title = 'Private equipment weekend';
    Object.assign(parentInput.form, {startDate: '2099-10-09', endDate: '2099-10-11'});
    const parent = await createResourceViaForm(organizer.request, parentInput);
    const noAudiencePermissions = {public: [], authenticated: [], guest: [], participant: []};
    await command(organizer.request, `/api/event/${parent.id}/settings`, {defaultPerms: noAudiencePermissions});
    const linkedInput = factories.createE2EPackingList();
    linkedInput.title = linkedInput.form.title = 'Equipment linked to a private event';
    const linked = await createResourceViaForm(organizer.request, linkedInput);
    await command(organizer.request, `/api/packing/${linked.id}/settings`, {defaultPerms: noAudiencePermissions});
    const guestSession = await (await guest.request.get('/api/v1/session')).json();
    await command(organizer.request, `/api/packing/${linked.id}/admins`, {
        profileId: guestSession.activeProfile.id, perms: ['ACCESS_VIEW'],
    });
    await command(organizer.request, `/api/packing/${linked.id}/event`, {eventId: parent.id, expectedEventId: null});
    await command(organizer.request, `/api/event/${parent.id}/archive`, {});
    for (const [context, actor, expectedUrl] of [[organizer, session, parent.path], [guest, guestSession, null]]) {
        const linkedResponse = await context.request.get(`/api/v1/packing-lists/${linked.id}`, {
            headers: {'X-Surveyor-Context': actor.context},
        });
        expect(linkedResponse.status()).toBe(200);
        expect(await linkedResponse.json()).toMatchObject({currentEventId: parent.id, currentEventUrl: expectedUrl,
            archived: false, inheritedArchived: true});
    }

    // Everyone normally hides Take, but existing self-membership must still offer Remove.
    // The ordinary assignment endpoint can create this historical state without direct DB writes.
    const everyoneInput = factories.createE2EPackingList();
    everyoneInput.title = everyoneInput.form.title = 'Everyone with an existing assignment';
    Object.assign(everyoneInput.form, {'defaultPerms[public][0]': 'ACCESS_VIEW', items: JSON.stringify([
        {title: 'Personal water bottle', description: 'An existing assignment on an Everyone item',
            maxAssignees: 1, requiredByAll: true},
    ])});
    const everyone = await createResourceViaForm(organizer.request, everyoneInput);
    const everyoneData = await (await organizer.request.get(`/api/v1/packing-lists/${everyone.id}`, {
        headers: {'X-Surveyor-Context': session.context},
    })).json();
    const everyoneItemId = everyoneData.items[0].id;
    await command(guest.request, `/api/packing/${everyone.id}/assign`, {itemId: everyoneItemId});

    // Different lists let the same guest exercise independent grants without changing a
    // captured actor's permissions halfway through a pair. Account-only actions use a
    // separate full-account delegate, prepared by capturePilotScenes below.
    const roles = [
        {key: 'read-only', label: 'Read-only participant', perms: [], fields: []},
        {key: 'write-only', label: 'Item creator without self-assignment', perms: ['ITEM_ADD'], fields: []},
        {key: 'title-only', label: 'Title editor', perms: ['EDIT_TITLE'], fields: ['title'], settings: true},
        {key: 'description-only', label: 'Description editor', perms: ['EDIT_DESC'], fields: ['description'], settings: true},
        {key: 'metadata-only', label: 'Image and event manager', perms: ['EDIT_META'], fields: [], settings: true},
        {key: 'item-editor', label: 'Item editor', perms: ['ITEM_EDIT'], fields: []},
        {key: 'item-descriptions', label: 'Item description editor', perms: ['ITEM_EDIT_DESC'], fields: []},
        {key: 'item-deleter', label: 'Item deleter', perms: ['ITEM_DELETE'], fields: []},
        {key: 'assignment-manager', label: 'Assignment manager', perms: ['MANAGE_ASSIGNMENTS'], fields: []},
        {key: 'permission-manager', label: 'Permission manager', perms: ['MANAGE_PERMISSIONS'], fields: [], settings: true},
        {key: 'account-duplicate', label: 'Account duplicate permission', perms: ['DATA_DUPLICATE'], fields: [], settings: true, account: true},
        {key: 'account-admin', label: 'Account administrator', preset: 'ADMIN', fields: ['title', 'description'], settings: true, account: true},
        {key: 'guest-admin', label: 'Guest administrator', preset: 'ADMIN', fields: ['title', 'description'], settings: true},
    ];
    for (const role of roles) {
        const roleInput = factories.createE2EPackingList();
        roleInput.title = roleInput.form.title = `Equipment — ${role.label}`;
        Object.assign(roleInput.form, {description: 'First paragraph of shared instructions.\nSecond line stays separate.',
            items: JSON.stringify([{title: 'Shared tent', description: 'An occupied item with spare capacity', maxAssignees: 2, requiredByAll: false},
                {title: 'Personal bottle', description: 'Everyone brings one', maxAssignees: 1, requiredByAll: true}])});
        role.list = await createResourceViaForm(organizer.request, roleInput);
        await command(organizer.request, `/api/packing/${role.list.id}/settings`, {defaultPerms: noAudiencePermissions});
        if (!role.account && (role.preset || role.perms.length)) {
            await command(organizer.request, `/api/packing/${role.list.id}/admins`, {
                profileId: guestSession.activeProfile.id, ...(role.preset ? {preset: role.preset} : {perms: role.perms}),
            });
        }
        const roleData = await (await organizer.request.get(`/api/v1/packing-lists/${role.list.id}`, {
            headers: {'X-Surveyor-Context': session.context},
        })).json();
        role.itemId = roleData.items.find(item => item.title === 'Shared tent').id;
        await command(organizer.request, `/api/packing/${role.list.id}/assign`, {itemId: role.itemId});
    }
    Object.assign(manifest.fixtures, {packing, empty, image, archived, parent, linked, everyone, everyoneItemId, roles,
        requiredItemId: data.items.find(item => item.requiredByAll).id, tentItemId: tent.id});
    manifest.checks.push({name: 'linked child remains accessible while event link follows independent parent permission; archival is inherited', passed: true});
    // Flash-only creation/login messages would otherwise make equivalent pages look different.
    await organizer.request.get('/users/dashboard');
    await guest.request.get(packing.path);
}

/** Match the whole visible label while allowing decorative icon-font glyphs in native
 * accessible names. No words may be added or omitted, and no rendered DOM is changed. */
function labelName(label) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    return new RegExp(`^[\\s\\p{Co}]*${escaped}[\\s\\p{Co}]*$`, 'u');
}

/** Capture every supported surface in paired routes, including mobile navigation and native help. */
async function capturePilotScenes(browser, organizer, guest, phase) {
    const f = manifest.fixtures;
    const anonymous = await browser.newContext({baseURL, locale: 'en-GB', timezoneId: 'UTC'});
    const native = await browser.newContext({baseURL, locale: 'en-GB', timezoneId: 'UTC', javaScriptEnabled: false});
    const account = await browser.newContext({baseURL, locale: 'en-GB', timezoneId: 'UTC'});
    for (const context of [anonymous, native, account]) {
        context.on('page', observeCapturePage);
    }
    await loginForE2E(account.request, {username: captureEnv.E2E_ADMIN_USERNAME, password: captureEnv.E2E_ADMIN_PASSWORD});
    // A fresh active profile is required: using the owner's ordinary login would silently
    // give every permission and invalidate the administrator/duplicate comparison.
    const delegateName = `Baseline delegate ${randomUUID().slice(0, 8)}`;
    expect((await account.request.post('/users/profile/create', {form: {name: delegateName}, maxRedirects: 0})).status()).toBe(302);
    const delegateSession = await (await account.request.get('/api/v1/session')).json();
    const delegate = delegateSession.profiles.find(profile => profile.name === delegateName);
    expect(delegate).toBeDefined();
    expect((await account.request.get(`/users/profile/change/${delegate.id}`, {maxRedirects: 0})).status()).toBe(302);
    for (const role of f.roles.filter(role => role.account)) {
        await command(organizer.request, `/api/packing/${role.list.id}/admins`, {
            profileId: delegate.id, ...(role.preset ? {preset: role.preset} : {perms: role.perms}),
        });
    }
    await account.request.get('/users/dashboard');

    /** Measure the regression itself, rather than treating matching markup as visual proof. */
    async function assertPackingLayout(page, title) {
        const heading = page.getByRole('heading', {name: labelName(title)});
        const geometry = await heading.evaluate(element => {
            const titleRect = element.getBoundingClientRect();
            const headerRect = element.closest('.card-header').getBoundingClientRect();
            const counters = document.querySelector('[data-packing-counters]');
            const participant = counters?.firstElementChild;
            const labelRange = document.createRange();
            const label = participant && Array.from(participant.childNodes).find(node => node.nodeType === Node.TEXT_NODE && node.textContent.includes('Participants'));
            if (label) labelRange.selectNode(label);
            const labelRect = label ? labelRange.getBoundingClientRect() : null;
            const badgeRect = participant?.querySelector('.badge')?.getBoundingClientRect();
            const description = document.getElementById('planDesc');
            return {centerOffset: Math.abs(titleRect.x + titleRect.width / 2 - headerRect.x - headerRect.width / 2),
                participantSameLine: !!labelRect && !!badgeRect && labelRect.top < badgeRect.bottom && badgeRect.top < labelRect.bottom,
                descriptionGap: description && counters ? counters.getBoundingClientRect().top - description.getBoundingClientRect().bottom : null,
                overflow: document.documentElement.scrollWidth - innerWidth};
        });
        expect(geometry.centerOffset, 'Entity title remains centered independently of available actions').toBeLessThanOrEqual(1);
        expect(geometry.participantSameLine, 'Participants label and count remain on the same line').toBe(true);
        if (geometry.descriptionGap !== null) expect(geometry.descriptionGap, 'Description has breathing room before counters').toBeGreaterThanOrEqual(16);
        expect(geometry.overflow, 'Table scroll stays inside its own container').toBeLessThanOrEqual(1);
    }
    const scenes = [
        {id: 'packing-anonymous-entry', context: anonymous, current: `${f.packing.path}/guest`, pilot: `/frontend-pilot${f.packing.path}`,
            prepare: async page => {
                await expect(page.getByRole('heading', {name: labelName(`Join «${f.packing.title}»`)})).toBeVisible();
                await expect(page.getByRole('button', {name: labelName('Continue as guest')})).toBeVisible();
                await expect(page.locator('input[type="email"]')).toBeVisible();
            }},
        {id: 'packing-guest-recovery', context: anonymous, current: `/guest/recovery?next=${encodeURIComponent(f.packing.path)}`,
            pilot: `/frontend-pilot/users/login?next=${encodeURIComponent('/frontend-pilot' + f.packing.path)}`,
            prepare: async page => {
                await expect(page.getByRole('heading', {name: labelName('Looking for your guest account?')})).toBeVisible();
                await expect(page.getByRole('button', {name: labelName('Request access')})).toBeVisible();
                await expect(page.locator('input[type="email"]')).toBeVisible();
            }},
        {id: 'packing-create', context: organizer, current: '/packing/create', pilot: '/frontend-pilot/packing/create',
            prepare: async page => {
                await expect(page.getByRole('heading', {name: labelName('Create packing list')})).toBeVisible();
                await expect(page.getByRole('button', {name: labelName('Create list')})).toBeVisible();
                await expect(page.locator('tbody tr')).toHaveCount(1);
            }},
        {id: 'identity-register', context: anonymous, current: '/users/register', pilot: '/frontend-pilot/users/register',
            prepare: async page => {
                await expect(page.getByRole('heading', {name: labelName('Register')})).toBeVisible();
                await expect(page.locator('input[type="password"]')).toHaveCount(2);
                await expect(page.locator('input[type="email"]')).toBeVisible();
            }},
        {id: 'identity-forgot', context: anonymous, current: '/users/forgot-password', pilot: '/frontend-pilot/users/forgot-password',
            prepare: async page => {
                await expect(page.locator('input[name="username"]')).toBeVisible();
                await expect(page.getByRole('button', {name: labelName('Send reset link')})).toBeVisible();
            }},
        {id: 'packing-duplicate', context: organizer, current: `${f.packing.path}/duplicate`, pilot: `/frontend-pilot${f.packing.path}/duplicate`,
            prepare: async page => {
                await expect(page.getByRole('heading', {name: labelName('Create packing list')})).toBeVisible();
                await expect(page.locator('tbody tr')).toHaveCount(3);
                await expect(page.getByLabel(labelName('Title *'))).toHaveValue(f.packing.title);
            }},
        {id: 'packing-create-event-picker', context: organizer, current: '/packing/create', pilot: '/frontend-pilot/packing/create', viewportOnly: true,
            prepare: async page => {
                await page.getByRole('button', {name: labelName('Assign to event (optional)')}).click();
                await expect(page.getByRole('dialog')).toBeVisible();
                await expect(page.getByRole('dialog').getByRole('searchbox')).toBeVisible();
                await expect(page.getByRole('dialog').getByRole('list', {name: labelName('Available events')})).toBeVisible();
            }},
        {id: 'packing-owner', context: organizer, current: f.packing.path, pilot: `/frontend-pilot${f.packing.path}`, title: f.packing.title},
        {id: 'packing-inline-title', context: organizer, current: f.packing.path, pilot: `/frontend-pilot${f.packing.path}`, title: f.packing.title,
            prepare: async page => {
                const row = page.locator('tbody tr').filter({hasText: 'Two person tent'});
                await row.locator('td').nth(2).dblclick();
                await expect(row.locator('td').nth(2).getByRole('textbox')).toBeVisible();
                await row.locator('td').nth(2).getByRole('textbox').fill('Tent draft in progress');
            }},
        {id: 'packing-guest', context: guest, current: f.packing.path, pilot: `/frontend-pilot${f.packing.path}`, title: f.packing.title},
        {id: 'packing-checked', context: guest, current: f.packing.path, pilot: `/frontend-pilot${f.packing.path}`, title: f.packing.title,
            prepare: async page => { await page.locator('tbody tr').first().getByRole('checkbox').first().check(); }},
        {id: 'packing-empty', context: organizer, current: f.empty.path, pilot: `/frontend-pilot${f.empty.path}`, title: f.empty.title},
        {id: 'packing-header', context: guest, current: f.image.path, pilot: `/frontend-pilot${f.image.path}`, title: f.image.title},
        {id: 'packing-archived', context: guest, current: f.archived.path, pilot: `/frontend-pilot${f.archived.path}`, title: f.archived.title},
        {id: 'packing-linked-owner', context: organizer, current: f.linked.path, pilot: `/frontend-pilot${f.linked.path}`, title: f.linked.title,
            prepare: async page => {
                await expect(page.getByRole('link', {name: labelName('Go to event')})).toHaveAttribute('href', f.parent.path);
            }},
        {id: 'packing-linked-owner-actions', context: organizer, current: f.linked.path, pilot: `/frontend-pilot${f.linked.path}`, title: f.linked.title, viewportOnly: true,
            prepare: async page => {
                await page.getByRole('button', {name: labelName('Entity settings')}).click();
                const dialog = page.getByRole('dialog');
                await dialog.getByRole('tab', {name: labelName('Actions')}).click();
                await expect(dialog.getByRole('link', {name: labelName('Open event')})).toHaveAttribute('href', f.parent.path);
                await expect(dialog.getByRole('button', {name: labelName('Archive for everyone')})).toBeVisible();
            }},
        {id: 'packing-linked-guest', context: guest, current: f.linked.path, pilot: `/frontend-pilot${f.linked.path}`, title: f.linked.title,
            prepare: async page => {
                await expect(page.locator(`a[href="${f.parent.path}"]`)).toHaveCount(0);
                await expect(page.getByText('This entity is archived.', {exact: true})).toBeVisible();
            }},
        {id: 'packing-everyone-assigned', context: guest, current: f.everyone.path, pilot: `/frontend-pilot${f.everyone.path}`, title: f.everyone.title,
            prepare: async page => {
                const row = page.locator('tbody tr').filter({hasText: 'Personal water bottle'});
                await expect(row.getByRole('button', {name: labelName('Remove')})).toBeVisible();
                await expect(row.getByText('Everyone', {exact: true})).toBeVisible();
                await expect(row.getByText('Full', {exact: true})).toBeVisible();
            }},
        {id: 'packing-editor', context: organizer, current: f.packing.path, pilot: `/frontend-pilot${f.packing.path}`, title: f.packing.title, viewportOnly: true,
            prepare: async page => {
                await page.getByRole('button', {name: labelName('Entity settings')}).click();
                await expect(page.getByRole('dialog')).toBeVisible();
                await expect(page.getByRole('dialog').locator('textarea[name="description"]')).toBeVisible();
            }},
        {id: 'help-home', context: organizer, current: '/help', pilot: '/frontend-pilot/help'},
        {id: 'help-article', context: organizer, current: '/help/packing_lists', pilot: '/frontend-pilot/help?doc=packing_lists'},
        {id: 'help-results', context: organizer, current: '/help/search?q=packing', pilot: '/frontend-pilot/help?q=packing'},
        {id: 'help-no-results', context: organizer, current: '/help/search?q=zzzzfixture', pilot: '/frontend-pilot/help?q=zzzzfixture'},
        {id: 'help-anonymous', context: anonymous, current: '/help', pilot: '/frontend-pilot/help'},
        {id: 'help-native', context: native, current: '/help', pilot: '/frontend-pilot/help',
            prepare: async page => {
                await page.getByRole('searchbox').fill('zzzzfixture');
                await page.getByRole('button', {name: labelName('Search help')}).click();
                await expect(page.getByRole('heading', {name: labelName('Search results')})).toBeVisible();
                expect(new URL(page.url()).searchParams.get('q')).toBe('zzzzfixture');
            }},
        {id: 'navigation', context: guest, current: f.packing.path, pilot: `/frontend-pilot${f.packing.path}`, title: f.packing.title,
            prepare: async page => {
                if (await page.getByRole('button', {name: labelName('Toggle navigation')}).isVisible()) {
                    await page.getByRole('button', {name: labelName('Toggle navigation')}).click();
                }
                // Native Bootstrap uses an anchor while Vue owns a disclosure summary. Open
                // the same account menu explicitly; a missing match must fail this scene.
                await page.getByText('Jamie Guest (Guest)', {exact: true}).click();
                await expect(page.getByRole('link', {name: labelName('Logout')})
                    .or(page.getByRole('button', {name: labelName('Logout')}))).toBeVisible();
            }},
        {id: 'account-navigation', context: organizer, current: f.packing.path, pilot: `/frontend-pilot${f.packing.path}`, title: f.packing.title,
            prepare: async page => {
                const toggle = page.getByRole('button', {name: labelName('Toggle navigation')});
                if (await toggle.isVisible()) await toggle.click();
                await page.getByText('Baseline organizer', {exact: true}).first().click();
                await expect(page.getByRole('link', {name: labelName('Your profiles')})).toBeVisible();
                await expect(page.getByRole('link', {name: labelName('Logout')})
                    .or(page.getByRole('button', {name: labelName('Logout')}))).toBeVisible();
            }},
    ];
    // The native dashboard also owns other business features. Its existing type filter
    // selects the same packing collection as this pilot without altering rendered DOM.
    const nativePackingOverview = '/users/dashboard?participant_main_type=packing&owner_main_type=packing';
    for (const overview of [
        {key: 'owner', context: organizer, query: '&participant_main_q=zzzzfixture&owner_main_q=Weekend%20equipment'},
        {key: 'owner-menu', context: organizer, query: '&participant_main_q=zzzzfixture&owner_main_q=Weekend%20equipment', menu: true},
        {key: 'guest', context: guest, query: '&participant_main_q=Weekend%20equipment'},
        {key: 'guest-menu', context: guest, query: '&participant_main_q=Weekend%20equipment', menu: true},
        {key: 'empty-results', context: organizer, query: '&participant_main_q=zzzzfixture&owner_main_q=zzzzfixture'},
        {key: 'hidden', context: organizer, query: '&participant_main_q=zzzzfixture&owner_main_q=zzzzfixture&owner_hidden_open=1&owner_hidden_type=packing&owner_hidden_q=Archived%20equipment'},
        {key: 'linked-hidden', context: organizer, query: `&participant_main_q=zzzzfixture&owner_main_q=zzzzfixture&owner_hidden_open=1&owner_hidden_type=packing&owner_hidden_event=${f.parent.id}`},
    ]) scenes.push({id: `packing-overview-${overview.key}`, context: overview.context,
        current: nativePackingOverview + overview.query, pilot: '/frontend-pilot?' + overview.query.slice(1),
        prepare: async page => {
            await expect(page.getByRole('heading', {name: labelName(overview.context === guest ? 'Welcome, Jamie Guest!' : 'Welcome, Baseline organizer!')})).toBeVisible();
            // Native regions retain an additional visually-hidden h3 for focus after AJAX
            // replacement. Target the visible collection heading without changing either DOM.
            await expect(page.getByRole('heading', {level: 2, name: labelName('Your participation')})).toBeVisible();
            if (overview.context !== guest) await expect(page.getByRole('heading', {level: 2, name: labelName('Administrable entities')})).toBeVisible();
            // Collection headings exist before the SPA request finishes. Wait for the
            // fixture's actual cards or filtered empty state before recording the view.
            const ownerMain = page.locator('.js-overview-region[data-collection="owner"][data-region="main"]');
            const participantMain = page.locator('.js-overview-region[data-collection="participant"][data-region="main"]');
            const ownerHidden = page.locator('.js-overview-region[data-collection="owner"][data-region="hidden"]');
            if (overview.key === 'owner' || overview.key === 'owner-menu') {
                await expect(ownerMain.locator(`.js-item[data-id="${f.packing.id}"]`)).toBeVisible();
            } else if (overview.key === 'guest' || overview.key === 'guest-menu') {
                await expect(participantMain.locator(`.js-item[data-id="${f.packing.id}"]`)).toBeVisible();
            } else if (overview.key === 'empty-results') {
                for (const region of [ownerMain, participantMain]) {
                    await expect(region.getByText('No entities match your search and filter.', {exact: true})).toBeVisible();
                }
            } else if (overview.key === 'hidden') {
                await expect(ownerHidden.locator(`.js-item[data-id="${f.archived.id}"]`)).toBeVisible();
            } else if (overview.key === 'linked-hidden') {
                const parent = ownerHidden.locator(`.js-item[data-id="${f.parent.id}"]`);
                await expect(parent).toBeVisible();
                await expect(parent.locator(`.entity-overview-children .js-item[data-id="${f.linked.id}"]`)).toBeVisible();
            }
            if (overview.menu) {
                const card = page.locator(`.js-item[data-id="${f.packing.id}"]`).first();
                await card.locator('summary').or(card.getByRole('button', {
                    name: labelName(`Archival and visibility for ${f.packing.title}`),
                })).click();
                await expect(card.getByText('Only my overview', {exact: true})).toBeVisible();
                await expect(card.getByRole('button', {name: labelName('Hide for me')})).toBeVisible();
                await expect(card.getByRole('button', {name: labelName('Show for me')})).toBeVisible();
                await waitForTransitions(page);
                if (page.viewportSize().width >= 768) {
                    // A full-page image can conceal an off-screen menu. Verify the actual
                    // viewport placement, especially owner menus close to its lower edge.
                    const menu = await card.locator('.dropdown-menu').boundingBox();
                    expect(menu.y).toBeGreaterThanOrEqual(0);
                    expect(menu.y + menu.height).toBeLessThanOrEqual(page.viewportSize().height);
                }
            }
        }});
    for (const role of f.roles) {
        const context = role.account ? account : guest;
        scenes.push({id: `packing-role-${role.key}`, context, current: role.list.path,
            pilot: `/frontend-pilot${role.list.path}`, title: role.list.title,
            prepare: async page => {
                await expect(page.getByRole('button', {name: labelName('Entity settings')})).toHaveCount(role.settings ? 1 : 0);
                const add = page.getByRole('button', {name: labelName('Add')});
                await expect(add).toHaveCount(role.preset || role.perms.includes('ITEM_ADD') ? 1 : 0);
                if (!role.preset) await expect(page.getByRole('button', {name: labelName('Take')})).toHaveCount(0);
            }});
        if (role.settings) scenes.push({id: `packing-role-${role.key}-settings`, context,
            current: role.list.path, pilot: `/frontend-pilot${role.list.path}`, title: role.list.title, viewportOnly: true,
            prepare: async page => {
                await page.getByRole('button', {name: labelName('Entity settings')}).click();
                const dialog = page.getByRole('dialog');
                await expect(dialog).toBeVisible();
                for (const name of ['title', 'description']) {
                    await expect(dialog.locator(`[name="${name}"]`)).toHaveCount(role.fields.includes(name) ? 1 : 0);
                }
                await expect(dialog.getByRole('button', {name: labelName('Delete permanently')})).toHaveCount(0);
                await expect(dialog.getByRole('link', {name: labelName('Duplicate'), includeHidden: true})).toHaveCount(role.account && (role.preset || role.perms.includes('DATA_DUPLICATE')) ? 1 : 0);
            }});
    }
    // A full administrator's landing view cannot stand in for the other settings panels.
    // Capture the public controls users actually open; no DOM mutation substitutes for a click.
    for (const panel of [
        {key: 'header', tab: 'General', disclosure: 'Header image'},
        {key: 'event', tab: 'Linked event'},
        {key: 'groups', tab: 'Access', subtab: 'Group Permissions'},
        {key: 'administrators', tab: 'Access', subtab: 'Administrators'},
        {key: 'actions', tab: 'Actions'},
    ]) {
        scenes.push({id: `packing-owner-settings-${panel.key}`, context: organizer, current: f.packing.path,
            pilot: `/frontend-pilot${f.packing.path}`, title: f.packing.title, viewportOnly: true,
            prepare: async page => {
                await page.getByRole('button', {name: labelName('Entity settings')}).click();
                const dialog = page.getByRole('dialog');
                await expect(dialog).toBeVisible();
                await dialog.getByRole('tab', {name: labelName(panel.tab)}).click();
                if (panel.subtab) await dialog.getByRole('tab', {name: labelName(panel.subtab)}).click();
                if (panel.disclosure) {
                    const summary = dialog.locator('summary').filter({hasText: new RegExp(`^${panel.disclosure}$`)});
                    if (await summary.locator('..').getAttribute('open') === null) await summary.click();
                    await dialog.getByLabel(labelName('Choose image')).scrollIntoViewIfNeeded();
                }
            }});
    }
    // Expanded controls and permission-specific actions need their own captures;
    // a closed panel does not show the administrator picker or the file actions.
    const permissionManager = f.roles.find(role => role.key === 'permission-manager');
    const guestAdmin = f.roles.find(role => role.key === 'guest-admin');
    for (const extra of [
        {key: 'administrators-add', list: f.packing, context: organizer, tab: 'Access', subtab: 'Administrators', add: true},
        {key: 'permission-manager-administrator', list: permissionManager.list, context: guest, tab: 'Access', subtab: 'Administrators', expandAdmin: true},
        {key: 'permission-manager-administrator-commands', list: permissionManager.list, context: guest, tab: 'Access', subtab: 'Administrators', expandAdmin: true, bottom: 'Save'},
        {key: 'guest-admin-actions', list: guestAdmin.list, context: guest, tab: 'Actions', guestActions: true},
        {key: 'existing-header', list: f.image, context: organizer, tab: 'General', header: true},
        {key: 'event-filters', list: f.packing, context: organizer, tab: 'Linked event', filters: true},
        // Viewport snapshots of long modal bodies need explicit lower-scroll states;
        // the initial panel alone cannot prove its off-screen command controls.
        {key: 'header-commands', list: f.packing, context: organizer, tab: 'General', header: true, bottom: 'Upload'},
        {key: 'existing-header-commands', list: f.image, context: organizer, tab: 'General', header: true, bottom: 'Remove image'},
        {key: 'groups-commands', list: f.packing, context: organizer, tab: 'Access', subtab: 'Group Permissions', bottom: 'Update permissions'},
        {key: 'event-filter-results', list: f.packing, context: organizer, tab: 'Linked event', filters: true, bottom: 'Save event link'},
    ]) {
        scenes.push({id: `packing-settings-${extra.key}`, context: extra.context, current: extra.list.path,
            pilot: `/frontend-pilot${extra.list.path}`, title: extra.list.title, viewportOnly: true,
            prepare: async page => {
                await page.getByRole('button', {name: labelName('Entity settings')}).click();
                const dialog = page.getByRole('dialog');
                await expect(dialog).toBeVisible();
                if (extra.expandAdmin) {
                    // This role has only Access, so both implementations omit top-level tabs.
                    await expect(dialog.locator('.entity-settings-nav')).toHaveCount(0);
                } else await dialog.getByRole('tab', {name: labelName(extra.tab)}).click();
                if (extra.subtab) await dialog.getByRole('tab', {name: labelName(extra.subtab)}).click();
                if (extra.add) {
                    await dialog.getByRole('button', {name: labelName('Add')}).click();
                    await expect(dialog.getByRole('heading', {name: labelName('Add administrator')})).toBeVisible();
                    await expect(dialog.getByLabel(labelName('User (name or email)'))).toBeVisible();
                }
                if (extra.expandAdmin) {
                    await dialog.locator('.admin-matrix .accordion-button').first().click();
                    await expect(dialog.getByRole('button', {name: labelName('Save')})).toBeVisible();
                }
                if (extra.guestActions) {
                    await expect(dialog.getByRole('link', {name: labelName('Duplicate')})).toHaveCount(0);
                    await expect(dialog.getByRole('button', {name: labelName('Delete permanently')})).toHaveCount(0);
                    await expect(dialog.getByRole('button', {name: labelName('Archive for everyone')})).toBeVisible();
                }
                if (extra.header) {
                    const summary = dialog.locator('summary').filter({hasText: /^Header image$/});
                    if (await summary.locator('..').getAttribute('open') === null) await summary.click();
                    if (extra.list.id === f.image.id) await expect(dialog.getByRole('button', {name: labelName('Remove image')})).toBeVisible();
                    await dialog.getByLabel(labelName('Choose image')).scrollIntoViewIfNeeded();
                }
                if (extra.filters) {
                    await dialog.locator('summary').filter({hasText: /^Filter by dates and state$/}).click();
                    await expect(dialog.getByLabel(labelName('From'))).toBeVisible();
                }
                if (extra.bottom) {
                    // Expansion can move a command after Playwright has scrolled it into view.
                    // Finish the real Bootstrap transition before choosing the scroll position.
                    await waitForTransitions(page);
                    const command = dialog.getByRole('button', {name: labelName(extra.bottom)});
                    await command.scrollIntoViewIfNeeded();
                    await expect(command).toBeInViewport({ratio: 1});
                }
            }});
    }
    scenes.push({id: 'packing-inline-capacity', context: organizer, current: f.packing.path,
        pilot: `/frontend-pilot${f.packing.path}`, title: f.packing.title,
        prepare: async page => {
            const row = page.locator(`tr[data-itemid="${f.tentItemId}"], tr[data-item-id="${f.tentItemId}"]`);
            await row.locator('td').nth(4).dblclick();
            await expect(row.getByRole('spinbutton')).toBeVisible();
        }});
    // Articles share a renderer, but their tables, images and heading layouts differ.
    // Capture every shipped article in both languages to check actual release content.
    const additionalHelpArticles = ['readme', 'getting_started', 'dashboard', 'surveys', 'events',
        'activity_plans', 'invoice_pools', 'drivers_lists', 'permissions'];
    for (const doc of additionalHelpArticles) scenes.push({id: `help-article-${doc}`, context: anonymous,
        current: `/help/${doc}?locale=en`, pilot: `/frontend-pilot/help?doc=${doc}&locale=en`});
    // Locale belongs to each route/request. Keep the German cases after the English ones so
    // their persisted anonymous cookie cannot accidentally translate an English comparison.
    scenes.push(
        {id: 'help-german-article', context: anonymous, current: '/help/packing_lists?locale=de', pilot: '/frontend-pilot/help?doc=packing_lists&locale=de'},
        {id: 'help-german-results', context: anonymous, current: '/help/search?q=Packliste&locale=de', pilot: '/frontend-pilot/help?q=Packliste&locale=de'},
        {id: 'help-german-native', context: native, current: '/help?locale=de', pilot: '/frontend-pilot/help?locale=de',
            prepare: async page => {
                await expect(page.locator('html')).toHaveAttribute('lang', 'de');
                await page.getByRole('searchbox').fill('zzzzfixture');
                await page.getByRole('button', {name: labelName('Hilfe durchsuchen')}).click();
                await expect(page.getByRole('heading', {name: labelName('Suchergebnisse')})).toBeVisible();
                expect(new URL(page.url()).searchParams.get('locale')).toBe('de');
            }},
    );
    for (const doc of additionalHelpArticles) scenes.push({id: `help-german-article-${doc}`, context: anonymous,
        current: `/help/${doc}?locale=de`, pilot: `/frontend-pilot/help?doc=${doc}&locale=de`});
    try {
        for (const scene of scenes) for (const viewport of viewports) {
            for (const implementation of ['current', 'pilot']) {
                const page = await scene.context.newPage();
                try {
                    if (scene.title) {
                        // Restore an identical checklist before each view; later behavior checks verify sharing.
                        await page.goto('/help');
                        await page.evaluate(id => localStorage.removeItem(`packed_${id.list}_${id.item}`), {list: f.packing.id, item: f.requiredItemId});
                    }
                    await capture(page, {id: `${phase}-${scene.id}-${implementation}`, role: scene.id,
                        path: scene[implementation], text: scene.title, viewportOnly: scene.viewportOnly}, viewport, async page => {
                            if (scene.title) await assertPackingLayout(page, scene.title);
                            if (scene.prepare) await scene.prepare(page);
                        });
                } finally { await page.close(); }
            }
        }
        // Exercise real native links as well as SSR content. Resolve the heading from the
        // rendered TOC so this check does not duplicate maintained guide wording or anchors.
        await captureGermanPilotLayouts({organizer, guest, account, anonymous}, phase);
        for (const locale of ['en', 'de']) for (const [implementation, articlePath] of [
            ['current', `/help/packing_lists?locale=${locale}`],
            ['pilot', `/frontend-pilot/help?doc=packing_lists&locale=${locale}`],
        ]) {
            const page = await native.newPage();
            try {
                await page.goto(articlePath, {waitUntil: 'networkidle'});
                await expect(page.locator('html')).toHaveAttribute('lang', locale);
                const link = page.getByRole('navigation', {name: labelName(locale === 'de' ? 'Auf dieser Seite' : 'On this page')}).getByRole('link').last();
                const href = await link.getAttribute('href');
                expect(href).toMatch(/^#.+/);
                await link.click();
                await expect(page).toHaveURL(url => url.hash === href);
                await expect(page.locator(`[id="${decodeURIComponent(href.slice(1))}"]`)).toBeInViewport();
                manifest.checks.push({name: `${phase} ${implementation} ${locale} help article anchor works with JavaScript disabled`, passed: true});
            } finally { await page.close(); }
        }
        const nativeCaptures = manifest.captures.filter(entry => entry.scene.startsWith(`${phase}-help-native-`));
        manifest.checks.push({name: `${phase} current and pilot help search submits with JavaScript disabled`,
            passed: nativeCaptures.length === viewports.length * 2 && nativeCaptures.every(entry => entry.status === 'captured')});
        const germanCaptures = manifest.captures.filter(entry => entry.scene.startsWith(`${phase}-help-german-native-`));
        manifest.checks.push({name: `${phase} current and pilot German help search preserves locale with JavaScript disabled`,
            passed: germanCaptures.length === viewports.length * 2 && germanCaptures.every(entry => entry.status === 'captured')});
    } finally { await anonymous.close(); await native.close(); await account.close(); }
}

/** Translated controls need layout proof as well as translated articles. Native packing
 * remains English: reuse its already captured, identical fixture as the visual reference
 * instead of pretending that a second native interface language has been implemented. */
async function captureGermanPilotLayouts(contexts, phase) {
    const f = manifest.fixtures;
    const words = JSON.parse(fs.readFileSync(path.join(workspace, 'src/locales/de.json'), 'utf8')).resources.ui;
    const packing = words.packing;
    const scenes = [];
    async function settings(page) {
        await page.getByRole('button', {name: labelName(packing.edit)}).click();
        await expect(page.getByRole('dialog')).toBeVisible();
        return page.getByRole('dialog');
    }
    for (const role of f.roles) {
        const context = role.account ? contexts.account : contexts.guest;
        scenes.push({id: `packing-role-${role.key}`, context, path: `/frontend-pilot${role.list.path}`,
            prepare: async page => {
                await expect(page.getByRole('heading', {name: labelName(role.list.title)})).toBeVisible();
                await expect(page.getByRole('button', {name: labelName(packing.edit)})).toHaveCount(role.settings ? 1 : 0);
                await expect(page.getByRole('button', {name: labelName(packing.add)}))
                    .toHaveCount(role.preset || role.perms.includes('ITEM_ADD') ? 1 : 0);
                if (!role.preset) await expect(page.getByRole('button', {name: labelName(packing.assign)})).toHaveCount(0);
            }});
        if (role.settings) scenes.push({id: `packing-role-${role.key}-settings`, context,
            path: `/frontend-pilot${role.list.path}`, viewportOnly: true,
            prepare: async page => {
                const dialog = await settings(page);
                for (const name of ['title', 'description']) {
                    await expect(dialog.locator(`[name="${name}"]`)).toHaveCount(role.fields.includes(name) ? 1 : 0);
                }
            }});
    }
    for (const [id, context] of [['owner', contexts.organizer], ['guest', contexts.guest]]) {
        scenes.push({id: `packing-${id}`, context, path: `/frontend-pilot${f.packing.path}`,
            prepare: async page => {
                await expect(page.getByRole('heading', {name: labelName(f.packing.title)})).toBeVisible();
                await expect(page.locator('tbody tr')).toHaveCount(3);
            }});
    }
    for (const panel of [
        {key: 'header', tab: 'general', disclosure: 'headerImage'},
        {key: 'event', tab: 'linkedEvent'},
        {key: 'groups', tab: 'access', subtab: 'groupPermissions'},
        {key: 'administrators', tab: 'access', subtab: 'administrators'},
        {key: 'actions', tab: 'actions'},
    ]) scenes.push({id: `packing-owner-settings-${panel.key}`, context: contexts.organizer,
        path: `/frontend-pilot${f.packing.path}`, viewportOnly: true,
        prepare: async page => {
            const dialog = await settings(page);
            await dialog.getByRole('tab', {name: labelName(packing[panel.tab])}).click();
            if (panel.subtab) await dialog.getByRole('tab', {name: labelName(packing[panel.subtab])}).click();
            if (panel.disclosure) {
                const summary = dialog.locator('summary').filter({hasText: labelName(packing[panel.disclosure])});
                if (await summary.locator('..').getAttribute('open') === null) await summary.click();
                await dialog.getByLabel(labelName(packing.chooseImage)).scrollIntoViewIfNeeded();
            }
        }});
    for (const copy of [false, true]) scenes.push({id: copy ? 'packing-duplicate' : 'packing-create',
        context: contexts.organizer, path: copy ? `/frontend-pilot${f.packing.path}/duplicate` : '/frontend-pilot/packing/create',
        prepare: async page => {
            await expect(page.getByRole('heading', {name: labelName(packing.create)})).toBeVisible();
            await expect(page.getByRole('button', {name: labelName(packing.createList)})).toBeVisible();
            await expect(page.locator('tbody tr')).toHaveCount(copy ? 3 : 1);
        }});
    scenes.push({id: 'packing-create-event-picker', context: contexts.organizer, path: '/frontend-pilot/packing/create', viewportOnly: true,
        prepare: async page => {
            await page.getByRole('button', {name: labelName(packing.assignEvent)}).click();
            await expect(page.getByRole('dialog').getByRole('searchbox')).toBeFocused();
            await expect(page.getByRole('dialog').getByRole('list', {name: labelName(packing.availableEvents)})).toBeVisible();
        }});
    for (const [id, context, collection, query] of [
        ['owner', contexts.organizer, 'owner', 'participant_main_q=zzzzfixture&owner_main_q=Weekend%20equipment'],
        ['guest', contexts.guest, 'participant', 'participant_main_q=Weekend%20equipment'],
    ]) scenes.push({id: `packing-overview-${id}`, context, path: `/frontend-pilot?${query}`,
        prepare: async page => {
            await expect(page.locator(`[data-collection="${collection}"][data-region="main"] .js-item[data-id="${f.packing.id}"]`)).toBeVisible();
        }});
    for (const [id, pathname, field] of [
        ['packing-anonymous-entry', `/frontend-pilot${f.packing.path}`, 'email'],
        ['packing-guest-recovery', '/frontend-pilot/users/login', 'email'],
        ['identity-register', '/frontend-pilot/users/register', 'password'],
        ['identity-forgot', '/frontend-pilot/users/forgot-password', 'username'],
    ]) scenes.push({id, context: contexts.anonymous, path: pathname,
        prepare: async page => {
            const selector = field === 'email' ? 'input[type="email"]' : `input[name="${field}"]`;
            await expect(page.locator(selector).first()).toBeVisible();
        }});
    for (const [id, context, name] of [
        ['navigation', contexts.guest, 'Jamie Guest'],
        ['account-navigation', contexts.organizer, 'Baseline organizer'],
    ]) scenes.push({id, context, path: `/frontend-pilot${f.packing.path}`,
        prepare: async page => {
            const toggle = page.getByRole('button', {name: labelName(words.app.toggleNavigation)});
            if (await toggle.isVisible()) await toggle.click();
            await page.locator('.pilot-nav-dropdown > summary').filter({hasText: name}).click();
            await expect(page.getByRole('button', {name: labelName(words.app.logout)})).toBeVisible();
        }});
    for (const scene of scenes) for (const viewport of viewports) {
        const reference = `${phase}-${scene.id}-current-${viewport.name}.png`;
        expect(manifest.captures.some(entry => entry.file === reference && entry.status === 'captured'),
            'A translated layout must retain its actual native fixture reference').toBe(true);
        const page = await scene.context.newPage();
        try {
            await page.goto('/help');
            await page.evaluate(value => localStorage.removeItem(value), `packed_${f.packing.id}_${f.requiredItemId}`);
            await capture(page, {id: `${phase}-${scene.id}-german-pilot`, role: 'German pilot layout',
                path: scene.path + (scene.path.includes('?') ? '&' : '?') + 'locale=de',
                viewportOnly: scene.viewportOnly, nativeBaseline: reference}, viewport, async current => {
                await expect(current.locator('html')).toHaveAttribute('lang', 'de');
                await scene.prepare(current);
            });
        } finally { await page.close(); }
    }
}

/** Ordinary self-membership and checklist behavior are compared through both actual browser pages. */
async function comparePilotBehavior(guest) {
    const f = manifest.fixtures;
    const page = await guest.newPage();
    try {
        await page.goto(f.packing.path, {waitUntil: 'networkidle'});
        const legacyRow = page.locator(`tr[data-itemid="${f.tentItemId}"]`);
        await legacyRow.getByRole('button', {name: labelName('Remove')}).click();
        await expect(legacyRow.getByRole('button', {name: labelName('Take')})).toBeVisible();
        await page.goto(`/frontend-pilot${f.packing.path}`, {waitUntil: 'networkidle'});
        const pilotRow = page.locator(`tr[data-item-id="${f.tentItemId}"]`);
        await expect(pilotRow.getByRole('button', {name: labelName('Take')})).toBeVisible();
        await pilotRow.getByRole('button', {name: labelName('Take')}).click();
        await expect(pilotRow.getByRole('button', {name: labelName('Remove')})).toBeVisible();
        await pilotRow.getByRole('checkbox').check();
        await page.goto(f.packing.path, {waitUntil: 'networkidle'});
        await expect(legacyRow.getByRole('button', {name: labelName('Remove')})).toBeVisible();
        await expect(legacyRow.getByRole('checkbox')).toBeChecked();
        await legacyRow.getByRole('checkbox').uncheck();
        await page.goto(`/frontend-pilot${f.packing.path}`, {waitUntil: 'networkidle'});
        await expect(pilotRow.getByRole('checkbox')).not.toBeChecked();
        manifest.checks.push({name: 'same guest membership and canonical Packed state across current/pilot routes', passed: true});

        // An Everyone item with existing membership is removable in both UIs. Recreate the
        // fixture through the real endpoint between checks; the UI intentionally offers no Take.
        for (const [implementation, listPath] of [['current', f.everyone.path], ['pilot', `/frontend-pilot${f.everyone.path}`]]) {
            await page.goto(listPath, {waitUntil: 'networkidle'});
            const row = page.locator('tbody tr').filter({hasText: 'Personal water bottle'});
            await row.getByRole('button', {name: labelName('Remove')}).click();
            await expect(row.getByRole('button', {name: labelName('Remove')})).toHaveCount(0);
            await expect(row.getByRole('button', {name: labelName('Take')})).toHaveCount(0);
            await expect(row.locator('td').last().getByText('Everyone', {exact: true})).toBeVisible();
            await row.getByRole('checkbox').check();
            await page.reload({waitUntil: 'networkidle'});
            await expect(row.getByRole('checkbox')).toBeChecked();
            await expect(row).toHaveClass(/\btable-success\b/);
            await row.getByRole('checkbox').uncheck();
            await expect(row).toHaveClass(/\btable-info\b/);
            const actor = await (await guest.request.get('/api/v1/session')).json();
            const state = await (await guest.request.get(`/api/v1/packing-lists/${f.everyone.id}`, {
                headers: {'X-Surveyor-Context': actor.context},
            })).json();
            expect(state.counters).toEqual({participants: 0, open: 0, empty: 0});
            expect(state.items[0]).toMatchObject({requiredByAll: true, selfAssigned: false, assignedCount: 0});
            await command(guest.request, `/api/packing/${f.everyone.id}/assign`, {itemId: f.everyoneItemId});
            manifest.checks.push({name: `${implementation} Everyone membership removes without offering Take; Packed persists and counters exclude Everyone`, passed: true});
        }
    } finally { await page.close(); }
}

/** Receive a real controller-generated mail link without persisting its capability. */
async function takeIdentityMail(kind, address) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
        const index = identityMail.findIndex(message => message.kind === kind && message.address === address);
        if (index >= 0) return identityMail.splice(index, 1)[0].link;
        await delay(25);
    }
    throw new Error(`Expected ${kind} delivery at the capture mail boundary.`);
}

/**
 * Use distinct accounts for each renderer/viewport because activation and reset links
 * are single-use. Only mail delivery is replaced: every form and token comes from a
 * production HTTP/controller workflow in the preflight-verified disposable schema.
 */
async function captureIdentityFeedback(browser, phase) {
    for (const viewport of viewports) {
        for (const implementation of ['current', 'pilot']) {
            const context = await browser.newContext({baseURL, locale: 'en-GB', timezoneId: 'UTC'});
            const page = await context.newPage();
            observeCapturePage(page);
            const prefix = implementation === 'pilot' ? '/frontend-pilot' : '';
            const username = `capture-identity-${randomUUID().slice(0, 8)}`;
            const email = `${username}@example.test`;
            const password = `Capture-${randomUUID()}-8`;
            async function scene(id, pathname, prepare, expectedStatus = 200) {
                await capture(page, {id: `${phase}-identity-${id}-${implementation}`, role: 'anonymous identity',
                    path: pathname, expectedStatus}, viewport, prepare);
                if (manifest.captures.at(-1).status !== 'captured') {
                    throw new Error(`Identity ${id} scene failed; dependent token scenes were not attempted.`);
                }
            }
            async function submitReset(mismatch = false) {
                await page.locator('#password').fill(password);
                await page.locator('#confirmPassword, #password-repeat').fill(mismatch ? password + '-different' : password);
                await page.getByRole('button', {name: labelName('Change password')}).click();
            }
            try {
                await scene('registration-success', `${prefix}/users/register`, async () => {
                    await page.locator('#username').fill(username);
                    await page.locator('#displayname').fill('Identity example');
                    await page.locator('#email').fill(email);
                    await page.locator('#password').fill(password);
                    await page.locator('#password_repeat, #password-repeat').fill(password);
                    await page.getByRole('button', {name: labelName('Register')}).click();
                    await expect(page.getByText('Account successfully registered. Please activate it using the link sent to your email.', {exact: true})).toBeVisible();
                });
                const activation = new URL(await takeIdentityMail('activation', email));
                expect(activation.pathname.startsWith(`${prefix}/users/activate/`)).toBe(true);
                await scene('activation-success', activation.pathname + activation.search, async () => {
                    try {
                        await expect(page.getByText(/^Account successfully activated\.?$/)).toBeVisible();
                    } catch (error) {
                        // Retain the real page for diagnosis; filenames never contain the
                        // activation capability, and the form does not show its token.
                        await page.screenshot({path: path.join(output,
                            `${phase}-identity-activation-observed-${implementation}-${viewport.name}.png`), fullPage: true});
                        throw error;
                    }
                });
                await scene('forgot-success', `${prefix}/users/forgot-password`, async () => {
                    await page.locator('#username').fill(username);
                    await page.getByRole('button', {name: labelName('Send reset link')}).click();
                    await expect(page.getByText('A link has been sent to the email corresponding to this account (if present).', {exact: true})).toBeVisible();
                });
                const reset = new URL(await takeIdentityMail('reset', email));
                expect(reset.pathname.startsWith(`${prefix}/users/reset-password/`)).toBe(true);
                await scene('reset-valid', reset.pathname + reset.search, async () => {
                    await expect(page.getByRole('heading', {name: labelName('Reset your password')})).toBeVisible();
                    await expect(page.locator('#password')).toBeVisible();
                    await expect(page.locator('#confirmPassword, #password-repeat')).toBeVisible();
                });
                await scene('reset-mismatch', reset.pathname + reset.search, async () => {
                    await submitReset(true);
                    await expect(page.getByText('Passwords do not match!', {exact: true})).toBeVisible();
                });
                await scene('reset-success', reset.pathname + reset.search, async () => {
                    await submitReset();
                    await expect(page.getByText(/^Your password has been successfully reset\.?$/)).toBeVisible();
                });
                await scene('reset-used', reset.pathname + reset.search, async () => {
                    // Both initial routes deny a real consumed capability before revealing
                    // a password form. SPA admission uses the same controller read.
                    await expect(page.locator('#password')).toHaveCount(0);
                    await expect(page.getByText(implementation === 'pilot'
                        ? 'This link is invalid, expired, or already used.' : 'Invalid or expired token', {exact: true})).toBeVisible();
                }, 401);
                await scene('login-error', `${prefix}/users/login`, async () => {
                    await page.locator('#username').fill(username);
                    await page.locator('#password').fill(password + '-incorrect');
                    await page.getByRole('button', {name: labelName('Login')}).click();
                    await expect(page.getByText(/^Invalid username\/email or password\.?$/)).toBeVisible();
                });
                manifest.checks.push({name: `${implementation} ${viewport.name} identity feedback uses real single-use mail links`, passed: true});
            } catch (error) {
                manifest.checks.push({name: `${implementation} ${viewport.name} identity feedback`, passed: false,
                    error: redactCaptureText(error.message)});
            } finally { await context.close(); }
        }
    }
}

/** Wait for finite layout transitions; perpetual indicators must not block capture. */
async function waitForTransitions(page) {
    await page.waitForFunction(() => !document.querySelector('.collapsing')
        && !document.getAnimations().some(animation => animation.playState === 'running'
            && animation.effect?.getTiming().iterations !== Infinity));
}

/** Record a complete rendered state, including viewport overflow and loaded external stylesheet evidence. */
async function capture(page, scene, viewport, prepare) {
    const entry = {scene: scene.id, viewport: viewport.name, role: scene.role || 'organizer', path: redactCaptureText(scene.path),
        captureMode: scene.viewportOnly ? 'viewport' : 'full-page', status: 'incomplete'};
    if (scene.nativeBaseline) entry.nativeBaseline = scene.nativeBaseline;
    manifest.captures.push(entry);
    try {
        await page.setViewportSize({width: viewport.width, height: viewport.height});
        const response = await page.goto(scene.path, {waitUntil: 'networkidle'});
        expect(response.status()).toBe(scene.expectedStatus ?? 200);
        if (scene.text) await expect(page.getByText(scene.text, {exact: true}).first()).toBeVisible();
        if (prepare) await prepare(page);
        await page.evaluate(() => document.fonts.ready);
        // Bootstrap collapse takes longer than an arbitrary screenshot delay. Wait for finite
        // transitions before measuring the full page so its footer cannot be cut off mid-frame.
        await waitForTransitions(page);
        entry.render = await page.evaluate(() => ({title: document.title, language: document.documentElement.lang,
            viewportWidth: innerWidth, documentWidth: document.documentElement.scrollWidth,
            documentHeight: document.documentElement.scrollHeight,
            bootstrapLoaded: Array.from(document.styleSheets).some(sheet => sheet.href?.includes('bootstrap@'))}));
        entry.file = `${scene.id}-${viewport.name}.png`;
        // Fixed-position dialogs must be captured at the actual viewport, not stitched into a taller document.
        const screenshot = await page.screenshot({path: path.join(output, entry.file), fullPage: !scene.viewportOnly, animations: 'disabled'});
        entry.image = {width: screenshot.readUInt32BE(16), height: screenshot.readUInt32BE(20)};
        if (!scene.viewportOnly) expect(entry.image.height).toBeGreaterThanOrEqual(entry.render.documentHeight - 1);
        // A full-page screenshot can silently grow wider than the viewport. Retain
        // that image as evidence, but reject overflow in every page family.
        expect(entry.render.documentWidth, 'Horizontal overflow must stay inside its own scroll container')
            .toBeLessThanOrEqual(entry.render.viewportWidth + 1);
        entry.status = 'captured';
        console.log(`Captured ${entry.file}`);
    } catch (error) {
        entry.status = 'failed';
        entry.error = redactCaptureText(error.message);
        console.log(`Failed ${scene.id} (${viewport.name}): ${entry.error.split('\n')[0]}`);
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
    let server = startCaptureServer(log);
    let browser;
    try {
        await waitForServer(server);
        browser = await chromium.launch({headless: true});
        manifest.browser = browser.version();
        if (identityOnly) {
            await captureIdentityFeedback(browser, 'comparison');
            expect(buildFingerprint(), 'Selected runtime inputs stay frozen during identity capture').toEqual(manifest.build);
        } else {
            const organizer = await browser.newContext({baseURL, locale: 'en-GB', timezoneId: 'UTC'});
            const guest = await browser.newContext({baseURL, locale: 'en-GB', timezoneId: 'UTC'});
            for (const context of [organizer, guest]) {
                context.on('page', observeCapturePage);
            }
            await loginForE2E(organizer.request, {username: captureEnv.E2E_ADMIN_USERNAME, password: captureEnv.E2E_ADMIN_PASSWORD});
            const setupPage = await organizer.newPage();
            await selectSyntheticProfile(setupPage);
            await setupPage.close();
            if (pilotComparison) {
                await seedPilotFixtures(organizer, guest);
                await capturePilotScenes(browser, organizer, guest,
                    process.env.FRONTEND_BASELINE_TWO_PHASE === '1' ? 'before' : 'comparison');
                await captureIdentityFeedback(browser, process.env.FRONTEND_BASELINE_TWO_PHASE === '1' ? 'before' : 'comparison');
                await comparePilotBehavior(guest);
                expect(buildFingerprint(), 'Selected runtime inputs stay frozen during a comparison phase').toEqual(manifest.build);
                fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
                writeGallery();
                // The optional two-phase mode retains actors/data while the caller rebuilds source.
                // Its signal is task control, not a hand-edited screenshot or verification result.
                if (process.env.FRONTEND_BASELINE_TWO_PHASE === '1') {
                    const signal = path.join(output, 'rebuild.ready');
                    console.log(`INITIAL_CAPTURE_COMPLETE ${output}`);
                    const deadline = Date.now() + 30 * 60 * 1000;
                    while (!fs.existsSync(signal)) {
                        if (Date.now() > deadline) throw new Error('Timed out waiting for the comparison rebuild.');
                        await delay(1000);
                    }
                    const exited = new Promise(resolve => server.once('close', resolve));
                    server.kill();
                    await exited;
                    manifest.afterBuild = buildFingerprint();
                    server = startCaptureServer(log);
                    await waitForServer(server);
                    await capturePilotScenes(browser, organizer, guest, 'after');
                    await captureIdentityFeedback(browser, 'after');
                    await comparePilotBehavior(guest);
                    expect(buildFingerprint(), 'Selected runtime inputs stay frozen during the second phase').toEqual(manifest.afterBuild);
                }
            } else {
                await seedFixtures(organizer, guest);
                await captureScenes(browser, organizer, guest);
            }
        }
        expect(manifest.browserErrors, 'No JavaScript or caught framework rendering errors').toEqual([]);
        expect(manifest.assetFailures, 'Document-emitted frontend assets load executable modules and styles').toEqual([]);
        manifest.checks.push({name: 'captured build fingerprints remain frozen; no browser rendering errors', passed: true});
        manifest.status = manifest.captures.every(entry => entry.status === 'captured')
            && manifest.checks.every(entry => entry.passed) ? 'captured-awaiting-visual-review' : 'partial';
        if (manifest.status === 'partial') process.exitCode = 1;
    } catch (error) {
        manifest.error = redactCaptureText(error.message);
        process.exitCode = 1;
        console.error(manifest.error);
    } finally {
        try {
            if (browser) await browser.close();
        } finally {
            if (server.exitCode === null && server.signalCode === null) {
                const exited = new Promise(resolve => server.once('close', resolve));
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
    function captureCard(entry, heading = entry.scene) {
        return `<article><h2>${escape(heading)} · ${escape(entry.viewport)}</h2>
        <p>${escape(entry.role)} · ${escape(entry.status)}</p>${entry.file
        ? `<a href="${escape(entry.file)}"><img loading="lazy" src="${escape(entry.file)}" alt="${escape(entry.scene)} ${escape(entry.viewport)}"></a>`
        : `<p>${escape(entry.error || 'Not captured')}</p>`}</article>`;
    }
    const pairs = new Map();
    for (const entry of manifest.captures) {
        const match = entry.scene.match(/^(before|after|comparison)-(.+)-(current|pilot)$/);
        if (!match) continue;
        const key = `${match[1]} · ${match[2]} · ${entry.viewport}`;
        if (!pairs.has(key)) pairs.set(key, {});
        pairs.get(key)[match[3]] = entry;
        if (entry.nativeBaseline) pairs.get(key).current = manifest.captures.find(candidate => candidate.file === entry.nativeBaseline);
    }
    const cards = pairs.size ? [...pairs].map(([heading, entries]) => `<section><h2>${escape(heading)}</h2>
        <div class="pair">${entries.current ? captureCard(entries.current, 'Current implementation') : ''}
        ${entries.pilot ? captureCard(entries.pilot, 'Frontend pilot') : ''}</div></section>`).join('\n')
        : manifest.captures.map(entry => captureCard(entry)).join('\n');
    fs.writeFileSync(path.join(output, 'index.html'), `<!doctype html><html lang="en"><meta charset="utf-8">
        <meta name="viewport" content="width=device-width,initial-scale=1"><title>Surveyor frontend baseline</title>
        <style>body{font:16px system-ui;background:#15171b;color:#eee;margin:2rem}main{display:grid;gap:1rem}article{padding:1rem;background:#252932;border-radius:8px}.pair{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}h2{font-size:1rem}img{width:100%;max-height:900px;object-fit:contain;object-position:top}a{color:#aaf}@media(max-width:700px){.pair{grid-template-columns:1fr}}</style>
        <h1>Surveyor frontend baseline</h1><p>${escape(manifest.runId)} · ${escape(manifest.status)}</p>
        <p>Click an image to inspect its original size. <a href="manifest.json">Capture manifest</a></p><main>${cards}</main></html>`);
}

if (galleryOnly) writeGallery();
else main().catch(error => { console.error(redactCaptureText(error.message)); process.exitCode = 1; });
