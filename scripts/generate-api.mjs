/** Compile the authored OpenAPI contract into types and eval-free validators for both runtimes. */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import YAML from 'yaml';
import openapiTS, {astToString} from 'openapi-typescript';
import Ajv2020, {_, str} from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import standaloneCode from 'ajv/dist/standalone/index.js';
import {build} from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputArgument = process.argv.indexOf('--output-root');
const outputRoot = outputArgument < 0 ? root : path.resolve(process.argv[outputArgument + 1]);
const check = process.argv.includes('--check');
const sourceDirectory = path.join(root, 'contracts/api/v1');
const artifactDirectory = '.generated/api/v1';
const policyHeaders = new Set(['x-surveyor-context', 'x-csrf-token', 'if-match']);
const methods = new Set(['get', 'post', 'put', 'patch', 'delete']);
const banner = '// Generated from contracts/api/v1; do not edit.\n';

/** Reject remote and escaping references before handing any document to a resolver. */
function inspectReferences(value, sourceFile) {
    if (!value || typeof value !== 'object') return;

    // Check each reference before resolving or executing a third-party bundler.
    // Empty filenames refer to the current authored document, never another root.
    if (typeof value.$ref === 'string') {
        const [file] = value.$ref.split('#');
        if (/^[a-z][a-z\d+.-]*:/i.test(file) || path.isAbsolute(file)) throw new Error(`External reference in ${sourceFile}`);
        const target = path.resolve(path.dirname(sourceFile), file || path.basename(sourceFile));
        const relative = path.relative(sourceDirectory, target);
        if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Reference leaves contract directory: ${value.$ref}`);
    }
    // References can occur in nested schemas as well as at an operation boundary.
    for (const nested of Object.values(value)) inspectReferences(nested, sourceFile);
}

/** Resolve references only within the already bundled document. */
function resolve(document, value) {
    if (!value?.$ref) return value;
    if (!value.$ref.startsWith('#/')) throw new Error(`Unbundled reference: ${value.$ref}`);

    // Follow escaped JSON Pointer members inside the verified bundled document.
    let found = document;
    for (const part of value.$ref.slice(2).split('/')) found = found?.[part.replace(/~1/g, '/').replace(/~0/g, '~')];
    if (!found) throw new Error(`Missing bundled reference: ${value.$ref}`);
    return resolve(document, found);
}

/** Ajv receives exactly the contract vocabulary; only reference destinations are rewritten. */
function validatorSchema(value, id, additive = false, insideParameters = false) {
    // Preserve arrays and scalar vocabulary before rewriting object/reference nodes.
    if (Array.isArray(value)) {
        const result = [];
        for (const item of value) result.push(validatorSchema(item, id, additive, insideParameters));
        return result;
    }
    if (!value || typeof value !== 'object') return value;
    const result = {};
    for (const [key, nested] of Object.entries(value)) {
        if (key === '$ref') {
            if (!nested.startsWith('#/components/schemas/')) throw new Error(`Unsupported schema reference: ${nested}`);
            result.$ref = `${id}#/$defs/${nested.slice('#/components/schemas/'.length)}`;
        } else if (key === 'additionalProperties' && nested === false && additive && !insideParameters) {
            // New response fields are compatible. Never weaken known error parameter contracts.
            result[key] = true;
        } else if (key === 'properties') {
            // Error parameters keep their strict authored shape even inside an
            // additive browser response graph. Other fields inherit their graph.
            const properties = [];
            for (const [name, schema] of Object.entries(nested)) {
                properties.push([name, validatorSchema(schema, id, additive, insideParameters || name === 'params')]);
            }
            result[key] = Object.fromEntries(properties);
        } else {
            result[key] = validatorSchema(nested, id, additive, insideParameters);
        }
    }
    return result;
}

/** Require operations to name shared authored schemas rather than invent inline DTOs. */
function schemaName(schema) {
    const prefix = '#/components/schemas/';
    if (!schema?.$ref?.startsWith(prefix)) throw new Error('Operations must reference a named schema');
    return schema.$ref.slice(prefix.length);
}

/** Derive a validator identifier from the already validated nonempty operation name. */
function upperFirst(value) { return value[0].toUpperCase() + value.slice(1); }

/**
 * Native HTML/password checks count UTF-16 units, while JSON Schema minLength counts
 * code points. Only an explicitly authored extension selects the native unit; other
 * string constraints retain their standard meaning. Inline Ajv code generation keeps
 * this check in both standalone runtimes without a runtime compiler or another validator.
 */
function compileUtf16Minimum(context) {
    const {data, schemaCode} = context;
    // Ajv's string type rule guards this expression. The authored threshold is emitted
    // directly, so no feature field names or copied password limits enter the generator.
    context.fail(_`${data}.length < ${schemaCode}`);
}

function utf16MinimumMessage({schemaCode}) {
    return str`must NOT have fewer than ${schemaCode} UTF-16 code units`;
}

function utf16MinimumParameters({schemaCode}) {
    return _`{limit: ${schemaCode}}`;
}

/** Parameter containers are derived transport shapes, not separately authored DTOs. */
function parameterSchema(parameters) {
    const properties = {};
    for (const group of ['path', 'query', 'header']) {
        // Common policy headers are checked by their owning middleware, not copied
        // into each feature's transport parameter validator.
        const members = [];
        const required = [];
        for (const parameter of parameters) {
            if (parameter.in !== group || group === 'header' && policyHeaders.has(parameter.name.toLowerCase())) continue;
            members.push([parameter.name, parameter.schema]);
            if (parameter.required) required.push(parameter.name);
        }
        properties[group] = {type: 'object', additionalProperties: false,
            properties: Object.fromEntries(members), required};
    }
    return {type: 'object', additionalProperties: false, required: ['path', 'query', 'header'], properties};
}

// Stable authored ordering makes clean-tree generation reproducible. Parse every
// YAML input before bundling so duplicate keys or external references fail visibly.
const files = (await fs.readdir(sourceDirectory)).filter(file => file.endsWith('.yaml')).sort();
const sourceHash = createHash('sha256');
for (const file of files) {
    const source = await fs.readFile(path.join(sourceDirectory, file), 'utf8');
    sourceHash.update(file).update('\0').update(source).update('\0');
    const parsed = YAML.parseDocument(source, {uniqueKeys: true});
    if (parsed.errors.length) throw new Error(parsed.errors.map(error => error.message).join('\n'));
    inspectReferences(parsed.toJSON(), path.join(sourceDirectory, file));
}

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'surveyor-contract-'));
let document;
try {
    const cli = path.join(root, 'node_modules/@redocly/cli/bin/cli.js');
    const entry = path.join(sourceDirectory, 'openapi.yaml');
    // The CLI is installed locally. No npx/network fallback can change generation inputs.
    // Local contract validation needs neither analytics nor remote update checks.
    // Keep both real commands and their failures, removing only ancillary network work.
    const cliOptions = {cwd: root, stdio: 'pipe', env: {...process.env,
        REDOCLY_TELEMETRY: 'off', REDOCLY_SUPPRESS_UPDATE_NOTICE: 'true'}};
    execFileSync(process.execPath, [cli, 'lint', entry, '--extends', 'minimal'], cliOptions);
    const bundled = path.join(temporary, 'openapi.json');
    execFileSync(process.execPath, [cli, 'bundle', entry, '--output', bundled], cliOptions);
    document = JSON.parse(await fs.readFile(bundled, 'utf8'));
} catch (error) {
    if (error.stdout) process.stderr.write(error.stdout);
    if (error.stderr) process.stderr.write(error.stderr);
    throw error;
} finally {
    if (path.dirname(path.resolve(temporary)) !== path.resolve(os.tmpdir()) || !path.basename(temporary).startsWith('surveyor-contract-')) {
        throw new Error('Refusing unexpected contract temporary-directory cleanup');
    }
    await fs.rm(temporary, {recursive: true, force: true});
}

if (document.openapi !== '3.1.1' || document.jsonSchemaDialect !== 'https://json-schema.org/draft/2020-12/schema') {
    throw new Error('The generator supports the declared OpenAPI 3.1.1 / JSON Schema 2020-12 dialect only');
}

const schemas = document.components.schemas;
const derivedSchemas = {};
const requestSchemas = new Set();
const operations = [];
const operationIds = new Set();
for (const [route, unresolvedPathItem] of Object.entries(document.paths)) {
    const pathItem = resolve(document, unresolvedPathItem);
    for (const [method, operation] of Object.entries(pathItem)) {
        if (!methods.has(method)) continue;
        if (!operation.operationId || operationIds.has(operation.operationId)) throw new Error('Missing or duplicate operation ID');
        operationIds.add(operation.operationId);
        const parameters = [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])].map(parameter => resolve(document, parameter));
        const names = new Set();
        for (const parameter of parameters) {
            const identity = `${parameter.in}:${parameter.name}`;
            if (names.has(identity)) throw new Error(`Duplicate parameter: ${identity}`);
            names.add(identity);
            // Check the binding representation, not the authored schema's shape.
            // The generated validators preserve arrays, objects and unions; their
            // declaration alone does not install a corresponding runtime codec.
            if (!['path', 'query', 'header'].includes(parameter.in) || parameter.content
                || (parameter.style && parameter.style !== (parameter.in === 'query' ? 'form' : 'simple'))) {
                throw new Error(`Unsupported API parameter serialization: ${identity}`);
            }
            // Runtime transport metadata must contain resolved shapes, not a second reference resolver.
            parameter.schema = resolve(document, parameter.schema);
        }
        let requestSchema = null;
        let requestMediaType = null;
        if (operation.requestBody) {
            const body = resolve(document, operation.requestBody);
            requestMediaType = Object.keys(body.content).join();
            if (!['application/json', 'multipart/form-data'].includes(requestMediaType)) throw new Error('Unsupported API request media type');
            requestSchema = schemaName(body.content[requestMediaType].schema);
            requestSchemas.add(requestSchema);
        }
        const responseSchemas = {};
        const responseMediaTypes = {};
        for (const [status, unresolved] of Object.entries(operation.responses)) {
            const response = resolve(document, unresolved);
            if (!response.content) { responseSchemas[status] = null; continue; }
            const entries = Object.entries(response.content);
            // One status has one schema/media slot in the existing manifest.
            // Preserve the authored media name rather than ban future outputs;
            // an HTTP writer remains responsible for implementing its encoding.
            if (entries.length !== 1) {
                throw new Error('An API response must declare exactly one media type');
            }
            responseMediaTypes[status] = entries[0][0];
            responseSchemas[status] = schemaName(entries[0][1].schema);
        }
        const parametersName = `${upperFirst(operation.operationId)}Parameters`;
        derivedSchemas[parametersName] = parameterSchema(parameters);
        requestSchemas.add(parametersName);
        const policy = operation['x-surveyor-command'];
        if (!policy || !['read', 'natural-idempotent', 'reconcile-only'].includes(policy.retryPolicy)
            || !['none', 'metadata', 'item', 'order', 'settings'].includes(policy.precondition)
            || (method === 'get') !== (policy.retryPolicy === 'read')) {
            throw new Error(`Missing or invalid authored command policy: ${operation.operationId}`);
        }
        const successStatuses = Object.keys(responseSchemas).map(Number).filter(status => status >= 200 && status < 300);
        operations.push({operationId: operation.operationId, method: method.toUpperCase(), path: route, parameters,
            parametersValidator: `validate${parametersName}`, requestSchema, requestMediaType, responseSchemas, responseMediaTypes,
            successStatuses, policy});
    }
}

// Localization derives problem parameters from these authored variants; it must
// not maintain another handwritten error inventory.
const problems = [];
for (const variant of schemas.Problem.oneOf) {
    problems.push({code: variant.properties.code.const, status: variant.properties.status.const,
        messageKey: variant.properties.messageKey.const, paramsSchema: variant.properties.params});
}
const apiCompatibility = document['x-surveyor-api-compatibility'];
if (typeof apiCompatibility !== 'string' || !/^[a-zA-Z0-9-]{1,128}$/u.test(apiCompatibility)) throw new Error('Missing API compatibility family');
const manifest = {sourceHash: sourceHash.digest('hex'), apiCompatibility, schemas: Object.keys(schemas), operations, problems};
const allSchemas = {...schemas, ...derivedSchemas};
const output = new Map();
output.set(`${artifactDirectory}/openapi.json`, `${JSON.stringify(document, null, 2)}\n`);
output.set(`${artifactDirectory}/operations.json`, `${JSON.stringify(manifest, null, 2)}\n`);
output.set('src/types/api/v1.d.ts', banner + astToString(await openapiTS(document)));
// Small policy metadata belongs in the shell; feature validators remain separate lazy modules below.
output.set(`${artifactDirectory}/policy.mjs`, banner + `export const apiCompatibility = ${JSON.stringify(apiCompatibility)};\nexport const operationPolicies = ${JSON.stringify(Object.fromEntries(
    operations.map(operation => [operation.operationId, {successStatuses: operation.successStatuses, ...operation.policy}])))};\n`);
output.set(`${artifactDirectory}/policy.d.mts`, banner + "import type {operations} from '../../../src/types/api/v1.js';\n"
    + `export const apiCompatibility: ${JSON.stringify(apiCompatibility)};\n`
    + "export const operationPolicies: Record<keyof operations, {successStatuses: readonly number[]; retryPolicy: 'read' | 'natural-idempotent' | 'reconcile-only'; precondition: 'none' | 'metadata' | 'item' | 'order' | 'settings'}>;\n");

let declarations = `${banner}import type {components, operations} from './v1';\nimport type {ErrorObject} from 'ajv';\n\n`;
declarations += 'export interface GeneratedValidator<T> { (data: unknown): data is T; errors?: ErrorObject[] | null; }\n';
declarations += 'type Present<T> = [NonNullable<T>] extends [never] ? Record<string, never> : NonNullable<T>;\n';
declarations += "type Parameters<K extends keyof operations> = { path: Present<operations[K]['parameters']['path']>; query: Present<operations[K]['parameters']['query']>; header: Omit<Present<operations[K]['parameters']['header']>, 'X-Surveyor-Context' | 'X-CSRF-Token' | 'If-Match'>; };\n";
declarations += 'export interface ValidationSchemas {\n';
for (const name of Object.keys(schemas)) declarations += `    ${name}: components['schemas']['${name}'];\n`;
for (const operation of operations) declarations += `    ${upperFirst(operation.operationId)}Parameters: Parameters<'${operation.operationId}'>;\n`;
declarations += '}\nexport type ValidatorSet = { [K in keyof ValidationSchemas as `validate${K}`]: GeneratedValidator<ValidationSchemas[K]>; };\n';
output.set('src/types/api/validation-v1.d.ts', declarations);

// A request may reach shared shapes through multipart metadata or another named object.
// Follow those references for direct validator exports, while keeping response traversal
// separate: the same authored shape can be strict in a request and additive in a response.
/** Include transitive request schemas without weakening their response counterparts. */
function includeRequestReferences(value) {
    if (!value || typeof value !== 'object') return;

    // Mark before traversing so recursive schema graphs terminate and each named
    // request shape receives the strict browser validation graph.
    if (typeof value.$ref === 'string' && value.$ref.startsWith('#/components/schemas/')) {
        const name = value.$ref.slice('#/components/schemas/'.length);
        if (!requestSchemas.has(name)) {
            requestSchemas.add(name);
            includeRequestReferences(allSchemas[name]);
        }
    }
    for (const nested of Object.values(value)) includeRequestReferences(nested);
}
for (const name of [...requestSchemas]) includeRequestReferences(allSchemas[name]);

/** Bundle one lazy browser validator using the same compiled schema graph.
 * These independent builds may run concurrently; all results are collected before
 * the normal output/check phase publishes or compares any generated artifact. */
async function bundleBrowserValidator(exportName, reference, ajv, output) {
    // Standalone code carries its own referenced shapes and helpers. No Ajv compiler
    // enters the application runtime or needs to run during feature navigation.
    const single = standaloneCode(ajv, {[exportName]: reference});
    const result = await build({stdin: {contents: single, resolveDir: root, sourcefile: `${exportName}.mjs`},
        bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2020', legalComments: 'none'});

    // Keep the lazy runtime and its declaration paired under the existing owner.
    output.set(`${artifactDirectory}/browser/${exportName}.mjs`, banner + result.outputFiles[0].text);
    output.set(`${artifactDirectory}/browser/${exportName}.d.mts`, banner
        + `import type {ValidatorSet} from '../../../../src/types/api/validation-v1.js';\n`
        + `export const ${exportName}: ValidatorSet['${exportName}'];\n`);
}

for (const browser of [false, true]) {
    const id = `urn:surveyor:api:v1:${browser ? 'browser' : 'server'}`;
    const requestId = browser ? `${id}:request` : id;
    const ajv = new Ajv2020({strict: true, allErrors: true, coerceTypes: false, useDefaults: false,
        removeAdditional: false, validateFormats: true, code: {source: true, esm: browser}});
    addFormats(ajv);
    ajv.addKeyword({keyword: 'x-surveyor-min-length-utf16', type: 'string', schemaType: 'number',
        metaSchema: {type: 'integer', minimum: 0}, code: compileUtf16Minimum,
        error: {message: utf16MinimumMessage, params: utf16MinimumParameters}});
    // Binary is a transport marker; the upload owner checks file presence, media and size.
    ajv.addFormat('binary', true);
    for (const graphId of browser ? [id, requestId] : [id]) {
        const additive = browser && graphId === id;
        const definitions = [];
        for (const [name, schema] of Object.entries(allSchemas)) {
            definitions.push([name, validatorSchema(schema, graphId, additive)]);
        }
        ajv.addSchema({$id: graphId, $defs: Object.fromEntries(definitions)});
    }
    const exportMap = {};
    for (const name of Object.keys(allSchemas)) {
        const graphId = browser && requestSchemas.has(name) ? requestId : id;
        const reference = `${graphId}#/$defs/${name}`;
        ajv.getSchema(reference);
        exportMap[`validate${name}`] = reference;
    }
    const generated = standaloneCode(ajv, exportMap);
    const bundled = await build({stdin: {contents: generated, resolveDir: root, sourcefile: browser ? 'validators.mjs' : 'validators.cjs'},
        bundle: true, write: false, platform: browser ? 'browser' : 'node', format: browser ? 'esm' : 'cjs',
        target: browser ? 'es2022' : 'node24', legalComments: 'none'});
    const basename = browser ? 'browser' : 'server';
    output.set(`${artifactDirectory}/${basename}.${browser ? 'mjs' : 'cjs'}`, banner + bundled.outputFiles[0].text);
    let signatures = `${banner}import type {ValidatorSet} from '../../../src/types/api/validation-v1.js';\n`;
    for (const name of Object.keys(allSchemas)) signatures += `export const validate${name}: ValidatorSet['validate${name}'];\n`;
    output.set(`${artifactDirectory}/${basename}.d.${browser ? 'mts' : 'cts'}`, signatures);
    if (browser) {
        // A standalone module per schema lets Vite load only a route's validation graph. Each module
        // bundles its referenced shapes and helpers, with no Ajv compiler in the application runtime.
        const builds = [];
        for (const [exportName, reference] of Object.entries(exportMap)) {
            builds.push(bundleBrowserValidator(exportName, reference, ajv, output));
        }
        await Promise.all(builds);
    }
}

/** Inspect the physical browser directory without accepting redirected ancestors.
 * Reuse this check before publication and deletion; file IDs distinguish even
 * differently cased directories on case-sensitive Windows volumes. */
async function inspectBrowserDirectory(actualRoot) {
    // The selected output root may be an explicit alias, already canonicalized
    // by the caller. Its physical directory and every output ancestor must stay plain.
    const directories = [actualRoot];
    for (const segment of `${artifactDirectory}/browser`.split('/')) {
        directories.push(path.join(directories.at(-1), segment));
    }

    let identity;
    for (const directory of directories) {
        identity = await fs.lstat(directory, {bigint: true});
        if (!identity.isDirectory() || identity.isSymbolicLink()) {
            throw new Error('Refusing browser validator cleanup through a redirected output directory');
        }
    }
    return {directory: directories.at(-1), identity};
}

/** Find retired direct browser outputs without changing them. Expected files
 * are skipped before reading; foreign files, links and nested trees stay outside
 * this generator's cleanup. Validate the real directory before publication. */
async function obsoleteBrowserValidators() {
    const directory = path.join(outputRoot, artifactDirectory, 'browser');
    let information;
    try {
        information = await fs.lstat(directory);
    } catch (error) {
        if (error.code === 'ENOENT') return {directory, files: []};
        throw error;
    }

    // Deletion must stay in the actual output root, even when an intermediate
    // path was redirected. A fresh output tree has no older artifacts to retire.
    const actualRoot = await fs.realpath(outputRoot);
    const inspected = await inspectBrowserDirectory(actualRoot);
    if (!information.isDirectory() || information.isSymbolicLink()) {
        throw new Error('Refusing browser validator cleanup through a redirected output directory');
    }

    const currentBrowserPaths = [...output.keys()].filter(relative => relative.startsWith(`${artifactDirectory}/browser/`));
    const files = [];
    for (const entry of await fs.readdir(directory, {withFileTypes: true})) {
        const relative = `${artifactDirectory}/browser/${entry.name}`;
        if (output.has(relative) || !entry.isFile() || !/^validate.+\.(?:mjs|d\.mts)$/u.test(entry.name)) continue;

        // A case-only contract rename can still address this same file on a
        // case-insensitive volume. Compare exact file identities, including on
        // case-sensitive Windows directories; bigint retains full file IDs.
        let currentAlias = false;
        for (const current of currentBrowserPaths) {
            if (path.basename(current).toLowerCase() !== entry.name.toLowerCase()) continue;
            try {
                const candidateIdentity = await fs.lstat(path.join(directory, entry.name), {bigint: true});
                const currentIdentity = await fs.lstat(path.join(outputRoot, current), {bigint: true});
                currentAlias = currentIdentity.isFile() && candidateIdentity.isFile()
                    && currentIdentity.dev === candidateIdentity.dev && currentIdentity.ino === candidateIdentity.ino;
            } catch (error) {
                if (error.code !== 'ENOENT') throw error;
            }
            if (currentAlias) break;
        }
        if (currentAlias) continue;

        // Naming alone never grants cleanup ownership. Keep another producer's
        // file even when it uses a validator-like filename.
        if ((await fs.readFile(path.join(directory, entry.name), 'utf8')).startsWith(banner)) files.push(entry.name);
    }
    return {actualRoot, ...inspected, files};
}

const obsolete = await obsoleteBrowserValidators();

// Reuse successful directory preparation within this invocation. Keep creation
// lazy and writes ordered so a failure still stops at its owning artifact.
const preparedDirectories = new Set();
for (const [relative, content] of output) {
    const destination = path.join(outputRoot, relative);
    if (check) {
        const existing = await fs.readFile(destination, 'utf8').catch(() => null);
        if (existing !== content) throw new Error(`Generated artifact is stale: ${relative}`);
    } else {
        const directory = path.dirname(destination);
        if (!preparedDirectories.has(directory)) {
            await fs.mkdir(directory, {recursive: true});
            preparedDirectories.add(directory);
        }
        await fs.writeFile(destination, content);
    }
}

// Retire old modules only after every current artifact is complete. Check mode
// remains read-only, including when it reports an obsolete generated module.
for (const filename of obsolete.files) {
    if (check) throw new Error(`Obsolete generated browser validator: ${filename}`);
    const destination = path.join(obsolete.directory, filename);
    const information = await fs.lstat(destination);
    // Recheck physical containment and ownership after publication; a changed
    // path must not turn the earlier inventory into authority to delete it.
    const logicalDirectory = path.join(outputRoot, artifactDirectory, 'browser');
    const inspected = await inspectBrowserDirectory(obsolete.actualRoot);
    const logicalIdentity = await fs.lstat(logicalDirectory, {bigint: true});
    if (inspected.identity.dev !== obsolete.identity.dev || inspected.identity.ino !== obsolete.identity.ino
        || !logicalIdentity.isDirectory() || logicalIdentity.isSymbolicLink()
        || logicalIdentity.dev !== obsolete.identity.dev || logicalIdentity.ino !== obsolete.identity.ino || !information.isFile()
        || information.isSymbolicLink() || !(await fs.readFile(destination, 'utf8')).startsWith(banner)) {
        throw new Error(`Browser validator cleanup ownership changed: ${filename}`);
    }
    await fs.unlink(destination);
}
process.stdout.write(`API contract ${manifest.sourceHash.slice(0, 12)}: ${operations.length} operations, ${Object.keys(schemas).length} schemas (${check ? 'checked' : 'generated'}).\n`);
