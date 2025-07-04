const nodemailer = require('nodemailer');
const settings = require('./settings.js');

let transporter = undefined;

function init() {
    if (!transporter) {
        transporter = nodemailer.createTransport({
            pool: settings.smtpPool,
            host: settings.smtpHost,
            port: settings.smtpPort,
            secure: settings.smtpSecure, // use TLS
            auth: {
                user: settings.smtpUser,
                pass: settings.smtpPassword,
            },
        });
    }
}

// Funktion zum Senden einer E-Mail
async function sendEmail(to, subject, text) {
    init();

    const mailOptions = {
        from: settings.smtpEmail,
        to: to,
        subject: subject,
        text: text,
    };

    try {
        const info = await transporter.sendMail(mailOptions);
    } catch (error) {
        console.error('Error sending E-Mail:', error);
    }
}

// Funktion zum Senden einer Aktivierungs-E-Mail
async function sendActivationEmail(userEmail, activationLink) {
    const subject = 'Activate your account';
    const text = `Hi! Welcome to Surveyor!\n\nTo activate your account, please follow this link:\n\n${activationLink}\n\nNote: This link will expire in 1 hour.\n\nYour Surveyor Team.`;

    await sendEmail(userEmail, subject, text);
}

// Funktion zum Senden einer E-Mail für das Passwort zurücksetzen
async function sendPasswordResetEmail(userEmail, resetLink) {
    const subject = 'Reset your password';
    const text = `Hi!\n\nYou requested to reset your password.\n\nTo set a new one, please follow this link:\n\n${resetLink}\n\nNote: This link will expire in 1 hour.\n\nYour Surveyor Team.`;

    await sendEmail(userEmail, subject, text);
}

async function sendLinkEmail(userEmail, surveyLink) {
    const subject = 'Your personal editing link';
    const text = `Hi! Thank you for using Surveyor!\n\nThis is your personal link to editor your answers:\n\n${surveyLink}\n\nNote: Please do not share this link with anybody.\n\nYour Surveyor Team.`;

    await sendEmail(userEmail, subject, text);
}

module.exports = {
    sendEmail,
    sendActivationEmail,
    sendPasswordResetEmail,
    sendLinkEmail
};
