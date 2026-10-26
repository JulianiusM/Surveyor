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
import {createTranslator, helpSourceDirectory, resolveLocale, resolveSupportedLocale} from '../../common/localization/translator';
import {localizedHelpUrl} from '../../common/lib/helpNavigation';
import type {HelpAssetSource, HelpDocumentSummary, HelpNavigationGroup, HelpTocEntry, HelpSearchResult, HelpPageData} from '../../types/HelpTypes';

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
    fallbackToEnglish: boolean;
}

/** Implementation-only source selection. Requests never provide a filesystem directory. */
interface HelpFileSource {
    filePath: string;
    locale: string;
}

/** Only absent valid localized figures permit complete-article English selection. */
class MissingLocalizedHelpAssetsError extends Error {}

interface HeadingInfo extends HelpTocEntry {
    renderedIndex: number;
}

/**
 * Fixed, release-controlled source for in-app help. This directory is trusted
 * application content under DEC-004; it is not configurable from requests,
 * settings, a database, or a remote source.
 */
export function getHelpDocsBasePath(requestedLocale?: string): string {
    // Every reader uses the reviewed language corpora. An omitted or unsupported
    // selection resolves to English; requests never supply a filesystem root.
    const docsRoot = path.join(__dirname, '..', '..', '..', 'docs', 'user-guide');
    return path.join(docsRoot, helpSourceDirectory(requestedLocale));
}

export function getHelpAssetsBasePath(requestedLocale?: string): string {
    return path.join(getHelpDocsBasePath(requestedLocale), 'assets');
}

function isPathInside(basePath: string, candidatePath: string): boolean {
    const relative = path.relative(path.resolve(basePath), path.resolve(candidatePath));
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

/** Resolve an existing regular file within the caller-selected reviewed directory.
 * Strict lookup distinguishes actual absence from malformed release entries;
 * source selection alone decides whether a complete English article may be used. */
function resolveRegularFile(basePath: string, relativePath: string): string | null {
    // Reject lexical traversal before probing the filesystem, then validate the
    // actual entry and resolved target inside this same reviewed corpus.
    const resolvedPath = path.resolve(basePath, relativePath);
    if (!isPathInside(basePath, resolvedPath)) {
        return null;
    }
    // A malformed release entry is not a missing translation. Refuse directories,
    // symlinks and real paths outside the reviewed corpus instead of hiding them
    // behind English fallback.
    let entry: fs.Stats;
    try {
        entry = fs.lstatSync(resolvedPath);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
    }
    if (!entry.isFile() || entry.isSymbolicLink()
        || !isPathInside(basePath, fs.realpathSync(resolvedPath))) {
        throw new Error('Trusted Help source must be a regular file inside its reviewed release corpus');
    }
    return resolvedPath;
}

/** Resolve one Markdown basename within the fixed selected corpus. Every lookup
 * rejects malformed existing release entries; source fallback is decided separately. */
function resolveDocPath(fileName: string, locale = 'en'): string | null {
    if (path.basename(fileName) !== fileName || !fileName.toLowerCase().endsWith('.md')) {
        return null;
    }
    return resolveRegularFile(getHelpDocsBasePath(locale), fileName);
}

/** Missing translations borrow only the reviewed English corpus. Existing files
 * remain authoritative even if reading or validating them fails: fallback must never
 * conceal an unsafe or broken release article. */
function resolveDocSource(fileName: string, locale = 'en'): HelpFileSource | null {
    const filePath = resolveDocPath(fileName, locale);
    if (filePath) return {filePath, locale};
    if (locale === 'en') return null;
    const englishPath = resolveDocPath(fileName, 'en');
    return englishPath ? {filePath: englishPath, locale: 'en'} : null;
}

export function resolveHelpAssetPath(assetName: string, locale = 'en'): string | null {
    return resolveHelpAssetSource(assetName, locale)?.filePath ?? null;
}

/** Keep the same closed raster-name policy at authored-reference and asset-response boundaries. */
function isHelpAssetName(assetName: string): boolean {
    return HELP_ASSET_NAME_RE.test(assetName) && path.basename(assetName) === assetName
        && HELP_ASSET_EXTENSIONS.has(path.extname(assetName).toLowerCase());
}

/** Asset responses use only the requested reviewed language. A complete English
 * article supplies its own English URLs; an asset request never borrows another corpus. */
export function resolveHelpAssetSource(assetName: string, locale = 'en'): HelpAssetSource | null {
    // Reject unsafe names before deriving a path. Existing malformed release
    // files still fail their strict lookup; only actual absence returns null.
    if (!isHelpAssetName(assetName)) return null;
    const sourceLocale = resolveLocale(locale);
    const filePath = resolveRegularFile(getHelpAssetsBasePath(sourceLocale), assetName);
    return filePath ? {filePath, locale: sourceLocale} : null;
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

/** Recognize only a permitted visual's basename under the canonical assets path.
 * Source lookup is separate so an absent valid figure is distinct from an unsafe reference. */
function managedAssetBasename(href: string): string | null {
    const {base} = splitUriSuffix(href);
    // Canonical assets remain within the selected article's fixed corpus.
    const normalized = base.replaceAll('\\', '/').replace(/^\/help\//u, '');
    if (!normalized.startsWith('assets/') || normalized.slice('assets/'.length).includes('/')) {
        return null;
    }
    const assetName = normalized.slice('assets/'.length);
    return isHelpAssetName(assetName) ? assetName : null;
}

/** An authored asset is usable only when its own article language supplies that exact raster. */
function managedAssetName(href: string, locale = 'en'): string | null {
    const assetName = managedAssetBasename(href);
    return assetName && resolveHelpAssetPath(assetName, locale) ? assetName : null;
}

/** Local figure links must use this article's canonical assets path; external links retain their URI policy. */
function isHelpAssetReference(href: string): boolean {
    const {base} = splitUriSuffix(href);
    const normalized = base.replaceAll('\\', '/');
    return !/^[a-z][a-z0-9+.-]*:/iu.test(normalized) && /(?:^|\/)assets\//u.test(normalized);
}

/** Reject another language in authored Help links instead of silently rewriting its choice. */
function assertAuthoredHelpLocale(href: string, sourceName: string, locale = 'en'): void {
    const {base, suffix} = splitUriSuffix(href);
    // External links retain their ordinary URI contract. Only Help topic/asset
    // references belong to this article's release language. Regional hints use
    // the shared matcher; an unsupported hint cannot pass through its English default.
    const helpReference = base === '/help' || base.startsWith('/help/')
        || isHelpAssetReference(href) || (!base.includes('/') && base.toLowerCase().endsWith('.md'));
    if (!helpReference || !suffix.startsWith('?')) return;
    const query = new URLSearchParams(suffix.split('#', 1)[0].slice(1));
    const sourceLocale = resolveLocale(locale);
    for (const authoredLocale of query.getAll('locale')) {
        if (resolveSupportedLocale(authoredLocale) !== sourceLocale) {
            throw new Error(`${sourceName} Help links must reference only their own language`);
        }
    }
}

/** Recognize only adjacent maintained articles, excluding query/fragment suffixes
 * from filesystem lookup. The route rewriter retains those suffixes after source selection. */
function managedHelpDocName(href: string, locale = 'en'): string | null {
    const {base} = splitUriSuffix(href);
    const normalized = base.replaceAll('\\', '/');
    if (normalized.includes('/') || !normalized.toLowerCase().endsWith('.md')) {
        return null;
    }
    return resolveDocSource(normalized, locale) ? normalized : null;
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
    // Remove only the permitted maintainer metadata before inspecting authored
    // tokens. Nested validation still examines every link/image before rendering.
    const authoredMarkdown = stripDocumentationMetadata(markdown);
    const tokens = marked.lexer(authoredMarkdown, {gfm: true});
    let missingAssetMessage: string | undefined;

    /** Validate nested links/images in the same authored source context.
     * Defer only valid absent figures
     * until all tokens have passed; a later unsafe token must prevent fallback. */
    function validateHelpToken(token: Record<string, any>): void {
        // Raw markup and unsafe/cross-language destinations are hard failures;
        // neither may be disguised as an unavailable translated illustration.
        if (token.type === 'html') {
            throw new Error(`${sourceName} contains raw HTML outside the permitted documentation metadata comment`);
        }
        if ((token.type === 'link' || token.type === 'image') && typeof token.href === 'string') {
            assertSafeHelpUri(token.href, sourceName);
            assertAuthoredHelpLocale(token.href, sourceName, locale);
        }
        if (token.type === 'link' && typeof token.href === 'string') {
            const {base} = splitUriSuffix(token.href);
            if (base.toLowerCase().endsWith('.md') && !managedHelpDocName(token.href, locale)) {
                throw new Error(`${sourceName} links may reference only maintained Markdown files in the selected help language`);
            }
        }
        if (typeof token.href === 'string') {
            const assetLink = token.type === 'link' && isHelpAssetReference(token.href);
            if ((token.type === 'image' || assetLink) && !managedAssetName(token.href, locale)) {
                const message = assetLink ? `${sourceName} asset links must reference a packaged file in the selected help language`
                    : `${sourceName} images must reference a packaged file in the selected help language's assets directory`;
                // Only a closed, safe basename with an absent own-language file
                // qualifies. Invalid paths/formats and malformed existing files reject.
                if (locale !== 'en' && managedAssetBasename(token.href)) missingAssetMessage ??= message;
                else throw new Error(message);
            }
        }
    }
    // Finish the complete traversal before reporting an otherwise valid missing
    // figure, so a later unsafe token cannot cause whole-article fallback.
    visitTokenTree(tokens, validateHelpToken);
    if (missingAssetMessage) throw new MissingLocalizedHelpAssetsError(missingAssetMessage);
}

/** Rewrite maintained article/asset links after their authored-content validation.
 * Article navigation retains the interface locale, while figures retain the selected
 * article's content locale. Fragments and supported external destinations stay intact. */
export function rewriteDocHrefToHelpRoute(href: string, locale = 'en', interfaceLocale = locale): string {
    if (!href || href.startsWith('#')) {
        return href;
    }
    const {base, suffix} = splitUriSuffix(href);
    // Authored article links belong to their selected corpus. An explicit query in the
    // source must not send a reader to another language; UI language selection is separate.
    if (base === '/help' || base.startsWith('/help/')) {
        // Figures keep the selected article language while topic navigation
        // retains the requested interface language.
        if (base.startsWith('/help/assets/')) {
            const assetName = managedAssetName(href, locale);
            const source = assetName ? resolveHelpAssetSource(assetName, locale) : null;
            return localizedHelpUrl(href, source?.locale ?? locale);
        }
        return localizedHelpUrl(href, interfaceLocale ?? locale);
    }

    // External destinations retain their reviewed URL rather than becoming local
    // article lookups. Relative figures and Markdown topics are handled separately.
    const lower = href.toLowerCase();
    if ([...SAFE_EXTERNAL_URI_SCHEMES].some(scheme => lower.startsWith(`${scheme}:`))) {
        return href;
    }

    const assetName = managedAssetName(href, locale);
    if (assetName) {
        const source = resolveHelpAssetSource(assetName, locale);
        return localizedHelpUrl(`/help/assets/${encodeURIComponent(assetName)}${suffix}`, source?.locale ?? locale);
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
    const destination = `/help/${fileName.toLowerCase()}${suffix}`;
    return localizedHelpUrl(destination, interfaceLocale ?? locale);
}

/** Route a validated local figure to its own corpus's asset endpoint, preserving
 * query/fragment suffixes and the selected content language. */
function rewriteHelpAssetHref(href: string, locale = 'en'): string {
    // Resolve only the article's raster; an absent or unsupported reference never
    // acquires another language's image through URL rewriting.
    const {suffix} = splitUriSuffix(href);
    const assetName = managedAssetName(href, locale);
    if (!assetName) return href;
    const destination = `/help/assets/${encodeURIComponent(assetName)}${suffix}`;
    const source = resolveHelpAssetSource(assetName, locale);
    return localizedHelpUrl(`${destination}`, source?.locale ?? locale);
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
    // Only the permitted article metadata can declare anchors. Articles without
    // that declaration retain the ordinary generated heading IDs.
    const metadata = DOCUMENTATION_METADATA_RE.exec(markdown)?.[0];
    const anchors = metadata && /^heading-anchors:\s*(.+)$/mu.exec(metadata)?.[1];
    if (!anchors) {
        return;
    }

    // Require one declared anchor per parsed heading before assigning any. The
    // positional mapping keeps translated task links aligned with their headings.
    const entries = anchors.trim().split(/\s*;\s*/u);
    const ids = new Set<string>();
    if (entries.length !== headings.length) {
        throw new Error(`${sourceName} heading anchors must match the article's headings`);
    }

    for (let index = 0; index < entries.length; index += 1) {
        // Reject unsafe IDs, mismatched levels and duplicates at the same point
        // as the original traversal, then apply this article's stable anchor.
        const match = /^([1-6]):([a-z0-9][a-z0-9_-]*)$/u.exec(entries[index]);
        if (!match || Number(match[1]) !== headings[index].level || ids.has(match[2])) {
            throw new Error(`${sourceName} contains invalid or mismatched heading anchors`);
        }
        ids.add(match[2]);
        headings[index].id = match[2];
    }
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

/** Validate reviewed release Markdown, then render its content, stable headings and
 * navigation projection together. Source selection/fallback belongs to the resolver;
 * content and interface languages stay separate. Input must remain trusted content. */
export function renderTrustedHelpMarkdown(markdown: string, sourceName = 'Help document', locale = 'en',
    interfaceLocale = locale): ParsedHelpDocument {
    // Validate the authored source before rewriting tokens or emitting HTML. The
    // article's metadata may supply stable translated anchors, but stays invisible.
    validateTrustedHelpMarkdown(markdown, sourceName, locale);
    const authoredMarkdown = stripDocumentationMetadata(markdown);
    const headings = extractHeadings(authoredMarkdown);
    applyAuthoredHeadingAnchors(markdown, headings, sourceName);
    // A selected article and all its figures share one content language. The
    // caller decides complete-article fallback; navigation retains the UI locale.
    const fallbackToEnglish = interfaceLocale !== 'en' && locale === 'en';

    /** Rewrite validated own-language figures and logical article URLs without mixing their responsibilities. */
    function rewriteToken(token: any): void {
        if (token?.type === 'link' && typeof token.href === 'string') {
            token.href = rewriteDocHrefToHelpRoute(token.href, locale, interfaceLocale);
        }
        if (token?.type === 'image' && typeof token.href === 'string') {
            token.href = rewriteHelpAssetHref(token.href, locale);
        }
    }

    // The token walker changes only validated navigation/figure destinations.
    // The same heading list then supplies rendered IDs, title and visible contents.
    const rendered = marked.parse(authoredMarkdown, {
        gfm: true,
        breaks: false,
        walkTokens: rewriteToken,
    }) as string;

    return {
        content: addHeadingIds(rendered, headings),
        title: headings.find(heading => heading.level === 1)?.title || createTranslator(locale).t('help.title'),
        headings: headings.map(({id, title, level}) => ({id, title, level})),
        toc: headings
            .filter(heading => heading.level === 2 || heading.level === 3)
            .map(({id, title, level}) => ({id, title, level})),
        fallbackToEnglish,
    };
}

/** Read and validate the source already chosen by the resolver. A failed read or
 * authored-content check becomes a load failure; it never requests another translation. */
function readMarkdownFile(filePath: string, locale = 'en', interfaceLocale = locale): ParsedHelpDocument | null {
    // Read and render one captured source. Preserve this caller's null/error
    // convention without retrying against a different language on failure.
    try {
        const markdown = fs.readFileSync(filePath, 'utf-8');
        return renderTrustedHelpMarkdown(markdown, path.basename(filePath), locale, interfaceLocale);
    } catch (error) {
        console.error('Error reading trusted help document:', error);
        return null;
    }
}

/**
 * Select an indivisible article/figure bundle for every localized reader. Only
 * valid absent localized figures permit replacement with complete reviewed English.
 * Link-existence lookup remains separate, preventing cycles between linked articles.
 * Existing unrelated read/validation failures stay with each caller's prior error boundary.
 */
function resolveCompleteDocSource(fileName: string, locale = 'en'): HelpFileSource | null {
    // English and absent-article selection already belongs to the basic
    // resolver. Only an existing translated article needs figure-completeness review.
    const source = resolveDocSource(fileName, locale);
    if (!source || source.locale === 'en') return source;

    try {
        // Retain ordinary malformed/unreadable-source handling. Only the specific
        // missing-figure outcome permits consideration of a complete English bundle.
        const markdown = fs.readFileSync(source.filePath, 'utf-8');
        let missingFigures = false;
        try {
            validateTrustedHelpMarkdown(markdown, path.basename(source.filePath), source.locale);
        } catch (error) {
            if (!(error instanceof MissingLocalizedHelpAssetsError)) return source;
            missingFigures = true;
        }
        // Missing figures cannot conceal mismatched anchors. Both checks belong
        // to the original translated article before any English selection occurs.
        applyAuthoredHeadingAnchors(markdown, extractHeadings(stripDocumentationMetadata(markdown)), path.basename(source.filePath));
        if (!missingFigures) return source;

        // The replacement must itself validate with its own figures and anchors;
        // never assemble a mixed-language article from individually borrowed images.
        const englishPath = resolveDocPath(fileName, 'en');
        if (!englishPath) return source;
        const english = fs.readFileSync(englishPath, 'utf-8');
        validateTrustedHelpMarkdown(english, path.basename(englishPath), 'en');
        applyAuthoredHeadingAnchors(english, extractHeadings(stripDocumentationMetadata(english)), path.basename(englishPath));
        return {filePath: englishPath, locale: 'en'};
    } catch {
        // Do not add a general navigation/search hardening change. Their existing
        // summary/reader still handles the invalid source, without hiding it by fallback.
        return source;
    }
}

function helpDocUrl(docPath: string, locale = 'en'): string {
    const destination = docPath === 'readme' ? '/help' : `/help/${docPath}`;
    return localizedHelpUrl(destination, locale);
}

/** One title/path projection serves every reviewed catalog and includes the
 * selected article language independently of the interface language. */
function summarizeHelpDoc(filePath: string, name: string, locale = 'en', contentLocale = locale): HelpDocumentSummary {
    // Titles come from the selected article, while its URL keeps the interface
    // language. Content-language metadata lets localized consumers disclose fallback.
    const markdown = fs.readFileSync(filePath, 'utf-8');
    const authoredMarkdown = stripDocumentationMetadata(markdown);
    const title = extractHeadings(authoredMarkdown).find(heading => heading.level === 1)?.title
        || name.replace(/\.md$/iu, '');
    const docPath = name.replace(/\.md$/iu, '').toLowerCase();
    return {name, title, path: docPath, url: helpDocUrl(docPath, locale),
        contentLocale};
}

/** Missing corpus directories are expected for catalog-only languages. Other filesystem
 * failures remain release errors rather than silently disguising a broken translation. */
function localizedDocNames(locale: string): string[] {
    // Adjacent locale directories/assets are not topics. Only a missing corpus
    // is an expected empty result; other directory failures remain visible.
    try {
        return fs.readdirSync(getHelpDocsBasePath(locale), {withFileTypes: true})
            .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
            .map(entry => entry.name);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
    }
}

/** Navigation and search share the same per-article source selection as direct reads.
 * English adds absent topics; a localized topic replaces its English counterpart.
 * URLs retain the requested interface language, while each title declares its source. */
function getDocsCatalog(locale: string): HelpDocumentSummary[] {
    // Union topic names before resolving each source once, preventing an English
    // fallback topic from appearing beside a second translated entry for that topic.
    const names = new Set(localizedDocNames(locale));
    if (locale !== 'en') {
        for (const name of localizedDocNames('en')) names.add(name);
    }
    // The common resolver selects the same complete article used by direct reads
    // and search, so titles and fallback disclosure cannot choose a separate source.
    const catalog: HelpDocumentSummary[] = [];
    for (const name of names) {
        const source = resolveCompleteDocSource(name, locale);
        if (!source) continue;
        catalog.push(summarizeHelpDoc(source.filePath, name, locale, source.locale));
    }
    return catalog;
}

/** Arrange the selected article catalog into the established navigation groups.
 * Localize group labels through the shared translator and include
 * ungrouped topics once in the final alphabetized group. */
function buildNavigation(catalog: HelpDocumentSummary[], locale = 'en'): {
    docsList: HelpDocumentSummary[];
    docsGroups: HelpNavigationGroup[]
} {
    // Known groups retain their authored order, but unavailable topics contribute
    // no placeholder link. Track included paths separately from displayed titles.
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

    // Newly shipped topics remain discoverable without changing the fixed groups;
    // exclude already grouped paths before sorting by the selected article title.
    const otherDocs = catalog
        .filter(doc => !included.has(doc.path))
        .sort((left, right) => left.title.localeCompare(right.title));
    if (otherDocs.length > 0) {
        docsGroups.push({title: t('help.more'), docs: otherDocs});
    }

    return {docsGroups, docsList: docsGroups.flatMap(group => group.docs)};
}

/** Build one navigation snapshot for every page variant. Borrowed navigation titles
 * require disclosure even when the current body is translated. */
function commonPageData(currentDoc: string, locale = 'en'): Pick<HelpPageData,
    'locale' | 'docsList' | 'docsGroups' | 'currentDoc' | 'fallbackToEnglish'> {
    // One navigation snapshot supplies both grouped and flat consumers. Localized
    // disclosure includes borrowed titles even when this page's own body is translated.
    const {docsList, docsGroups} = buildNavigation(getDocsCatalog(locale), locale);
    return {locale: resolveLocale(locale), docsList, docsGroups, currentDoc,
        fallbackToEnglish: locale !== 'en' && docsList.some(doc => doc.contentLocale === 'en')};
}

/** Produce searchable text without metadata, fenced code or Markdown destinations.
 * Preserve hyphens inside visible control labels while removing line decoration. */
function markdownSearchText(markdown: string): string {
    // Search the visible label spelling, including intraword hyphens such as
    // "Auto-generate". Line-level list, rule and table delimiters are Markdown
    // decoration; stripping every dash makes that exact control query miss.
    const plain = stripDocumentationMetadata(markdown)
        .replace(/```[\s\S]*?```/gu, ' ')
        .replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
        .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1');
    // Remove structural rules, table separators and list markers before generic
    // formatting marks, leaving intraword hyphens available for exact label searches.
    return plain
        .replace(/^ {0,3}(?:-[\t ]*){3,}$/gmu, ' ')
        .replace(/^ {0,3}\|?[\t ]*:?-+:?[\t ]*(?:\|[\t ]*:?-+:?[\t ]*)+\|?[\t ]*$/gmu, ' ')
        .replace(/^[\t ]*-[\t ]+/gmu, ' ')
        .replace(/[`*_>#|~]+/gu, ' ')
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

/** Search the selected reviewed catalog with bounded all-term matching. Each topic
 * uses the same complete source as its reader; rank title/heading matches and return
 * at most twenty excerpts with actual content language for localized consumers. */
export function searchHelpDocuments(rawQuery: string, requestedLocale?: string): HelpSearchResult[] {
    // Normalize interface selection and bound input before reading any articles.
    // An empty query produces no result set rather than matching every topic.
    const locale = resolveLocale(requestedLocale);
    const query = rawQuery.trim().replace(/\s+/gu, ' ').slice(0, MAX_SEARCH_QUERY_LENGTH);
    if (!query) {
        return [];
    }
    const results: Array<HelpSearchResult & { score: number }> = [];

    // A catalog already contains each logical topic once. Search its selected
    // article/figure bundle, not an additional independent English result corpus.
    for (const doc of getDocsCatalog(locale)) {
        const source = resolveCompleteDocSource(doc.name, locale);
        if (!source) {
            continue;
        }
        // Case folding follows the actual article language. Every term must occur;
        // the first text match anchors the excerpt even when ranking favors a heading.
        const terms = query.toLocaleLowerCase(source.locale).split(' ').filter(Boolean);
        const markdown = fs.readFileSync(source.filePath, 'utf-8');
        const searchText = markdownSearchText(markdown);
        const lowerText = searchText.toLocaleLowerCase(source.locale);
        if (!terms.every(term => lowerText.includes(term))) {
            continue;
        }

        const lowerTitle = doc.title.toLocaleLowerCase(source.locale);
        const matchIndexes = terms.map(term => lowerText.indexOf(term)).filter(index => index >= 0);
        const firstMatch = matchIndexes.length > 0 ? Math.min(...matchIndexes) : 0;
        // Search uses the same validated stable headings as the displayed article.
        const headings = readMarkdownFile(source.filePath, source.locale, locale)?.headings;
        if (!headings) continue;
        // Favor title matches, then a useful section link, and disclose the
        // source language independently of the result navigation language.
        const matchingHeading = headings.find(heading => terms.some(term => heading.title.toLocaleLowerCase(source.locale).includes(term)));
        const score = terms.reduce((total, term) => total + (lowerTitle.includes(term) ? 20 : 1), 0)
            + (matchingHeading ? 8 : 0);
        results.push({
            title: doc.title,
            url: matchingHeading ? `${doc.url}#${matchingHeading.id}` : doc.url,
            sectionTitle: matchingHeading?.title,
            excerpt: createSearchExcerpt(searchText, firstMatch),
            contentLocale: source.locale,
            score,
        });
    }

    // Keep internal ranking out of the wire/view result and bound the final list
    // after deterministic score/title ordering rather than truncating topic discovery.
    return results
        .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))
        .slice(0, 20)
        .map(({score: _score, ...result}) => result);
}

/** Render the selected Help home with its actual content language and requested UI
 * language. The resolver alone decides missing-translation fallback before parsing. */
export function fetchHelpIndex(requestedLocale?: string): HelpPageData {
    // Navigation and body resolve through the same corpus policy; retain separate
    // interface/content languages when the complete English article is selected.
    const locale = resolveLocale(requestedLocale);
    const common = commonPageData('readme', locale);
    const source = resolveCompleteDocSource('README.md', locale);
    const parsed = source ? readMarkdownFile(source.filePath, source.locale, locale) : null;
    // A broken existing article must surface a load error rather than look like
    // a missing translation; genuine absence retains the existing empty home.
    if (source && !parsed) {
        throw new ExpectedError(createTranslator(locale).t('help.loadError'), 'error', 500, {}, {messageKey: 'help.loadError'});
    }
    return {
        ...common,
        title: parsed?.title ?? createTranslator(locale).t('help.title'),
        content: parsed?.content ?? '',
        toc: parsed?.toc ?? [],
        contentLocale: source?.locale ?? locale,
        fallbackToEnglish: Boolean(common.fallbackToEnglish || parsed?.fallbackToEnglish),
    };
}

/** Assemble the existing search page around the shared catalog/search owners.
 * The query and page labels use the interface locale; individual results disclose
 * their own selected source language without rendering an article body. */
export function fetchHelpSearch(rawQuery: string, requestedLocale?: string): HelpPageData {
    // Use the same bounded query for redisplay and search. Shared navigation
    // continues disclosing fallback independently of any matching result.
    const locale = resolveLocale(requestedLocale);
    const searchQuery = rawQuery.trim().replace(/\s+/gu, ' ').slice(0, MAX_SEARCH_QUERY_LENGTH);
    return {
        ...commonPageData('search', locale),
        title: createTranslator(locale).t('help.searchTitle'),
        content: '',
        toc: [],
        searchQuery,
        searchResults: searchHelpDocuments(searchQuery, locale),
        contentLocale: locale,
    };
}

/** Load a routed topic without exposing filesystem paths. Missing topics produce
 * 404; an existing source that cannot be rendered produces 500 instead of English fallback. */
export function fetchHelpDoc(docName: string, requestedLocale?: string): HelpPageData {
    const locale = resolveLocale(requestedLocale);
    const {t} = createTranslator(locale);
    // Reject route input before deriving any filename or reading either reviewed corpus.
    if (!HELP_DOC_SLUG_RE.test(docName)) {
        throw new ExpectedError(t('help.notFound'), 'error', 404, {}, {messageKey: 'help.notFound'});
    }

    const fileName = `${docName.toUpperCase()}.md`;
    const source = resolveCompleteDocSource(fileName, locale);
    if (!source) {
        throw new ExpectedError(t('help.notFound'), 'error', 404, {}, {messageKey: 'help.notFound'});
    }

    const parsed = readMarkdownFile(source.filePath, source.locale, locale);
    if (!parsed) {
        throw new ExpectedError(t('help.loadError'), 'error', 500, {}, {messageKey: 'help.loadError'});
    }

    // Article and navigation fallback share one visible disclosure. Language
    // metadata identifies the rendered body, while common page state retains the UI locale.
    const common = commonPageData(docName.toLowerCase(), locale);
    return {
        ...common,
        title: parsed.title,
        content: parsed.content,
        toc: parsed.toc,
        contentLocale: source.locale,
        fallbackToEnglish: Boolean(common.fallbackToEnglish || parsed.fallbackToEnglish),
    };
}
