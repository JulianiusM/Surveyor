import nodemailer, {Transporter} from 'nodemailer';
import settings from './settings';
import {MailOptions, Options, SentMessageInfo} from 'nodemailer/lib/smtp-pool';

let transporter: Transporter<SentMessageInfo, Options> | undefined = undefined;

function init() {
    if (!transporter) {
        transporter = nodemailer.createTransport({
            pool: true,
            host: settings.value.smtpHost,
            port: settings.value.smtpPort,
            secure: settings.value.smtpSecure, // use TLS
            auth: {
                user: settings.value.smtpUser,
                pass: settings.value.smtpPassword,
            },
        });
    }
}

// Funktion zum Senden einer E-Mail
async function sendEmail(to: string, subject: string, text: string) {
    init();

    const mailOptions: MailOptions = {
        from: settings.value.smtpEmail,
        to: to,
        subject: subject,
        text: text,
    };

    try {
        const info = await transporter!.sendMail(mailOptions);
    } catch (error) {
        console.error('Error sending E-Mail:', error);
    }
}

// Funktion zum Senden einer Aktivierungs-E-Mail
async function sendActivationEmail(userEmail: string, activationLink: string) {
    const subject = 'Activate your account';
    const text = `Hi! Welcome to Surveyor!\n\nTo activate your account, please follow this link:\n\n${activationLink}\n\nNote: This link will expire in 1 hour.\n\nYour Surveyor Team.`;

    await sendEmail(userEmail, subject, text);
}

// Funktion zum Senden einer E-Mail für das Passwort zurücksetzen
async function sendPasswordResetEmail(userEmail: string, resetLink: string) {
    const subject = 'Reset your password';
    const text = `Hi!\n\nYou requested to reset your password.\n\nTo set a new one, please follow this link:\n\n${resetLink}\n\nNote: This link will expire in 1 hour.\n\nYour Surveyor Team.`;

    await sendEmail(userEmail, subject, text);
}

async function sendLinkEmail(userEmail: string, surveyLink: string) {
    const subject = 'Your personal editing link';
    const text = `Hi! Thank you for using Surveyor!\n\nThis is your personal link to edit your answers:\n\n${surveyLink}\n\nNote: Please do not share this link with anybody.\n\nYour Surveyor Team.`;

    await sendEmail(userEmail, subject, text);
}

async function sendGuestRecoveryEmail(userEmail: string, links: string[]) {
    const subject = 'Your guest recovery links';
    const list = links.map((link, i) => `${i + 1}. ${link}`).join('\n');
    const text = `Hi! Thank you for using Surveyor!\n\nYou requested recovery links for guest access tied to this email address.\n\n${list}\n\nNote: Please do not share these links with anybody.\n\nYour Surveyor Team.`;
    await sendEmail(userEmail, subject, text);
}

export default {
    sendEmail,
    sendActivationEmail,
    sendPasswordResetEmail,
    sendLinkEmail,
    sendGuestRecoveryEmail
};
