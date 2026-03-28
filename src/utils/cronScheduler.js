const cron = require('node-cron');

const checkMissedClockIns = require('../jobs/checkMissedClockIns');
const checkMissedClockOuts = require('../jobs/checkMissedClockOuts');
const sendMorningReportJob = require('../jobs/sendMorningReport');
const sendEveningReportJob = require('../jobs/sendEveningReport');
const autoClockOutSafeguard = require('../jobs/autoClockOutSafeguard');

/**
 * Initialize all cron jobs for the notification system
 */
function initializeCronJobs() {
  console.log('⏰ Initializing cron jobs...\n');

  // Job 1: Check for missed clock-ins every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    console.log('\n🔔 [CRON] Running missed clock-in check...');
    await checkMissedClockIns();
  });
  console.log('✅ Missed clock-in checker: Every 5 minutes');

  // Job 2: Check for missed clock-outs every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    console.log('\n🔔 [CRON] Running missed clock-out check...');
    await checkMissedClockOuts();
  });
  console.log('✅ Missed clock-out checker: Every 5 minutes');

  // Job 3: Auto clock-out after 20 hours - every 10 minutes
  cron.schedule('*/10 * * * *', async () => {
    await autoClockOutSafeguard();
  });
  console.log('✅ Auto 20-hour clock-out safeguard: Every 10 minutes');

  // Job 4: Send morning report at 10:00 AM daily
  cron.schedule('0 10 * * *', async () => {
    console.log('\n📊 [CRON] Sending morning reports...');
    await sendMorningReportJob();
  });
  console.log('✅ Morning reports: Daily at 10:00 AM');

  // Job 5: Send evening report at 6:00 PM daily
  cron.schedule('0 18 * * *', async () => {
    console.log('\n📊 [CRON] Sending evening reports...');
    await sendEveningReportJob();
  });
  console.log('✅ Evening reports: Daily at 6:00 PM');

  console.log('\n🎉 All cron jobs initialized successfully!');
}

module.exports = { initializeCronJobs };