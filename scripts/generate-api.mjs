/** Compile the authored OpenAPI contract into types and eval-free validators for both runtimes. */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import YAML from 'yaml';
import openapiTS, {astToString} from 'openapi-typescript';
import Ajv2020 from 'ajv/dist/2020.js';
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
    if (typeof value.$ref === 'string') {
        const [file] = value.$ref.split('#');
        if (/^[a-z][a-z\d+.-]*:/i.test(file) || path.isAbsolute(file)) throw new Error(`External reference in ${sourceFile}`);
        const target = path.resolve(path.dirname(sourceFile), file || path.basename(sourceFile));
        const relative = path.relative(sourceDirectory, target);
        if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Reference leaves contract directory: ${value.$ref}`);
    }
    for (const nested of Object.values(value)) inspectReferences(nested, sourceFile);
}

/** Resolve references only within the already bundled document. */
function resolve(document, value) {
    if (!value?.$ref) return value;
    if (!value.$ref.startsWith('#/')) throw new Error(`Unbundled reference: ${value.$ref}`);
    let found = document;
    for (const part of value.$ref.slice(2).split('/')) found = found?.[part.replace(/~1/g, '/').replace(/~0/g, '~')];
    if (!found) throw new Error(`Missing bundled reference: ${value.$ref}`);
    return resolve(document, found);
}

/** Ajv receives exactly the contract vocabulary; only reference destinations are rewritten. */
function validatorSchema(value, id, additive = false, insideParameters = false) {
    if (Array.isArray(value)) return value.map(item => validatorSchema(item, id, additive, insideParameters));
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
            result[key] = Object.fromEntries(Object.entries(nested).map(([name, schema]) =>
                [name, validatorSchema(schema, id, additive, insideParameters || name === 'params')]));
        } else {
            result[key] = validatorSchema(nested, id, additive, insideParameters);
        }
    }
    return result;
}

function schemaName(schema) {
    const prefix = '#/components/schemas/';
    if (!schema?.$ref?.startsWith(prefix)) throw new Error('Operations must reference a named schema');
    return schema.$ref.slice(prefix.length);
}

function upperFirst(value) { return value[0].toUpperCase() + value.slice(1); }

/** Parameter containers are derived transport shapes, not separately authored DTOs. */
function parameterSchema(parameters) {
    const properties = {};
    for (const group of ['path', 'query', 'header']) {
        const members = parameters.filter(parameter => parameter.in === group
            && !(group === 'header' && policyHeaders.has(parameter.name.toLowerCase())));
        properties[group] = {type: 'object', additionalProperties: false,
            properties: Object.fromEntries(members.map(parameter => [parameter.name, parameter.schema])),
            required: members.filter(parameter => parameter.required).map(parameter => parameter.name)};
    }
    return {type: 'object', additionalProperties: false, required: ['path', 'query', 'header'], properties};
}

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
    execFileSync(process.execPath, [cli, 'lint', entry, '--extends', 'minimal'], {cwd: root, stdio: 'pipe'});
    const bundled = path.join(temporary, 'openapi.json');
    execFileSync(process.execPath, [cli, 'bundle', entry, '--output', bundled], {cwd: root, stdio: 'pipe'});
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
            if (!['path', 'query', 'header'].includes(parameter.in) || parameter.content
                || (parameter.style && parameter.style !== (parameter.in === 'query' ? 'form' : 'simple'))
                || resolve(document, parameter.schema)?.type === 'array') {
                throw new Error(`Unsupported pilot parameter serialization: ${identity}`);
            }
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
            if (entries.length !== 1 || !['application/json', 'application/problem+json', 'application/octet-stream'].includes(entries[0][0])) {
                throw new Error('Unsupported pilot response media type');
            }
            responseMediaTypes[status] = entries[0][0];
            responseSchemas[status] = schemaName(entries[0][1].schema);
        }
        const parametersName = `${upperFirst(operation.operationId)}Parameters`;
        derivedSchemas[parametersName] = parameterSchema(parameters);
        requestSchemas.add(parametersName);
        operations.push({operationId: operation.operationId, method: method.toUpperCase(), path: route, parameters,
            parametersValidator: `validate${parametersName}`, requestSchema, requestMediaType, responseSchemas, responseMediaTypes});
    }
}

const problems = schemas.Problem.oneOf.map(variant => ({
    code: variant.properties.code.const,
    status: variant.properties.status.const,
    messageKey: variant.properties.messageKey.const,
    paramsSchema: variant.properties.params,
}));
const manifest = {sourceHash: sourceHash.digest('hex'), schemas: Object.keys(schemas), operations, problems};
const allSchemas = {...schemas, ...derivedSchemas};
const output = new Map();
output.set(`${artifactDirectory}/openapi.json`, `${JSON.stringify(document, null, 2)}\n`);
output.set(`${artifactDirectory}/operations.json`, `${JSON.stringify(manifest, null, 2)}\n`);
output.set('src/types/api/v1.d.ts', banner + astToString(await openapiTS(document)));

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
function includeRequestReferences(value) {
    if (!value || typeof value !== 'object') return;
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

for (const browser of [false, true]) {
    const id = `urn:surveyor:api:v1:${browser ? 'browser' : 'server'}`;
    const requestId = browser ? `${id}:request` : id;
    const ajv = new Ajv2020({strict: true, allErrors: true, coerceTypes: false, useDefaults: false,
        removeAdditional: false, validateFormats: true, code: {source: true, esm: browser}});
    addFormats(ajv);
    // Binary is a transport marker; the upload owner checks file presence, media and size.
    ajv.addFormat('binary', true);
    for (const graphId of browser ? [id, requestId] : [id]) {
        const additive = browser && graphId === id;
        const definitions = Object.fromEntries(Object.entries(allSchemas).map(([name, schema]) =>
            [name, validatorSchema(schema, graphId, additive)]));
        ajv.addSchema({$id: graphId, $defs: definitions});
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
}

for (const [relative, content] of output) {
    const destination = path.join(outputRoot, relative);
    if (check) {
        const existing = await fs.readFile(destination, 'utf8').catch(() => null);
        if (existing !== content) throw new Error(`Generated artifact is stale: ${relative}`);
    } else {
        await fs.mkdir(path.dirname(destination), {recursive: true});
        await fs.writeFile(destination, content);
    }
}
process.stdout.write(`API contract ${manifest.sourceHash.slice(0, 12)}: ${operations.length} operations, ${Object.keys(schemas).length} schemas (${check ? 'checked' : 'generated'}).\n`);
