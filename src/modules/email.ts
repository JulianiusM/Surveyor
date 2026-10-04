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

import nodemailer, {Transporter} from 'nodemailer';
import {MailOptions} from 'nodemailer/lib/smtp-pool';
import type {GuestLinkData} from '../types/UserTypes';
import type {EmailAction, EmailContent, EmailDetail, EmailFormula, EmailRecipient, EmailSection,
    EmailSectionGroup, RenderedEmail, StructuredEmailContent} from '../types/EmailTypes';
import {Guest} from './database/entities/user/Guest';
import {Profile} from './database/entities/user/Profile';
import {User} from './database/entities/user/User';
import settings from './settings';

let transporter: Transporter | undefined;

function init(): void {
    const transportOptions = {
        ...(settings.value.smtpPool ? {pool: true as const} : {}),
        host: settings.value.smtpHost,
        port: settings.value.smtpPort,
        secure: settings.value.smtpSecure,
        auth: {
            user: settings.value.smtpUser,
            pass: settings.value.smtpPassword,
        },
    };
    transporter ??= nodemailer.createTransport(transportOptions);
}

function escapeHtml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function renderMultiline(value: string): string {
    return escapeHtml(value).replace(/\r?\n/g, '<br>');
}

function safeHttpUrl(value: string): string | null {
    try {
        const parsed = new URL(value);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : null;
    } catch {
        return null;
    }
}

function normalizedAccentColor(): string {
    return /^#[0-9a-f]{6}$/i.test(settings.value.emailAccentColor)
        ? settings.value.emailAccentColor
        : '#6d5dfc';
}

function contrastingTextColor(hexColor: string): string {
    const red = Number.parseInt(hexColor.slice(1, 3), 16);
    const green = Number.parseInt(hexColor.slice(3, 5), 16);
    const blue = Number.parseInt(hexColor.slice(5, 7), 16);
    const perceivedBrightness = (red * 299 + green * 587 + blue * 114) / 1000;
    return perceivedBrightness > 160 ? '#0f172a' : '#ffffff';
}

export function resolveEmailRecipientName(...names: (string | null | undefined)[]): string {
    for (const candidate of names) {
        const normalized = candidate?.replace(/\s+/g, ' ').trim();
        if (normalized) return normalized;
    }
    return '';
}

function normalizeRecipient(recipient: EmailRecipient): EmailRecipient {
    const name = resolveEmailRecipientName(recipient.name);
    const address = recipient.address?.trim();
    if (!name || !address || /[\r\n]/.test(recipient.address)) {
        throw new Error('Email recipients require a name and an address without line breaks');
    }
    return {name, address};
}

function normalizeContent(subject: string, rawContent: EmailContent, recipient: EmailRecipient): StructuredEmailContent {
    const content = typeof rawContent === 'string'
        ? {heading: subject, paragraphs: rawContent.split(/\r?\n\s*\r?\n/).filter(Boolean)}
        : rawContent;
    const paragraphs = [...(content.paragraphs ?? [])];
    // Older string notifications may already contain a standalone salutation.
    if (paragraphs[0]) {
        paragraphs[0] = paragraphs[0].replace(/^(?:Hello|Hi|Dear)(?:[ \t]+[^\r\n,!]+)?[,!]\s*(?:\r?\n|$)/i, '').trimStart();
        if (!paragraphs[0]) paragraphs.shift();
    }
    return {...content, paragraphs, greeting: `Hello ${recipient.name},`};
}

function renderAction(action: EmailAction, accentColor: string, accentTextColor: string): string {
    const safeUrl = safeHttpUrl(action.url);
    if (!safeUrl) return '';
    const label = escapeHtml(action.label);
    const href = escapeHtml(safeUrl);
    return `
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin: 26px 0 8px;">
            <tr>
                <td style="border-radius: 10px; background: ${accentColor};">
                    <a href="${href}" style="display: inline-block; padding: 13px 22px; color: ${accentTextColor}; font-size: 15px; font-weight: 700; line-height: 20px; text-decoration: none; border-radius: 10px;">${label}</a>
                </td>
            </tr>
        </table>
        <p style="margin: 12px 0 0; color: #64748b; font-size: 12px; line-height: 18px; overflow-wrap: anywhere;">If the button does not work, copy this address into your browser:<br><a href="${href}" style="color: ${accentColor}; text-decoration: underline;">${href}</a></p>`;
}

function renderDetails(details: EmailDetail[]): string {
    if (!details.length) return '';
    const rows = details.map((detail) => `
        <tr>
            <td style="padding: 9px 12px; color: #64748b; font-size: 13px; line-height: 19px; vertical-align: top; border-bottom: 1px solid #e2e8f0; width: 34%;">${escapeHtml(detail.label)}</td>
            <td style="padding: 9px 12px; color: #0f172a; font-size: 13px; font-weight: 600; line-height: 19px; vertical-align: top; border-bottom: 1px solid #e2e8f0; overflow-wrap: anywhere;">${renderMultiline(detail.value)}</td>
        </tr>`).join('');
    return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin: 22px 0; border: 1px solid #e2e8f0; border-radius: 10px; border-collapse: separate; overflow: hidden;">${rows}</table>`;
}

/** Present named operands and a distinct result without fixing the number of columns on narrow email screens. */
function renderFormula(formula: EmailFormula): string {
    const parts: string[] = [];
    // Terms wrap as small blocks; escaping applies equally to saved names, labels, and numerical values.
    for (const term of formula.terms) {
        if (term.operator || parts.length) parts.push(`<span style="display: inline-block; padding: 6px; vertical-align: middle; font-size: 18px;">${escapeHtml(term.operator || '+')}</span>`);
        const value = term.value.startsWith('-') ? `(${term.value})` : term.value;
        parts.push(`<span style="display: inline-block; max-width: 100%; padding: 8px 10px; vertical-align: middle; overflow-wrap: anywhere;"><strong style="display: block; color: #0f172a; font-size: 15px;">${escapeHtml(value)}</strong><span style="display: block; color: #64748b; font-size: 12px; line-height: 18px;">${escapeHtml(term.label)}</span></span>`);
    }
    // A separated result remains recognizable when the preceding operands wrap onto several lines.
    if (parts.length) parts.push('<span style="display: inline-block; padding: 6px; vertical-align: middle; font-size: 18px;">=</span>');
    parts.push(`<span style="display: inline-block; max-width: 100%; padding: 8px 10px; vertical-align: middle; border: 1px solid #cbd5e1; border-radius: 6px; overflow-wrap: anywhere;"><strong style="display: block; color: #0f172a; font-size: 16px;">${escapeHtml(formula.result.value)}</strong><span style="display: block; color: #475569; font-size: 12px; line-height: 18px;">${escapeHtml(formula.result.label)}</span></span>`);
    const note = formula.note ? `<p style="margin: 8px 0 0; color: #64748b; font-size: 12px; line-height: 18px;">${renderMultiline(formula.note)}</p>` : '';
    return `<div style="margin: 10px 0; line-height: 22px;">${parts.join('')}</div>${note}`;
}

/** Keep the text alternative equivalent to the labeled HTML formula, including subtraction of signed credits. */
function formulaText(formula: EmailFormula): string {
    const parts: string[] = [];
    // Parentheses keep a negative amount distinguishable from the operator that precedes it.
    for (const term of formula.terms) {
        if (term.operator || parts.length) parts.push(term.operator || '+');
        const value = term.value.startsWith('-') ? `(${term.value})` : term.value;
        parts.push(`${term.label}: ${value}`);
    }
    // A zero-term formula still describes the saved result rather than inventing unavailable inputs.
    if (parts.length) parts.push('=');
    parts.push(`${formula.result.label}: ${formula.result.value}`);
    return parts.join(' ');
}

/** Render optional feature-supplied metrics and arithmetic within the existing section card layout. */
function renderSections(sections: EmailSection[], accentColor: string, accentTextColor: string): string {
    const rendered: string[] = [];
    for (const section of sections) {
        // Keep prose, saved facts, and arithmetic distinct while sharing the same escaped section boundary.
        const title = section.title
            ? `<h2 style="margin: 0 0 10px; color: #0f172a; font-size: 16px; line-height: 23px;">${escapeHtml(section.title)}</h2>`
            : '';
        const paragraphs: string[] = [];
        for (const paragraph of section.paragraphs || []) paragraphs.push(`<p style="margin: 0 0 10px; color: #475569; font-size: 14px; line-height: 22px;">${renderMultiline(paragraph)}</p>`);
        const listItems: string[] = [];
        for (const item of section.items || []) listItems.push(`<li style="margin: 5px 0;">${renderMultiline(item)}</li>`);
        const items = listItems.length
            ? `<ul style="margin: 8px 0 0; padding-left: 20px; color: #475569; font-size: 14px; line-height: 22px;">${listItems.join('')}</ul>`
            : '';
        // Feature arithmetic is optional; the original paragraph/list/action sections retain their existing markup.
        const details = renderDetails(section.details || []);
        const formula = section.formula ? renderFormula(section.formula) : '';
        const actions: string[] = [];
        for (const action of section.actions || []) actions.push(renderAction(action, accentColor, accentTextColor));
        rendered.push(`<div style="margin: 18px 0 0; padding: 16px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px;">${title}${paragraphs.join('')}${details}${formula}${items}${actions.join('')}</div>`);
    }
    return rendered.join('');
}

/** Group optional detail sections with native disclosure semantics and an always-present readable fallback. */
function renderSectionGroups(groups: EmailSectionGroup[], accentColor: string, accentTextColor: string): string {
    const rendered: string[] = [];
    // Reuse ordinary section rendering so grouped formulas, names, notes, and links share the same escaping boundary.
    for (const group of groups) {
        const title = escapeHtml(group.title);
        const sections = renderSections(group.sections, accentColor, accentTextColor);
        if (group.disclosure) {
            // Supporting clients provide click/keyboard expansion. No author CSS or hidden attribute conceals
            // the children, so clients that ignore or unwrap these elements can still display the full contents.
            // Email sanitizers vary; the plain-text alternative always preserves the same complete calculation.
            rendered.push(`<details style="margin: 18px 0 0; padding: 16px; border: 1px solid #e2e8f0; border-radius: 10px;"><summary style="color: #0f172a; font-size: 16px; font-weight: 700; line-height: 23px; cursor: pointer;">${title}</summary>${sections}</details>`);
        } else {
            // A non-disclosure group is an ordinary visible heading followed by the same section cards.
            rendered.push(`<div style="margin: 18px 0 0;"><h2 style="margin: 0; color: #0f172a; font-size: 16px; line-height: 23px;">${title}</h2>${sections}</div>`);
        }
    }
    return rendered.join('');
}

function renderFooterLink(label: string, value: string, accentColor: string): string {
    const url = safeHttpUrl(value);
    if (!url) return '';
    return `<a href="${escapeHtml(url)}" style="color: ${accentColor}; text-decoration: none;">${escapeHtml(label)}</a>`;
}

/** Append readable sections independently of whether HTML wraps them in a disclosure. */
function appendTextSections(lines: string[], sections: EmailSection[]): void {
    // Preserve the existing prose, metric, equation, note, and action order in every ordinary or grouped section.
    for (const section of sections) {
        if (section.title) lines.push(section.title);
        for (const paragraph of section.paragraphs ?? []) lines.push(paragraph);
        for (const detail of section.details ?? []) lines.push(`${detail.label}: ${detail.value}`);
        if (section.formula) {
            lines.push(formulaText(section.formula));
            if (section.formula.note) lines.push(section.formula.note);
        }
        for (const item of section.items ?? []) lines.push(`- ${item}`);
        // Grouping must not relax the established action-link protocol check in the text alternative.
        for (const action of section.actions ?? []) {
            if (safeHttpUrl(action.url)) lines.push(`${action.label}: ${action.url}`);
        }
        lines.push('');
    }
}

/** Append a primary action at its selected position using the same URL boundary as the HTML renderer. */
function appendTextAction(lines: string[], action?: EmailAction): void {
    if (action && safeHttpUrl(action.url)) lines.push(`${action.label}: ${action.url}`, '');
}

/** Render the same escaped HTML email content as readable text for clients without HTML support. */
function renderText(content: StructuredEmailContent): string {
    const lines: string[] = [];
    // Lead with the recipient, heading, and shared message facts in the same order as the HTML body.
    if (content.greeting) lines.push(content.greeting, '');
    lines.push(content.heading, '');
    for (const paragraph of content.paragraphs ?? []) lines.push(paragraph, '');
    for (const detail of content.details ?? []) lines.push(`${detail.label}: ${detail.value}`);
    if (content.details?.length) lines.push('');
    // A message can put its main action before secondary material; callers without the option retain their order.
    if (content.actionPosition === 'beforeSections') appendTextAction(lines, content.action);
    appendTextSections(lines, content.sections ?? []);
    // Plain text never collapses a disclosure. Include its group heading and every nested saved fact and equation.
    for (const group of content.sectionGroups ?? []) {
        lines.push(group.title, '');
        appendTextSections(lines, group.sections);
    }
    if (content.actionPosition !== 'beforeSections') appendTextAction(lines, content.action);
    // Notice and footer behavior remain shared infrastructure, after the complete message body.
    if (content.notice) lines.push(`Note: ${content.notice}`, '');
    lines.push(content.closing ?? `Kind regards,\nThe ${settings.value.appName} team`);

    const footerLinks = [
        safeHttpUrl(settings.value.rootUrl) ? `Website: ${settings.value.rootUrl}` : '',
        safeHttpUrl(settings.value.imprintUrl) ? `Imprint: ${settings.value.imprintUrl}` : '',
        safeHttpUrl(settings.value.privacyPolicyUrl) ? `Privacy: ${settings.value.privacyPolicyUrl}` : '',
    ].filter(Boolean);
    if (footerLinks.length) lines.push('', footerLinks.join(' | '));
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Render both representations from one normalized message while preserving optional feature-specific ordering. */
export function renderEmail(subject: string, rawContent: EmailContent, recipient: EmailRecipient): RenderedEmail {
    // Normalize the recipient and legacy greeting before any visible text or metadata is constructed.
    const content = normalizeContent(subject, rawContent, normalizeRecipient(recipient));
    const appName = escapeHtml(settings.value.appName);
    const appInitial = escapeHtml(settings.value.appName.trim().charAt(0).toUpperCase() || 'S');
    const accentColor = normalizedAccentColor();
    const accentTextColor = contrastingTextColor(accentColor);
    const preheader = escapeHtml(content.preheader ?? content.paragraphs?.[0] ?? subject);
    const websiteLink = renderFooterLink('Website', settings.value.rootUrl, accentColor);
    const imprintLink = renderFooterLink('Imprint', settings.value.imprintUrl, accentColor);
    const privacyLink = renderFooterLink('Privacy', settings.value.privacyPolicyUrl, accentColor);
    const footerLinks = [websiteLink, imprintLink, privacyLink].filter(Boolean).join('&nbsp;&nbsp;·&nbsp;&nbsp;');
    const eyebrow = content.eyebrow
        ? `<p style="margin: 0 0 8px; color: ${accentColor}; font-size: 12px; font-weight: 800; letter-spacing: .08em; line-height: 18px; text-transform: uppercase;">${escapeHtml(content.eyebrow)}</p>`
        : '';
    const greeting = content.greeting
        ? `<p style="margin: 0 0 18px; color: #0f172a; font-size: 16px; font-weight: 650; line-height: 24px;">${renderMultiline(content.greeting)}</p>`
        : '';
    const paragraphs = (content.paragraphs ?? [])
        .map((paragraph) => `<p style="margin: 0 0 16px; color: #475569; font-size: 15px; line-height: 24px;">${renderMultiline(paragraph)}</p>`)
        .join('');
    const action = content.action ? renderAction(content.action, accentColor, accentTextColor) : '';
    // An early action is opt-in. Existing messages still place their primary button after all ordinary sections.
    const earlyAction = content.actionPosition === 'beforeSections' ? action : '';
    const finalAction = content.actionPosition === 'beforeSections' ? '' : action;
    const sections = renderSections(content.sections ?? [], accentColor, accentTextColor);
    const sectionGroups = renderSectionGroups(content.sectionGroups ?? [], accentColor, accentTextColor);
    const notice = content.notice
        ? `<div style="margin: 22px 0 0; padding: 13px 15px; background: #f8fafc; border-left: 4px solid ${accentColor}; border-radius: 6px;"><p style="margin: 0; color: #475569; font-size: 13px; line-height: 20px;"><strong style="color: #0f172a;">Please note:</strong> ${renderMultiline(content.notice)}</p></div>`
        : '';
    const closing = renderMultiline(content.closing ?? `Kind regards,\nThe ${settings.value.appName} team`);

    // Keep the branded shell and its responsive rules unchanged; disclosure behavior belongs to native HTML only.
    const html = `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light">
    <title>${escapeHtml(subject)}</title>
    <style>
        @media only screen and (max-width: 620px) {
            .email-shell { width: 100% !important; }
            .email-padding { padding: 24px 18px !important; }
            .email-header { padding: 22px 18px !important; }
        }
    </style>
</head>
<body style="margin: 0; padding: 0; background: #f1f5f9; color: #0f172a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; -webkit-text-size-adjust: 100%;">
    <div style="display: none; max-height: 0; overflow: hidden; opacity: 0; color: transparent;">${preheader}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width: 100%; background: #f1f5f9;">
        <tr>
            <td align="center" style="padding: 28px 12px;">
                <table class="email-shell" role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width: 600px; max-width: 600px; background: #ffffff; border-radius: 16px; box-shadow: 0 8px 28px rgba(15, 23, 42, .08); overflow: hidden;">
                    <tr>
                        <td class="email-header" style="padding: 25px 34px; background: #111827; border-top: 4px solid ${accentColor};">
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
                                <td style="width: 38px; height: 38px; color: ${accentTextColor}; background: ${accentColor}; border-radius: 10px; font-size: 20px; font-weight: 800; line-height: 38px; text-align: center;">${appInitial}</td>
                                <td style="padding-left: 12px; color: #ffffff; font-size: 19px; font-weight: 750; letter-spacing: .01em;">${appName}</td>
                            </tr></table>
                        </td>
                    </tr>
                    <tr>
                        <td class="email-padding" style="padding: 34px;">
                            ${greeting}
                            ${eyebrow}
                            <h1 style="margin: 0 0 22px; color: #0f172a; font-size: 27px; line-height: 34px; letter-spacing: -.02em;">${escapeHtml(content.heading)}</h1>
                            ${paragraphs}${renderDetails(content.details ?? [])}${earlyAction}${sections}${sectionGroups}${finalAction}${notice}
                            <p style="margin: 26px 0 0; color: #475569; font-size: 14px; line-height: 22px;">${closing}</p>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 20px 34px 24px; background: #f8fafc; border-top: 1px solid #e2e8f0; color: #64748b; font-size: 12px; line-height: 19px; text-align: center;">
                            <p style="margin: 0 0 8px;">This is an automated service email from ${appName}.</p>
                            ${footerLinks ? `<p style="margin: 0;">${footerLinks}</p>` : ''}
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;

    return {text: renderText(content), html};
}

function createSender(): MailOptions['from'] {
    const configuredSender = settings.value.smtpEmail.trim();
    if (configuredSender.includes('<') && configuredSender.endsWith('>')) {
        return configuredSender;
    }
    return {
        name: settings.value.appName,
        address: configuredSender,
    };
}

export function createMailOptions(to: EmailRecipient, subject: string, content: EmailContent): MailOptions {
    const recipient = normalizeRecipient(to);
    const rendered = renderEmail(subject, content, recipient);
    return {
        from: createSender(),
        to: recipient,
        subject,
        text: rendered.text,
        html: rendered.html,
    };
}

export async function sendEmail(to: EmailRecipient, subject: string, content: EmailContent): Promise<void> {
    const mailOptions = createMailOptions(to, subject, content);
    init();

    try {
        await transporter!.sendMail(mailOptions);
    } catch (error) {
        console.error('Error sending email:', error);
    }
}

async function sendActivationEmail(userEmail: EmailRecipient, activationLink: string): Promise<void> {
    await sendEmail(userEmail, 'Activate your account', {
        eyebrow: 'Account setup',
        heading: `Welcome to ${settings.value.appName}`,
        preheader: 'Activate your account to finish signing up.',
        paragraphs: ['Thanks for signing up. Confirm your email address to activate your account and get started.'],
        action: {label: 'Activate account', url: activationLink},
        notice: 'This activation link expires in 1 hour. If you did not create this account, you can ignore this email.',
    });
}

async function sendPasswordResetEmail(userEmail: EmailRecipient, resetLink: string): Promise<void> {
    await sendEmail(userEmail, 'Reset your password', {
        eyebrow: 'Account security',
        heading: 'Choose a new password',
        preheader: 'Use this secure link to reset your password.',
        paragraphs: ['We received a request to reset the password for your account. Use the button below to choose a new one.'],
        action: {label: 'Reset password', url: resetLink},
        notice: 'This link expires in 1 hour. If you did not request a password reset, no action is required.',
    });
}

async function sendLinkEmail(userEmail: EmailRecipient, surveyLink: string): Promise<void> {
    await sendEmail(userEmail, 'Your personal editing link', {
        eyebrow: 'Personal access',
        heading: 'Your editing link is ready',
        preheader: 'Keep this private link to return to your answers.',
        paragraphs: ['Use this personal link whenever you need to review or update your answers.'],
        action: {label: 'Open my answers', url: surveyLink},
        notice: 'This link provides access to your information. Keep it private and do not forward it to anyone else.',
    });
}

function formatGuestCreatedAt(value: Date): string {
    return new Intl.DateTimeFormat('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'UTC',
        timeZoneName: 'short',
    }).format(value);
}

async function sendGuestRecoveryEmail(email: EmailRecipient, guestLinkData: GuestLinkData[]): Promise<void> {
    await sendEmail(email, 'Your guest accounts', {
        eyebrow: 'Account recovery',
        heading: guestLinkData.length === 1 ? 'Your guest account' : 'Your guest accounts',
        preheader: 'Here are the guest accounts connected to your email address.',
        paragraphs: ['You requested access to the guest accounts connected to this email address. Choose an account below to continue.'],
        sections: guestLinkData.map((guest) => ({
            title: guest.username,
            paragraphs: [`Created ${formatGuestCreatedAt(guest.track.createdAt)}`],
            actions: [{label: `Open ${guest.username}`, url: guest.link}],
        })),
        notice: 'Each link provides direct access to its guest account. Keep these links private and do not forward this email.',
    });
}

async function sendMigrationEmail(email: EmailRecipient, profile: Profile, newOwner: User): Promise<void> {
    await sendEmail(email, 'Your profile was migrated', {
        eyebrow: 'Profile update',
        heading: 'Your profile has a new owner',
        preheader: `${profile.name} was migrated to ${newOwner.name}.`,
        paragraphs: ['Your individual migration token was used to move this profile to another account.'],
        details: [
            {label: 'Profile', value: profile.name},
            {label: 'New owner', value: newOwner.name},
            {label: 'Username', value: newOwner.username},
            {label: 'Email', value: newOwner.email},
        ],
        notice: 'If this was your final profile, the previous account was closed automatically as part of the migration.',
        closing: `Thank you for using ${settings.value.appName}.\nThe ${settings.value.appName} team`,
    });
}

async function sendDeletionEmail(email: EmailRecipient, account: User | Guest): Promise<void> {
    await sendEmail(email, 'Your account has been closed', {
        eyebrow: 'Account update',
        heading: 'Your account has been closed',
        preheader: `The account ${account.username} was closed as requested.`,
        paragraphs: ['We have completed your request to close your account.'],
        details: [{label: 'Account', value: account.username}],
        notice: 'Associated profiles have been deactivated. Existing event and survey participation remains visible where it is needed for shared records.',
        closing: `Thank you for using ${settings.value.appName}.\nThe ${settings.value.appName} team`,
    });
}

export default {
    sendEmail,
    sendActivationEmail,
    sendPasswordResetEmail,
    sendLinkEmail,
    sendGuestRecoveryEmail,
    sendMigrationEmail,
    sendDeletionEmail,
};
