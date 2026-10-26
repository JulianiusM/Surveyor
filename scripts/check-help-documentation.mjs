#!/usr/bin/env node

/*
 * Copyright 2026 Julian Malovanij
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {declaresDocumentationPublication} from './check-documentation.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const helpRoot = path.join(repositoryRoot, 'docs', 'user-guide');
const allowedAssetExtensions = new Set(['.gif', '.jpeg', '.jpg', '.png', '.webp']);
const safeSchemes = new Set(['http', 'https', 'mailto', 'tel']);
const metadataPattern = /<!--\s*documentation-metadata\s*\r?\n[\s\S]*?-->\s*/iu;

const errors = [];
const warnings = [];
const referencedAssets = new Map();
let linksChecked = 0;
let imagesChecked = 0;
let rawHtmlChecks = 0;

function relative(filePath) {
    return path.relative(repositoryRoot, filePath).split(path.sep).join('/');
}

function addError(filePath, message) {
    errors.push({file: relative(filePath), message});
}

function addWarning(filePath, message) {
    warnings.push({file: relative(filePath), message});
}

/** Distinguish absent translations from malformed release entries. A directory,
 * symlink, unreadable path or realpath escape must never be hidden by English fallback. */
function inspectHelpFile(corpusRoot, relativePath) {
    const filePath = path.resolve(corpusRoot, relativePath);
    if (!isInside(corpusRoot, filePath)) return {present: true, filePath: null};
    let entry;
    try { entry = fs.lstatSync(filePath); }
    catch (error) {
        if (error.code === 'ENOENT') return {present: false, filePath: null};
        throw error;
    }
    const valid = entry.isFile() && !entry.isSymbolicLink() && isInside(corpusRoot, fs.realpathSync(filePath));
    return {present: true, filePath: valid ? filePath : null};
}

/** Check logical topic destinations without importing application code. A missing
 * translated topic may open a complete English article; this never selects an
 * English figure for an otherwise translated article. */
function resolveCorpusFile(corpus, relativePath, authoredFile) {
    const selected = inspectHelpFile(corpus.root, relativePath);
    if (selected.present) return selected.filePath;
    if (corpus.locale === 'en') return null;
    const english = inspectHelpFile(path.join(helpRoot, 'en'), relativePath);
    if (english.filePath) {
        addWarning(authoredFile, `Localized ${relativePath} is absent; navigation may open its complete reviewed English article`);
    }
    return english.filePath;
}

/** Collect each actual locale directory under the canonical tree. No translated
 * corpus, visual-label registry or retired alias is treated as another Help root. */
function helpCorpora() {
    const corpora = [];
    for (const entry of fs.readdirSync(helpRoot, {withFileTypes: true})) {
        let canonicalLocale;
        try { canonicalLocale = Intl.getCanonicalLocales(entry.name)[0]; }
        catch { canonicalLocale = null; }
        if (!entry.isDirectory() || canonicalLocale !== entry.name) {
            addError(path.join(helpRoot, entry.name), 'Help subdirectories must be regular canonical locale directories');
            continue;
        }
        corpora.push({root: path.join(helpRoot, entry.name), locale: entry.name});
    }
    if (!corpora.some(corpus => corpus.locale === 'en')) {
        addError(path.join(helpRoot, 'en'), 'The reviewed English Help corpus is missing');
    }
    return corpora;
}

function isInside(basePath, candidatePath) {
    const rel = path.relative(path.resolve(basePath), path.resolve(candidatePath));
    return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}

function decodeReferences(value) {
    return value
        .replace(/&#x([0-9a-f]+);?/giu, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
        .replace(/&#([0-9]+);?/gu, (_match, code) => String.fromCodePoint(Number.parseInt(code, 10)))
        .replace(/&colon;/giu, ':')
        .replace(/&tab;/giu, '\t')
        .replace(/&newline;/giu, '\n')
        .replace(/&amp;/giu, '&');
}

function validateUri(filePath, target) {
    const decoded = decodeReferences(target.trim());
    if (/[\u0000-\u001f\u007f]/u.test(decoded)) {
        addError(filePath, `URI contains control characters: ${JSON.stringify(target)}`);
        return false;
    }
    const probe = decoded.replace(/[\s\u00a0]+/gu, '');
    if (probe.startsWith('//') || probe.startsWith('\\\\')) {
        addError(filePath, `Protocol-relative URI is not allowed: ${target}`);
        return false;
    }
    const scheme = /^([a-z][a-z0-9+.-]*):/iu.exec(probe)?.[1]?.toLowerCase();
    if (scheme && !safeSchemes.has(scheme)) {
        addError(filePath, `Unsafe URI scheme "${scheme}" is not allowed: ${target}`);
        return false;
    }
    return true;
}

function removeCode(markdown) {
    const result = [];
    let fence = null;
    for (const line of markdown.split(/\r?\n/u)) {
        const fenceMatch = /^\s*(`{3,}|~{3,})/u.exec(line);
        if (fenceMatch) {
            const marker = fenceMatch[1][0];
            if (fence === null) {
                fence = marker;
            } else if (fence === marker) {
                fence = null;
            }
            result.push('');
            continue;
        }
        if (fence !== null) {
            result.push('');
            continue;
        }
        result.push(line.replace(/(`+)(?:[^`]|`(?!\1))*?\1/gu, ''));
    }
    return result.join('\n');
}

function parseMarkdownTarget(rawTarget) {
    const trimmed = rawTarget.trim();
    if (trimmed.startsWith('<')) {
        const closing = trimmed.indexOf('>');
        return closing >= 0 ? trimmed.slice(1, closing) : trimmed;
    }
    const quotedTitle = /\s+["'][^"']*["']\s*$/u;
    return trimmed.replace(quotedTitle, '').trim();
}

/** Review the authored subset without executing application code: metadata is stripped,
 * code examples stay literal, and each article references only its own language.
 * All findings remain advisory; this regex report does not replace runtime token validation. */
function validateHelpFile(filePath, corpus) {
    const markdown = fs.readFileSync(filePath, 'utf8');
    const metadataMatches = markdown.match(/<!--\s*documentation-metadata\b/giu) ?? [];
    if (metadataMatches.length !== 1) {
        addError(filePath, `Expected exactly one documentation metadata comment, found ${metadataMatches.length}`);
    }

    const authored = markdown.replace(metadataPattern, '');
    const withoutCode = removeCode(authored);
    rawHtmlChecks += 1;
    const htmlPattern = /<!--|<!doctype\b|<\?|<\/?[a-z][^>]*>/giu;
    const htmlMatch = htmlPattern.exec(withoutCode);
    if (htmlMatch) {
        addError(filePath, `Raw HTML is not allowed in in-app help: ${htmlMatch[0].slice(0, 80)}`);
    }

    const linkPattern = /(!?)\[([^\]]*)\]\(([^)]+)\)/gu;
    for (const match of withoutCode.matchAll(linkPattern)) {
        const isImage = match[1] === '!';
        const altOrText = match[2].trim();
        const target = parseMarkdownTarget(match[3]);
        if (isImage) {
            imagesChecked += 1;
        } else {
            linksChecked += 1;
        }
        if (!validateUri(filePath, target)) {
            continue;
        }
        // Explicit language overrides in local Help references must agree with the
        // article's corpus. Do not silently rewrite a cross-language authored URL.
        if (!validateReferenceLocale(filePath, target, corpus)) continue;
        if (!isImage) {
            const targetWithoutSuffix = target.split(/[?#]/u, 1)[0].replaceAll('\\', '/');
            if (targetWithoutSuffix.toLowerCase().endsWith('.md')) {
                const resolvedDoc = path.resolve(path.dirname(filePath), targetWithoutSuffix);
                if (!isInside(corpus.root, resolvedDoc) || path.dirname(resolvedDoc) !== corpus.root
                    || !resolveCorpusFile(corpus, targetWithoutSuffix, filePath)) {
                    addError(filePath, `In-app Markdown link must target a maintained guide in ${relative(corpus.root)}: ${target}`);
                }
            } else if (!/^[a-z][a-z0-9+.-]*:/iu.test(targetWithoutSuffix)
                && /(?:^|\/)assets\//u.test(targetWithoutSuffix)) {
                // Full-size links obey the same closed asset path as images.
                // Detect traversal before checking existence in another corpus.
                const assetReference = targetWithoutSuffix.replace(/^\/help\//u, '');
                validateAssetReference(filePath, assetReference, corpus);
            }
            continue;
        }
        if (!altOrText) {
            addError(filePath, `Image requires non-empty alt text: ${target}`);
        }
        const targetWithoutSuffix = target.split(/[?#]/u, 1)[0].replaceAll('\\', '/');
        if (!/^assets\/[^/]+$/iu.test(targetWithoutSuffix)) {
            addError(filePath, `Image must use a local packaged asset under assets/: ${target}`);
            continue;
        }
        validateAssetReference(filePath, targetWithoutSuffix, corpus);
    }
}

/** Local article/figure URLs cannot select another language through a query string.
 * External web links keep their ordinary query semantics. */
function validateReferenceLocale(filePath, target, corpus) {
    if (!corpus.locale) return true;
    const base = target.split(/[?#]/u, 1)[0].replaceAll('\\', '/');
    const localHelp = base.toLowerCase().endsWith('.md') || base.startsWith('assets/')
        || base === '/help' || base.startsWith('/help/');
    if (!localHelp || /^[a-z][a-z0-9+.-]*:/iu.test(base)) return true;

    // Check every occurrence: a second locale parameter must not smuggle in an
    // alternate source after the first, otherwise valid, same-language value.
    const locales = new URL(target, 'https://surveyor.invalid').searchParams.getAll('locale');
    if (locales.some(locale => resolveReferenceLocale(locale, corpus.catalogLocales) !== corpus.locale)) {
        addError(filePath, `Localized Help references must retain their own language (${corpus.locale}): ${target}`);
        return false;
    }
    return true;
}

/** Independently check authored hints against the discovered catalog tags. This
 * offline report cannot import the application; runtime source selection remains
 * exclusively in the localization owner and is protected by application tests. */
function resolveReferenceLocale(value, catalogLocales) {
    try {
        const requested = new Intl.Locale(value);
        const candidates = [requested.baseName, requested.script ? `${requested.language}-${requested.script}` : requested.language];
        for (const candidate of candidates) {
            const found = catalogLocales.find(locale => locale.toLowerCase() === candidate.toLowerCase());
            if (found) return found;
        }
    } catch {
        // Invalid authored hints are findings, never passive English negotiation.
    }
    return undefined;
}

/** Corpus fixtures may omit UI catalogs; real catalog filenames follow the same
 * canonical tags checked by generation. Discover names instead of maintaining
 * another language registry or depending on ignored generated application output. */
function reportCatalogLocales(corpora) {
    const locales = new Set(corpora.map(corpus => corpus.locale).filter(Boolean));
    const catalogRoot = path.join(repositoryRoot, 'src', 'common', 'locales');
    if (fs.existsSync(catalogRoot)) {
        for (const entry of fs.readdirSync(catalogRoot, {withFileTypes: true})) {
            if (entry.isFile() && entry.name.endsWith('.json')) locales.add(entry.name.slice(0, -5));
        }
    }
    return [...locales];
}

/** Images and full-size figure links share one format/source/reference owner. */
function validateAssetReference(filePath, target, corpus) {
    if (!/^assets\/[^/]+$/iu.test(target)) {
        addError(filePath, `Help figures must use a local packaged asset under assets/: ${target}`);
        return;
    }
    const assetName = target.slice('assets/'.length);
    const extension = path.extname(assetName).toLowerCase();
    if (!allowedAssetExtensions.has(extension)) {
        addError(filePath, `Unsupported help image type "${extension}": ${target}`);
        return;
    }
    const selected = inspectHelpFile(corpus.root, target);
    if (!selected.present && corpus.locale && corpus.locale !== 'en') {
        // A missing figure makes this entire translated article incomplete. Its
        // English counterpart is reported independently with all its own assets;
        // never count an English filename as a reference from translated prose.
        const counterpart = inspectHelpFile(path.join(helpRoot, 'en'), path.basename(filePath));
        if (counterpart.filePath) {
            addWarning(filePath, `Localized ${target} is absent; the complete article must fall back to reviewed English`);
            return;
        }
    }
    if (!selected.filePath) {
        addError(filePath, `Referenced help image is missing or is not a regular reviewed file: ${target}`);
        return;
    }
    const sourcePath = relative(selected.filePath);
    referencedAssets.set(sourcePath, (referencedAssets.get(sourcePath) ?? 0) + 1);
}

/** Inventory only regular reviewed raster files after every corpus's references have
 * been collected. A missing translation is a warning; malformed entries or orphaned
 * assets are findings for explicit maintainer review rather than automatic cleanup. */
function validateAssets(corpus) {
    const assetRoot = path.join(corpus.root, 'assets');
    let directory;
    try { directory = fs.lstatSync(assetRoot); }
    catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    if (!directory) {
        if (corpus.locale && corpus.locale !== 'en') addWarning(assetRoot, 'Localized asset directory is absent; incomplete articles require complete English article fallback');
        else addError(assetRoot, 'Help asset directory is missing');
        return [];
    }
    if (!directory.isDirectory() || directory.isSymbolicLink() || !isInside(corpus.root, fs.realpathSync(assetRoot))) {
        addError(assetRoot, 'Help assets must use a regular directory inside the reviewed corpus');
        return [];
    }
    const assets = fs.readdirSync(assetRoot, {withFileTypes: true});
    for (const entry of assets) {
        const assetPath = path.join(assetRoot, entry.name);
        if (!entry.isFile()) {
            addError(assetPath, 'Nested directories and non-file entries are not allowed in the help asset directory');
            continue;
        }
        if (!allowedAssetExtensions.has(path.extname(entry.name).toLowerCase())) {
            addError(assetPath, 'Only reviewed raster image formats are allowed in the help asset directory');
        }
        if ((referencedAssets.get(relative(assetPath)) ?? 0) === 0) {
            addError(assetPath, 'Help asset is not referenced by any maintained user guide');
        }
    }
    return assets.filter(entry => entry.isFile()).map(entry => entry.name).sort();
}

/** Check the canonical release-copy comparison independently of runtime implementation
 * spelling. Only application fixtures can establish how requests resolve actual sources. */
function validateSourceBoundary() {
    const controllerPath = path.join(repositoryRoot, 'src', 'backend', 'controller', 'helpController.ts');
    if (!fs.existsSync(controllerPath)) {
        addError(controllerPath, 'Help controller is missing');
    }

    // This report checks reviewed localized content and packaging, not executable path
    // selection. Searching for a particular path expression would reject equivalent
    // composition and could accept an unsafe unused string. Synthetic application
    // tests independently exercise fixed roots, traversal and content rejection.

    const releasePath = path.join(repositoryRoot, '.github', 'workflows', 'release.yml');
    const release = fs.readFileSync(releasePath, 'utf8');
    // Publication declarations share their existing generic owner. This report
    // still independently requires the exact runtime Help byte comparison;
    // recognizing a command never certifies that its execution copied the bytes.
    if (!declaresDocumentationPublication(repositoryRoot, release)) {
        addError(releasePath, 'Release packaging does not declare maintained documentation copying');
    }
    const comparison = 'diff -qr docs/user-guide release/docs/user-guide';
    if (!release.includes(comparison)) {
        addError(releasePath, `Release packaging does not verify maintained help content: ${comparison}`);
    }
}

if (!fs.existsSync(helpRoot) || !fs.statSync(helpRoot).isDirectory()) {
    errors.push({file: 'docs/user-guide', message: 'Canonical in-app help directory is missing'});
    process.stdout.write(`${JSON.stringify({advisory: true, ok: false, errors}, null, 2)}\n`);
    process.exitCode = 0;
} else {
    const corpora = helpCorpora();
    const catalogLocales = reportCatalogLocales(corpora);
    const helpFiles = [];
    // Collect every corpus's own references before reporting unused assets. Missing
    // translated bundles never lend English figures to translated article bodies.
    for (const corpus of corpora) {
        corpus.catalogLocales = catalogLocales;
        corpus.files = [];
        for (const entry of fs.readdirSync(corpus.root, {withFileTypes: true})) {
            if (!entry.name.toLowerCase().endsWith('.md')) continue;
            const filePath = path.join(corpus.root, entry.name);
            if (!entry.isFile() || !inspectHelpFile(corpus.root, entry.name).filePath) {
                addError(filePath, 'Maintained Help articles must be regular files inside their reviewed corpus');
                continue;
            }
            corpus.files.push(filePath);
        }
        corpus.files.sort();
        for (const filePath of corpus.files) validateHelpFile(filePath, corpus);
        helpFiles.push(...corpus.files);
    }
    const assets = [];
    for (const corpus of corpora) {
        corpus.assets = validateAssets(corpus);
        assets.push(...corpus.assets.map(name => relative(path.join(corpus.root, 'assets', name))));
    }
    validateSourceBoundary();

    const report = {
        advisory: true,
        ok: errors.length === 0,
        helpRoot: relative(helpRoot),
        corpora: corpora.map(corpus => ({directory: relative(corpus.root), locale: corpus.locale,
            markdownFiles: corpus.files.length, assets: corpus.assets})),
        markdownFiles: helpFiles.length,
        linksChecked,
        imagesChecked,
        rawHtmlChecks,
        assets,
        referencedAssets: Object.fromEntries([...referencedAssets.entries()].sort()),
        warnings,
        errors,
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    // Runtime help validation is unchanged; this offline report is advisory.
    process.exitCode = 0;
}
