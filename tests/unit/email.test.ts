/**
 * Unit tests for src/modules/email.ts
 * - Mocks nodemailer to observe transport + payload
 * - Mocks settings to inject SMTP config + from address
 * - Verifies singleton init (createTransport called once)
 * - Verifies three template helpers build the expected subject/body
 * - Verifies error path logs and does not throw
 */
export {}; // make this test file a module; avoids global name collisions


// We'll lazily import the module after mocks are set
const makeMocks = () => {
    jest.resetModules();

    // Mock settings module consumed by email.ts
    jest.doMock('../../src/modules/settings', () => ({
        __esModule: true,
        default: {
            value: {
                smtpHost: 'smtp.test.local',
                smtpPort: 2525,
                smtpSecure: false,
                smtpUser: 'mailer',
                smtpPassword: 'secret',
                smtpEmail: 'noreply@surveyor.test',
            }
        }
    }));

    // Mock nodemailer with spies
    const sendMail = jest.fn().mockResolvedValue({accepted: ['ok'], messageId: 'msg-1'});
    const createTransport = jest.fn(() => ({sendMail}));

    jest.doMock('nodemailer', () => ({
        __esModule: true,
        default: {createTransport},
        createTransport,
    }));

    return {sendMail, createTransport};
};

describe('email module', () => {
    test('sendEmail initializes transport once and sends with settings.from', async () => {
        const {sendMail, createTransport} = makeMocks();
        const email = (await import('../../src/modules/email')).default;

        // First call creates transport
        await email.sendEmail('user@example.com', 'Subject X', 'Hello');
        expect(createTransport).toHaveBeenCalledTimes(1);
        expect(createTransport).toHaveBeenCalledWith({
            pool: true,
            host: 'smtp.test.local',
            port: 2525,
            secure: false,
            auth: {user: 'mailer', pass: 'secret'},
        });
        expect(sendMail).toHaveBeenCalledWith({
            from: 'noreply@surveyor.test',
            to: 'user@example.com',
            subject: 'Subject X',
            text: 'Hello',
        });

        // Second call reuses same transporter (no new createTransport)
        await email.sendEmail('a@b.c', 'S2', 'Hi again');
        expect(createTransport).toHaveBeenCalledTimes(1);
        expect(sendMail).toHaveBeenCalledWith({
            from: 'noreply@surveyor.test',
            to: 'a@b.c',
            subject: 'S2',
            text: 'Hi again',
        });
    });

    test('sendActivationEmail produces correct subject/body', async () => {
        const {sendMail} = makeMocks();
        const email = (await import('../../src/modules/email')).default;

        const link = 'https://app.local/activate/abc';
        await email.sendActivationEmail('user@x', link);

        expect(sendMail).toHaveBeenCalledTimes(1);
        const payload = sendMail.mock.calls[0][0];
        expect(payload.subject).toBe('Activate your account');
        expect(payload.text).toBe(
            'Hi! Welcome to Surveyor!\n\n' +
            'To activate your account, please follow this link:\n\n' +
            link + '\n\n' +
            'Note: This link will expire in 1 hour.\n\n' +
            'Your Surveyor Team.'
        );
    });

    test('sendPasswordResetEmail produces correct subject/body', async () => {
        const {sendMail} = makeMocks();
        const email = (await import('../../src/modules/email')).default;

        const link = 'https://app.local/reset/xyz';
        await email.sendPasswordResetEmail('user@x', link);

        expect(sendMail).toHaveBeenCalledTimes(1);
        const payload = sendMail.mock.calls[0][0];
        expect(payload.subject).toBe('Reset your password');
        expect(payload.text).toBe(
            'Hi!\n\n' +
            'You requested to reset your password.\n\n' +
            'To set a new one, please follow this link:\n\n' +
            link + '\n\n' +
            'Note: This link will expire in 1 hour.\n\n' +
            'Your Surveyor Team.'
        );
    });

    test('sendLinkEmail produces correct subject/body', async () => {
        const {sendMail} = makeMocks();
        const email = (await import('../../src/modules/email')).default;

        const link = 'https://app.local/surveys/edit/123';
        await email.sendLinkEmail('user@x', link);

        expect(sendMail).toHaveBeenCalledTimes(1);
        const payload = sendMail.mock.calls[0][0];
        expect(payload.subject).toBe('Your personal editing link');
        expect(payload.text).toBe(
            'Hi! Thank you for using Surveyor!\n\n' +
            'This is your personal link to edit your answers:\n\n' +
            link + '\n\n' +
            'Note: Please do not share this link with anybody.\n\n' +
            'Your Surveyor Team.'
        );
    });

    test('sendEmail swallows send errors and logs', async () => {
        jest.resetModules();

        // settings mock
        jest.doMock('../../src/modules/settings', () => ({
            __esModule: true,
            default: {
                value: {
                    smtpHost: 'smtp.test.local', smtpPort: 2525, smtpSecure: false,
                    smtpUser: 'mailer', smtpPassword: 'secret', smtpEmail: 'noreply@surveyor.test'
                }
            }
        }));

        const sendMail = jest.fn().mockRejectedValue(new Error('SMTP down'));
        const createTransport = jest.fn(() => ({sendMail}));
        jest.doMock('nodemailer', () => ({
            __esModule: true,
            default: {createTransport},
            createTransport,
        }));

        const spyErr = jest.spyOn(console, 'error').mockImplementation(() => {
        });

        const email = (await import('../../src/modules/email')).default;
        await expect(email.sendEmail('to@x', 'S', 'B')).resolves.toBeUndefined();

        expect(createTransport).toHaveBeenCalledTimes(1);
        expect(spyErr).toHaveBeenCalled();
    });
});
