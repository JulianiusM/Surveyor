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

/** Match runtime source selection without importing the application or compiled output.
 * Native Help remains rooted here; localized missing topics/figures borrow only adjacent
 * reviewed English. Reports disclose those omissions as warnings, never invented errors. */
function resolveCorpusFile(corpus, relativePath, authoredFile) {
    const selected = inspectHelpFile(corpus.root, relativePath);
    if (selected.present) return selected.filePath;
    if (!corpus.locale || corpus.locale === 'en') return null;
    const english = inspectHelpFile(path.join(helpRoot, 'en'), relativePath);
    if (english.filePath) {
        addWarning(authoredFile, `Localized ${relativePath} is absent; the runtime visibly falls back to reviewed English`);
    }
    return english.filePath;
}

/** Collect each actual locale directory under the canonical tree. No translated
 * corpus, visual-label registry or retired alias is treated as another Help root. */
function helpCorpora() {
    const corpora = [{root: helpRoot, locale: null}];
    for (const entry of fs.readdirSync(helpRoot, {withFileTypes: true})) {
        if (entry.name === 'assets' || entry.isFile()) continue;
        let canonicalLocale;
        try { canonicalLocale = Intl.getCanonicalLocales(entry.name)[0]; }
        catch { canonicalLocale = null; }
        if (!entry.isDirectory() || canonicalLocale !== entry.name) {
            addError(path.join(helpRoot, entry.name), 'Help subdirectories must be regular canonical locale directories');
            continue;
        }
        corpora.push({root: path.join(helpRoot, entry.name), locale: entry.name});
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
 * code examples stay literal, and links/figures use this corpus's containment/fallback.
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
        if (!isImage) {
            const targetWithoutSuffix = target.split(/[?#]/u, 1)[0].replaceAll('\\', '/');
            if (targetWithoutSuffix.toLowerCase().endsWith('.md')) {
                const resolvedDoc = path.resolve(path.dirname(filePath), targetWithoutSuffix);
                if (!isInside(corpus.root, resolvedDoc) || path.dirname(resolvedDoc) !== corpus.root
                    || !resolveCorpusFile(corpus, targetWithoutSuffix, filePath)) {
                    addError(filePath, `In-app Markdown link must target a maintained guide in ${relative(corpus.root)}: ${target}`);
                }
            } else if (targetWithoutSuffix.startsWith('assets/') || targetWithoutSuffix.startsWith('/help/assets/')) {
                validateAssetReference(filePath, targetWithoutSuffix.replace(/^\/help\//u, ''), corpus);
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

/** Images and full-size figure links share one format/source/reference owner. */
function validateAssetReference(filePath, target, corpus) {
    const assetName = target.slice('assets/'.length);
    const extension = path.extname(assetName).toLowerCase();
    if (!allowedAssetExtensions.has(extension)) {
        addError(filePath, `Unsupported help image type "${extension}": ${target}`);
        return;
    }
    if (!/^assets\/[^/]+$/iu.test(target)) {
        addError(filePath, `Help figures must use a local packaged asset under assets/: ${target}`);
        return;
    }
    const assetPath = resolveCorpusFile(corpus, target, filePath);
    if (!assetPath) {
        addError(filePath, `Referenced help image is missing or is not a regular reviewed file: ${target}`);
        return;
    }
    const sourcePath = relative(assetPath);
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
        if (corpus.locale && corpus.locale !== 'en') addWarning(assetRoot, 'Localized asset directory is absent; referenced figures may use visible English fallback');
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
    const controllerPath = path.join(repositoryRoot, 'src', 'controller', 'helpController.ts');
    if (!fs.existsSync(controllerPath)) {
        addError(controllerPath, 'Help controller is missing');
    }

    // This report checks reviewed native/localized content and packaging, not executable path
    // selection. Searching for a particular path expression would reject equivalent
    // composition and could accept an unsafe unused string. Synthetic application
    // tests independently exercise fixed roots, traversal and content rejection.

    const releasePath = path.join(repositoryRoot, '.github', 'workflows', 'release.yml');
    const release = fs.readFileSync(releasePath, 'utf8');
    for (const required of ['cp -R docs release/docs', 'diff -qr docs/user-guide release/docs/user-guide']) {
        if (!release.includes(required)) {
            addError(releasePath, `Release packaging does not verify maintained help content: ${required}`);
        }
    }
}

if (!fs.existsSync(helpRoot) || !fs.statSync(helpRoot).isDirectory()) {
    errors.push({file: 'docs/user-guide', message: 'Canonical in-app help directory is missing'});
    process.stdout.write(`${JSON.stringify({advisory: true, ok: false, errors}, null, 2)}\n`);
    process.exitCode = 0;
} else {
    const corpora = helpCorpora();
    const helpFiles = [];
    // Validate every article first so English assets referenced by a partial locale
    // are counted before any corpus's unreferenced-asset report is calculated.
    for (const corpus of corpora) {
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
