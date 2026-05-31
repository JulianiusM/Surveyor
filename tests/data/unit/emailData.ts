/**
 * Test data for email module tests
 */

/**
 * Test cases for sendEmail transport initialization and reuse
 */
export const sendEmailTransportData = [
    {
        description: 'first call initializes transport with settings',
        call: 1,
        to: 'user@example.com',
        subject: 'Subject X',
        body: 'Hello',
        expectedTransportCalls: 1,
        expectedMailPayload: {
            from: 'noreply@surveyor.test',
            to: 'user@example.com',
            subject: 'Subject X',
            text: 'Hello',
        },
    },
    {
        description: 'second call reuses transport (no new createTransport)',
        call: 2,
        to: 'a@b.c',
        subject: 'S2',
        body: 'Hi again',
        expectedTransportCalls: 1, // Still 1, reused
        expectedMailPayload: {
            from: 'noreply@surveyor.test',
            to: 'a@b.c',
            subject: 'S2',
            text: 'Hi again',
        },
    },
];

/**
 * Test cases for email template helpers
 */
export const emailTemplateData = [
    {
        description: 'sendActivationEmail produces correct subject/body',
        method: 'sendActivationEmail',
        to: 'user@x',
        link: 'https://app.local/activate/abc',
        expectedSubject: 'Activate your account',
        expectedBody:
            'Hi! Welcome to Surveyor!\n\n' +
            'To activate your account, please follow this link:\n\n' +
            'https://app.local/activate/abc\n\n' +
            'Note: This link will expire in 1 hour.\n\n' +
            'Your Surveyor Team.',
    },
    {
        description: 'sendPasswordResetEmail produces correct subject/body',
        method: 'sendPasswordResetEmail',
        to: 'user@x',
        link: 'https://app.local/reset/xyz',
        expectedSubject: 'Reset your password',
        expectedBody:
            'Hi!\n\n' +
            'You requested to reset your password.\n\n' +
            'To set a new one, please follow this link:\n\n' +
            'https://app.local/reset/xyz\n\n' +
            'Note: This link will expire in 1 hour.\n\n' +
            'Your Surveyor Team.',
    },
    {
        description: 'sendLinkEmail produces correct subject/body',
        method: 'sendLinkEmail',
        to: 'user@x',
        link: 'https://app.local/surveys/edit/123',
        expectedSubject: 'Your personal editing link',
        expectedBody:
            'Hi! Thank you for using Surveyor!\n\n' +
            'This is your personal link to edit your answers:\n\n' +
            'https://app.local/surveys/edit/123\n\n' +
            'Note: Please do not share this link with anybody.\n\n' +
            'Your Surveyor Team.',
    },
    {
        description: 'sendGuestRecoveryEmail produces correct subject/body',
        method: 'sendGuestRecoveryEmail',
        to: 'user@x',
        link: ['https://app.local/surveys/edit/123', 'https://app.local/activity/a1/edit/xyz'],
        expectedSubject: 'Your guest recovery links',
        expectedBody:
            'Hi! Thank you for using Surveyor!\n\n' +
            'You requested recovery links for guest access tied to this email address.\n\n' +
            '1. https://app.local/surveys/edit/123\n' +
            '2. https://app.local/activity/a1/edit/xyz\n\n' +
            'Note: Please do not share these links with anybody.\n\n' +
            'Your Surveyor Team.',
    },
];

/**
 * Mock settings for email tests
 */
export const mockEmailSettings = {
    smtpHost: 'smtp.test.local',
    smtpPort: 2525,
    smtpSecure: false,
    smtpUser: 'mailer',
    smtpPassword: 'secret',
    smtpEmail: 'noreply@surveyor.test',
};

/**
 * Expected transport configuration
 */
export const expectedTransportConfig = {
    pool: true,
    host: 'smtp.test.local',
    port: 2525,
    secure: false,
    auth: { user: 'mailer', pass: 'secret' },
};
