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
const assetRoot = path.join(helpRoot, 'assets');
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

function validateHelpFile(filePath) {
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
                if (!isInside(helpRoot, resolvedDoc) || path.dirname(resolvedDoc) !== helpRoot
                    || !fs.existsSync(resolvedDoc) || !fs.statSync(resolvedDoc).isFile()) {
                    addError(filePath, `In-app Markdown link must target a maintained guide in docs/user-guide: ${target}`);
                }
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
        const assetName = targetWithoutSuffix.slice('assets/'.length);
        const extension = path.extname(assetName).toLowerCase();
        if (!allowedAssetExtensions.has(extension)) {
            addError(filePath, `Unsupported help image type "${extension}": ${target}`);
            continue;
        }
        const assetPath = path.resolve(assetRoot, assetName);
        if (!isInside(assetRoot, assetPath) || !fs.existsSync(assetPath) || !fs.statSync(assetPath).isFile()) {
            addError(filePath, `Referenced help image does not exist: ${target}`);
            continue;
        }
        referencedAssets.set(assetName, (referencedAssets.get(assetName) ?? 0) + 1);
    }
}

function validateAssets() {
    if (!fs.existsSync(assetRoot) || !fs.statSync(assetRoot).isDirectory()) {
        errors.push({file: 'docs/user-guide/assets', message: 'Help asset directory is missing'});
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
        if ((referencedAssets.get(entry.name) ?? 0) === 0) {
            addError(assetPath, 'Help asset is not referenced by any maintained user guide');
        }
    }
    return assets.filter(entry => entry.isFile()).map(entry => entry.name).sort();
}

function validateSourceBoundary() {
    const controllerPath = path.join(repositoryRoot, 'src', 'controller', 'helpController.ts');
    const controller = fs.readFileSync(controllerPath, 'utf8');
    for (const required of [
        "'docs', 'user-guide'",
        'validateTrustedHelpMarkdown',
        'resolveHelpAssetPath',
        'renderTrustedHelpMarkdown',
    ]) {
        if (!controller.includes(required)) {
            addError(controllerPath, `Missing fixed help-source guard: ${required}`);
        }
    }

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
} else {
    const helpFiles = fs.readdirSync(helpRoot, {withFileTypes: true})
        .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
        .map(entry => path.join(helpRoot, entry.name))
        .sort();
    for (const filePath of helpFiles) {
        validateHelpFile(filePath);
    }
    const assets = validateAssets();
    validateSourceBoundary();

    const report = {
        ok: errors.length === 0,
        helpRoot: relative(helpRoot),
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
    process.exitCode = report.ok ? 0 : 1;
}
