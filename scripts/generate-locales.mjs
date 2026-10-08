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
const apiRoot = await fs.access(path.join(outputRoot, '.generated/api/v1/operations.json')).then(() => outputRoot, () => root);
const api = JSON.parse(await fs.readFile(path.join(apiRoot, '.generated/api/v1/operations.json'), 'utf8'));
const contract = JSON.parse(await fs.readFile(path.join(apiRoot, '.generated/api/v1/openapi.json'), 'utf8'));
const catalogs = [];
const sourceHash = createHash('sha256').update(api.sourceHash);
const pluralSuffix = /_(zero|one|two|few|many|other)$/;

/** Read keys from the authoritative permission declarations without executing their module or
 * copying a second permission inventory into the frontend. Unsupported registry structure fails visibly. */
async function permissionRegistryKeys() {
    const source = await fs.readFile(path.join(root, 'src/modules/lib/permissions.ts'), 'utf8');
    sourceHash.update(source);
    const tree = ts.createSourceFile('permissions.ts', source, ts.ScriptTarget.Latest, true);
    function unwrap(node) {
        while (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) node = node.expression;
        return node;
    }
    const names = [];
    for (const statement of tree.statements) {
        if (!ts.isVariableStatement(statement)) continue;
        for (const declaration of statement.declarationList.declarations) {
            if (!['PERM', 'DEFAULT_PERM'].includes(declaration.name.getText(tree))) continue;
            let value = unwrap(declaration.initializer);
            if (ts.isCallExpression(value)) {
                const factory = unwrap(value.expression);
                const returned = factory.body.statements.find(ts.isReturnStatement);
                value = unwrap(returned.expression);
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

function flattenResources(resources) {
    const result = {};
    for (const [namespace, value] of Object.entries(resources)) {
        const nested = {};
        function flatten(value, key) {
            if (typeof value === 'string') { nested[key] = value; return; }
            if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid resources in ${namespace}`);
            for (const [name, child] of Object.entries(value)) {
                if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) throw new Error(`Invalid message key: ${name}`);
                flatten(child, key ? `${key}.${name}` : name);
            }
        }
        if (!/^[a-z][a-z0-9]*$/.test(namespace)) throw new Error('Invalid catalog namespace');
        flatten(value, '');
        for (const [key, text] of Object.entries(nested)) result[namespace === 'ui' ? key : `${namespace}:${key}`] = text;
    }
    return result;
}

function placeholders(text, key) {
    if (!text.trim() || /<[^>]*>|\$t\(|{{\s*-/.test(text)) throw new Error(`Unsafe or empty catalog text: ${key}`);
    const parameters = new Set();
    const remaining = text.replace(/{{\s*([A-Za-z]\w*)\s*}}/g, (_match, name) => { parameters.add(name); return ''; });
    if (/{{|}}/.test(remaining)) throw new Error(`Unsupported interpolation in ${key}`);
    return [...parameters].sort();
}

function resolveSchema(schema) {
    if (!schema.$ref) return schema;
    const prefix = '#/components/schemas/';
    if (!schema.$ref.startsWith(prefix)) throw new Error('Unexpected API parameter reference');
    return resolveSchema(contract.components.schemas[schema.$ref.slice(prefix.length)]);
}

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
    // at uploads, an absolute path, or an ancestor outside docs/user-guide.
    if (!catalog.help || typeof catalog.help.directory !== 'string'
        || catalog.help.directory !== (catalog.locale === 'en' ? '.' : catalog.locale)) {
        // The existing English corpus owns the root. Every added language owns its own directory;
        // a catalog may never silently redirect help to another language's documents or pictures.
        throw new Error(`Invalid fixed help source: ${file}`);
    }
    const messages = flattenResources(catalog.resources);
    const groups = {};
    for (const [key, text] of Object.entries(messages)) {
        const suffix = key.match(pluralSuffix)?.[1];
        const logical = suffix ? key.replace(pluralSuffix, '') : key;
        (groups[logical] ??= []).push({key, text, suffix, parameters: placeholders(text, key)});
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
for (const key of keys) {
    const variants = english.groups[key];
    const isPlural = variants.some(variant => variant.suffix);
    const used = [...new Set(variants.flatMap(variant => variant.parameters))].sort();
    const problem = problemByKey.get(key);
    const ui = english.uiContracts?.[key];
    const properties = problem ? Object.fromEntries(Object.entries(problem.paramsSchema.properties ?? {}).map(([name, schema]) =>
        [name, resolveSchema(schema).type])) : (ui?.parameters ?? {});
    const required = problem ? (problem.paramsSchema.required ?? []) : Object.keys(properties);
    if (Object.values(properties).some(type => !['string', 'number', 'integer', 'boolean'].includes(type))) {
        throw new Error(`Unsupported message parameter type: ${key}`);
    }
    if (used.some(parameter => !Object.hasOwn(properties, parameter)) || (!problem && used.join() !== Object.keys(properties).sort().join())) {
        throw new Error(`Message parameter declaration differs from placeholders: ${key}`);
    }
    if (isPlural && (properties.count !== 'number' || !ui?.plural)) throw new Error(`Plural requires numeric count contract: ${key}`);
    messageContracts[key] = {parameters: properties, required, plural: isPlural};
    const shape = problem
        ? `Extract<components['schemas']['Problem'], {code: '${problem.code}'}>['params']`
        : Object.keys(properties).length
            ? `{${Object.entries(properties).map(([name, type]) => `${JSON.stringify(name)}: ${type === 'integer' ? 'number' : type}`).join('; ')}}`
            : 'Record<string, never>';
    typeEntries.push(`    ${JSON.stringify(key)}: ${shape};`);
    for (const catalog of catalogs) {
        const translated = catalog.groups[key];
        if (!translated) throw new Error(`Missing ${catalog.locale} message: ${key}`);
        const translatedUsed = [...new Set(translated.flatMap(variant => variant.parameters))].sort();
        if (translatedUsed.join() !== used.join()) throw new Error(`Placeholder drift in ${catalog.locale}: ${key}`);
        if (isPlural) {
            const categories = new Intl.PluralRules(catalog.locale).resolvedOptions().pluralCategories;
            if (translated.some(variant => !variant.suffix) || categories.some(category => !translated.some(variant => variant.suffix === category))) {
                throw new Error(`Incomplete ${catalog.locale} plural forms: ${key}`);
            }
        } else if (translated.length !== 1 || translated[0].suffix) throw new Error(`Unexpected plural forms: ${key}`);
    }
}
for (const catalog of catalogs) {
    if (Object.keys(catalog.groups).sort().join('\0') !== keys.join('\0')) throw new Error(`Extra or missing logical keys: ${catalog.locale}`);
}

const manifest = {version: sourceHash.digest('hex'), locales: catalogs.map(({locale, nativeName, direction}) => ({locale, nativeName, direction})),
    helpSources: Object.fromEntries(catalogs.map(({locale, help}) => [locale, help.directory])), messages: messageContracts};
const resources = Object.fromEntries(catalogs.map(({locale, resources}) => [locale, resources]));
const declarations = `// Generated from src/locales and the API contract; do not edit.
import type {components} from './api/v1';
export type Locale = ${catalogs.map(catalog => JSON.stringify(catalog.locale)).join(' | ')};
export interface LocaleDefinition { readonly locale: Locale; readonly nativeName: string; readonly direction: 'ltr' | 'rtl'; }
export interface MessageParameters {
${typeEntries.join('\n')}
}
export type MessageKey = keyof MessageParameters;
export type Translator = <K extends MessageKey>(key: K, ...arguments_: {} extends MessageParameters[K] ? [parameters?: MessageParameters[K]] : [parameters: MessageParameters[K]]) => string;
export interface LocalizationContext { readonly locale: Locale; readonly t: Translator; }
`;
const output = new Map([
    ['src/types/LocalizationTypes.d.ts', declarations],
    ['src/modules/localization/generated/resources.json', `${JSON.stringify(resources, null, 2)}\n`],
    ['src/modules/localization/generated/manifest.json', `${JSON.stringify(manifest, null, 2)}\n`],
    ['src/modules/localization/generated/permissions.ts', '// Generated from permission registry and locale catalogs; do not edit.\n'
        + "import type {MessageKey} from '../../../types/LocalizationTypes';\n"
        + `export const permissionMessageKeys = ${JSON.stringify(Object.fromEntries(permissionKeys.map(key => [key, `permissions.${key}`])), null, 2)} as const satisfies Record<string, MessageKey>;\n`],
]);
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
