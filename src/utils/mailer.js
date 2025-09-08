// src/utils/mailer.js
const nodemailer = require("nodemailer");

const host = process.env.SMTP_HOST || "smtp.dreamhost.com";
const port = Number(process.env.SMTP_PORT || 587);
const secure = port === 465; 
const user = process.env.SMTP_USER;         
const pass = process.env.SMTP_PASS;        


const transporter = nodemailer.createTransport({
  host,
  port,
  secure,
  auth: { user, pass },
});

async function sendMail({ to, subject, html, text }) {
  return transporter.sendMail({
    from: process.env.MAIL_FROM || user,
    to, subject, html, text,
  });
}

module.exports = { sendMail };
