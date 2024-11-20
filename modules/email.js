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
        console.log('E-Mail gesendet: ', info);
    } catch (error) {
        console.error('Fehler beim Senden der E-Mail:', error);
    }
}

// Funktion zum Senden einer Aktivierungs-E-Mail
async function sendActivationEmail(userEmail, activationLink) {
    const subject = 'Aktivierung Ihres Kontos';
    const text = `Klicken Sie auf den folgenden Link, um Ihr Konto zu aktivieren:\n\n${activationLink}`;

    await sendEmail(userEmail, subject, text);
}

// Funktion zum Senden einer E-Mail für das Passwort zurücksetzen
async function sendPasswordResetEmail(userEmail, resetLink) {
    const subject = 'Passwort zurücksetzen';
    const text = `Klicken Sie auf den folgenden Link, um Ihr Passwort zurückzusetzen:\n\n${resetLink}`;

    await sendEmail(userEmail, subject, text);
}

async function sendSurveyLinkEmail(userEmail, surveyLink) {
    const subject = 'Ihr persönlicher Bearbeitungslink';
    const text = `Sie können Ihre Umfrageantworten bearbeiten, indem Sie auf den folgenden Link klicken:\n\n${surveyLink}`;

    await sendEmail(userEmail, subject, text);
}

module.exports = {
    sendEmail,
    sendActivationEmail,
    sendPasswordResetEmail,
    sendSurveyLinkEmail
};
