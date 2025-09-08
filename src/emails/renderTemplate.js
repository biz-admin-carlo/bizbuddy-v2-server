// src/emails/renderTemplate.js
const fs = require("fs");
const path = require("path");

function renderWelcome({ firstName, companyName, email, password }) {
  const file = path.join(__dirname, "welcome_bizbuddy.html");
  let html = fs.readFileSync(file, "utf8");
  html = html
    .replace(/{{firstName}}/g, firstName)
    .replace(/{{companyName}}/g, companyName)
    .replace(/{{email}}/g, email)
    .replace(/{{password}}/g, password || "")
    .replace(/{{year}}/g, String(new Date().getFullYear()));
  return html;
}

module.exports = { renderWelcome };
