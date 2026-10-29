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
import {_Code} from 'ajv/dist/compile/codegen/code.js';
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
        } else if (key === 'x-surveyor-controller-status-override') {
            // This reviewed controller-adapter annotation belongs to the
            // manifest, not JSON payload validation or executable vocabulary.
            continue;
        } else if (key === 'x-surveyor-runtime-choices') {
            // Generation validates this annotation against its owning enum. It
            // selects shared runtime data, never another JSON validation rule.
            continue;
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

/** Compile the shared UTF-8 measurement into both standalone validation runtimes. */
function compileUtf8Maximum(context) {
    const {data, schemaCode} = context;
    // Bundle the exact common function below; no independent byte algorithm or
    // generated runtime path is imported by the server or the browser.
    const measure = context.gen.scopeValue('func', {ref: utf8ByteLength,
        code: new _Code(`(${utf8ByteLength.toString()})`)});
    context.fail(_`${measure}(${data}) > ${schemaCode}`);
}

function utf8MaximumMessage({schemaCode}) {
    return str`must NOT exceed ${schemaCode} UTF-8 bytes`;
}

function utf8MaximumParameters({schemaCode}) {
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

/** Follow authored request schema identities before bundling can coalesce aliases.
 * Named response aliases retain their own direct-validator role, while each
 * request and its nested references still use the existing strict graph. */
function authoredRequestSchemas(documents, entryFile) {
    const requested = new Set();
    const responded = new Set();
    const requestVisits = new Set();
    const responseVisits = new Set();
    const entry = documents.get(entryFile);

    /** Resolve one local/external pointer with the source document it actually owns. */
    function reference(value, sourceFile, aliases = new Set()) {
        const [relative, fragment = ''] = value.split('#');
        let filename = path.resolve(path.dirname(sourceFile), relative || path.basename(sourceFile));
        const pointer = decodeURIComponent(fragment);
        if (pointer && !pointer.startsWith('/')) throw new Error('Unsupported authored contract fragment');
        const members = pointer ? pointer.slice(1).split('/').map(member => member.replace(/~1/g, '/').replace(/~0/g, '~')) : [];
        let target = documents.get(filename);
        let resolvedMembers = [];
        for (const member of members) {
            // Authored parameters may select a property through an exported
            // alias. Resolve that intermediate owner without marking its whole
            // enclosing response/request declaration as a selected schema.
            while (typeof target?.$ref === 'string') {
                const alias = filename + '#' + resolvedMembers.join('/');
                if (aliases.has(alias)) throw new Error('Recursive authored pointer alias');
                aliases.add(alias);
                const next = reference(target.$ref, filename, aliases);
                target = next.value;
                filename = next.filename;
                resolvedMembers = next.members;
            }
            target = target?.[member];
            resolvedMembers = [...resolvedMembers, member];
        }
        if (target === undefined) throw new Error('Missing authored contract reference: ' + value);
        const resolvedPointer = resolvedMembers.map(member => member.replace(/~/g, '~0').replace(/\//g, '~1')).join('/');
        return {value: target, filename, members: resolvedMembers, identity: filename + '#/' + resolvedPointer};
    }

    /** Wrapper references select the actual path, parameter or body declaration;
     * they do not themselves turn a response schema into a request schema. */
    function declaration(value, sourceFile) {
        const chain = new Set();
        while (value?.$ref) {
            const next = reference(value.$ref, sourceFile);
            if (chain.has(next.identity)) throw new Error('Recursive authored transport declaration');
            chain.add(next.identity);
            value = next.value;
            sourceFile = next.filename;
        }
        return {value, filename: sourceFile};
    }

    /** Mark the exact referenced node before descending. A property reference
     * never marks its enclosing response, and recursive graphs terminate here. */
    function include(value, sourceFile, identities, visited) {
        if (!value || typeof value !== 'object') return;
        if (typeof value.$ref === 'string') {
            const next = reference(value.$ref, sourceFile);
            identities.add(next.identity);
            if (!visited.has(next.identity)) {
                visited.add(next.identity);
                include(next.value, next.filename, identities, visited);
            }
        }
        for (const [name, nested] of Object.entries(value)) if (name !== '$ref') include(nested, sourceFile, identities, visited);
    }

    // Follow path-item and operation wrappers using their own file coordinates.
    // Request and response usage remain separate. A response-only alias must
    // retain its own role even when its concrete target is used by a command.
    for (const unresolved of Object.values(entry.paths)) {
        const pathItem = declaration(unresolved, entryFile);
        for (const [method, unresolvedOperation] of Object.entries(pathItem.value)) {
            if (!methods.has(method)) continue;
            const operation = declaration(unresolvedOperation, pathItem.filename);
            for (const [parameter, owner] of [
                ...(pathItem.value.parameters ?? []).map(value => [value, pathItem.filename]),
                ...(operation.value.parameters ?? []).map(value => [value, operation.filename]),
            ]) {
                const resolved = declaration(parameter, owner);
                include(resolved.value.schema, resolved.filename, requested, requestVisits);
            }
            if (operation.value.requestBody) {
                const body = declaration(operation.value.requestBody, operation.filename);
                for (const media of Object.values(body.value.content)) include(media.schema, body.filename, requested, requestVisits);
            }
            for (const unresolved of Object.values(operation.value.responses)) {
                const response = declaration(unresolved, operation.filename);
                for (const media of Object.values(response.value.content ?? {})) {
                    include(media.schema, response.filename, responded, responseVisits);
                }
            }
        }
    }

    // The first actually used identity decides each export's role. Request
    // usage wins for a mixed identity. Unused aliases inherit the first used
    // target in their explicit chain, independent of every symbol's spelling.
    const names = new Set();
    for (const [name, schema] of Object.entries(entry.components.schemas)) {
        const own = entryFile + '#/components/schemas/' + name.replace(/~/g, '~0').replace(/\//g, '~1');
        if (requested.has(own) || responded.has(own)) {
            if (requested.has(own)) names.add(name);
            continue;
        }
        const chain = new Set();
        let value = schema;
        let owner = entryFile;
        while (typeof value?.$ref === 'string') {
            const next = reference(value.$ref, owner);
            if (chain.has(next.identity)) break;
            chain.add(next.identity);
            if (requested.has(next.identity) || responded.has(next.identity)) {
                if (requested.has(next.identity)) names.add(name);
                break;
            }
            value = next.value;
            owner = next.filename;
        }
    }
    return {names};
}

// Stable authored ordering makes clean-tree generation reproducible. Parse every
// YAML input before bundling so duplicate keys or external references fail visibly.
const files = (await fs.readdir(sourceDirectory)).filter(file => file.endsWith('.yaml')).sort();
const sourceHash = createHash('sha256');
const authoredDocuments = new Map();
for (const file of files) {
    const source = await fs.readFile(path.join(sourceDirectory, file), 'utf8');
    sourceHash.update(file).update('\0').update(source).update('\0');
    const parsed = YAML.parseDocument(source, {uniqueKeys: true});
    if (parsed.errors.length) throw new Error(parsed.errors.map(error => error.message).join('\n'));
    const document = parsed.toJSON();
    const sourceFile = path.join(sourceDirectory, file);
    inspectReferences(document, sourceFile);
    authoredDocuments.set(sourceFile, document);
}

const authoredRequests = authoredRequestSchemas(authoredDocuments, path.join(sourceDirectory, 'openapi.yaml'));
const runtimeChoices = runtimeChoiceDeclarations(authoredDocuments);
const passwordSchema = authoredDocuments.get(path.join(sourceDirectory, 'auth.yaml')).schemas.NewPassword;
if (passwordSchema?.type !== 'string' || !Number.isInteger(passwordSchema.minLength) || passwordSchema.minLength < 1
    || !Number.isInteger(passwordSchema['x-surveyor-max-utf8-bytes']) || passwordSchema['x-surveyor-max-utf8-bytes'] < 1) {
    throw new Error('NewPassword must author its Unicode minimum and UTF-8 byte maximum');
}
const newPasswordPolicy = {minLength: passwordSchema.minLength, maxUtf8Bytes: passwordSchema['x-surveyor-max-utf8-bytes']};
// Identity fields and provider display projection consume this same authored
// code-point bound; neither DBAL nor UI components own another length policy.
const identityNameSchema = authoredDocuments.get(path.join(sourceDirectory, 'auth.yaml')).schemas.IdentityName;
if (identityNameSchema?.type !== 'string' || !Number.isInteger(identityNameSchema.maxLength) || identityNameSchema.maxLength < 1) {
    throw new Error('IdentityName must author its Unicode code-point maximum');
}
const identityNamePolicy = {maxLength: identityNameSchema.maxLength};

// The measurement helper has no generated inputs: a clean checkout can compile
// it before publishing policy metadata, without a generator/runtime dependency cycle.
const utf8Source = await fs.readFile(path.join(root, 'src/common/lib/utf8.ts'), 'utf8');
sourceHash.update('src/common/lib/utf8.ts').update('\0').update(utf8Source).update('\0');
const utf8Module = await build({stdin: {contents: utf8Source, loader: 'ts', sourcefile: 'utf8.ts'},
    bundle: true, write: false, platform: 'neutral', format: 'esm', target: 'es2022', legalComments: 'none'});
const {utf8ByteLength} = await import(`data:text/javascript;base64,${Buffer.from(utf8Module.outputFiles[0].text).toString('base64')}`);

/** Derive runtime option data from annotated authored enums, independently of
 * bundler aliases. Metadata selects exports/groups; the enum owns allowed values.
 * Invalid or incomplete grouping fails before any generated file is published. */
function runtimeChoiceDeclarations(documents) {
    const declarations = new Map();
    const reserved = new Set('arguments await break case catch class const continue debugger default delete do else enum eval export extends false finally for function if implements import in instanceof interface let new null package private protected public return static super switch this throw true try typeof var void while with yield'.split(' '));

    /** Reserve a valid unique runtime export before emitting executable text. */
    function reserve(name, value) {
        if (typeof name !== 'string' || !/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(name) || reserved.has(name)
            || declarations.has(name)) throw new Error('Runtime choice exports must have unique JavaScript identifiers');
        declarations.set(name, value);
    }

    /** Visit original documents once. References do not create another enum owner. */
    function inspect(value, source) {
        if (!value || typeof value !== 'object') return;
        const annotation = value['x-surveyor-runtime-choices'];
        if (annotation !== undefined) {
            // Only finite string enums can supply choices. No default, union or
            // executable metadata may silently change another layer's inventory.
            if (!annotation || typeof annotation !== 'object' || Array.isArray(annotation)
                || Object.keys(annotation).some(key => !['exportName', 'groupsExportName', 'groups'].includes(key))
                || value.type !== 'string' || !Array.isArray(value.enum) || !value.enum.length
                || value.enum.some(choice => typeof choice !== 'string') || new Set(value.enum).size !== value.enum.length) {
                throw new Error(`Runtime choices require a finite string enum and explicit export metadata: ${source}`);
            }
            reserve(annotation.exportName, value.enum);
            if (annotation.groups !== undefined || annotation.groupsExportName !== undefined) {
                const groups = annotation.groups;
                if (!groups || typeof groups !== 'object' || Array.isArray(groups) || !Object.keys(groups).length) {
                    throw new Error(`Runtime choice groups must partition their enum: ${source}`);
                }
                const grouped = [];
                for (const [group, choices] of Object.entries(groups)) {
                    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(group) || !Array.isArray(choices) || !choices.length
                        || choices.some(choice => typeof choice !== 'string' || !value.enum.includes(choice))) {
                        throw new Error(`Runtime choice groups must contain only their enum values: ${source}`);
                    }
                    grouped.push(...choices);
                }
                // A value belongs to one presentation group, including text-only
                // choices. Missing/duplicate membership cannot disappear in the UI.
                if (grouped.length !== value.enum.length || new Set(grouped).size !== grouped.length) {
                    throw new Error(`Runtime choice groups must partition their enum: ${source}`);
                }
                reserve(annotation.groupsExportName, groups);
            }
        }
        for (const nested of Object.values(value)) inspect(nested, source);
    }

    for (const [source, document] of documents) inspect(document, source);
    return declarations;
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
const requestSchemas = new Set(authoredRequests.names);
const authoredExports = authoredDocuments.get(path.join(sourceDirectory, 'openapi.yaml')).components.schemas;
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
            requestSchema = schemaName(body.content[requestMediaType].schema);        }
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
const problemVariants = new Set(schemas.Problem.oneOf);
validateControllerStatusOverrides(schemas);
for (const variant of schemas.Problem.oneOf) {
    problems.push({code: variant.properties.code.const, status: variant.properties.status.const,
        messageKey: variant.properties.messageKey.const, paramsSchema: variant.properties.params,
        ...(variant['x-surveyor-controller-status-override'] === true ? {controllerStatusOverride: true} : {})});
}

/** Only authored Problem variants can retain a controller's legacy status override.
 * Validate the annotation before stripping it from standalone schema compilation;
 * no code-name whitelist or second Event-cause inventory participates. */
function validateControllerStatusOverrides(value) {
    if (!value || typeof value !== 'object') return;

    // Placement and boolean shape are deliberate generation contracts. A typo
    // must fail rather than silently change an existing controller error mapping.
    if (Object.hasOwn(value, 'x-surveyor-controller-status-override')
        && (!problemVariants.has(value) || typeof value['x-surveyor-controller-status-override'] !== 'boolean')) {
        throw new Error('Controller status override must be a boolean annotation on a Problem variant');
    }
    for (const nested of Object.values(value)) validateControllerStatusOverrides(nested);
}
const apiCompatibility = document['x-surveyor-api-compatibility'];
if (typeof apiCompatibility !== 'string' || !/^[a-zA-Z0-9-]{1,128}$/u.test(apiCompatibility)) throw new Error('Missing API compatibility family');
const manifest = {sourceHash: sourceHash.digest('hex'), apiCompatibility, schemas: Object.keys(schemas), operations, problems};
const allSchemas = {...schemas, ...derivedSchemas};
/** Add only automatic bundled names reached by actual request graphs.
 * Explicit exports keep their authored alias role above. Following through a
 * response-only explicit alias cannot turn that alias's direct validator strict. */
function includeAutomaticRequestSchemas(name, visited = new Set()) {
    if (!name || visited.has(name)) return;
    visited.add(name);
    if (!Object.hasOwn(authoredExports, name)) requestSchemas.add(name);
    include(allSchemas[name]);

    /** Only an exact named reference selects the whole declaration. A property
     * reference visits its selected leaf without marking the enclosing shape. */
    function include(value) {
        if (!value || typeof value !== 'object') return;
        if (typeof value.$ref === 'string') {
            const prefix = '#/components/schemas/';
            if (!value.$ref.startsWith(prefix)) throw new Error('Unsupported bundled request reference');
            const members = value.$ref.slice(prefix.length).split('/').map(member => member.replace(/~1/g, '/').replace(/~0/g, '~'));
            const [target, ...properties] = members;
            if (!properties.length) includeAutomaticRequestSchemas(target, visited);
            else {
                let selected = allSchemas[target];
                for (const property of properties) {
                    // Follow an intermediate alias before selecting its leaf;
                    // this does not assign the enclosing alias a request role.
                    selected = resolve(document, selected)?.[property];
                }
                include(selected);
            }
        }
        for (const [key, nested] of Object.entries(value)) if (key !== '$ref') include(nested);
    }
}
// Automatic names exist only after bundling. Their actual request reachability
// augments the authored export roles without inferring roles from feature names.
for (const operation of operations) {
    includeAutomaticRequestSchemas(operation.requestSchema);
    includeAutomaticRequestSchemas(operation.parametersValidator.slice('validate'.length));
}

const output = new Map();
// Both ORM/server code and browser controls import this neutral generated source.
// Server compilation packages it normally; no request/ORM implementation enters
// its graph. Frozen tuples keep values/order stable and cannot be mutated by a UI.
let choiceSource = banner;
for (const [name, value] of runtimeChoices) {
    if (Array.isArray(value)) choiceSource += `export const ${name} = Object.freeze(${JSON.stringify(value)} as const);\n`;
    else choiceSource += `export const ${name} = Object.freeze({${Object.entries(value).map(
        ([group, choices]) => `[${JSON.stringify(group)}]: Object.freeze(${JSON.stringify(choices)} as const)`).join(',')}});\n`;
}
output.set('src/common/generated/domainChoices.ts', choiceSource);
// Preserve the existing shared identity-policy module and browser boundary;
// credential limits and stored-name bounds both derive from their authored schema.
output.set('src/common/generated/passwordPolicy.ts', banner
    + `export const newPasswordPolicy = Object.freeze(${JSON.stringify(newPasswordPolicy)} as const);\n`
    + `export const identityNamePolicy = Object.freeze(${JSON.stringify(identityNamePolicy)} as const);\n`);
const headerValidatorNames = new Map();
// Every dispatch uses the strict request graph, even when the bundler selected
// an explicitly response-only alias as the body's canonical exported name.
const operationInputs = operations.map(operation => {
    // Policy admission remains server-owned. The frontend still checks the
    // authored structural header shape, including conditional requiredness.
    const headers = operation.parameters.filter(parameter => parameter.in === 'header' && policyHeaders.has(parameter.name.toLowerCase()))
        .sort((left, right) => left.name.localeCompare(right.name));
    const headerSchema = {type: 'object', additionalProperties: false,
        properties: Object.fromEntries(headers.map(parameter => [parameter.name, parameter.schema])),
        required: headers.filter(parameter => parameter.required).map(parameter => parameter.name)};
    const identity = JSON.stringify(headerSchema);
    let headersValidator = headerValidatorNames.get(identity);
    if (!headersValidator) {
        const name = `OperationHeaders${headerValidatorNames.size + 1}`;
        if (Object.hasOwn(allSchemas, name)) throw new Error(`Duplicate operation header validator: ${name}`);
        allSchemas[name] = headerSchema;
        requestSchemas.add(name);
        headersValidator = `validate${name}`;
        headerValidatorNames.set(identity, headersValidator);
    }
    let bodyValidator = operation.requestSchema ? `validate${operation.requestSchema}` : null;
    if (operation.requestSchema && !requestSchemas.has(operation.requestSchema)) {
        const name = `${upperFirst(operation.operationId)}Request`;
        if (Object.hasOwn(allSchemas, name)) throw new Error(`Duplicate operation request validator: ${name}`);
        allSchemas[name] = {$ref: `#/components/schemas/${operation.requestSchema}`};
        requestSchemas.add(name);
        bodyValidator = `validate${name}`;
    }
    return {operationId: operation.operationId, method: operation.method, path: operation.path,
        mediaType: operation.requestMediaType, bodyValidator, parametersValidator: operation.parametersValidator,
        headersValidator, policyHeaders: headers.map(parameter => parameter.name),
        binaryParts: operation.requestMediaType === 'multipart/form-data'
            ? Object.entries(resolve(document, schemas[operation.requestSchema]).properties ?? {}).filter(([, schema]) => resolve(document, schema).format === 'binary').map(([name]) => name) : [],
        parameters: operation.parameters.filter(parameter => parameter.in !== 'header' || !policyHeaders.has(parameter.name.toLowerCase()))
            .map(parameter => ({in: parameter.in, name: parameter.name, type: parameter.schema.type}))};
});
output.set(`${artifactDirectory}/openapi.json`, `${JSON.stringify(document, null, 2)}\n`);
output.set(`${artifactDirectory}/operations.json`, `${JSON.stringify(manifest, null, 2)}\n`);
output.set('src/types/api/v1.d.ts', banner + astToString(await openapiTS(document)));
// Small policy metadata belongs in the shell; feature validators remain separate lazy modules below.
output.set(`${artifactDirectory}/policy.mjs`, banner + `export const apiCompatibility = ${JSON.stringify(apiCompatibility)};\nexport const operationPolicies = ${JSON.stringify(Object.fromEntries(
    operations.map(operation => [operation.operationId, {successStatuses: operation.successStatuses, ...operation.policy}])))};\n`);
output.set(`${artifactDirectory}/policy.d.mts`, banner + "import type {operations} from '../../../src/types/api/v1.js';\n"
    + `export const apiCompatibility: ${JSON.stringify(apiCompatibility)};\n`
    + "export const operationPolicies: Record<keyof operations, {successStatuses: readonly number[]; retryPolicy: 'read' | 'natural-idempotent' | 'reconcile-only'; precondition: 'none' | 'metadata' | 'item' | 'order' | 'settings'}>;\n");

// Literal imports keep each validator lazy and visible to the frontend bundler.
// This is generated operation metadata, not a second authored request registry.
const inputValidatorNames = [...new Set(operationInputs.flatMap(input => [input.parametersValidator, input.bodyValidator, input.headersValidator].filter(Boolean)))];
const parameterFieldAttributes = Object.fromEntries(operations.flatMap(operation => {
    const groups = {};
    for (const parameter of operation.parameters) {
        if (parameter.schema.maxLength === undefined) continue;
        (groups[parameter.in] ??= {})[parameter.name] = {maxLength: parameter.schema.maxLength};
    }
    return Object.keys(groups).length ? [[operation.operationId, groups]] : [];
}));
output.set(`${artifactDirectory}/policy.mjs`, output.get(`${artifactDirectory}/policy.mjs`)
    + `export const parameterFieldAttributes = ${JSON.stringify(parameterFieldAttributes)};\n`
    + `export const operationInputs = ${JSON.stringify(operationInputs)};\n`
    + `const inputValidators = {${inputValidatorNames.map(name => `${JSON.stringify(name)}: () => import('./browser/${name}.mjs').then(module => module.${name})`).join(',')}};\n`
    + 'export function loadInputValidator(name) { return inputValidators[name](); }\n');
output.set(`${artifactDirectory}/policy.d.mts`, output.get(`${artifactDirectory}/policy.d.mts`)
    + `export const parameterFieldAttributes: ${JSON.stringify(parameterFieldAttributes)};\n`
    + "import type {GeneratedValidator} from '../../../src/types/api/validation-v1.js';\n"
    + "export const operationInputs: readonly {operationId: keyof operations; method: string; path: string; mediaType: string | null; bodyValidator: string | null; parametersValidator: string; headersValidator: string; policyHeaders: readonly string[]; binaryParts: readonly string[]; parameters: readonly {in: 'path' | 'query' | 'header'; name: string; type?: string}[]}[];\n"
    + 'export function loadInputValidator(name: string): Promise<GeneratedValidator<unknown>>;\n');

let declarations = `${banner}import type {components, operations} from './v1';\nimport type {ErrorObject} from 'ajv';\n\n`;
declarations += 'export interface GeneratedValidator<T> { (data: unknown): data is T; errors?: ErrorObject[] | null; }\n';
declarations += 'type Present<T> = [NonNullable<T>] extends [never] ? Record<string, never> : NonNullable<T>;\n';
declarations += "type Parameters<K extends keyof operations> = { path: Present<operations[K]['parameters']['path']>; query: Present<operations[K]['parameters']['query']>; header: Omit<Present<operations[K]['parameters']['header']>, 'X-Surveyor-Context' | 'X-CSRF-Token' | 'If-Match'>; };\n";
declarations += 'export interface ValidationSchemas {\n';
for (const name of Object.keys(schemas)) declarations += `    ${name}: components['schemas']['${name}'];\n`;
for (const operation of operations) declarations += `    ${upperFirst(operation.operationId)}Parameters: Parameters<'${operation.operationId}'>;\n`;
for (const input of operationInputs) if (input.bodyValidator && !Object.hasOwn(schemas, input.bodyValidator.slice('validate'.length))) {
    declarations += `    ${input.bodyValidator.slice('validate'.length)}: unknown;\n`;
}
for (const name of headerValidatorNames.values()) declarations += `    ${name.slice('validate'.length)}: unknown;\n`;
declarations += '}\nexport type ValidatorSet = { [K in keyof ValidationSchemas as `validate${K}`]: GeneratedValidator<ValidationSchemas[K]>; };\n';
output.set('src/types/api/validation-v1.d.ts', declarations);

// Direct browser export roles come from the authored graph above. Both compiled
// graphs still contain every definition: nested request references stay strict,
// and a response-only alias stays additive even when bundling reuses its target.

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
    const attributes = nativeFieldAttributes(exportName.slice('validate'.length));
    const attributeEntries = Object.entries(attributes);
    const attributeCode = attributeEntries.length ? `\nexport const fieldAttributes = Object.freeze({${attributeEntries.map(
        ([field, value]) => `${JSON.stringify(field)}: Object.freeze(${JSON.stringify(value)})`).join(',')}});\n` : '';
    const attributeTypes = attributeEntries.length ? `export const fieldAttributes: {${attributeEntries.map(
        ([field, value]) => `readonly ${JSON.stringify(field)}: {${Object.entries(value).map(([key, bound]) => `readonly ${key}: ${bound}`).join(';')}}`).join(';')}};\n` : '';
    output.set(`${artifactDirectory}/browser/${exportName}.mjs`, banner + result.outputFiles[0].text + attributeCode);
    output.set(`${artifactDirectory}/browser/${exportName}.d.mts`, banner
        + `import type {ValidatorSet} from '../../../../src/types/api/validation-v1.js';\n`
        + `export const ${exportName}: ValidatorSet['${exportName}'];\n` + attributeTypes);
}

/** Project declared top-level request string bounds for matching native controls.
 * This is static metadata beside the owning lazy validator, never another schema
 * compiler. Native maxlength retains browser UTF-16 behavior while JSON validation
 * keeps its existing code-point semantics and business checks remain server-owned. */
function nativeFieldAttributes(name) {
    if (!requestSchemas.has(name)) return {};
    const schema = resolve(document, allSchemas[name]);
    const attributes = {};

    // Only an explicit authored bound is projected. No feature defaults, inferred
    // database sizes or automatic field rendering enter the generated contract.
    for (const [field, unresolved] of Object.entries(schema.properties ?? {})) {
        const value = resolve(document, unresolved);
        const bounds = {};
        if (value.maxLength !== undefined) bounds.maxLength = value.maxLength;
        if (Object.keys(bounds).length) attributes[field] = bounds;
    }
    return attributes;
}

for (const browser of [false, true]) {
    const id = `urn:surveyor:api:v1:${browser ? 'browser' : 'server'}`;
    const requestId = browser ? `${id}:request` : id;
    const ajv = new Ajv2020({strict: true, allErrors: true, coerceTypes: false, useDefaults: false,
        removeAdditional: false, validateFormats: true, discriminator: true, code: {source: true, esm: browser}});
    addFormats(ajv);
    ajv.addKeyword({keyword: 'x-surveyor-max-utf8-bytes', type: 'string', schemaType: 'number',
        metaSchema: {type: 'integer', minimum: 0}, code: compileUtf8Maximum,
        error: {message: utf8MaximumMessage, params: utf8MaximumParameters}});
    // Binary is a transport marker; the upload owner checks file presence, media and size.
    ajv.addFormat('binary', true);
    for (const graphId of browser ? [id, requestId] : [id]) {
        const additive = browser && graphId === id;
        const definitions = [];
        for (const [name, schema] of Object.entries(allSchemas)) {
            const compiled = validatorSchema(schema, graphId, additive);
            // Problem already requires a unique constant code in every variant.
            // Tell Ajv to select that branch directly instead of trying every
            // unrelated error code. This generated annotation changes neither the
            // authored contract nor accepted payloads; malformed tags still fail.
            if (name === 'Problem') compiled.discriminator = {propertyName: 'code'};
            definitions.push([name, compiled]);
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
