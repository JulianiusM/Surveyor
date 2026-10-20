/** Discover release catalogs and derive one browser/server message contract. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import YAML from 'yaml';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputArgument = process.argv.indexOf('--output-root');
const outputRoot = outputArgument < 0 ? root : path.resolve(process.argv[outputArgument + 1]);
const check = process.argv.includes('--check');
const localeArgument = process.argv.indexOf('--source');
const sourceDirectory = localeArgument < 0 ? path.join(root, 'src/locales') : path.resolve(process.argv[localeArgument + 1]);
const apiRoot = await selectApiRoot();
const api = JSON.parse(await fs.readFile(path.join(apiRoot, '.generated/api/v1/operations.json'), 'utf8'));
const contract = JSON.parse(await fs.readFile(path.join(apiRoot, '.generated/api/v1/openapi.json'), 'utf8'));
const catalogs = [];
const sourceHash = createHash('sha256').update(api.sourceHash);
const pluralSuffix = /_(zero|one|two|few|many|other)$/;
let invoiceCatalog;

/** Prefer freshly generated contracts in a detached output tree; ordinary catalog-only
 * invocations retain the existing repository contract fallback. */
async function selectApiRoot() {
    try {
        await fs.access(path.join(outputRoot, '.generated/api/v1/operations.json'));
        return outputRoot;
    } catch {
        return root;
    }
}

/** Retire only compiled siblings of this generator's permission source.
 * Extensionless imports can choose a stale permissions.js instead of permissions.ts.
 * Validate exact lexical/real output paths and entry types before any unlink; check
 * mode reports the collision without changing outputs or unrelated files. */
async function retireCompiledPermissionSiblings() {
    const generatedRelative = path.join('src', 'modules', 'localization', 'generated');
    const generatedDirectory = path.resolve(outputRoot, generatedRelative);
    const collisions = [];

    // These two names belong to the emitted permissions source. Never discover
    // arbitrary files for deletion or clean the generated directory recursively.
    for (const filename of ['permissions.js', 'permissions.js.map']) {
        const destination = path.resolve(generatedDirectory, filename);
        if (path.relative(outputRoot, destination) !== path.join(generatedRelative, filename)) {
            throw new Error('Refusing compiled permission cleanup outside the output root');
        }

        let entry;
        try {
            entry = await fs.lstat(destination);
        } catch (error) {
            if (error.code === 'ENOENT') continue;
            throw error;
        }
        if (!entry.isFile()) throw new Error(`Refusing unexpected compiled permission entry: ${filename}`);
        collisions.push(destination);
    }
    if (!collisions.length) return;

    // A redirected parent directory must not turn an exact generated filename
    // into removal outside the selected output tree. Validate before either unlink.
    const realOutputRoot = await fs.realpath(outputRoot);
    const realGeneratedDirectory = await fs.realpath(generatedDirectory);
    if (path.relative(realOutputRoot, realGeneratedDirectory) !== generatedRelative) {
        throw new Error('Refusing compiled permission cleanup through a redirected output directory');
    }
    if (check) throw new Error('Generated catalog has compiled permission siblings; run normal locale generation');

    // Catalog/contract validation has already succeeded. Remove only these
    // generator-owned stale files before publishing the current typed source.
    for (const destination of collisions) await fs.unlink(destination);
}

/** Read keys from the authoritative permission declarations without executing their module or
 * copying a second permission inventory into the frontend. Unsupported registry structure fails visibly. */
async function permissionRegistryKeys() {
    // Parse the authoritative declarations without importing their executable
    // business helpers. Registry bytes also participate in the catalog version.
    const source = await fs.readFile(path.join(root, 'src/modules/lib/permissions.ts'), 'utf8');
    sourceHash.update(source);
    const tree = ts.createSourceFile('permissions.ts', source, ts.ScriptTarget.Latest, true);
    const names = [];

    // PERM is an object declaration; DEFAULT_PERM returns its object from a local
    // factory. Collect only those existing shapes, never a guessed second registry.
    for (const statement of tree.statements) {
        if (!ts.isVariableStatement(statement)) continue;
        for (const declaration of statement.declarationList.declarations) {
            if (!['PERM', 'DEFAULT_PERM'].includes(declaration.name.getText(tree))) continue;
            let value = unwrapRegistryExpression(declaration.initializer);
            if (ts.isCallExpression(value)) {
                const factory = unwrapRegistryExpression(value.expression);
                const returned = factory.body.statements.find(ts.isReturnStatement);
                value = unwrapRegistryExpression(returned.expression);
            }
            if (!ts.isObjectLiteralExpression(value)) throw new Error('Unsupported permission registry declaration');
            for (const property of value.properties) {
                if (!property.name || !ts.isIdentifier(property.name)) throw new Error('Unsupported permission registry key');
                names.push(property.name.text);
            }
        }
    }
    if (!names.length) throw new Error('Permission registry is empty');
    return [...new Set(names)].sort();
}
const permissionKeys = await permissionRegistryKeys();

/** Ignore type assertions and parentheses while inspecting an authored registry expression. */
function unwrapRegistryExpression(node) {
    while (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) node = node.expression;
    return node;
}

/** Read the maintained invoice catalog as static data, never import or execute its module. */
async function sharedInvoiceCatalog() {
    if (invoiceCatalog) return invoiceCatalog;
    const relative = 'src/modules/invoice/locales/en.ts';
    const source = await fs.readFile(path.join(root, relative), 'utf8');
    const tree = ts.createSourceFile(relative, source, ts.ScriptTarget.Latest, true);
    if (tree.parseDiagnostics.length) throw new Error('Invalid invoice catalog syntax');

    // Only the existing named literal is a wording source. Hash its actual bytes
    // so wording edits invalidate the same browser/server preparation receipt.
    const declarations = tree.statements.filter(ts.isVariableStatement).flatMap(statement =>
        [...statement.declarationList.declarations].filter(declaration => ts.isIdentifier(declaration.name)
            && declaration.name.text === 'englishInvoiceCatalog'));
    if (declarations.length !== 1 || !declarations[0].initializer) throw new Error('Missing invoice catalog literal');
    invoiceCatalog = invoiceLiteral(declarations[0].initializer);
    if (typeof invoiceCatalog !== 'object') throw new Error('Invalid invoice catalog literal');
    sourceHash.update(relative).update('\0').update(source).update('\0');
    return invoiceCatalog;
}

/** Admit string/object literal data only; getters, spreads and executable initializers are rejected. */
function invoiceLiteral(expression) {
    const node = unwrapRegistryExpression(expression);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (!ts.isObjectLiteralExpression(node)) throw new Error('Unsupported invoice catalog literal');

    // A null prototype keeps even an unexpected authored name from interpreting
    // assignment as prototype mutation. Duplicate keys must fail rather than win.
    const result = Object.create(null);
    for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property) || !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) {
            throw new Error('Unsupported invoice catalog property');
        }
        const name = property.name.text;
        if (Object.hasOwn(result, name)) throw new Error(`Duplicate invoice catalog key: ${name}`);
        result[name] = invoiceLiteral(property.initializer);
    }
    return result;
}

/** Insert one generated text leaf without replacing authored text or traversing a non-object parent. */
function insertInvoiceMessage(resources, target, text) {
    const segments = target.split('.');
    let parent = resources.ui;
    if (!parent || typeof parent !== 'object' || Array.isArray(parent)) throw new Error('Invoice messages require UI resources');
    for (const segment of segments.slice(0, -1)) {
        if (!Object.hasOwn(parent, segment)) parent[segment] = {};
        parent = parent[segment];
        if (!parent || typeof parent !== 'object' || Array.isArray(parent)) throw new Error(`Duplicate invoice message target: ${target}`);
    }
    const name = segments.at(-1);
    if (Object.hasOwn(parent, name)) throw new Error(`Duplicate invoice message target: ${target}`);
    // The native formatter's named placeholders are the same scalar values;
    // ordinary catalog validation below still rejects unsupported brace syntax.
    parent[name] = text.replace(/\{([A-Za-z]\w*)\}/g, '{{$1}}');
}

/** Resolve explicitly selected English invoice wording before ordinary catalog validation and flattening. */
async function resolveInvoiceMessages(catalog) {
    const references = catalog.invoiceMessages;
    if (references === undefined) return;
    if (catalog.locale !== 'en') throw new Error('Only English selects shared invoice messages');
    if (!references || typeof references !== 'object' || Array.isArray(references)) throw new Error('Invalid invoice message references');
    if (!Object.keys(references).length) return;
    const shared = await sharedInvoiceCatalog();
    const existing = new Set(Object.keys(flattenResources(catalog.resources)).map(name => name.replace(pluralSuffix, '')));

    // References name logical UI messages. Plural category suffixes are derived
    // from the native source and cannot collide with an authored bare/variant key.
    for (const [target, key] of Object.entries(references)) {
        if (!target.split('.').every(segment => /^[A-Za-z][A-Za-z0-9_]*$/.test(segment)) || pluralSuffix.test(target)) {
            throw new Error(`Invalid invoice message target: ${target}`);
        }
        if (existing.has(target)) throw new Error(`Duplicate invoice message target: ${target}`);
        if (typeof key !== 'string' || !Object.hasOwn(shared, key)) throw new Error(`Unknown invoice message reference: ${target}`);
        const value = shared[key];
        if (typeof value === 'string') insertInvoiceMessage(catalog.resources, target, value);
        else {
            if (!Object.hasOwn(value, 'other')) throw new Error(`Missing invoice plural fallback: ${key}`);
            for (const [category, message] of Object.entries(value)) {
                if (!/^(zero|one|two|few|many|other)$/.test(category) || typeof message !== 'string') {
                    throw new Error(`Unsupported invoice plural: ${key}`);
                }
                insertInvoiceMessage(catalog.resources, `${target}_${category}`, message);
            }
        }
        existing.add(target);
    }
}

/** Flatten one namespace without accepting arrays, unsafe names or non-text leaves. */
function flattenNamespace(value, key, nested, namespace) {
    // Leaf values are literal text. An object extends the same dotted logical key;
    // there is no alternate namespace/key interpretation in browser or server.
    if (typeof value === 'string') { nested[key] = value; return; }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid resources in ${namespace}`);

    for (const [name, child] of Object.entries(value)) {
        if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) throw new Error(`Invalid message key: ${name}`);
        flattenNamespace(child, key ? `${key}.${name}` : name, nested, namespace);
    }
}

/** Derive the same logical message names from every catalog's nested resources. */
function flattenResources(resources) {
    const result = {};
    for (const [namespace, value] of Object.entries(resources)) {
        const nested = {};
        if (!/^[a-z][a-z0-9]*$/.test(namespace)) throw new Error('Invalid catalog namespace');
        flattenNamespace(value, '', nested, namespace);

        // UI keys remain the established default namespace; explicit namespaces
        // retain their prefix in the one generated message contract.
        for (const [key, text] of Object.entries(nested)) result[namespace === 'ui' ? key : `${namespace}:${key}`] = text;
    }
    return result;
}

/** Derive scalar and authored-node placeholders without admitting catalog HTML. */
function placeholders(text, key) {
    if (!text.trim() || /<[^>]*>|\$t\(|{{\s*-/.test(text)) throw new Error(`Unsafe or empty catalog text: ${key}`);

    // Collect the supported placeholders, then reject any unmatched brace syntax.
    // Catalog text cannot introduce HTML, nested translations or raw interpolation.
    const parameters = new Set();
    const interpolation = /{{\s*([A-Za-z]\w*)\s*}}/g;
    for (const match of text.matchAll(interpolation)) parameters.add(match[1]);
    const remaining = text.replace(interpolation, '');
    const nodes = [...remaining.matchAll(/{([a-z][a-z0-9-]*)}/g)].map(match => match[1]);
    // Fixed node names belong to the catalog contract. Interpolated names,
    // unmatched braces and repeated nodes cannot change the authored Vue tree.
    if (/[{}]/.test(remaining.replace(/{([a-z][a-z0-9-]*)}/g, '')) || new Set(nodes).size !== nodes.length) {
        throw new Error(`Unsupported interpolation or node placeholder in ${key}`);
    }
    return {parameters: [...parameters].sort(), nodes: nodes.sort()};
}

/** Resolve message parameter references inside the already generated API contract. */
function resolveSchema(schema) {
    if (!schema.$ref) return schema;
    const prefix = '#/components/schemas/';
    if (!schema.$ref.startsWith(prefix)) throw new Error('Unexpected API parameter reference');
    return resolveSchema(contract.components.schemas[schema.$ref.slice(prefix.length)]);
}

// Stable input order and duplicate-key-aware parsing produce one reproducible
// browser/server catalog rather than silently accepting overwritten message keys.
const files = (await fs.readdir(sourceDirectory)).filter(file => file.endsWith('.json')).sort();
for (const file of files) {
    const source = await fs.readFile(path.join(sourceDirectory, file), 'utf8');
    JSON.parse(source); // Enforce JSON syntax before the duplicate-key-aware parse below.
    sourceHash.update(file).update('\0').update(source).update('\0');
    // YAML's JSON-compatible parser rejects duplicate object keys, unlike JSON.parse.
    const parsed = YAML.parseDocument(source, {uniqueKeys: true});
    if (parsed.errors.length) throw new Error(parsed.errors.map(error => error.message).join('\n'));
    const catalog = parsed.toJSON();
    const canonical = Intl.getCanonicalLocales(catalog.locale)[0];
    if (canonical !== catalog.locale || file !== `${canonical}.json` || !['ltr', 'rtl'].includes(catalog.direction)
        || typeof catalog.nativeName !== 'string' || !catalog.nativeName.trim() || !catalog.resources) {
        throw new Error(`Invalid locale metadata: ${file}`);
    }
    if (catalog.locale !== 'en' && catalog.uiContracts) throw new Error('Only English owns UI parameter declarations');
    // Only release-owned help directories are selectable. A catalog cannot point the runtime
    // at uploads, an absolute path, or an ancestor outside the release-owned corpus.
    if (!catalog.help || typeof catalog.help.directory !== 'string'
        || catalog.help.directory !== catalog.locale) {
        // Every language names its own fixed directory. Localized Help may be absent;
        // the controller then selects reviewed English and exposes that fallback explicitly.
        // Catalog metadata itself may never redirect to another corpus or filesystem root.
        throw new Error(`Invalid fixed help source: ${file}`);
    }
    await resolveInvoiceMessages(catalog);
    const messages = flattenResources(catalog.resources);
    const groups = {};
    for (const [key, text] of Object.entries(messages)) {
        const suffix = key.match(pluralSuffix)?.[1];
        const logical = suffix ? key.replace(pluralSuffix, '') : key;
        (groups[logical] ??= []).push({key, text, suffix, ...placeholders(text, key)});
    }
    catalogs.push({...catalog, messages, groups});
}

const english = catalogs.find(catalog => catalog.locale === 'en');
if (!english) throw new Error('The complete English fallback catalog is required');
const keys = Object.keys(english.groups).sort();
const problemByKey = new Map(api.problems.map(problem => [problem.messageKey, problem]));
for (const key of problemByKey.keys()) if (!english.groups[key]) throw new Error(`Missing contracted API message: ${key}`);
for (const key of permissionKeys) if (!english.groups[`permissions.${key}`]) throw new Error(`Missing permission message: ${key}`);
for (const key of Object.keys(english.uiContracts ?? {})) {
    if (!english.groups[key] || problemByKey.has(key)) throw new Error(`Invalid or duplicated UI contract: ${key}`);
}

const messageContracts = {};
const typeEntries = [];
const nodeTypeEntries = [];
for (const key of keys) {
    const variants = english.groups[key];
    const isPlural = variants.some(variant => variant.suffix);
    const used = [...new Set(variants.flatMap(variant => variant.parameters))].sort();
    const problem = problemByKey.get(key);
    const ui = english.uiContracts?.[key];
    const nodes = ui?.nodes ?? [];
    if (!Array.isArray(nodes) || new Set(nodes).size !== nodes.length
        || nodes.some(name => typeof name !== 'string' || !/^[a-z][a-z0-9-]*$/.test(name) || name.startsWith('value-'))) {
        throw new Error(`Invalid authored node declaration: ${key}`);
    }
    if (nodes.length && problem) throw new Error(`API messages cannot contain authored nodes: ${key}`);
    // API messages inherit their parameter vocabulary from the wire contract;
    // only ordinary UI messages use the English catalog's explicit declarations.
    let properties = ui?.parameters ?? {};
    if (problem) {
        const entries = [];
        for (const [name, schema] of Object.entries(problem.paramsSchema.properties ?? {})) {
            entries.push([name, resolveSchema(schema).type]);
        }
        properties = Object.fromEntries(entries);
    }
    const required = problem ? (problem.paramsSchema.required ?? []) : Object.keys(properties);
    if (Object.values(properties).some(type => !['string', 'number', 'integer', 'boolean'].includes(type))) {
        throw new Error(`Unsupported message parameter type: ${key}`);
    }
    const declared = Object.keys(properties).filter(name => name !== 'count' || !ui?.plural || used.includes(name));
    if (used.some(parameter => !Object.hasOwn(properties, parameter)) || (!problem && used.join() !== declared.sort().join())) {
        throw new Error(`Message parameter declaration differs from placeholders: ${key}`);
    }
    if (isPlural && (properties.count !== 'number' || !ui?.plural)) throw new Error(`Plural requires numeric count contract: ${key}`);
    messageContracts[key] = {parameters: properties, required, plural: isPlural, nodes};
    if (nodes.length) nodeTypeEntries.push(`    ${JSON.stringify(key)}: ${nodes.map(name => JSON.stringify(name)).join(' | ')};`);
    const shape = problem
        ? `Extract<components['schemas']['Problem'], {code: '${problem.code}'}>['params']`
        : messageParameterShape(properties);
    typeEntries.push(`    ${JSON.stringify(key)}: ${shape};`);
    for (const catalog of catalogs) {
        const translated = catalog.groups[key];
        if (!translated) throw new Error(`Missing ${catalog.locale} message: ${key}`);
        const translatedUsed = [...new Set(translated.flatMap(variant => variant.parameters))].sort();
        if (translatedUsed.join() !== used.join()) throw new Error(`Placeholder drift in ${catalog.locale}: ${key}`);
        for (const variant of translated) {
            if (variant.nodes.join() !== [...nodes].sort().join()) throw new Error(`Authored node drift in ${catalog.locale}: ${variant.key}`);
        }
        if (isPlural) {
            const categories = new Intl.PluralRules(catalog.locale).resolvedOptions().pluralCategories;
            const translatedCategories = new Set();
            for (const variant of translated) translatedCategories.add(variant.suffix);

            // A plural message has no bare variant and includes every category
            // selected by this language's actual Intl plural rules.
            if (translatedCategories.has(undefined)) throw new Error(`Incomplete ${catalog.locale} plural forms: ${key}`);
            for (const category of categories) {
                if (!translatedCategories.has(category)) throw new Error(`Incomplete ${catalog.locale} plural forms: ${key}`);
            }
        } else if (translated.length !== 1 || translated[0].suffix) throw new Error(`Unexpected plural forms: ${key}`);
    }
}
for (const catalog of catalogs) {
    if (Object.keys(catalog.groups).sort().join('\0') !== keys.join('\0')) throw new Error(`Extra or missing logical keys: ${catalog.locale}`);
}

/** Emit a UI parameter declaration using the already validated scalar vocabulary. */
function messageParameterShape(properties) {
    if (!Object.keys(properties).length) return 'Record<string, never>';

    const members = [];
    for (const [name, type] of Object.entries(properties)) {
        members.push(`${JSON.stringify(name)}: ${type === 'integer' ? 'number' : type}`);
    }
    return `{${members.join('; ')}}`;
}

// Publish locale metadata/resources in their authored order. These are derived
// outputs of the same catalog pass, not independently maintained runtime sources.
const localeDefinitions = [];
const helpSources = [];
const resourceEntries = [];
const permissionMessages = [];
for (const {locale, nativeName, direction, help, resources} of catalogs) {
    localeDefinitions.push({locale, nativeName, direction});
    helpSources.push([locale, help.directory]);
    resourceEntries.push([locale, resources]);
}
for (const key of permissionKeys) permissionMessages.push([key, `permissions.${key}`]);
const manifest = {version: sourceHash.digest('hex'), locales: localeDefinitions,
    helpSources: Object.fromEntries(helpSources), messages: messageContracts};
const resources = Object.fromEntries(resourceEntries);
const declarations = `// Generated from src/locales and the API contract; do not edit.
import type {components} from './api/v1';
export type Locale = ${catalogs.map(catalog => JSON.stringify(catalog.locale)).join(' | ')};
export interface LocaleDefinition { readonly locale: Locale; readonly nativeName: string; readonly direction: 'ltr' | 'rtl'; }
export interface MessageParameters {
${typeEntries.join('\n')}
}
export type MessageKey = keyof MessageParameters;
export interface MessageNodes {
${nodeTypeEntries.join('\n')}
}
export type RichMessageKey = keyof MessageNodes;
export interface RichMessageContent { readonly text: string; readonly values: Readonly<Record<string, string | number | boolean>>; }
export type Translator = <K extends MessageKey>(key: K, ...arguments_: {} extends MessageParameters[K] ? [parameters?: MessageParameters[K]] : [parameters: MessageParameters[K]]) => string;
export type RichTranslator = <K extends RichMessageKey>(key: K, parameters: MessageParameters[K]) => RichMessageContent;
export interface LocalizationContext { readonly locale: Locale; readonly t: Translator; readonly rich: RichTranslator; }
`;
const output = new Map([
    ['src/types/LocalizationTypes.d.ts', declarations],
    ['src/modules/localization/generated/resources.json', `${JSON.stringify(resources, null, 2)}\n`],
    ['src/modules/localization/generated/manifest.json', `${JSON.stringify(manifest, null, 2)}\n`],
    ['src/modules/localization/generated/permissions.ts', '// Generated from permission registry and locale catalogs; do not edit.\n'
        + "import type {MessageKey} from '../../../types/LocalizationTypes';\n"
        + `export const permissionMessageKeys = ${JSON.stringify(Object.fromEntries(permissionMessages), null, 2)} as const satisfies Record<string, MessageKey>;\n`],
]);
await retireCompiledPermissionSiblings();
for (const [relative, content] of output) {
    const destination = path.join(outputRoot, relative);
    if (check) {
        if (await fs.readFile(destination, 'utf8').catch(() => null) !== content) throw new Error(`Generated catalog is stale: ${relative}`);
    } else {
        await fs.mkdir(path.dirname(destination), {recursive: true});
        await fs.writeFile(destination, content);
    }
}
process.stdout.write(`Locale catalog ${manifest.version.slice(0, 12)}: ${catalogs.length} locales, ${keys.length} messages (${check ? 'checked' : 'generated'}).\n`);
