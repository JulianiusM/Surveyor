/*
 * Copyright 2026 Julian Malovanij
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import type {Address} from 'nodemailer/lib/mailer';

/** Shared email contracts keep caller-owned content separate from SMTP and renderer implementation details. */
export interface EmailAction {
    label: string;
    url: string;
}

export interface EmailDetail {
    label: string;
    value: string;
}

/** Renderer-neutral arithmetic supplied by the owning feature, with already localized labels and values. */
export interface EmailFormula {
    terms: {label: string; value: string; operator?: '+' | '−' | '×' | '÷'}[];
    result: {label: string; value: string};
    note?: string;
}

/** Ordinary sections retain their existing layout; all optional richer content comes from the owning feature. */
export interface EmailSection {
    title?: string;
    paragraphs?: string[];
    items?: string[];
    details?: EmailDetail[];
    formula?: EmailFormula;
    actions?: EmailAction[];
}

/** One optional native disclosure groups related sections without hiding content through CSS or scripts. */
export interface EmailSectionGroup {
    title: string;
    sections: EmailSection[];
    disclosure?: boolean;
}

/** Existing callers keep their action after sections; individual messages may opt into a leading action. */
export interface StructuredEmailContent {
    heading: string;
    preheader?: string;
    eyebrow?: string;
    greeting?: string;
    paragraphs?: string[];
    details?: EmailDetail[];
    sections?: EmailSection[];
    sectionGroups?: EmailSectionGroup[];
    action?: EmailAction;
    actionPosition?: 'beforeSections' | 'afterSections';
    notice?: string;
    closing?: string;
}

export type EmailContent = string | StructuredEmailContent;
export type EmailRecipient = Address;

export interface RenderedEmail {
    text: string;
    html: string;
}
