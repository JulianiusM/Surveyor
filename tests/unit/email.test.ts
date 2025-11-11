/**
 * Unit tests for src/modules/email.ts - Data Driven
 * - Mocks nodemailer to observe transport + payload
 * - Mocks settings to inject SMTP config + from address
 * - Verifies singleton init (createTransport called once)
 * - Verifies three template helpers build the expected subject/body
 * - Verifies error path logs and does not throw
 */
export {}; // make this test file a module; avoids global name collisions

import {
    sendEmailTransportData,
    emailTemplateData,
    mockEmailSettings,
    expectedTransportConfig,
} from '../data/unit/emailData';

// We'll lazily import the module after mocks are set
const makeMocks = () => {
    jest.resetModules();

    // Mock settings module consumed by email.ts
    jest.doMock('../../src/modules/settings', () => ({
        __esModule: true,
        default: {
            value: mockEmailSettings,
        }
    }));

    // Mock nodemailer with spies
    const sendMail = jest.fn().mockResolvedValue({ accepted: ['ok'], messageId: 'msg-1' });
    const createTransport = jest.fn(() => ({ sendMail }));

    jest.doMock('nodemailer', () => ({
        __esModule: true,
        default: { createTransport },
        createTransport,
    }));

    return { sendMail, createTransport };
};

describe('email module', () => {
    test('sendEmail initializes transport once and sends with settings.from', async () => {
        const { sendMail, createTransport } = makeMocks();
        const email = (await import('../../src/modules/email')).default;

        // Test both calls using data
        for (const testCase of sendEmailTransportData) {
            await email.sendEmail(testCase.to, testCase.subject, testCase.body);
            
            expect(createTransport).toHaveBeenCalledTimes(testCase.expectedTransportCalls);
            
            if (testCase.call === 1) {
                expect(createTransport).toHaveBeenCalledWith(expectedTransportConfig);
            }
            
            expect(sendMail).toHaveBeenCalledWith(testCase.expectedMailPayload);
        }
    });

    describe('email template helpers - Data Driven', () => {
        test.each(emailTemplateData)(
            '$description',
            async ({ method, to, link, expectedSubject, expectedBody }) => {
                const { sendMail } = makeMocks();
                const email = (await import('../../src/modules/email')).default;

                await (email as any)[method](to, link);

                expect(sendMail).toHaveBeenCalledTimes(1);
                const payload = sendMail.mock.calls[0][0];
                expect(payload.subject).toBe(expectedSubject);
                expect(payload.text).toBe(expectedBody);
            }
        );
    });

    test('sendEmail swallows send errors and logs', async () => {
        jest.resetModules();

        // settings mock
        jest.doMock('../../src/modules/settings', () => ({
            __esModule: true,
            default: {
                value: mockEmailSettings,
            }
        }));

        const sendMail = jest.fn().mockRejectedValue(new Error('SMTP down'));
        const createTransport = jest.fn(() => ({ sendMail }));
        jest.doMock('nodemailer', () => ({
            __esModule: true,
            default: { createTransport },
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

