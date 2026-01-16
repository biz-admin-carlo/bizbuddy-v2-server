const { sendMail } = require('@utils/mailer');
const handlebars = require('handlebars');
const fs = require('fs').promises;
const path = require('path');

/**
 * Load and compile Handlebars template
 */
async function loadTemplate(templateName) {
  const templatePath = path.join(__dirname, '../templates', `${templateName}.hbs`);
  try {
    const templateSource = await fs.readFile(templatePath, 'utf-8');
    return handlebars.compile(templateSource);
  } catch (error) {
    console.error(`❌ Template not found: ${templateName}`, error);
    throw error;
  }
}

/**
 * Send email with template
 * @param {Object} options
 * @param {string} options.to - Recipient email
 * @param {string} options.subject - Email subject
 * @param {string} options.templateName - Handlebars template name (without .hbs)
 * @param {Object} options.context - Template variables
 * @param {boolean} options.isNotification - Use notification email (default: true for this service)
 */
async function sendEmail({ to, subject, templateName, context, isNotification = true }) {
  try {
    const template = await loadTemplate(templateName);
    const html = template(context);

    // Use notification email by default for this service
    await sendMail({ 
      to, 
      subject, 
      html,
      isNotification, // Will use notifications@mybizbuddy.co
    });

    console.log(`✅ Email sent to: ${to} (from: ${isNotification ? 'notifications@' : 'no-reply@'})`);
    return { success: true };
  } catch (error) {
    console.error('❌ Email send failed:', error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  sendEmail,
};