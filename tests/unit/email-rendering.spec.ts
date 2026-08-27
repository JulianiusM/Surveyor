import {describe, expect, it} from 'vitest';
import {createMailOptions, renderEmail} from '../../src/modules/email';
import settings from '../../src/modules/settings';
import {createStructuredEmailContent} from '../factories/emailFactory';

describe('transactional email rendering', () => {
    it('renders a responsive branded email and an equivalent plain-text fallback', () => {
        const rendered = renderEmail('Event details', createStructuredEmailContent());

        // Canary: recipients get usable content in modern HTML clients and text-only clients.
        expect(rendered.html).toContain('<!doctype html>');
        expect(rendered.html).toContain('@media only screen and (max-width: 620px)');
        expect(rendered.html).toContain('role="presentation"');
        expect(rendered.html).toContain('Your event details are ready');
        expect(rendered.html).toContain('href="https://surveyor.example/event/event-1"');
        expect(rendered.html).toContain('View event');
        expect(rendered.text).toContain('Event: Summer retreat');
        expect(rendered.text).toContain('- Review your details');
        expect(rendered.text).toContain('View event: https://surveyor.example/event/event-1');
    });

    it('escapes untrusted content and never turns unsafe protocols into HTML links', () => {
        const rendered = renderEmail('Security update', createStructuredEmailContent({
            heading: '<img src=x onerror=alert(1)>',
            paragraphs: ['A value contained <script>alert(1)</script>.'],
            details: [{label: 'Submitted by', value: 'Casey & Morgan'}],
            action: {label: 'Open <account>', url: 'javascript:alert(1)'},
        }));

        // Canary: participant and organizer text cannot inject markup or clickable script URLs.
        expect(rendered.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
        expect(rendered.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
        expect(rendered.html).toContain('Casey &amp; Morgan');
        expect(rendered.html).not.toContain('<script>');
        expect(rendered.html).not.toContain('href="javascript:');
        expect(rendered.text).not.toContain('javascript:alert(1)');
    });

    it('wraps legacy text notifications in the same polished email shell', () => {
        const rendered = renderEmail('Simple notification', 'The first paragraph.\n\nThe second paragraph.');

        // Canary: any future plain-string call still receives consistent branding and a text alternative.
        expect(rendered.html).toContain('<h1');
        expect(rendered.html).toContain('Simple notification');
        expect(rendered.html).toContain('The first paragraph.');
        expect(rendered.html).toContain('This is an automated service email');
        expect(rendered.text).toContain('The first paragraph.\n\nThe second paragraph.');
    });

    it('builds a multipart delivery payload with a branded sender', () => {
        const mailOptions = createMailOptions(
            'taylor@example.com',
            'Event details',
            createStructuredEmailContent(),
        );

        // Canary: the SMTP boundary receives both representations instead of silently dropping polished HTML.
        expect(mailOptions).toMatchObject({
            to: 'taylor@example.com',
            subject: 'Event details',
            from: expect.objectContaining({name: expect.any(String), address: expect.any(String)}),
        });
        expect(mailOptions.html).toContain('<!doctype html>');
        expect(mailOptions.text).toContain('Your event details are ready');
    });

    it('preserves a configured display-name mailbox as the SMTP sender', () => {
        const previousSender = settings.value.smtpEmail;
        settings.value.smtpEmail = 'Surveyor notifications <notifications@example.com>';

        try {
            const mailOptions = createMailOptions(
                'taylor@example.com',
                'Event details',
                createStructuredEmailContent(),
            );

            // Regression: wrapping a complete mailbox in an address object makes Nodemailer reject every email.
            expect(mailOptions.from).toBe('Surveyor notifications <notifications@example.com>');
        } finally {
            settings.value.smtpEmail = previousSender;
        }
    });
});
