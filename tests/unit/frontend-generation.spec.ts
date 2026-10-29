import {describe, expect, it} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync, spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import YAML from 'yaml';
import type {ApiContractManifest} from '../../src/types/ApiTransportTypes';

const root = process.cwd();
const artifacts = ['.generated/api/v1/openapi.json', '.generated/api/v1/operations.json',
    '.generated/api/v1/server.cjs', '.generated/api/v1/browser.mjs',
    '.generated/api/v1/server.d.cts', '.generated/api/v1/browser.d.mts',
    'src/types/api/v1.d.ts', 'src/types/api/validation-v1.d.ts', 'src/types/LocalizationTypes.d.ts',
    'src/common/localization/generated/resources.json', 'src/common/localization/generated/manifest.json',
    'src/common/localization/generated/permissions.ts', '.generated/api/v1/policy.mjs',
    'src/common/generated/domainChoices.ts',
    'src/common/generated/passwordPolicy.ts',
    '.generated/api/v1/browser/validatePackingListView.mjs', '.generated/api/v1/browser/validateRegistrationInput.mjs'];

/** Run the real generators in an empty output tree; never substitute hand-authored validators. */
function generate(script: string, arguments_: string[], sourceRoot = root): void {
    execFileSync(process.execPath, [path.join(sourceRoot, 'scripts', script), ...arguments_], {cwd: sourceRoot, stdio: 'pipe'});
}

/** Copy the real generation inputs into one owned tree. Both watcher and
 * contract-authoring fixtures share this setup without changing authored sources. */
async function prepareGenerationTree(directory: string): Promise<void> {
    // Installed dependencies remain read-only behind the one explicit junction.
    // Remove that link separately after child processes close, before tree cleanup.
    await fs.mkdir(path.join(directory, 'scripts'), {recursive: true});
    for (const script of ['watch-frontend-inputs.mjs', 'generate-api.mjs', 'generate-locales.mjs']) {
        await fs.copyFile(path.join(root, 'scripts', script), path.join(directory, 'scripts', script));
    }
    await fs.cp(path.join(root, 'contracts/api/v1'), path.join(directory, 'contracts/api/v1'), {recursive: true});
    await fs.cp(path.join(root, 'src/common/locales'), path.join(directory, 'src/common/locales'), {recursive: true});
    await fs.mkdir(path.join(directory, 'src/common/lib'), {recursive: true});
    await fs.copyFile(path.join(root, 'src/common/lib/utf8.ts'), path.join(directory, 'src/common/lib/utf8.ts'));
    await fs.mkdir(path.join(directory, 'src/backend/modules/lib'), {recursive: true});
    await fs.copyFile(path.join(root, 'src/backend/modules/lib/permissions.ts'), path.join(directory, 'src/backend/modules/lib/permissions.ts'));
    await fs.mkdir(path.join(directory, 'src/backend/modules/invoice/locales'), {recursive: true});
    await fs.copyFile(path.join(root, 'src/backend/modules/invoice/locales/en.ts'), path.join(directory, 'src/backend/modules/invoice/locales/en.ts'));
    await fs.symlink(path.join(root, 'node_modules'), path.join(directory, 'node_modules'),
        process.platform === 'win32' ? 'junction' : 'dir');
}

/** Exercise watcher scheduling with a bounded slice of the actual authored API.
 * All lifecycle batches still run the real API/catalog generators. Full-contract
 * compilation, transport and deterministic output remain covered by the other cases. */
async function prepareWatcherTree(directory: string): Promise<void> {
    // Copy the same scripts, catalogs and permission registry as the complete
    // fixture. Only this detached tree's OpenAPI entry is narrowed afterward.
    await prepareGenerationTree(directory);
    const source = path.join(directory, 'contracts/api/v1/openapi.yaml');
    const contract = YAML.parseDocument(await fs.readFile(source, 'utf8'));
    const session = contract.getIn(['paths', '/session']);
    const sessionOwner = YAML.parseDocument(await fs.readFile(path.join(directory, 'contracts/api/v1/session.yaml'), 'utf8'));
    const sessionRead = sessionOwner.getIn(['paths', '/session', 'get']);
    const locale = contract.getIn(['components', 'parameters', 'Locale']);
    const problem = contract.getIn(['components', 'schemas', 'Problem']);
    const sessionView = contract.getIn(['components', 'schemas', 'SessionView']);
    const localeTag = contract.getIn(['components', 'schemas', 'LocaleTag']);
    if (![session, sessionRead, locale, problem, sessionView, localeTag].every(YAML.isMap)) {
        throw new Error('Watcher fixture requires the actual session operation and its authored components.');
    }

    // Retain authored references instead of inventing wire shapes or validators.
    // External session/problem schemas keep their complete dependency graphs;
    // unused parameters must leave with their otherwise unreferenced root aliases.
    contract.set('paths', {'/session': session});
    contract.setIn(['components', 'parameters'], {Locale: locale});
    contract.setIn(['components', 'schemas'], {Problem: problem, SessionView: sessionView, LocaleTag: localeTag});
    await fs.writeFile(source, contract.toString());
}

/** Remove only the fixture's dependency link; never recursively follow it. */
async function removeDependencyLink(directory: string): Promise<void> {
    try {
        await fs.unlink(path.join(directory, 'node_modules'));
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
}

/** Temporary directories originate from mkdtemp and cleanup cannot escape that named test directory. */
async function removeTemporary(directory: string): Promise<void> {
    const resolved = path.resolve(directory);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('surveyor-generation-')) {
        throw new Error('Refusing unexpected generation test cleanup path');
    }
    // Callers have already settled their generator processes and released links.
    // Bound Windows filesystem-release retries rather than hiding a live child.
    await fs.rm(resolved, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
}

/** Request test-owned generator draining over IPC, then await stdio closure.
 * Windows process signals can terminate a parent before its children stop, so
 * this fixture never uses a process-tree kill or touches another Node process. */
async function stopWatcher(watcher: ReturnType<typeof spawn>): Promise<void> {
    if (watcher.exitCode !== null || watcher.signalCode !== null) return;
    await new Promise<void>(requestWatcherStop);

    function requestWatcherStop(resolve: () => void, reject: (error: Error) => void): void {
        // Generators finish their own synchronous subprocesses before the preload
        // emits the production stop event. Parent close then settles streams/cwd.
        const timer = setTimeout(stopExpired, 30_000);
        watcher.once('close', watcherClosed);
        watcher.once('error', stopFailed);
        watcher.send({kind: 'stop-watcher'}, sentStop);

        function watcherClosed(): void { finish(); resolve(); }
        function stopFailed(error: Error): void { finish(); reject(error); }
        function stopExpired(): void { stopFailed(new Error('Owned generator watcher did not finish cleanup within 30 seconds.')); }
        function sentStop(error: Error | null): void { if (error) stopFailed(error); }
        function finish(): void {
            clearTimeout(timer);
            watcher.off('close', watcherClosed);
            watcher.off('error', stopFailed);
        }
    }
}

/** Read a watcher result while its asynchronous generator may not have published it yet. */
async function readOptionalFile(filename: string): Promise<string | null> {
    try {
        return await fs.readFile(filename, 'utf8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
    }
}

/** Hold the actual readiness write in a detached watcher process. Real directory
 * callbacks run first and report their completion, making a newer known save
 * deterministic without replacing either generator or accessing watcher state. */
function readinessPublicationGate(): string {
    return String.raw`
import filesystem from 'node:fs';
import promises from 'node:fs/promises';
import path from 'node:path';
import {syncBuiltinESMExports} from 'node:module';
import childProcess from 'node:child_process';

const writeFile = promises.writeFile.bind(promises);
const renameSync = filesystem.renameSync.bind(filesystem);
const watch = filesystem.watch.bind(filesystem);
const spawn = childProcess.spawn.bind(childProcess);
const generators = new Set();
let firstReadinessWrite = true;
let firstReadinessRename = true;
let retainedMarker;
let release;
let stopRequested = false;
let stopping = false;

// Observe only actual generators launched inside this detached fixture. No
// production command, generator output or readiness policy is substituted.
childProcess.spawn = function observeGenerator(command, arguments_, options) {
    const generator = spawn(command, arguments_, options);
    const script = arguments_?.[0];
    if (command === process.execPath && options?.cwd === process.cwd()
        && ['generate-api.mjs', 'generate-locales.mjs'].includes(path.basename(script ?? ''))
        && path.dirname(script) === path.join(process.cwd(), 'scripts')) {
        generators.add(generator);
        process.send({kind: 'generator-started', script: path.basename(script)});
        generator.once('close', generatorClosed);
    }
    return generator;

    function generatorClosed(code) {
        generators.delete(generator);
        process.send({kind: 'generator-closed', script: path.basename(script), code});
        finishDrain();
        finishStop();
    }
};

// Delay only the first readiness artifact, whether published directly or staged
// beside it. Generator subprocesses do not inherit this process-only preload.
promises.writeFile = async function holdReadiness(filename, ...arguments_) {
    const target = path.resolve(String(filename));
    if (firstReadinessWrite && path.dirname(target) === path.join(process.cwd(), '.generated')
        && path.basename(target).startsWith('frontend-ready')) {
        firstReadinessWrite = false;
        const released = new Promise(function awaitRelease(resolve) { release = resolve; });
        process.send({kind: 'readiness-held'});
        await released;
    }
    return writeFile(filename, ...arguments_);
};

// Observe real input delivery after the production callback has already queued
// its next batch. IPC cannot release publication before that callback finishes.
filesystem.watch = function observeInput(directory, options, listener) {
    const callback = typeof options === 'function' ? options : listener;
    const watchOptions = typeof options === 'function' ? undefined : options;
    return watch(directory, watchOptions, inputObserved);

    function inputObserved(event, filename) {
        callback.call(this, event, filename);
        if (path.resolve(String(directory)) === path.join(process.cwd(), 'src/backend/modules/lib')
            && filename?.toString() === 'permissions.ts') process.send({kind: 'permission-observed'});
    }
};

// Fail one actual marker replacement at its filesystem boundary. The real
// watcher must retry publication alone, without rerunning either generator or
// removing the previously published marker. All other renames remain native.
filesystem.renameSync = function failTransientReadinessRename(source, destination, ...arguments_) {
    const target = path.resolve(String(destination));
    const readiness = target === path.join(process.cwd(), '.generated/frontend-ready.json');
    if (readiness && firstReadinessRename && filesystem.existsSync(target)) {
        firstReadinessRename = false;
        retainedMarker = filesystem.readFileSync(target, 'utf8');
        process.send({kind: 'readiness-rename-blocked'});
        throw Object.assign(new Error('Fixture transient readiness-marker sharing violation'), {code: 'EPERM'});
    }
    if (readiness && retainedMarker !== undefined) {
        if (!filesystem.existsSync(target) || filesystem.readFileSync(target, 'utf8') !== retainedMarker) {
            throw new Error('Readiness retry must retain the previous marker until atomic replacement');
        }
        retainedMarker = undefined;
    }
    const result = renameSync(source, destination, ...arguments_);
    if (readiness) process.send({kind: 'readiness-renamed'});
    return result;
};
syncBuiltinESMExports();

function receiveRelease(message) {
    if (message.kind === 'release-readiness') release?.();
    // Let actual generators finish their own Redocly/esbuild work. Killing their
    // Node parent early would not prove that its subprocesses released this tree.
    else if (message.kind === 'stop-watcher') {
        stopRequested = true;
        release?.();
        finishDrain();
    }
}
function finishDrain() {
    if (!stopRequested || stopping || generators.size) return;
    // There is no active generator for production stop to kill. Its real handler
    // closes watches and queued timers before they can start another input pass.
    process.emit('SIGTERM');
}
function stopGate() {
    if (stopping) return;
    stopping = true;
    release?.();
    finishStop();
}
function finishStop() {
    if (!stopping || generators.size || !process.connected) return;
    process.off('message', receiveRelease);
    process.send({kind: 'generators-stopped'}, function acknowledgedStop() {
        if (process.connected) process.disconnect();
    });
}
process.on('message', receiveRelease);
process.once('SIGTERM', stopGate);
process.once('SIGINT', stopGate);
`;
}

describe('contract and catalog generation', () => {
    // This offline inventory parses every authored contract and loads both full
    // compiled graphs. Its budget is distinct from an HTTP/browser latency test.
    it('keeps contract composition directed toward actual owners and preserves public profile aliases', async function verifiesOwnedContracts() {
        const directory = path.join(root, 'contracts/api/v1');
        // Inspect the authored reference graph, including parsed YAML aliases.
        // Root exports remain public; feature documents cannot depend back on it.
        function inspect(value: unknown): void {
            if (!value || typeof value !== 'object') return;
            const node = value as Record<string, unknown>;
            if (typeof node.$ref === 'string') expect(node.$ref).not.toMatch(/(?:^|\/)openapi\.yaml#/u);
            Object.values(node).forEach(inspect);
        }
        for (const filename of (await fs.readdir(directory)).filter(name => name.endsWith('.yaml') && name !== 'openapi.yaml')) {
            inspect(YAML.parse(await fs.readFile(path.join(directory, filename), 'utf8')));
        }

        // Existing public validator names retain strict server and additive
        // browser behavior after their schema bodies adopt one common owner.
        const server = (await import(pathToFileURL(path.join(root, '.generated/api/v1/server.cjs')).href)).default;
        const browser = await import(pathToFileURL(path.join(root, '.generated/api/v1/browser.mjs')).href);
        const profile = {id: '11111111-1111-4111-8111-111111111111', name: 'Profile'};
        for (const name of ['validateSessionProfile', 'validateActivityRecommendationProfile']) {
            expect(server[name](profile)).toBe(true);
            expect(server[name]({...profile, extra: true})).toBe(false);
            expect(browser[name]({...profile, extra: true})).toBe(true);
            expect(server[name]({id: profile.id})).toBe(false);
            expect(browser[name]({id: 'invalid', name: profile.name})).toBe(false);
        }
    }, 30_000);

    it('derives shared identity-name and new-password limits from their authored schemas', async function projectsIdentityPolicies() {
        const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'surveyor-generation-'));
        try {
            await prepareGenerationTree(temporary);
            const source = path.join(temporary, 'contracts/api/v1/auth.yaml');
            const auth = YAML.parseDocument(await fs.readFile(source, 'utf8'));
            // Change only the detached authored policy, proving neither generator
            // nor runtime metadata has independent copied acceptance thresholds.
            auth.setIn(['schemas', 'NewPassword', 'minLength'], 16);
            auth.setIn(['schemas', 'NewPassword', 'x-surveyor-max-utf8-bytes'], 80);
            auth.setIn(['schemas', 'IdentityName', 'maxLength'], 48);
            await fs.writeFile(source, auth.toString());
            generate('generate-api.mjs', [], temporary);
            const policyUrl = pathToFileURL(path.join(temporary, 'src/common/generated/passwordPolicy.ts')).href;
            const serverUrl = pathToFileURL(path.join(temporary, '.generated/api/v1/server.cjs')).href;
            const browserUrl = pathToFileURL(path.join(temporary, '.generated/api/v1/browser.mjs')).href;
            const registrationUrl = pathToFileURL(path.join(temporary, '.generated/api/v1/browser/validateRegistrationInput.mjs')).href;
            execFileSync(process.execPath, ['--input-type=module', '-e', `
                globalThis.Function = function () { throw new Error('Runtime compilation is forbidden'); };
                const {newPasswordPolicy, identityNamePolicy} = await import(${JSON.stringify(policyUrl)});
                if (newPasswordPolicy.minLength !== 16 || newPasswordPolicy.maxUtf8Bytes !== 80) throw new Error('Password policy drift');
                if (identityNamePolicy.maxLength !== 48) throw new Error('Provider display-name projection policy drift');
                const server = (await import(${JSON.stringify(serverUrl)})).default;
                const browser = await import(${JSON.stringify(browserUrl)});
                const registration = await import(${JSON.stringify(registrationUrl)});
                for (const validators of [server, browser]) {
                    if (!validators.validateResetInput({token: 'current', password: '😀'.repeat(20), confirmPassword: '😀'.repeat(20)})) throw new Error('Updated UTF8 bound rejected');
                    if (validators.validateResetInput({token: 'current', password: '😀'.repeat(21), confirmPassword: '😀'.repeat(20)})) throw new Error('Updated UTF8 bound ignored');
                    if (validators.validateResetInput({token: 'current', password: 'a'.repeat(15), confirmPassword: 'a'.repeat(16)})) throw new Error('Updated Unicode bound ignored');
                    if (!validators.validateLoginInput({username: 'Existing', password: 'short'})) throw new Error('Existing login policy changed');
                    if (!validators.validateLocalRegistrationName('😀'.repeat(48))) throw new Error('Shared registration code-point bound rejected');
                    if (validators.validateLocalRegistrationName('😀'.repeat(49))) throw new Error('Shared registration code-point bound ignored');
                    for (const validator of [validators.validateIdentityName]) {
                        if (!validator('😀'.repeat(48)) || validator('😀'.repeat(49))) throw new Error('Shared identity-name bound drift');
                    }
                    for (const [validator, field, rest] of [
                        [validators.validateGuestRegistrationInput, 'username', {email: null}],
                        [validators.validateProfileCreateInput, 'name', {}],
                        [validators.validateProfileUpdateInput, 'name', {isDefault: false}],
                    ]) {
                        if (!validator({...rest, [field]: '😀'.repeat(48)})) throw new Error('Stored-name field rejected its shared bound');
                        if (validator({...rest, [field]: '😀'.repeat(49)})) throw new Error('Stored-name field ignored its shared bound');
                    }
                    const input = {username: '😀'.repeat(48), displayname: '😀'.repeat(48), email: 'name@example.invalid',
                        password: 'a'.repeat(16), password_repeat: 'a'.repeat(16)};
                    if (!validators.validateRegistrationInput(input)) throw new Error('Registration did not adopt its shared name schema');
                    for (const field of ['username', 'displayname']) {
                        if (validators.validateRegistrationInput({...input, [field]: '😀'.repeat(49)})) throw new Error('Registration field bound drift');
                    }
                    if (!validators.validateLoginInput({username: 'a'.repeat(100), password: 'short'})) throw new Error('Registration changed existing login names');
                }
                if (registration.fieldAttributes?.password || registration.fieldAttributes?.password_repeat) throw new Error('Unicode/byte policy became a UTF16 HTML bound');
                if (registration.fieldAttributes?.username.maxLength !== 48 || registration.fieldAttributes?.displayname.maxLength !== 48) throw new Error('Registration field metadata drift');
            `], {cwd: temporary, stdio: 'pipe'});
        } finally {
            await removeDependencyLink(temporary);
            await removeTemporary(temporary);
        }
    }, 60_000);

    it('derives neutral runtime choices and validator admission from one authored inventory', async function projectsRuntimeChoices() {
        const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'surveyor-generation-'));
        try {
            await prepareGenerationTree(temporary);
            const surveyPath = path.join(temporary, 'contracts/api/v1/surveys.yaml');
            const survey = YAML.parseDocument(await fs.readFile(surveyPath, 'utf8'));
            survey.addIn(['schemas', 'SurveyCombinationInput', 'properties', 'weekday', 'enum'], 'FUTURE_DAY');
            survey.addIn(['schemas', 'SurveyCombinationInput', 'properties', 'nthWeek', 'enum'], '5');
            await fs.writeFile(surveyPath, survey.toString());
            const eventPath = path.join(temporary, 'contracts/api/v1/events.yaml');
            const event = YAML.parseDocument(await fs.readFile(eventPath, 'utf8'));
            event.addIn(['schemas', 'EventDietaryChoice', 'enum'], 'FUTURE_DISH');
            event.addIn(['schemas', 'EventDietaryChoice', 'x-surveyor-runtime-choices', 'groups', 'meal'], 'FUTURE_DISH');
            await fs.writeFile(eventPath, event.toString());
            generate('generate-api.mjs', [], temporary);

            // A real Node consumer loads the same erasable neutral source used by
            // the server compiler and browser graph, without importing ORM or API.
            const choicesUrl = pathToFileURL(path.join(temporary, 'src/common/generated/domainChoices.ts')).href;
            const validatorsUrl = pathToFileURL(path.join(temporary, '.generated/api/v1/server.cjs')).href;
            execFileSync(process.execPath, ['--input-type=module', '-e', `
                const choices = await import(${JSON.stringify(choicesUrl)});
                const validators = (await import(${JSON.stringify(validatorsUrl)})).default;
                if (!choices.surveyWeekdays.includes('FUTURE_DAY') || !choices.surveyOccurrences.includes('5')) throw new Error('Survey choices drift');
                if (!validators.validateSurveyCombinationInput({weekday: 'FUTURE_DAY', nthWeek: '5'})) throw new Error('Survey validator drift');
                if (!choices.eventDietaryChoices.includes('FUTURE_DISH') || !choices.eventDietaryGroups.meal.includes('FUTURE_DISH')) throw new Error('Dietary choices drift');
                if (!validators.validateEventRegistrationInput({arrivalDate: '2027-06-01', departureDate: '2027-06-02', dietary: ['FUTURE_DISH']})) throw new Error('Dietary validator drift');
                if (!Object.isFrozen(choices.eventDietaryChoices) || !Object.isFrozen(choices.eventDietaryGroups.meal)) throw new Error('Mutable shared choices');
            `], {cwd: temporary, stdio: 'pipe'});
        } finally {
            await removeDependencyLink(temporary);
            await removeTemporary(temporary);
        }
    }, 60_000);

    it('rejects incomplete runtime choice metadata before publishing generated artifacts', async function rejectsChoiceDrift() {
        const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'surveyor-generation-'));
        try {
            await prepareGenerationTree(temporary);
            const eventPath = path.join(temporary, 'contracts/api/v1/events.yaml');
            const original = await fs.readFile(eventPath, 'utf8');
            const output = path.join(temporary, 'src/common/generated/domainChoices.ts');
            await fs.mkdir(path.dirname(output), {recursive: true});
            await fs.writeFile(output, 'Unchanged previous successful choices');
            const metadata = ['schemas', 'EventDietaryChoice', 'x-surveyor-runtime-choices'];
            // Missing membership, duplicate membership, foreign values and invalid
            // export spelling are source defects, never a reason to weaken Ajv.
            for (const [suffix, value] of [
                [['groups', 'text'], ['UNKNOWN']],
                [['groups', 'meal'], ['MEAT', 'MEAT', 'FISH', 'VEGETARIAN', 'VEGAN']],
                [['groups', 'requirement'], ['HALAL']],
                [['exportName'], 'default'],
                [['exportName'], 'arguments'],
                [['exportName'], 'eval'],
                [['unexpected'], true],
            ] as const) {
                const event = YAML.parseDocument(original);
                event.setIn([...metadata, ...suffix], value);
                await fs.writeFile(eventPath, event.toString());
                expect(() => generate('generate-api.mjs', [], temporary)).toThrow(/Runtime choice/u);
                expect(await fs.readFile(output, 'utf8')).toBe('Unchanged previous successful choices');
            }
        } finally {
            await removeDependencyLink(temporary);
            await removeTemporary(temporary);
        }
    }, 60_000);

    it('keeps authored request roles independent of alias names, ordering and response reuse', async function preservesAuthoredAliasRoles() {
        const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'surveyor-generation-'));
        try {
            await prepareWatcherTree(temporary);
            const entry = path.join(temporary, 'contracts/api/v1/openapi.yaml');
            const original = await fs.readFile(entry, 'utf8');

            // Reverse the alias spelling and export order across two real
            // generation passes. Neither can decide request/response strictness.
            for (const renamed of [false, true]) {
                const names = renamed ? {request: 'ZCommandAlias', response: 'AViewAlias', shared: 'ChangedOwnedNode'}
                    : {request: 'ACommandAlias', response: 'ZViewAlias', shared: 'OwnedNode'};
                const contract = YAML.parseDocument(original);
                const local = (name: string) => ({$ref: '#/components/schemas/' + name});
                const shared = {$ref: './role-owner.yaml#/schemas/' + names.shared};
                const aliases = {[names.request]: shared, [names.response]: shared};
                await fs.writeFile(path.join(temporary, 'contracts/api/v1/role-aliases.yaml'), YAML.stringify({schemas: aliases}));
                await fs.writeFile(path.join(temporary, 'contracts/api/v1/role-owner.yaml'), YAML.stringify({schemas: {
                        [names.shared]: {type: 'object', additionalProperties: false, required: ['label'], properties: {
                                label: {type: 'string'}, child: {$ref: '#/schemas/' + names.shared},
                            }},
                        NestedCommand: {type: 'object', additionalProperties: false, required: ['value'], properties: {value: shared}},
                    }}));
                // A disconnected same-name declaration is genuinely used by a
                // parameter. It must not alter the exported response alias.
                await fs.writeFile(path.join(temporary, 'contracts/api/v1/role-shadow.yaml'), YAML.stringify({schemas: {
                        [names.response]: shared,
                    }}));
                const exports = {
                    [names.response]: {$ref: './role-aliases.yaml#/schemas/' + names.response},
                    [names.request]: {$ref: './role-aliases.yaml#/schemas/' + names.request},
                    [names.shared]: shared,
                    RoleResponseEnvelope: {type: 'object', additionalProperties: false, required: ['result'], properties: {result: local(names.response)}},
                    DifferentlyNamedCommandExport: {$ref: './role-owner.yaml#/schemas/NestedCommand'},
                    RoleMultipart: {type: 'object', additionalProperties: false, required: ['data'], properties: {
                            data: {$ref: './role-owner.yaml#/schemas/NestedCommand'}, image: {type: 'string', format: 'binary'},
                        }},
                    RoleParameter: {type: 'object', additionalProperties: false, required: ['value'], properties: {value: shared}},
                    RolePropertyResponse: {type: 'object', additionalProperties: false, properties: {selected: shared}},
                };
                const ordered = Object.entries(exports);
                if (renamed) ordered.reverse();
                for (const [name, schema] of ordered) contract.setIn(['components', 'schemas', name], schema);
                const response = {description: 'Role fixture', content: {'application/json': {schema: local('RoleResponseEnvelope')}}};
                contract.setIn(['paths', '/role-request'], {post: {operationId: 'roleRequest',
                        'x-surveyor-command': {retryPolicy: 'reconcile-only', precondition: 'none'},
                        requestBody: {required: true, content: {'application/json': {schema: local(names.request)}}}, responses: {'200': response}}});
                contract.setIn(['paths', '/role-multipart'], {post: {operationId: 'roleMultipart',
                        'x-surveyor-command': {retryPolicy: 'reconcile-only', precondition: 'none'},
                        requestBody: {required: true, content: {'multipart/form-data': {schema: local('RoleMultipart')}}}, responses: {'200': response}}});
                contract.setIn(['paths', '/role-parameters'], {get: {operationId: 'roleParameters',
                        'x-surveyor-command': {retryPolicy: 'read', precondition: 'none'}, parameters: [
                            {name: 'named', in: 'query', schema: local('RoleParameter')},
                            {name: 'selected', in: 'query', schema: {$ref: '#/components/schemas/RolePropertyResponse/properties/selected'}},
                            {name: 'shadow', in: 'query', schema: {$ref: './role-shadow.yaml#/schemas/' + names.response}},
                        ], responses: {'200': response}}});
                await fs.writeFile(entry, contract.toString());
                const output = path.join(temporary, renamed ? 'renamed-output' : 'original-output');
                generate('generate-api.mjs', ['--output-root', output], temporary);
                const browser = await import(pathToFileURL(path.join(output, '.generated/api/v1/browser.mjs')).href);
                const server = (await import(pathToFileURL(path.join(output, '.generated/api/v1/server.cjs')).href)).default;
                const policy = await import(pathToFileURL(path.join(output, '.generated/api/v1/policy.mjs')).href);
                const payload = {label: 'Existing value'};

                // Runtime dispatch selects the strict operation graph even if
                // bundling chose a response-only alias as its canonical name.
                const input = policy.operationInputs.find((input: {operationId: string}) => input.operationId === 'roleRequest');
                const validateRequest = await policy.loadInputValidator(input.bodyValidator);
                expect(validateRequest(payload)).toBe(true);
                expect(validateRequest({...payload, future: true})).toBe(false);
                const multipart = policy.operationInputs.find((input: {operationId: string}) => input.operationId === 'roleMultipart');
                expect(multipart.binaryParts).toEqual(['image']);

                // Direct requests and their genuine shared owner are strict.
                // Response-only aliases and nested response graphs stay additive.
                for (const name of [names.request, names.shared]) {
                    expect(browser['validate' + name](payload)).toBe(true);
                    expect(browser['validate' + name]({...payload, future: true})).toBe(false);
                }
                expect(browser['validate' + names.response]({...payload, future: true})).toBe(true);
                expect(browser.validateRoleResponseEnvelope({result: {...payload, future: true}, future: true})).toBe(true);
                expect(browser.validateRolePropertyResponse({selected: {...payload, future: true}, future: true})).toBe(true);
                expect(server['validate' + names.response]({...payload, future: true})).toBe(false);
                expect(browser['validate' + names.request]({...payload, child: {...payload, future: true}})).toBe(false);

                // Nested multipart metadata is automatically exported by the
                // real bundler. It keeps strict direct and transitive validation.
                expect(browser.validateNestedCommand({value: payload})).toBe(true);
                expect(browser.validateNestedCommand({value: {...payload, future: true}})).toBe(false);
                expect(browser.validateDifferentlyNamedCommandExport({value: payload})).toBe(true);
                expect(browser.validateDifferentlyNamedCommandExport({value: payload, future: true})).toBe(false);
                expect(browser.validateRoleMultipart({data: {value: payload}, image: 'proof.png'})).toBe(true);
                expect(browser.validateRoleMultipart({data: {value: payload, future: true}})).toBe(false);
                expect(browser.validateRoleMultipart({data: {value: {...payload, future: true}}})).toBe(false);
                const parameters = {path: {}, header: {}, query: {named: {value: payload}, selected: payload, shadow: payload}};
                expect(browser.validateRoleParametersParameters(parameters)).toBe(true);
                expect(browser.validateRoleParametersParameters({...parameters,
                    query: {...parameters.query, selected: {...payload, future: true}}})).toBe(false);

                // Known error parameters are still closed inside the additive
                // response graph; this is independent of ordinary future fields.
                const problem = {type: 'about:blank', title: 'Denied', detail: 'Denied', status: 401,
                    requestId: 'role-fixture', code: 'AUTH_REQUIRED', messageKey: 'api:errors.AUTH_REQUIRED', params: {}};
                expect(browser.validateProblem({...problem, future: true})).toBe(true);
                expect(browser.validateProblem({...problem, params: {future: true}})).toBe(false);
            }
        } finally {
            await removeDependencyLink(temporary);
            await removeTemporary(temporary);
        }
    }, 60_000);

    it('derives controller status annotations and native bounds from detached authored inputs', async function derivesAuthoredAdapterMetadata() {
        const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'surveyor-generation-'));
        try {
            await prepareGenerationTree(temporary);
            const commonPath = path.join(temporary, 'contracts/api/v1/common.yaml');
            const financePath = path.join(temporary, 'contracts/api/v1/finance.yaml');
            const helpPath = path.join(temporary, 'contracts/api/v1/help.yaml');
            const common = YAML.parseDocument(await fs.readFile(commonPath, 'utf8'));
            const finance = YAML.parseDocument(await fs.readFile(financePath, 'utf8'));
            const help = YAML.parseDocument(await fs.readFile(helpPath, 'utf8'));
            const variants = common.getIn(['schemas', 'Problem', 'oneOf']);
            if (!YAML.isSeq(variants)) throw new Error('Problem fixture needs its authored variants.');
            const flagged = variants.items.find(item => YAML.isMap(item) && item.get('x-surveyor-controller-status-override') === true);
            const ordinary = variants.items.find(item => YAML.isMap(item) && !item.has('x-surveyor-controller-status-override'));
            if (!YAML.isMap(flagged) || !YAML.isMap(ordinary)) throw new Error('Problem fixture needs both existing annotation states.');
            const removedCode = flagged.getIn(['properties', 'code', 'const']);
            const addedCode = ordinary.getIn(['properties', 'code', 'const']);

            // Change author intent in this detached source, including a non-Event
            // cause. Emission must follow metadata rather than another whitelist.
            flagged.set('x-surveyor-controller-status-override', false);
            ordinary.set('x-surveyor-controller-status-override', true);
            finance.setIn(['schemas', 'FinanceAcceptanceInput', 'properties', 'correctedDescription', 'maxLength'], 12);
            help.setIn(['parameters', 'HelpQuery', 'schema', 'maxLength'], 17);
            await fs.writeFile(commonPath, common.toString());
            await fs.writeFile(financePath, finance.toString());
            await fs.writeFile(helpPath, help.toString());
            generate('generate-api.mjs', [], temporary);
            const manifest = JSON.parse(await fs.readFile(path.join(temporary, '.generated/api/v1/operations.json'), 'utf8')) as ApiContractManifest;
            expect(manifest.problems.find(problem => problem.code === removedCode)?.controllerStatusOverride).toBeUndefined();
            expect(manifest.problems.find(problem => problem.code === addedCode)?.controllerStatusOverride).toBe(true);
            const browser = await import(pathToFileURL(path.join(temporary, '.generated/api/v1/browser/validateFinanceAcceptanceInput.mjs')).href);
            expect(browser.fieldAttributes.correctedDescription).toEqual({maxLength: 12});
            expect(browser.validateFinanceAcceptanceInput({correctedDescription: 'a'.repeat(13)})).toBe(false);
            // Native maxlength keeps UTF-16 semantics; projecting its numeric
            // bound must not change JSON Schema's existing code-point validation.
            expect(browser.validateFinanceAcceptanceInput({correctedDescription: '😀'.repeat(7)})).toBe(true);
            const policy = await import(pathToFileURL(path.join(temporary, '.generated/api/v1/policy.mjs')).href);
            expect(policy.parameterFieldAttributes.getHelpPage.query.q).toEqual({maxLength: 17});

            ordinary.set('x-surveyor-controller-status-override', 'yes');
            await fs.writeFile(commonPath, common.toString());
            expect(() => generate('generate-api.mjs', [], temporary)).toThrow(/boolean annotation on a Problem variant/);
            ordinary.set('x-surveyor-controller-status-override', true);
            common.setIn(['schemas', 'ComparisonToken', 'x-surveyor-controller-status-override'], true);
            await fs.writeFile(commonPath, common.toString());
            expect(() => generate('generate-api.mjs', [], temporary)).toThrow(/boolean annotation on a Problem variant/);
        } finally {
            await removeDependencyLink(temporary);
            await removeTemporary(temporary);
        }
    }, 120_000);

    it('watches atomically replaced shared declarations and publishes readiness only after successful dependent generation', async function watchesPermissionDependency(test) {
        const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'surveyor-generation-'));
        const started = Date.now();
        const trace: {elapsedMs: number; event: string}[] = [];
        let watcher: ReturnType<typeof spawn> | undefined;
        let output = '';
        let phase = 'prepare detached generation inputs';
        let failedPhase: string | undefined;
        let publicationHeld = false;
        let observedSaves = 0;
        let generatorsStopped = false;
        let assertionFailed = false;

        /** Report actual child progress even when the runner's overall deadline
         * wins before an awaited assertion can reach this fixture's catch block. */
        function reportWatcherFailure(): void {
            console.error('Generation watcher failure:', {phase: failedPhase ?? phase,
                elapsedMs: Date.now() - started, publicationHeld, observedSaves, generatorsStopped,
                exitCode: watcher?.exitCode, trace, output: output.slice(-32_000)});
        }

        /** Preserve phase timings without replacing production generators or their outputs. */
        function enterPhase(next: string): void {
            phase = next;
            trace.push({elapsedMs: Date.now() - started, event: next});
        }

        test.onTestFailed(reportWatcherFailure);
        try {
            // The actual Express watcher must wait for the completion marker;
            // observing this same source directly would restart before derived
            // interface messages and their version had finished regenerating.
            const scripts = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).scripts;
            expect(scripts['server:dev']).toContain('--ignore src/backend/modules/invoice/locales/en.ts');
            expect(scripts['server:dev']).toContain('--watch .generated/frontend-ready.json');
            // Run copies of the actual watcher/generators against a detached authored
            // tree. Installed dependencies are read through one junction; no maintained
            // source, application server, environment or database is changed.
            await prepareWatcherTree(temporary);
            const permissionsPath = path.join(temporary, 'src/backend/modules/lib/permissions.ts');
            const originalPermissions = await fs.readFile(permissionsPath, 'utf8');

            // Add the synthetic permission's text before watching. Subsequent changes
            // affect only the registry, proving its exact dependency is observed.
            for (const filename of ['en.json', 'de.json']) {
                const catalogPath = path.join(temporary, 'src/common/locales', filename);
                const catalog = JSON.parse(await fs.readFile(catalogPath, 'utf8'));
                catalog.resources.ui.permissions.WATCHER_PERMISSION = 'Watcher fixture permission';
                await fs.writeFile(catalogPath, JSON.stringify(catalog));
            }
            const gate = path.join(temporary, 'scripts/readiness-gate.mjs');
            await fs.writeFile(gate, readinessPublicationGate());
            watcher = spawn(process.execPath, ['--import', pathToFileURL(gate).href,
                path.join(temporary, 'scripts/watch-frontend-inputs.mjs')],
                {cwd: temporary, stdio: ['pipe', 'pipe', 'pipe', 'ipc']});
            function captureWatcherOutput(chunk: Buffer): void { output += chunk.toString(); }
            function receiveWatcherGate(message: {kind?: string; script?: string; code?: number}): void {
                trace.push({elapsedMs: Date.now() - started,
                    event: [message.kind, message.script, message.code].filter(value => value !== undefined).join(' ')});
                if (message.kind === 'readiness-held') publicationHeld = true;
                else if (message.kind === 'permission-observed') observedSaves++;
                else if (message.kind === 'generators-stopped') generatorsStopped = true;
            }
            watcher.stdout!.on('data', captureWatcherOutput);
            watcher.stderr!.on('data', captureWatcherOutput);
            watcher.on('message', receiveWatcherGate);
            enterPhase('wait for directory observers');
            await expect.poll(function watcherRegistered() { return output; }, {timeout: 10_000})
                .toContain('Watching frontend contracts, language catalogs and permission registry.');

            // An atomic replacement must remain watched. The ready file is absent
            // until real API and locale generation have both completed successfully.
            const validPermissions = originalPermissions.replace('    EDIT_TITLE: 1,', '    WATCHER_PERMISSION: 1,');
            expect(validPermissions).not.toBe(originalPermissions);
            const replacement = path.join(temporary, 'src/backend/modules/lib/permissions.next');
            const markerPath = path.join(temporary, '.generated/frontend-ready.json');
            const generatedDirectory = path.join(temporary, 'src/common/localization/generated');
            expect(await readOptionalFile(markerPath)).toBeNull();
            await fs.writeFile(replacement, validPermissions);
            await fs.rename(replacement, permissionsPath);

            // A newer save arrives inside the actual asynchronous readiness write.
            // Its callback is known before that write resumes, so the first valid
            // batch must not advertise readiness for the now-invalid input tree.
            enterPhase('wait for first real API/catalog batch and held publication');
            await expect.poll(function readinessWriteStarted() { return publicationHeld; }, {timeout: 30_000}).toBe(true);
            const savesBeforeReplacement = observedSaves;
            await fs.writeFile(replacement, validPermissions.replace('WATCHER_PERMISSION:', 'WATCHER_MISSING:'));
            await fs.rename(replacement, permissionsPath);
            enterPhase('deliver newer invalid permission save before publication');
            await expect.poll(function newerSaveDelivered() { return observedSaves; }, {timeout: 10_000})
                .toBeGreaterThan(savesBeforeReplacement);
            watcher.send({kind: 'release-readiness'});
            enterPhase('wait for queued invalid batch without readiness');
            await expect.poll(function queuedInvalidRegistryReported() { return output; }, {timeout: 30_000})
                .toContain('Missing permission message: WATCHER_MISSING');
            expect(await readOptionalFile(markerPath)).toBeNull();
            const abandonedMarkers = (await fs.readdir(path.dirname(markerPath)))
                .filter(filename => filename.startsWith('frontend-ready') && filename.endsWith('.tmp'));
            expect(abandonedMarkers).toEqual([]);

            // Recovery must still use the same parent-directory observation and
            // publish only after a full successful dependency pass for this save.
            await fs.writeFile(replacement, validPermissions);
            await fs.rename(replacement, permissionsPath);
            enterPhase('recover valid registry through the original observers');
            await expect.poll(async function initialReadyMarker() { return readOptionalFile(markerPath); }, {timeout: 30_000})
                .not.toBeNull();

            const firstMarker = await fs.readFile(markerPath, 'utf8');
            // This is a real generated session contract, not a substituted restart
            // signal. Comprehensive full-API artifacts are exercised independently.
            const generatedApi = JSON.parse(await fs.readFile(path.join(temporary, '.generated/api/v1/operations.json'), 'utf8')) as ApiContractManifest;
            expect(generatedApi.operations).toMatchObject([{operationId: 'getSession', method: 'GET', path: '/session',
                responseSchemas: {'200': 'SessionView', default: 'Problem'}}]);
            const emittedPermissions = await fs.readFile(path.join(generatedDirectory, 'permissions.ts'), 'utf8');
            expect(emittedPermissions).toContain('"WATCHER_PERMISSION": "permissions.WATCHER_PERMISSION"');
            expect(emittedPermissions).not.toContain('"EDIT_TITLE":');
            const firstManifest = JSON.parse(await fs.readFile(path.join(generatedDirectory, 'manifest.json'), 'utf8'));
            expect(firstManifest.messages['permissions.WATCHER_PERMISSION']).toBeDefined();
            const markerModified = (await fs.stat(markerPath)).mtimeMs;
            for (const relative of ['.generated/api/v1/operations.json',
                'src/common/localization/generated/permissions.ts', 'src/common/localization/generated/manifest.json']) {
                expect((await fs.stat(path.join(temporary, relative))).mtimeMs).toBeLessThanOrEqual(markerModified);
            }

            // An invalid intermediate registry save must not advertise a restart.
            // A later valid save must still recover through the same watcher handles.
            const outputBeforeInvalidSave = output.length;
            await fs.writeFile(replacement, validPermissions.replace('WATCHER_PERMISSION:', 'WATCHER_MISSING:'));
            await fs.rename(replacement, permissionsPath);
            enterPhase('reject invalid registry after a published valid batch');
            await expect.poll(function invalidRegistryReported() { return output.slice(outputBeforeInvalidSave); }, {timeout: 30_000})
                .toContain('Missing permission message: WATCHER_MISSING');
            expect(await fs.readFile(markerPath, 'utf8')).toBe(firstMarker);
            await fs.writeFile(replacement, originalPermissions);
            await fs.rename(replacement, permissionsPath);
            enterPhase('restore original registry and publish the next coherent batch');
            await expect.poll(async function recoveredReadyMarker() { return readOptionalFile(markerPath); }, {timeout: 30_000})
                .not.toBe(firstMarker);

            // The same successful dependency batch replaces an existing marker
            // despite one transient sharing failure. Recovery cannot replay
            // generators or bypass the earlier known-save/invalid-edit checks.
            await expect.poll(function readinessRenameRecovered() {
                const blocked = trace.findIndex(entry => entry.event === 'readiness-rename-blocked');
                return blocked >= 0 && trace.slice(blocked + 1).some(entry => entry.event === 'readiness-renamed');
            }, {timeout: 10_000}).toBe(true);
            const blockedRename = trace.findIndex(entry => entry.event === 'readiness-rename-blocked');
            const completedRename = trace.findIndex((entry, index) => index > blockedRename && entry.event === 'readiness-renamed');
            expect(trace.slice(blockedRename + 1, completedRename)
                .some(entry => entry.event.startsWith('generator-started'))).toBe(false);

            const recoveredPermissions = await fs.readFile(path.join(generatedDirectory, 'permissions.ts'), 'utf8');
            expect(recoveredPermissions).toContain('"EDIT_TITLE": "permissions.EDIT_TITLE"');
            expect(recoveredPermissions).not.toContain('"WATCHER_PERMISSION":');
            const recoveredManifest = JSON.parse(await fs.readFile(path.join(generatedDirectory, 'manifest.json'), 'utf8'));
            expect(recoveredManifest.version).not.toBe(firstManifest.version);

            // The original invoice catalog is a real preparation input too.
            // An atomic source save must update its derived interface wording
            // and version before publishing the next Express readiness marker.
            const recoveredMarker = await fs.readFile(markerPath, 'utf8');
            const invoicePath = path.join(temporary, 'src/backend/modules/invoice/locales/en.ts');
            const invoiceSource = await fs.readFile(invoicePath, 'utf8');
            const invoiceReplacement = invoiceSource.replace('base: "Base share"', 'base: "Watched shared invoice base"');
            expect(invoiceReplacement).not.toBe(invoiceSource);
            await fs.writeFile(`${invoicePath}.next`, invoiceReplacement);
            await fs.rename(`${invoicePath}.next`, invoicePath);
            enterPhase('regenerate selected invoice wording after atomic source replacement');
            await expect.poll(async function invoiceReadyMarker() { return readOptionalFile(markerPath); }, {timeout: 30_000})
                .not.toBe(recoveredMarker);
            const invoiceResources = JSON.parse(await fs.readFile(path.join(generatedDirectory, 'resources.json'), 'utf8'));
            expect(invoiceResources.en.ui.finance.base).toBe('Watched shared invoice base');
            const invoiceManifest = JSON.parse(await fs.readFile(path.join(generatedDirectory, 'manifest.json'), 'utf8'));
            expect(invoiceManifest.version).not.toBe(recoveredManifest.version);

            // The exact shared UTF-8 helper is an authored API compiler input.
            // An atomic helper save must regenerate before readiness; changing a
            // comment retains behavior while making source-hash adoption observable.
            const invoiceMarker = await fs.readFile(markerPath, 'utf8');
            const beforeUtf8 = JSON.parse(await fs.readFile(path.join(temporary, '.generated/api/v1/operations.json'), 'utf8'));
            const utf8Path = path.join(temporary, 'src/common/lib/utf8.ts');
            await fs.writeFile(`${utf8Path}.next`, await fs.readFile(utf8Path, 'utf8') + '\n// Watched measurement input.\n');
            await fs.rename(`${utf8Path}.next`, utf8Path);
            enterPhase('regenerate standalone validators after atomic shared UTF-8 helper replacement');
            await expect.poll(async function utf8ReadyMarker() { return readOptionalFile(markerPath); }, {timeout: 30_000})
                .not.toBe(invoiceMarker);
            const afterUtf8 = JSON.parse(await fs.readFile(path.join(temporary, '.generated/api/v1/operations.json'), 'utf8'));
            expect(afterUtf8.sourceHash).not.toBe(beforeUtf8.sourceHash);
        } catch (error) {
            failedPhase = phase;
            assertionFailed = true;
            throw error;
        } finally {
            // A close receipt proves this fixture's generator children settled.
            // Failed shutdown leaves the tree intact rather than racing its removal.
            try {
                enterPhase('drain owned generator processes');
                if (watcher) {
                    await stopWatcher(watcher);
                    expect(generatorsStopped).toBe(true);
                }
                enterPhase('remove settled fixture dependency link and directory');
                await removeDependencyLink(temporary);
                await removeTemporary(temporary);
            } catch (error) {
                // Keep the original assertion as the test failure. Cleanup remains
                // visible in diagnostics instead of replacing the evidence with EBUSY.
                if (!assertionFailed) throw error;
                console.error('Generation fixture cleanup also failed; the original assertion remains primary.', error);
            }
        }
    }, 90_000);

    it('keeps emitted JavaScript from shadowing maintained TypeScript modules and root configurations', async () => {
        // Extensionless imports can resolve an adjacent emitted .js before
        // the maintained .ts source. Such a copy can make both tests and production
        // bundles consume stale behavior despite a successful TypeScript check.
        // Build output belongs outside this authored tree; report every collision
        // together so another external emitter cannot silently invalidate review.
        const collisions: string[] = [];
        // Include every authored consumer: runtime helpers, test fixtures and
        // scripts can also resolve stale siblings. Root runner/build configurations
        // use all three TypeScript module formats. Discover pairs rather than
        // maintaining a second list of configs or generated-file exceptions.
        for (const directory of ['src', 'tests', 'scripts', '.']) {
            const files = new Set(await fs.readdir(path.join(root, directory), {recursive: directory !== '.'}));
            for (const file of files) {
                if (/\.d\.(?:ts|mts|cts)$/u.test(file)) continue;
                const extension = path.extname(file);
                const emittedExtension = extension === '.ts' ? '.js'
                    : extension === '.mts' ? '.mjs' : extension === '.cts' ? '.cjs' : null;
                if (emittedExtension === null) continue;
                const emitted = file.slice(0, -extension.length) + emittedExtension;
                if (files.has(emitted)) collisions.push(path.join(directory, emitted));
            }
        }
        expect(collisions.sort()).toEqual([]);
    });

    it('reports compiled permission siblings without mutation and retires only those known outputs during generation', async function retiresCompiledPermissionSiblings() {
        const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'surveyor-generation-'));
        try {
            const destination = path.join(temporary, 'output');
            generate('generate-locales.mjs', ['--output-root', destination]);
            const generated = path.join(destination, 'src/common/localization/generated');
            const sourcePath = path.join(generated, 'permissions.ts');
            const sourceBefore = await fs.readFile(sourcePath, 'utf8');
            const sourceModifiedBefore = (await fs.stat(sourcePath)).mtimeMs;
            const compiled = path.join(generated, 'permissions.js');
            const sourceMap = path.join(generated, 'permissions.js.map');
            const unrelated = path.join(generated, 'unrelated.js');

            // Reproduce the real extension-resolution collision in the generator's
            // own temporary output tree, with an unrelated file beside it.
            await fs.writeFile(compiled, '// Stale compiled permission source\n');
            await fs.writeFile(sourceMap, '{"version":3}\n');
            await fs.writeFile(unrelated, '// Preserve this unrelated generated neighbor\n');
            expect(() => generate('generate-locales.mjs', ['--output-root', destination, '--check']))
                .toThrow(/compiled permission siblings/);
            expect(await fs.readFile(compiled, 'utf8')).toBe('// Stale compiled permission source\n');
            expect(await fs.readFile(sourceMap, 'utf8')).toBe('{"version":3}\n');
            expect(await fs.readFile(sourcePath, 'utf8')).toBe(sourceBefore);
            expect((await fs.stat(sourcePath)).mtimeMs).toBe(sourceModifiedBefore);

            // Normal generation uses its exact-file retirement before publishing
            // current TypeScript. It must not replace a broad directory cleanup.
            generate('generate-locales.mjs', ['--output-root', destination]);
            await expect(fs.access(compiled)).rejects.toMatchObject({code: 'ENOENT'});
            await expect(fs.access(sourceMap)).rejects.toMatchObject({code: 'ENOENT'});
            expect(await fs.readFile(unrelated, 'utf8')).toBe('// Preserve this unrelated generated neighbor\n');
            expect(await fs.readFile(sourcePath, 'utf8')).toBe(sourceBefore);
            generate('generate-locales.mjs', ['--output-root', destination, '--check']);
        } finally {
            // The established guard verifies the mkdtemp root before recursive fixture cleanup.
            await removeTemporary(temporary);
        }
    }, 20_000);

    it('preserves current contracts and compiles future parameter shapes and response media without policy bans', async function preservesAuthoredShapes() {
        const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'surveyor-generation-'));
        try {
            await prepareGenerationTree(temporary);
            const source = path.join(temporary, 'contracts/api/v1/openapi.yaml');
            const futureContract = YAML.parseDocument(await fs.readFile(source, 'utf8'));
            const packingSource = path.join(temporary, 'contracts/api/v1/packing.yaml');
            const packingContract = YAML.parseDocument(await fs.readFile(packingSource, 'utf8'));
            const parameters = packingContract.getIn(['paths', '/packing-lists/create-entry', 'get', 'parameters']);
            if (!YAML.isSeq(parameters)) throw new Error('Fixture operation no longer declares its parameters.');

            // These declarations live only in the detached fixture. Removing an
            // unused runtime codec must not prohibit a future authored schema;
            // compilation does not claim that Express already decodes its values.
            futureContract.setIn(['components', 'schemas', 'FutureParameterValues'],
                {type: 'array', items: {type: 'string'}});
            parameters.add({name: 'repeated', in: 'query', style: 'form', explode: true,
                schema: {$ref: './openapi.yaml#/components/schemas/FutureParameterValues'}});
            parameters.add({name: 'structured', in: 'query', schema: {type: 'object', additionalProperties: false,
                    required: ['label'], properties: {label: {type: 'string'}}}});
            parameters.add({name: 'choice', in: 'query', schema: {oneOf: [
                        {type: 'object', additionalProperties: false, required: ['kind', 'id'],
                            properties: {kind: {type: 'string', const: 'single'}, id: {type: 'integer'}}},
                        {type: 'object', additionalProperties: false, required: ['kind', 'ids'],
                            properties: {kind: {type: 'string', const: 'multiple'}, ids: {type: 'array', items: {type: 'integer'}}}},
                    ]}});
            parameters.add({name: 'X-Future-Values', in: 'header',
                schema: {$ref: './openapi.yaml#/components/schemas/FutureParameterValues'}});
            futureContract.setIn(['components', 'schemas', 'PlainTextFixture'], {type: 'string'});
            packingContract.setIn(['paths', '/packing-lists/create-entry', 'get', 'responses', '200', 'content'],
                {'text/plain': {schema: {$ref: './openapi.yaml#/components/schemas/PlainTextFixture'}}});
            await fs.writeFile(source, futureContract.toString());
            await fs.writeFile(packingSource, packingContract.toString());

            // Compile the complete contract and future additions together once.
            // Unchanged operations retain all their assertions below; the separate
            // two-clean-tree case covers unmodified contract determinism.
            const futureOutput = path.join(temporary, 'future-output');
            generate('generate-api.mjs', ['--output-root', futureOutput], temporary);
            const futureMetadata = JSON.parse(await fs.readFile(path.join(futureOutput, '.generated/api/v1/operations.json'), 'utf8')) as ApiContractManifest;
            expect(futureMetadata.operations.some(operation => operation.requestMediaType === 'multipart/form-data')).toBe(true);
            expect(futureMetadata.operations.some(operation => Object.values(operation.responseMediaTypes).includes('application/octet-stream'))).toBe(true);
            const operation = futureMetadata.operations.find(operation => operation.operationId === 'getPackingCreateEntry');
            expect(operation?.responseMediaTypes['200']).toBe('text/plain');
            expect(operation?.parameters.find(parameter => parameter.name === 'repeated')?.schema)
                .toEqual({type: 'array', items: {type: 'string'}});

            const generatedServer = (await import(pathToFileURL(path.join(futureOutput, '.generated/api/v1/server.cjs')).href)).default;
            const generatedBrowser = await import(pathToFileURL(path.join(futureOutput, '.generated/api/v1/browser.mjs')).href);

            // These existing operations are unchanged by the future fixture.
            // Exercise their real validators alongside the new shapes below.
            expect(generatedServer.validateGetHelpPageParameters({path: {}, query: {q: 'packing'}, header: {}})).toBe(true);
            expect(generatedServer.validatePackingCreateForm({data: {title: 'Packing fixture', description: null, eventId: null,
                    defaultPermissions: {public: 0, guest: 0, authenticated: 0, participant: 0},
                    items: [{title: 'Tent', description: null, maxAssignees: 1, requiredByAll: false},
                    {title: 'Water', description: null, maxAssignees: 2, requiredByAll: false}]}})).toBe(true);

            const input = {path: {}, query: {repeated: ['one', 'two'], structured: {label: 'Selection'},
                    choice: {kind: 'multiple', ids: [1, 2]}}, header: {'X-Future-Values': ['first', 'second']}};
            for (const validators of [generatedServer, generatedBrowser]) {
                // Shape freedom preserves validation: wrong members and invalid
                // union variants must fail in both actual standalone runtimes.
                expect(validators.validateGetPackingCreateEntryParameters(input)).toBe(true);
                expect(validators.validateGetPackingCreateEntryParameters({...input,
                    query: {...input.query, choice: {kind: 'single', id: 3}}})).toBe(true);
                expect(validators.validateGetPackingCreateEntryParameters({...input,
                    query: {...input.query, repeated: 'one'}})).toBe(false);
                expect(validators.validateGetPackingCreateEntryParameters({...input,
                    query: {...input.query, structured: {label: 3}}})).toBe(false);
                expect(validators.validateGetPackingCreateEntryParameters({...input,
                    query: {...input.query, choice: {kind: 'multiple', ids: ['wrong']}}})).toBe(false);
                expect(validators.validatePlainTextFixture('Authored text')).toBe(true);
                expect(validators.validatePlainTextFixture(3)).toBe(false);
            }
        } finally {
            // Every synchronous child has closed before its link and named tree retire.
            await removeDependencyLink(temporary);
            await removeTemporary(temporary);
        }
    }, 60_000);

    /** Exercise real compiler output ownership, read-only rejection and redirected
     * directory safety inside one detached tree with explicitly released links. */
    // Five real compiler processes and junction/case cleanup need their own
    // offline batch budget; this case does not measure application latency.
    it('retires only obsolete owned browser validators and reports them without mutation in check mode', async function retiresBrowserArtifacts() {
        const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'surveyor-generation-'));
        const browser = path.join(temporary, '.generated/api/v1/browser');
        const apiDirectory = path.join(temporary, '.generated/api');
        const linked = path.join(browser, 'validateLinked.mjs');
        let linkCreated = false;
        let redirected = false;
        let redirectedAncestor = false;
        try {
            // Use the actual bounded session contract and compiler. This lifecycle
            // check stays separate from the existing full-contract comparison.
            await prepareWatcherTree(temporary);
            generate('generate-api.mjs', [], temporary);
            const module = await fs.readFile(path.join(browser, 'validateSessionView.mjs'), 'utf8');
            const declaration = await fs.readFile(path.join(browser, 'validateSessionView.d.mts'), 'utf8');
            const retired = path.join(browser, 'validateRetiredFixture.mjs');
            const retiredDeclaration = path.join(browser, 'validateRetiredFixture.d.mts');
            await fs.writeFile(retired, module);
            await fs.writeFile(retiredDeclaration, declaration);

            // Validator-like names do not grant ownership. Nested output and a
            // directory link retain their real bytes and target as well.
            const foreign = path.join(browser, 'validateForeign.mjs');
            await fs.writeFile(foreign, '// Another owner\n');
            const nested = path.join(browser, 'nested');
            await fs.mkdir(nested);
            await fs.writeFile(path.join(nested, 'validateRetiredFixture.mjs'), module);
            const external = path.join(temporary, 'external');
            await fs.mkdir(external);
            await fs.writeFile(path.join(external, 'validateRetiredFixture.mjs'), module);
            await fs.symlink(external, linked, process.platform === 'win32' ? 'junction' : 'dir');
            linkCreated = true;

            const manifest = path.join(temporary, '.generated/api/v1/operations.json');
            const original = await fs.readFile(manifest, 'utf8');
            const modified = (await fs.stat(manifest)).mtimeMs;
            expect(() => generate('generate-api.mjs', ['--check'], temporary)).toThrow('Obsolete generated browser validator');
            expect(await fs.readFile(retired, 'utf8')).toBe(module);
            expect(await fs.readFile(retiredDeclaration, 'utf8')).toBe(declaration);
            expect(await fs.readFile(manifest, 'utf8')).toBe(original);
            expect((await fs.stat(manifest)).mtimeMs).toBe(modified);

            // A case-only previous filename can address the current artifact on
            // Windows. Publication must never retire that current file's alias.
            await fs.rename(path.join(browser, 'validateSessionView.mjs'), path.join(browser, 'validateSessionVIEW.mjs'));
            await fs.rename(path.join(browser, 'validateSessionView.d.mts'), path.join(browser, 'validateSessionVIEW.d.mts'));
            await fs.writeFile(path.join(browser, 'validateSessionView.mjs'), module);
            await fs.writeFile(path.join(browser, 'validateSessionView.d.mts'), declaration);
            // On a case-sensitive filesystem these writes create distinct current
            // siblings, so the old spelling really is obsolete and must disappear.
            const names = await fs.readdir(browser);
            const distinctCaseSiblings = names.includes('validateSessionView.mjs') && names.includes('validateSessionVIEW.mjs');

            // Successful publication removes only the obsolete direct pair.
            // Current artifacts and every excluded neighbor remain readable.
            generate('generate-api.mjs', [], temporary);
            await expect(fs.lstat(retired)).rejects.toMatchObject({code: 'ENOENT'});
            await expect(fs.lstat(retiredDeclaration)).rejects.toMatchObject({code: 'ENOENT'});
            expect(await fs.readFile(foreign, 'utf8')).toBe('// Another owner\n');
            expect(await fs.readFile(path.join(nested, 'validateRetiredFixture.mjs'), 'utf8')).toBe(module);
            expect(await fs.readFile(path.join(linked, 'validateRetiredFixture.mjs'), 'utf8')).toBe(module);
            expect((await fs.lstat(linked)).isSymbolicLink()).toBe(true);
            expect(await fs.readFile(path.join(browser, 'validateSessionView.mjs'), 'utf8')).toBe(module);
            expect(await fs.readFile(path.join(browser, 'validateSessionView.d.mts'), 'utf8')).toBe(declaration);
            if (distinctCaseSiblings) {
                await expect(fs.lstat(path.join(browser, 'validateSessionVIEW.mjs'))).rejects.toMatchObject({code: 'ENOENT'});
                await expect(fs.lstat(path.join(browser, 'validateSessionVIEW.d.mts'))).rejects.toMatchObject({code: 'ENOENT'});
            }
            expect(await fs.readFile(manifest, 'utf8')).toBe(original);

            // A redirected browser directory is rejected before current outputs can be
            // overwritten. Unlink owned junctions explicitly before tree cleanup.
            await fs.unlink(linked);
            linkCreated = false;
            await fs.rename(browser, path.join(temporary, 'original-browser'));
            await fs.symlink(external, browser, process.platform === 'win32' ? 'junction' : 'dir');
            redirected = true;
            const published = (await fs.stat(manifest)).mtimeMs;
            expect(() => generate('generate-api.mjs', [], temporary)).toThrow('Refusing browser validator cleanup');
            expect((await fs.stat(manifest)).mtimeMs).toBe(published);
            expect(await fs.readFile(path.join(external, 'validateRetiredFixture.mjs'), 'utf8')).toBe(module);

            // An ancestor junction is equally unsafe, even when the browser leaf
            // itself is a regular directory. No artifact may be written through it.
            await fs.unlink(browser);
            redirected = false;
            await fs.rename(apiDirectory, path.join(temporary, 'original-api'));
            const externalBrowser = path.join(external, 'v1/browser');
            await fs.mkdir(externalBrowser, {recursive: true});
            await fs.writeFile(path.join(externalBrowser, 'validateRetiredFixture.mjs'), module);
            await fs.symlink(external, apiDirectory, process.platform === 'win32' ? 'junction' : 'dir');
            redirectedAncestor = true;
            expect(() => generate('generate-api.mjs', [], temporary)).toThrow('Refusing browser validator cleanup');
            await expect(fs.lstat(path.join(external, 'v1/operations.json'))).rejects.toMatchObject({code: 'ENOENT'});
            expect(await fs.readFile(path.join(externalBrowser, 'validateRetiredFixture.mjs'), 'utf8')).toBe(module);
        } finally {
            if (redirectedAncestor) await fs.unlink(apiDirectory);
            if (redirected) await fs.unlink(browser);
            if (linkCreated) await fs.unlink(linked);
            await removeDependencyLink(temporary);
            await removeTemporary(temporary);
        }
    }, 60_000);

    // Three complete API/catalog compiler batches, standalone execution and byte
    // comparisons need process/filesystem headroom; this is no request deadline.
    it('generates identical artifacts from two clean trees and verifies them without rewriting', async () => {
        const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'surveyor-generation-'));
        try {
            const first = path.join(temporary, 'first');
            const second = path.join(temporary, 'second');
            for (const destination of [first, second]) {
                generate('generate-api.mjs', ['--output-root', destination]);
                generate('generate-locales.mjs', ['--output-root', destination]);
            }
            for (const artifact of artifacts) {
                expect(await fs.readFile(path.join(first, artifact), 'utf8'))
                    .toBe(await fs.readFile(path.join(second, artifact), 'utf8'));
            }
            // Load copied build output outside the repository, with runtime compilation disabled.
            // Unicode length exercises a helper that standalone Ajv output otherwise imports.
            const browserUrl = pathToFileURL(path.join(first, '.generated/api/v1/browser.mjs')).href;
            const serverUrl = pathToFileURL(path.join(first, '.generated/api/v1/server.cjs')).href;
            const registrationUrl = pathToFileURL(path.join(first, '.generated/api/v1/browser/validateRegistrationInput.mjs')).href;
            const problemUrl = pathToFileURL(path.join(first, '.generated/api/v1/browser/validateProblem.mjs')).href;
            const verifyStandalone = `globalThis.Function = function () { throw new Error('Runtime compilation is forbidden'); };
                const browser = await import(${JSON.stringify(browserUrl)});
                const server = (await import(${JSON.stringify(serverUrl)})).default;
                const registration = await import(${JSON.stringify(registrationUrl)});
                const problem = await import(${JSON.stringify(problemUrl)});
                for (const validators of [browser, server]) {
                    if (!validators.validateBasicEntityMetadataPatch({title: '💡'.repeat(255)})) throw new Error('Unicode boundary rejected');
                    if (validators.validateBasicEntityMetadataPatch({title: '💡'.repeat(256)})) throw new Error('Unicode bound ignored');
                    const password = '💡'.repeat(18);
                    if (!validators.validateResetInput({token: 'Current-token', password, confirmPassword: password})) throw new Error('Unicode byte boundary rejected');
                    if (validators.validateResetInput({token: 'Current-token', password: '💡'.repeat(19), confirmPassword: password})) throw new Error('UTF-8 maximum ignored');
                    if (validators.validateResetInput({token: 'Current-token', password: '💡'.repeat(14), confirmPassword: password})) throw new Error('Unicode minimum ignored');
                }
                for (const validators of [browser, server, registration]) {
                    const input = {username: 'Account', displayname: 'Account', email: 'account@example.invalid', password: 'a'.repeat(15), password_repeat: 'a'.repeat(15)};
                    if (!validators.validateRegistrationInput(input)) throw new Error('Standalone new-password registration rejected');
                    if (validators.validateRegistrationInput({...input, password_repeat: '💡'.repeat(19)})) throw new Error('Standalone over-byte-limit repetition accepted');
                }
                for (const validators of [browser, server, problem]) {
                    const input = {type: 'about:blank', title: 'Rejected', detail: 'Synthetic rejection', requestId: 'standalone-problem',
                        code: 'PACKING_ITEM_FULL', status: 409, messageKey: 'api:errors.PACKING_ITEM_FULL',
                        params: {itemId: '11111111-1111-4111-8111-111111111111'}};
                    if (!validators.validateProblem(input)) throw new Error('Standalone discriminated Problem rejected');
                    if (validators.validateProblem({...input, status: 400})) throw new Error('Standalone Problem correlation ignored');
                }`;
            execFileSync(process.execPath, ['--input-type=module', '--eval', verifyStandalone], {cwd: temporary, stdio: 'pipe'});
            generate('generate-api.mjs', ['--output-root', first, '--check']);
            generate('generate-locales.mjs', ['--output-root', first, '--check']);
        } finally {
            await removeTemporary(temporary);
        }
    }, 120_000);

    it('derives selected invoice text from its literal owner and tracks source changes without executing catalog code', async () => {
        const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'surveyor-generation-invoice-'));
        try {
            await prepareGenerationTree(temporary);
            // Locale generation consumes the actual existing API metadata. This
            // fixture changes neither the contract compiler nor its wire shapes.
            const apiDirectory = path.join(temporary, '.generated/api/v1');
            await fs.mkdir(apiDirectory, {recursive: true});
            for (const filename of ['operations.json', 'openapi.json']) {
                await fs.copyFile(path.join(root, '.generated/api/v1', filename), path.join(apiDirectory, filename));
            }
            const destination = path.join(temporary, 'output');
            const localePath = path.join(temporary, 'src/common/locales/en.json');
            const english = JSON.parse(await fs.readFile(localePath, 'utf8'));
            const invoicePath = path.join(temporary, 'src/backend/modules/invoice/locales/en.ts');
            const originalInvoice = await fs.readFile(invoicePath, 'utf8');
            const resourcesPath = path.join(destination, 'src/common/localization/generated/resources.json');
            const manifestPath = path.join(destination, 'src/common/localization/generated/manifest.json');
            generate('generate-locales.mjs', ['--output-root', destination], temporary);
            const resources = JSON.parse(await fs.readFile(resourcesPath, 'utf8'));
            const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
            expect(english.invoiceMessages['finance.base']).toBe('base');
            expect(english.resources.ui.finance).not.toHaveProperty('base');
            expect(resources.en.ui.finance).toMatchObject({base: 'Base share', participantsCoveredBy: 'Participants covered by {{name}}',
                otherParticipantsCovered_one: 'Covers {{count}} other participant', otherParticipantsCovered_other: 'Covers {{count}} other participants'});
            expect(manifest.messages['finance.otherParticipantsCovered']).toMatchObject({parameters: {count: 'number'}, plural: true});

            // Changing only the authoritative wording must invalidate --check,
            // the emitted text and its shared catalog version together.
            const changedInvoice = originalInvoice.replace('base: "Base share"', 'base: "Source-owned base"');
            expect(changedInvoice).not.toBe(originalInvoice);
            await fs.writeFile(invoicePath, changedInvoice);
            expect(() => generate('generate-locales.mjs', ['--output-root', destination, '--check'], temporary))
                .toThrow('Generated catalog is stale');
            generate('generate-locales.mjs', ['--output-root', destination], temporary);
            expect(JSON.parse(await fs.readFile(resourcesPath, 'utf8')).en.ui.finance.base).toBe('Source-owned base');
            expect(JSON.parse(await fs.readFile(manifestPath, 'utf8')).version).not.toBe(manifest.version);
            await fs.writeFile(invoicePath, originalInvoice);

            // Source selection cannot overwrite explicit authored text, name an
            // absent native entry or bypass the existing safe-key vocabulary.
            const duplicate = structuredClone(english);
            duplicate.resources.ui.finance.base = 'Copied wording';
            const missing = structuredClone(english);
            missing.invoiceMessages['finance.base'] = 'missingInvoiceMessage';
            const unsafe = structuredClone(english);
            unsafe.invoiceMessages['finance.__proto__'] = 'base';
            for (const [catalog, message] of [[duplicate, 'Duplicate invoice message target'],
            [missing, 'Unknown invoice message reference'], [unsafe, 'Invalid invoice message target']] as const) {
                await fs.writeFile(localePath, JSON.stringify(catalog));
                expect(() => generate('generate-locales.mjs', ['--output-root', destination], temporary)).toThrow(message);
            }
            await fs.writeFile(localePath, JSON.stringify(english));
            for (const [source, message] of [
                [originalInvoice.replace('base: "Base share"', 'base: (() => "must not run")()'), 'Unsupported invoice catalog literal'],
                [originalInvoice.replace('base: "Base share"', 'base: "First", base: "Second"'), 'Duplicate invoice catalog key'],
                [originalInvoice.replace('base: "Base share"', 'base: "{{#label}}"'), 'Unsupported interpolation'],
            ] as const) {
                await fs.writeFile(invoicePath, source);
                expect(() => generate('generate-locales.mjs', ['--output-root', destination], temporary)).toThrow(message);
            }

            // Catalogs with no shared references retain their existing standalone
            // input boundary; they need no invoice file merely because it exists
            // in the application repository.
            const standalone = {...english, resources: resources.en};
            delete standalone.invoiceMessages;
            await fs.writeFile(localePath, JSON.stringify(standalone));
            await fs.unlink(invoicePath);
            generate('generate-locales.mjs', ['--output-root', destination], temporary);
            expect(JSON.parse(await fs.readFile(resourcesPath, 'utf8')).en.ui.finance.base).toBe('Base share');
        } finally {
            await removeDependencyLink(temporary);
            await removeTemporary(temporary);
        }
    }, 30_000);

    // Run all seven real generator processes, including the rejected catalogs,
    // within one offline correctness case with local process/filesystem headroom.
    it('discovers one added locale file and rejects missing text, placeholder drift and active markup', async () => {
        const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'surveyor-generation-'));
        try {
            const source = path.join(temporary, 'locales');
            const destination = path.join(temporary, 'output');
            await fs.cp(path.join(root, 'src/common/locales'), source, {recursive: true});
            const english = JSON.parse(await fs.readFile(path.join(source, 'en.json'), 'utf8'));
            // Synthetic fixture: tests discovery and applicable plural categories, not translation quality.
            generate('generate-locales.mjs', ['--source', source, '--output-root', destination]);
            const resolved = JSON.parse(await fs.readFile(path.join(destination, 'src/common/localization/generated/resources.json'), 'utf8'));
            const added = {...english, resources: resolved.en, locale: 'nl', nativeName: 'Nederlands', help: {directory: 'nl'}};
            delete added.uiContracts;
            delete added.invoiceMessages;
            await fs.writeFile(path.join(source, 'nl.json'), JSON.stringify(added));
            generate('generate-locales.mjs', ['--source', source, '--output-root', destination]);
            const manifest = JSON.parse(await fs.readFile(path.join(destination, 'src/common/localization/generated/manifest.json'), 'utf8'));
            expect(manifest.locales.map((locale: {locale: string}) => locale.locale)).toContain('nl');
            expect(manifest.helpSources.nl).toBe('nl');
            const germanPath = path.join(source, 'de.json');
            const german = JSON.parse(await fs.readFile(germanPath, 'utf8'));
            const invalidCatalogs = [
                {...german, help: {directory: '../uploads'}},
                {...german, help: {directory: '.'}},
                {...german, resources: {...german.resources, ui: {...german.resources.ui, common: {...german.resources.ui.common, save: undefined}}}},
                {...german, resources: {...german.resources, ui: {...german.resources.ui, app: {...german.resources.ui.app, activeProfile: 'Hallo {{unexpected}}'}}}},
                {...german, resources: {...german.resources, ui: {...german.resources.ui, common: {...german.resources.ui.common, save: '<script>alert(1)</script>'}}}},
            ];
            for (const invalid of invalidCatalogs) {
                await fs.writeFile(germanPath, JSON.stringify(invalid));
                expect(() => generate('generate-locales.mjs', ['--source', source, '--output-root', destination])).toThrow();
            }
        } finally {
            await removeTemporary(temporary);
        }
    }, 40_000);

    // Six generator processes check the complete positive/negative node matrix;
    // allow local process and filesystem overhead without weakening an assertion.
    it('validates authored node names in every translated and plural variant', async () => {
        const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'surveyor-generation-rich-'));
        try {
            const source = path.join(temporary, 'locales');
            const destination = path.join(temporary, 'output');
            await fs.cp(path.join(root, 'src/common/locales'), source, {recursive: true});
            generate('generate-locales.mjs', ['--source', source, '--output-root', destination]);
            const manifest = JSON.parse(await fs.readFile(path.join(destination, 'src/common/localization/generated/manifest.json'), 'utf8'));
            expect(manifest.messages['activity.progressFree']).toMatchObject({nodes: ['assigned'], plural: true});
            const germanPath = path.join(source, 'de.json');
            const original = await fs.readFile(germanPath, 'utf8');
            for (const text of ['Ohne Platzhalter', 'Mit {unknown}', 'Mit {add} und {add}', '<b>{add}</b>']) {
                const german = JSON.parse(original);
                german.resources.ui.activity.recommendations.scheduleHint = text;
                await fs.writeFile(germanPath, JSON.stringify(german));
                expect(() => generate('generate-locales.mjs', ['--source', source, '--output-root', destination])).toThrow();
            }
            // A single broken plural variant must fail even if the other
            // variant still contains the complete declared node vocabulary.
            const german = JSON.parse(original);
            german.resources.ui.activity.progressFree_one = 'Ein Einsatz ohne Knoten';
            await fs.writeFile(germanPath, JSON.stringify(german));
            expect(() => generate('generate-locales.mjs', ['--source', source, '--output-root', destination])).toThrow('Authored node drift');
        } finally { await removeTemporary(temporary); }
    }, 40_000);

    it('compiles real consumers and required negative assertions with the installed TypeScript', () => {
        execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--ignoreConfig',
            '--noEmit', '--strict', '--skipLibCheck', '--target', 'ES2024', '--module', 'NodeNext',
            '--moduleResolution', 'NodeNext', '--resolveJsonModule', '--esModuleInterop',
        path.join(root, 'tests/fixtures/frontend-contracts.mts')], {cwd: root, stdio: 'pipe'});
    }, 20_000);
});
