import type {Request} from 'express';
import {resolveLocale, resolvePreferredLocale} from '../../../common/localization/translator';

/** Resolve response language through the shared catalog policy: explicit header,
 * then cookie, then quality-ordered accepted languages. Negotiation never changes
 * the captured actor or grants authority to any localized presentation. */
export function requestLocale(req: Request): string {
    const explicitLocale = req.get('X-Surveyor-Locale') ?? req.cookies?.surveyor_locale;
    if (explicitLocale !== undefined && explicitLocale !== null) return resolveLocale(explicitLocale);

    // Express orders accepted ranges by quality. Preserve that order and skip unsupported/invalid
    // hints before choosing the application fallback; explicit header/cookie choices stay authoritative.
    const languages = req.acceptsLanguages();
    return resolvePreferredLocale(languages || []);
}
