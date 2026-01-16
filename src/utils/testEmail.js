require('dotenv').config();

const { sendMail } = require('./mailer');

async function testEmails() {
    console.log('🔍 Checking environment variables...\n');
    console.log('SMTP_USER:', process.env.SMTP_USER ? '✅ Set' : '❌ Missing');
    console.log('SMTP_PASS:', process.env.SMTP_PASS ? '✅ Set' : '❌ Missing');
    console.log('NOTIFICATION_SMTP_USER:', process.env.NOTIFICATION_SMTP_USER ? '✅ Set' : '❌ Missing');
    console.log('NOTIFICATION_SMTP_PASS:', process.env.NOTIFICATION_SMTP_PASS ? '✅ Set' : '❌ Missing');
    console.log('');

  // Test 1: Default email (no-reply)
  try {
    console.log('📧 Test 1: Sending from no-reply@mybizbuddy.co...');
    await sendMail({
      to: 'carloicorcuera@gmail.com', // Replace with your email
      subject: 'Test: Default Email',
      html: '<h1>This is from no-reply@mybizbuddy.co</h1>',
      isNotification: false,
    });
    console.log('✅ Test 1 passed!\n');
  } catch (error) {
    console.error('❌ Test 1 failed:', error.message, '\n');
  }

  // Test 2: Notification email
  try {
    console.log('📧 Test 2: Sending from notifications@mybizbuddy.co...');
    await sendMail({
      to: 'carloicorcuera@gmail.com', // Replace with your email
      subject: 'Test: Notification Email',
      html: '<h1>This is from notifications@mybizbuddy.co</h1>',
      isNotification: true,
    });
    console.log('✅ Test 2 passed!\n');
  } catch (error) {
    console.error('❌ Test 2 failed:', error.message, '\n');
  }

  console.log('🎉 Email tests complete!');
  process.exit(0);
}

testEmails();