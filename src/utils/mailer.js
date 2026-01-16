// src/utils/mailer.js
const nodemailer = require("nodemailer");

const host = process.env.SMTP_HOST || "smtp.dreamhost.com";
const port = Number(process.env.SMTP_PORT || 587);
const secure = port === 465;

// Default transporter (existing no-reply email)
const defaultTransporter = nodemailer.createTransport({
  host,
  port,
  secure,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Notification transporter (new notifications email)
const notificationTransporter = nodemailer.createTransport({
  host,
  port,
  secure,
  auth: {
    user: process.env.NOTIFICATION_SMTP_USER,
    pass: process.env.NOTIFICATION_SMTP_PASS,
  },
});

// Verify both connections on startup
defaultTransporter.verify((error, success) => {
  if (error) {
    console.error('❌ Default email service error:', error);
  } else {
    console.log('✅ Default email service ready (no-reply@mybizbuddy.co)');
  }
});

notificationTransporter.verify((error, success) => {
  if (error) {
    console.error('❌ Notification email service error:', error);
  } else {
    console.log('✅ Notification email service ready (notifications@mybizbuddy.co)');
  }
});

/**
 * Send email using appropriate transporter
 * @param {Object} options - Email options
 * @param {string} options.to - Recipient email
 * @param {string} options.subject - Email subject
 * @param {string} options.html - HTML content
 * @param {string} options.text - Plain text content (optional)
 * @param {boolean} options.isNotification - Use notification email (default: false)
 * @param {string} options.from - Custom from address (optional)
 */
async function sendMail({ to, subject, html, text, isNotification = false, from }) {
  // Choose transporter
  const transporter = isNotification ? notificationTransporter : defaultTransporter;
  
  // Choose from address
  const fromAddress = from || (isNotification 
    ? process.env.NOTIFICATION_MAIL_FROM 
    : process.env.MAIL_FROM) || process.env.SMTP_USER;

  return transporter.sendMail({
    from: fromAddress,
    to,
    subject,
    html,
    text,
  });
}

module.exports = { 
  sendMail,
  defaultTransporter,
  notificationTransporter,
};