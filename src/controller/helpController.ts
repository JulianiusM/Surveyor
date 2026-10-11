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

import {marked} from 'marked';
import fs from 'node:fs';
import path from 'node:path';
import {ExpectedError} from '../modules/lib/errors';
import {createTranslator, helpSourceDirectory, resolveLocale} from '../modules/localization/translator';
import {localizedHelpUrl} from '../modules/lib/helpNavigation';
import type {Locale} from '../types/LocalizationTypes';
import type {HelpDocumentSummary, HelpNavigationGroup, HelpTocEntry, HelpSearchResult, HelpPageData} from '../types/HelpTypes';

const DOCUMENTATION_METADATA_RE = /<!--\s*documentation-metadata\s*\r?\n[\s\S]*?-->\s*/iu;
const HELP_DOC_SLUG_RE = /^[a-z0-9_-]+$/iu;
const HELP_ASSET_NAME_RE = /^[a-z0-9][a-z0-9._-]*$/iu;
const HELP_ASSET_EXTENSIONS = new Set(['.gif', '.jpeg', '.jpg', '.png', '.webp']);
const SAFE_EXTERNAL_URI_SCHEMES = new Set(['http', 'https', 'mailto', 'tel']);
const MAX_SEARCH_QUERY_LENGTH = 100;

const HELP_NAVIGATION = [
    {title: 'help.startHere', paths: ['readme', 'getting_started', 'dashboard']},
    {title: 'help.planDecide', paths: ['surveys', 'events', 'activity_plans']},
    {title: 'help.organizeShare', paths: ['invoice_pools', 'packing_lists', 'drivers_lists']},
    {title: 'help.advanced', paths: ['permissions']},
] as const;

interface ParsedHelpDocument {
    content: string;
    title: string;
    toc: HelpTocEntry[];
    headings: HelpTocEntry[];
}

interface HeadingInfo extends HelpTocEntry {
    renderedIndex: number;
}

/**
 * Fixed, release-controlled source for in-app help. This directory is trusted
 * application content under DEC-004; it is not configurable from requests,
 * settings, a database, or a remote source.
 */
export function getHelpDocsBasePath(requestedLocale = 'en'): string {
    return path.join(__dirname, '..', '..', 'docs', 'user-guide', helpSourceDirectory(requestedLocale));
}

export function getHelpAssetsBasePath(requestedLocale = 'en'): string {
    return path.join(getHelpDocsBasePath(requestedLocale), 'assets');
}

function isPathInside(basePath: string, candidatePath: string): boolean {
    const relative = path.relative(path.resolve(basePath), path.resolve(candidatePath));
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function resolveRegularFile(basePath: string, relativePath: string): string | null {
    const resolvedPath = path.resolve(basePath, relativePath);
    if (!isPathInside(basePath, resolvedPath)) {
        return null;
    }
    if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
        return null;
    }
    return resolvedPath;
}

function resolveDocPath(fileName: string, locale = 'en'): string | null {
    if (path.basename(fileName) !== fileName || !fileName.toLowerCase().endsWith('.md')) {
        return null;
    }
    return resolveRegularFile(getHelpDocsBasePath(locale), fileName);
}

export function resolveHelpAssetPath(assetName: string, locale = 'en'): string | null {
    if (!HELP_ASSET_NAME_RE.test(assetName) || path.basename(assetName) !== assetName) {
        return null;
    }
    if (!HELP_ASSET_EXTENSIONS.has(path.extname(assetName).toLowerCase())) {
        return null;
    }
    return resolveRegularFile(getHelpAssetsBasePath(locale), assetName);
}

function stripDocumentationMetadata(markdown: string): string {
    return markdown.replace(DOCUMENTATION_METADATA_RE, '');
}

function decodeUriCharacterReferences(value: string): string {
    return value
        .replace(/&#x([0-9a-f]+);?/giu, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
        .replace(/&#([0-9]+);?/gu, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
        .replace(/&colon;/giu, ':')
        .replace(/&tab;/giu, '\t')
        .replace(/&newline;/giu, '\n')
        .replace(/&amp;/giu, '&');
}

function assertSafeHelpUri(href: string, sourceName: string): void {
    const trimmed = href.trim();
    if (!trimmed) {
        return;
    }

    const decoded = decodeUriCharacterReferences(trimmed);
    if (/[\u0000-\u001f\u007f]/u.test(decoded)) {
        throw new Error(`${sourceName} contains a URI with control characters`);
    }

    const schemeProbe = decoded.replace(/[\s\u00a0]+/gu, '');
    if (schemeProbe.startsWith('//') || schemeProbe.startsWith('\\\\')) {
        throw new Error(`${sourceName} contains a protocol-relative URI: ${href}`);
    }

    const schemeMatch = /^([a-z][a-z0-9+.-]*):/iu.exec(schemeProbe);
    if (schemeMatch && !SAFE_EXTERNAL_URI_SCHEMES.has(schemeMatch[1].toLowerCase())) {
        throw new Error(`${sourceName} contains an unsafe URI scheme: ${schemeMatch[1]}`);
    }
}

function splitUriSuffix(href: string): { base: string; suffix: string } {
    const queryIndex = href.indexOf('?');
    const fragmentIndex = href.indexOf('#');
    const indexes = [queryIndex, fragmentIndex].filter(index => index >= 0);
    const cutIndex = indexes.length > 0 ? Math.min(...indexes) : -1;
    return cutIndex < 0
        ? {base: href, suffix: ''}
        : {base: href.slice(0, cutIndex), suffix: href.slice(cutIndex)};
}

function managedAssetName(href: string, locale: string): string | null {
    const {base} = splitUriSuffix(href);
    const normalized = base.replaceAll('\\', '/').replace(/^\/help\//u, '');
    if (!normalized.startsWith('assets/') || normalized.slice('assets/'.length).includes('/')) {
        return null;
    }
    const assetName = normalized.slice('assets/'.length);
    return resolveHelpAssetPath(assetName, locale) ? assetName : null;
}

function managedHelpDocName(href: string, locale = 'en'): string | null {
    const {base} = splitUriSuffix(href);
    const normalized = base.replaceAll('\\', '/');
    if (normalized.includes('/') || !normalized.toLowerCase().endsWith('.md')) {
        return null;
    }
    return resolveDocPath(normalized, locale) ? normalized : null;
}

function visitTokenTree(value: unknown, visitor: (token: Record<string, any>) => void, seen = new WeakSet<object>()): void {
    if (!value || typeof value !== 'object') {
        return;
    }
    if (seen.has(value)) {
        return;
    }
    seen.add(value);

    if (Array.isArray(value)) {
        for (const item of value) {
            visitTokenTree(item, visitor, seen);
        }
        return;
    }

    const token = value as Record<string, any>;
    if (typeof token.type === 'string') {
        visitor(token);
    }
    for (const nested of Object.values(token)) {
        visitTokenTree(nested, visitor, seen);
    }
}

/**
 * Enforce the authored-content side of DEC-004 before trusted Markdown is
 * inserted into the application page. This is a rejection guard, not a claim
 * that arbitrary Markdown has been sanitized.
 */
export function validateTrustedHelpMarkdown(markdown: string, sourceName = 'Help document', locale = 'en'): void {
    const authoredMarkdown = stripDocumentationMetadata(markdown);
    const tokens = marked.lexer(authoredMarkdown, {gfm: true});

    visitTokenTree(tokens, token => {
        if (token.type === 'html') {
            throw new Error(`${sourceName} contains raw HTML outside the permitted documentation metadata comment`);
        }
        if ((token.type === 'link' || token.type === 'image') && typeof token.href === 'string') {
            assertSafeHelpUri(token.href, sourceName);
        }
        if (token.type === 'link' && typeof token.href === 'string') {
            const {base} = splitUriSuffix(token.href);
            if (base.toLowerCase().endsWith('.md') && !managedHelpDocName(token.href, locale)) {
                throw new Error(`${sourceName} links may reference only maintained Markdown files in the selected help language`);
            }
            if ((base.startsWith('assets/') || base.startsWith('/help/assets/')) && !managedAssetName(token.href, locale)) {
                throw new Error(`${sourceName} asset links must reference a packaged file in the selected help language`);
            }
        }
        if (token.type === 'image' && typeof token.href === 'string' && !managedAssetName(token.href, locale)) {
            throw new Error(`${sourceName} images must reference a packaged file in the selected help language's assets directory`);
        }
    });
}

/** Rewrite links to maintained Markdown documents into their in-app routes. */
export function rewriteDocHrefToHelpRoute(href: string, locale = 'en'): string {
    if (!href || href.startsWith('#')) {
        return href;
    }
    const {base, suffix} = splitUriSuffix(href);
    // Authored article links belong to their selected corpus. An explicit query in the
    // source must not send a reader to another language; UI language selection is separate.
    if (base === '/help' || base.startsWith('/help/')) {
        return localizedHelpUrl(href, locale);
    }

    const lower = href.toLowerCase();
    if ([...SAFE_EXTERNAL_URI_SCHEMES].some(scheme => lower.startsWith(`${scheme}:`))) {
        return href;
    }

    const assetName = managedAssetName(href, locale);
    if (assetName) {
        return localizedHelpUrl(`/help/assets/${encodeURIComponent(assetName)}${suffix}`, locale);
    }
    if (!base.toLowerCase().endsWith('.md')) {
        return href;
    }

    const docName = managedHelpDocName(href, locale);
    if (!docName) {
        return href;
    }
    const extension = path.posix.extname(docName);
    const fileName = path.posix.basename(docName, extension);
    return localizedHelpUrl(`/help/${fileName.toLowerCase()}${suffix}`, locale);
}

function rewriteHelpAssetHref(href: string, locale: string): string {
    const {suffix} = splitUriSuffix(href);
    const assetName = managedAssetName(href, locale);
    return assetName ? localizedHelpUrl(`/help/assets/${encodeURIComponent(assetName)}${suffix}`, locale) : href;
}

function tokenPlainText(token: any): string {
    if (Array.isArray(token?.tokens)) {
        return token.tokens.map((child: any) => tokenPlainText(child)).join('');
    }
    if (typeof token?.text === 'string') {
        return token.text;
    }
    return '';
}

function slugifyHeading(title: string): string {
    const slug = title
        .normalize('NFKD')
        .replace(/\p{M}/gu, '')
        .toLowerCase()
        .replace(/&/gu, ' and ')
        .replace(/[^\p{L}\p{N}]+/gu, '-')
        .replace(/^-+|-+$/gu, '');
    return slug || 'section';
}

function extractHeadings(markdown: string): HeadingInfo[] {
    const tokens = marked.lexer(markdown, {gfm: true});
    const counts = new Map<string, number>();
    const headings: HeadingInfo[] = [];

    for (const token of tokens as any[]) {
        if (token.type !== 'heading' || typeof token.depth !== 'number') {
            continue;
        }
        const title = tokenPlainText(token).trim() || String(token.text ?? '').trim();
        const baseId = slugifyHeading(title);
        const count = (counts.get(baseId) ?? 0) + 1;
        counts.set(baseId, count);
        headings.push({
            id: count === 1 ? baseId : `${baseId}-${count}`,
            title,
            level: token.depth,
            renderedIndex: headings.length,
        });
    }
    return headings;
}

/**
 * A translated article owns its stable fragment contract in the permitted metadata
 * comment. Keeping IDs alongside that article makes it usable without another language's
 * files, while copied and contextual links continue to reach the same task after translation.
 * Levels and unique safe IDs protect against silently assigning a link to the wrong heading.
 */
function applyAuthoredHeadingAnchors(markdown: string, headings: HeadingInfo[], sourceName: string): void {
    const metadata = DOCUMENTATION_METADATA_RE.exec(markdown)?.[0];
    const anchors = metadata && /^heading-anchors:\s*(.+)$/mu.exec(metadata)?.[1];
    if (!anchors) {
        return;
    }
    const entries = anchors.trim().split(/\s*;\s*/u);
    const ids = new Set<string>();
    if (entries.length !== headings.length) {
        throw new Error(`${sourceName} heading anchors must match the article's headings`);
    }
    entries.forEach((entry, index) => {
        const match = /^([1-6]):([a-z0-9][a-z0-9_-]*)$/u.exec(entry);
        if (!match || Number(match[1]) !== headings[index].level || ids.has(match[2])) {
            throw new Error(`${sourceName} contains invalid or mismatched heading anchors`);
        }
        ids.add(match[2]);
        headings[index].id = match[2];
    });
}

function addHeadingIds(html: string, headings: HeadingInfo[]): string {
    let headingIndex = 0;
    return html.replace(/<h([1-6])>([\s\S]*?)<\/h\1>/gu, (match, level: string, body: string) => {
        const heading = headings[headingIndex];
        headingIndex += 1;
        if (!heading || heading.level !== Number(level)) {
            return match;
        }
        return `<h${level} id="${heading.id}">${body}</h${level}>`;
    });
}

export function renderTrustedHelpMarkdown(markdown: string, sourceName = 'Help document', locale = 'en'): ParsedHelpDocument {
    validateTrustedHelpMarkdown(markdown, sourceName, locale);
    const authoredMarkdown = stripDocumentationMetadata(markdown);
    const headings = extractHeadings(authoredMarkdown);
    applyAuthoredHeadingAnchors(markdown, headings, sourceName);
    const rendered = marked.parse(authoredMarkdown, {
        gfm: true,
        breaks: false,
        walkTokens(token: any) {
            if (token?.type === 'link' && typeof token.href === 'string') {
                token.href = rewriteDocHrefToHelpRoute(token.href, locale);
            }
            if (token?.type === 'image' && typeof token.href === 'string') {
                token.href = rewriteHelpAssetHref(token.href, locale);
            }
        },
    }) as string;

    return {
        content: addHeadingIds(rendered, headings),
        title: headings.find(heading => heading.level === 1)?.title || createTranslator(locale).t('help.title'),
        headings: headings.map(({id, title, level}) => ({id, title, level})),
        toc: headings
            .filter(heading => heading.level === 2 || heading.level === 3)
            .map(({id, title, level}) => ({id, title, level})),
    };
}

function readMarkdownFile(filePath: string, locale: string): ParsedHelpDocument | null {
    try {
        const markdown = fs.readFileSync(filePath, 'utf-8');
        return renderTrustedHelpMarkdown(markdown, path.basename(filePath), locale);
    } catch (error) {
        console.error('Error reading trusted help document:', error);
        return null;
    }
}

function helpDocUrl(docPath: string, locale: string): string {
    return localizedHelpUrl(docPath === 'readme' ? '/help' : `/help/${docPath}`, locale);
}

function getDocsCatalog(locale: string): HelpDocumentSummary[] {
    const docsBasePath = getHelpDocsBasePath(locale);
    try {
        return fs.readdirSync(docsBasePath, {withFileTypes: true})
            .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
            .map(entry => {
                const filePath = path.join(docsBasePath, entry.name);
                const markdown = fs.readFileSync(filePath, 'utf-8');
                const authoredMarkdown = stripDocumentationMetadata(markdown);
                const title = extractHeadings(authoredMarkdown).find(heading => heading.level === 1)?.title
                    || entry.name.replace(/\.md$/iu, '');
                const docPath = entry.name.replace(/\.md$/iu, '').toLowerCase();
                return {name: entry.name, title, path: docPath, url: helpDocUrl(docPath, locale)};
            });
    } catch (error) {
        console.error('Error listing trusted help documents:', error);
        return [];
    }
}

function buildNavigation(catalog: HelpDocumentSummary[], locale: string): {
    docsList: HelpDocumentSummary[];
    docsGroups: HelpNavigationGroup[]
} {
    const byPath = new Map(catalog.map(doc => [doc.path, doc]));
    const included = new Set<string>();
    const docsGroups: HelpNavigationGroup[] = [];
    const {t} = createTranslator(locale);

    for (const group of HELP_NAVIGATION) {
        const docs = group.paths
            .map(docPath => byPath.get(docPath))
            .filter((doc): doc is HelpDocumentSummary => Boolean(doc));
        docs.forEach(doc => included.add(doc.path));
        if (docs.length > 0) {
            docsGroups.push({title: t(group.title), docs});
        }
    }

    const otherDocs = catalog
        .filter(doc => !included.has(doc.path))
        .sort((left, right) => left.title.localeCompare(right.title));
    if (otherDocs.length > 0) {
        docsGroups.push({title: t('help.more'), docs: otherDocs});
    }

    return {docsGroups, docsList: docsGroups.flatMap(group => group.docs)};
}

function commonPageData(currentDoc: string, locale: Locale): Pick<HelpPageData, 'locale' | 'docsList' | 'docsGroups' | 'currentDoc'> {
    const {docsList, docsGroups} = buildNavigation(getDocsCatalog(locale), locale);
    return {locale, docsList, docsGroups, currentDoc};
}

function markdownSearchText(markdown: string): string {
    return stripDocumentationMetadata(markdown)
        .replace(/```[\s\S]*?```/gu, ' ')
        .replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
        .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
        .replace(/[`*_>#|~-]+/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim();
}

function createSearchExcerpt(text: string, firstMatch: number): string {
    const radius = 105;
    const start = Math.max(0, firstMatch - radius);
    const end = Math.min(text.length, firstMatch + radius);
    const prefix = start > 0 ? '…' : '';
    const suffix = end < text.length ? '…' : '';
    return `${prefix}${text.slice(start, end).trim()}${suffix}`;
}

export function searchHelpDocuments(rawQuery: string, requestedLocale = 'en'): HelpSearchResult[] {
    const locale = resolveLocale(requestedLocale);
    const query = rawQuery.trim().replace(/\s+/gu, ' ').slice(0, MAX_SEARCH_QUERY_LENGTH);
    if (!query) {
        return [];
    }
    const terms = query.toLocaleLowerCase(locale).split(' ').filter(Boolean);
    const results: Array<HelpSearchResult & { score: number }> = [];

    for (const doc of getDocsCatalog(locale)) {
        const filePath = resolveDocPath(doc.name, locale);
        if (!filePath) {
            continue;
        }
        const markdown = fs.readFileSync(filePath, 'utf-8');
        const searchText = markdownSearchText(markdown);
        const lowerText = searchText.toLocaleLowerCase(locale);
        if (!terms.every(term => lowerText.includes(term))) {
            continue;
        }

        const lowerTitle = doc.title.toLocaleLowerCase(locale);
        const matchIndexes = terms.map(term => lowerText.indexOf(term)).filter(index => index >= 0);
        const firstMatch = matchIndexes.length > 0 ? Math.min(...matchIndexes) : 0;
        const parsed = readMarkdownFile(filePath, locale);
        if (!parsed) continue;
        const matchingHeading = parsed.headings.find(heading => terms.some(term => heading.title.toLocaleLowerCase(locale).includes(term)));
        const score = terms.reduce((total, term) => total + (lowerTitle.includes(term) ? 20 : 1), 0)
            + (matchingHeading ? 8 : 0);
        results.push({
            title: doc.title,
            url: matchingHeading ? `${doc.url}#${matchingHeading.id}` : doc.url,
            sectionTitle: matchingHeading?.title,
            excerpt: createSearchExcerpt(searchText, firstMatch),
            score,
        });
    }

    return results
        .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))
        .slice(0, 20)
        .map(({score: _score, ...result}) => result);
}

export function fetchHelpIndex(requestedLocale = 'en'): HelpPageData {
    const locale = resolveLocale(requestedLocale);
    const common = commonPageData('readme', locale);
    const readmePath = resolveDocPath('README.md', locale);
    const parsed = readmePath ? readMarkdownFile(readmePath, locale) : null;
    return {
        ...common,
        title: parsed?.title ?? createTranslator(locale).t('help.title'),
        content: parsed?.content ?? '',
        toc: parsed?.toc ?? [],
    };
}

export function fetchHelpSearch(rawQuery: string, requestedLocale = 'en'): HelpPageData {
    const locale = resolveLocale(requestedLocale);
    const searchQuery = rawQuery.trim().replace(/\s+/gu, ' ').slice(0, MAX_SEARCH_QUERY_LENGTH);
    return {
        ...commonPageData('search', locale),
        title: createTranslator(locale).t('help.searchTitle'),
        content: '',
        toc: [],
        searchQuery,
        searchResults: searchHelpDocuments(searchQuery, locale),
    };
}

export function fetchHelpDoc(docName: string, requestedLocale = 'en'): HelpPageData {
    const locale = resolveLocale(requestedLocale);
    const {t} = createTranslator(locale);
    if (!HELP_DOC_SLUG_RE.test(docName)) {
        throw new ExpectedError(t('help.notFound'), 'error', 404);
    }

    const fileName = `${docName.toUpperCase()}.md`;
    const filePath = resolveDocPath(fileName, locale);
    if (!filePath) {
        throw new ExpectedError(t('help.notFound'), 'error', 404);
    }

    const parsed = readMarkdownFile(filePath, locale);
    if (!parsed) {
        throw new ExpectedError(t('help.loadError'), 'error', 500);
    }

    return {
        ...commonPageData(docName.toLowerCase(), locale),
        title: parsed.title,
        content: parsed.content,
        toc: parsed.toc,
    };
}
