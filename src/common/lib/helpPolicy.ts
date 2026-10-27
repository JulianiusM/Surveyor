import type {HelpUriIssue} from '../../types/HelpTypes';

// This erasable, dependency-free source is shared by compiled runtime code and
// the Node-only advisory reader. It never imports the app, a parser or filesystem.
const SAFE_SCHEMES = new Set(['http', 'https', 'mailto', 'tel']);
const RASTER_EXTENSIONS = new Set(['.gif', '.jpeg', '.jpg', '.png', '.webp']);

/** Classify the DEC-004 raster suffix; callers retain their filename/path policy. */
export function isHelpRasterExtension(extension: string): boolean {
    return RASTER_EXTENSIONS.has(extension.toLowerCase());
}

/** Recognize the same explicitly allowed external prefixes when rewriting links. */
export function hasSafeHelpScheme(href: string): boolean {
    const lower = href.toLowerCase();
    for (const scheme of SAFE_SCHEMES) if (lower.startsWith(`${scheme}:`)) return true;
    return false;
}

/** Decode supported character references before evaluating a destination.
 * Invalid numeric codepoints retain their existing RangeError behavior. */
function decodeReferences(value: string): string {
    // Encodings must not conceal a forbidden scheme or separator.
    return value
        .replace(/&#x([0-9a-f]+);?/giu, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
        .replace(/&#([0-9]+);?/gu, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
        .replace(/&colon;/giu, ':')
        .replace(/&tab;/giu, '\t')
        .replace(/&newline;/giu, '\n')
        .replace(/&amp;/giu, '&');
}

/** Evaluate only the shared trusted-Help URI policy, without throwing UI errors.
 * Relative/empty destinations remain eligible for each caller's own path checks. */
export function classifyHelpUri(href: string): HelpUriIssue | null {
    const decoded = decodeReferences(href.trim());
    if (/[\u0000-\u001f\u007f]/u.test(decoded)) return {kind: 'control'};
    // Whitespace cannot hide protocol-relative paths or an unsafe scheme.
    const probe = decoded.replace(/[\s\u00a0]+/gu, '');
    if (probe.startsWith('//') || probe.startsWith('\\\\')) return {kind: 'protocol-relative'};
    const scheme = /^([a-z][a-z0-9+.-]*):/iu.exec(probe)?.[1];
    if (scheme && !SAFE_SCHEMES.has(scheme.toLowerCase())) return {kind: 'scheme', scheme};
    return null;
}
