import {describe, expect, it} from 'vitest';
import nodemailer from 'nodemailer';
import {createMailOptions, renderEmail, resolveEmailRecipientName} from '../../src/modules/email';
import settings from '../../src/modules/settings';
import {createStructuredEmailContent} from '../factories/emailFactory';

const recipient = {name: 'Taylor', address: 'taylor@example.com'};

describe('transactional email rendering', () => {
    it('renders a responsive branded email and an equivalent plain-text fallback', () => {
        const rendered = renderEmail('Event details', createStructuredEmailContent(), recipient);

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
        expect(rendered.text.startsWith('Hello Taylor,\n\nYour event details are ready')).toBe(true);
        expect(rendered.html.indexOf('Hello Taylor,')).toBeLessThan(rendered.html.indexOf('<h1'));
        expect(rendered.text.match(/Hello Taylor,/g)).toHaveLength(1);
    });

    it('escapes untrusted content and never turns unsafe protocols into HTML links', () => {
        const rendered = renderEmail('Security update', createStructuredEmailContent({
            heading: '<img src=x onerror=alert(1)>',
            paragraphs: ['A value contained <script>alert(1)</script>.'],
            details: [{label: 'Submitted by', value: 'Casey & Morgan'}],
            action: {label: 'Open <account>', url: 'javascript:alert(1)'},
        }), {name: '<Taylor & Casey>', address: recipient.address});

        // Canary: participant and organizer text cannot inject markup or clickable script URLs.
        expect(rendered.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
        expect(rendered.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
        expect(rendered.html).toContain('Casey &amp; Morgan');
        expect(rendered.html).not.toContain('<script>');
        expect(rendered.html).not.toContain('href="javascript:');
        expect(rendered.text).not.toContain('javascript:alert(1)');
        expect(rendered.html).toContain('Hello &lt;Taylor &amp; Casey&gt;,');
    });

    it('renders escaped section metrics and signed formula terms equivalently in HTML and text', () => {
        const note = 'Saved <img src=x onerror=alert(1)> & credit';
        const rendered = renderEmail('Signed formula', createStructuredEmailContent({
            sections: [{title: 'Calculation <payer>',
                details: [{label: 'Attendance <units>', value: '3 & 4'}],
                formula: {
                    terms: [{label: 'Settled <payer> & credit', value: '15.00', operator: '−'},
                        {label: 'Rebate <input>', value: '-2.00', operator: '−'}],
                    result: {label: 'Balance <refund>', value: '-13.00'}, note,
                },
            }],
        }), recipient);

        // A credit-only calculation starts with subtraction; negative input values and results keep their sign.
        expect(rendered.text).toContain('Attendance <units>: 3 & 4');
        expect(rendered.text).toContain('− Settled <payer> & credit: 15.00 − Rebate <input>: (-2.00) = Balance <refund>: -13.00');
        expect(rendered.text).toContain(note);
        expect(rendered.html).toContain('Calculation &lt;payer&gt;');
        expect(rendered.html).toContain('Attendance &lt;units&gt;');
        expect(rendered.html).toContain('3 &amp; 4');
        expect(rendered.html).toContain('Settled &lt;payer&gt; &amp; credit');
        expect(rendered.html).toContain('Rebate &lt;input&gt;');
        expect(rendered.html).toContain('Balance &lt;refund&gt;');
        expect(rendered.html).toContain('&lt;img src=x onerror=alert(1)&gt; &amp; credit');
        expect(rendered.html).not.toContain('<img src=x onerror=alert(1)>');
        expect(rendered.html.indexOf('>−</span>')).toBeLessThan(rendered.html.indexOf('15.00'));
        expect(rendered.html).toContain('-2.00');
        expect(rendered.html).toContain('-13.00');
    });

    it.each([undefined, 'afterSections', 'beforeSections'] as const)('places the main action using the optional %s position', (actionPosition) => {
        const rendered = renderEmail('Event details', createStructuredEmailContent({actionPosition}), recipient);
        const buttonHtml = rendered.html.indexOf('>View event</a>');
        const sectionHtml = rendered.html.indexOf('>Next steps</h2>');
        const buttonText = rendered.text.indexOf('View event:');
        const sectionText = rendered.text.indexOf('Next steps');
        if (actionPosition === 'beforeSections') {
            expect(buttonHtml).toBeLessThan(sectionHtml);
            expect(buttonText).toBeLessThan(sectionText);
        } else {
            // Unchanged callers retain their established action order in both MIME alternatives.
            expect(buttonHtml).toBeGreaterThan(sectionHtml);
            expect(buttonText).toBeGreaterThan(sectionText);
        }
        expect(rendered.text.match(/View event:/gu)).toHaveLength(1);
    });

    it('keeps a native disclosure complete and escaped without author-level hiding', () => {
        const rendered = renderEmail('Calculation', createStructuredEmailContent({
            sections: [{title: 'Saved facts', items: ['Actual <payer> & saved fact']}],
            sectionGroups: [{title: 'Explanation <payer> & detail', disclosure: true, sections: [{
                title: 'Signed balance', details: [{label: 'Nights', value: '3'}],
                formula: {terms: [{label: 'Earlier <credit>', value: '15.00', operator: '−'}],
                    result: {label: 'Refund <balance>', value: '-15.00'}, note: 'Saved <rounding> & explanation'},
            }]}],
        }), recipient);
        const start = rendered.html.indexOf('<details');
        const disclosure = rendered.html.slice(start, rendered.html.indexOf('</details>', start) + '</details>'.length);
        expect(start).toBeGreaterThan(rendered.html.indexOf('Saved facts'));
        expect(disclosure).toMatch(/<summary[^>]*>Explanation &lt;payer&gt; &amp; detail<\/summary>/u);
        expect(disclosure).toContain('Earlier &lt;credit&gt;');
        expect(disclosure).toContain('Refund &lt;balance&gt;');
        expect(disclosure).toContain('-15.00');
        expect(disclosure).toContain('Saved &lt;rounding&gt; &amp; explanation');
        // Unsupported readers can ignore the native tags and retain visible content; no separate hiding mechanism is emitted.
        expect(disclosure).not.toMatch(/<details\b[^>]*\sopen(?:=|\s|>)|<[^>]+\shidden(?:=|\s|>)|display\s*:\s*none|visibility\s*:\s*hidden|max-height|<script|<input/iu);
        expect(rendered.text).toContain('Explanation <payer> & detail');
        expect(rendered.text).toContain('Nights: 3');
        expect(rendered.text).toContain('− Earlier <credit>: 15.00 = Refund <balance>: -15.00');
        expect(rendered.text).toContain('Saved <rounding> & explanation');
    });

    it('renders an opted-in section group visibly when disclosure is disabled', () => {
        const rendered = renderEmail('Details', createStructuredEmailContent({
            sectionGroups: [{title: 'Grouped facts', sections: [{title: 'Actual result', items: ['Saved amount']}]}],
        }), recipient);
        expect(rendered.html).toContain('Grouped facts</h2>');
        expect(rendered.html).toContain('Actual result</h2>');
        expect(rendered.html).not.toContain('<details');
        expect(rendered.text).toContain('Grouped facts\n\nActual result\n- Saved amount');
    });

    it('wraps legacy text notifications in the same polished email shell', () => {
        const rendered = renderEmail('Simple notification', 'The first paragraph.\n\nThe second paragraph.', recipient);

        // Canary: any future plain-string call still receives consistent branding and a text alternative.
        expect(rendered.html).toContain('<h1');
        expect(rendered.html).toContain('Simple notification');
        expect(rendered.html).toContain('The first paragraph.');
        expect(rendered.html).toContain('This is an automated service email');
        expect(rendered.text).toContain('The first paragraph.\n\nThe second paragraph.');
    });

    it('builds a multipart delivery payload with a branded sender', () => {
        const mailOptions = createMailOptions(
            recipient,
            'Event details',
            createStructuredEmailContent(),
        );

        // Canary: the SMTP boundary receives both representations instead of silently dropping polished HTML.
        expect(mailOptions).toMatchObject({
            to: recipient,
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
                recipient,
                'Event details',
                createStructuredEmailContent(),
            );

            // Regression: wrapping a complete mailbox in an address object makes Nodemailer reject every email.
            expect(mailOptions.from).toBe('Surveyor notifications <notifications@example.com>');
        } finally {
            settings.value.smtpEmail = previousSender;
        }
    });

    it('replaces legacy greetings with exactly one named salutation before the message', () => {
        const rendered = renderEmail('Personal link', 'Hello!\n\nUse your private editing link.', recipient);
        expect(rendered.text.startsWith('Hello Taylor,\n\nPersonal link\n\nUse your private editing link.')).toBe(true);
        expect(rendered.text.match(/Hello/g)).toHaveLength(1);
        expect(rendered.html).not.toContain('Hello!');
    });

    it('produces a To header with the recipient display name, including names requiring quoting', async () => {
        const transport = nodemailer.createTransport({streamTransport: true, buffer: true, newline: 'unix'});
        const namedRecipient = {name: 'Taylor, Casey', address: recipient.address};
        const result = await transport.sendMail(createMailOptions(namedRecipient, 'Event details', 'Your event changed.'));
        expect(result.message.toString()).toContain('To: "Taylor, Casey" <taylor@example.com>');
        expect(result.message.toString()).toContain('Hello Taylor, Casey,');
        transport.close();
    });

    it('normalizes whitespace in legacy names without creating a second mail header', async () => {
        const options = createMailOptions({name: '  Taylor\r\n  Example\t ', address: recipient.address}, 'Event details', 'Details');
        expect(options.to).toEqual({name: 'Taylor Example', address: recipient.address});
        expect(options.text).toMatch(/^Hello Taylor Example,/);
        const transport = nodemailer.createTransport({streamTransport: true, buffer: true, newline: 'unix'});
        const injected = createMailOptions({name: 'Taylor\r\nBcc: another@example.com', address: recipient.address}, 'Details', 'Details');
        const result = await transport.sendMail(injected);
        expect(result.message.toString()).not.toMatch(/^Bcc:/m);
        expect(injected.to).toEqual({name: 'Taylor Bcc: another@example.com', address: recipient.address});
        transport.close();
    });

    it('uses the first nonblank actual name or username without inventing a name', () => {
        expect(resolveEmailRecipientName(' \r\n ', null, ' known-user ')).toBe('known-user');
        expect(resolveEmailRecipientName(' Morgan\t Example ', 'known-user')).toBe('Morgan Example');
        expect(resolveEmailRecipientName(undefined, ' ')).toBe('');
    });

    it.each([
        {name: '', address: 'taylor@example.com'},
        {name: 'Taylor', address: ''},
        {name: 'Taylor', address: 'taylor@example.com\r\nBcc: another@example.com'},
        {name: 'Taylor', address: '\r\ntaylor@example.com'},
    ])('rejects incomplete or injected named recipients', (invalid) => {
        expect(() => createMailOptions(invalid, 'Event details', 'Details')).toThrow('recipients require a name');
    });
});
