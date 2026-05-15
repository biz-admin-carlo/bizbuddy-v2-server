const cron = require('node-cron');

const checkMissedClockIns            = require('../jobs/checkMissedClockIns');
const checkMissedClockOuts           = require('../jobs/checkMissedClockOuts');
const sendMorningReportJob           = require('../jobs/sendMorningReport');
const sendEveningReportJob           = require('../jobs/sendEveningReport');
const autoClockOutJob                = require('../jobs/autoClockOutJob');
const autoGenerateCutoffPeriodsJob   = require('../jobs/autoGenerateCutoffPeriodsJob');

/**
 * Initialize all cron jobs for the notification system
 */
function initializeCronJobs() {
  // Job 1: Check for missed clock-ins every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    await checkMissedClockIns();
  });

  // Job 2: Check for missed clock-outs every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    await checkMissedClockOuts();
  });

  // Job 3: Auto clock-out — two-pass warn + close (v2.7.3 redesign)
  cron.schedule('*/5 * * * *', async () => {
    await autoClockOutJob();
  });

  // Job 4: Send morning report at 10:00 AM daily
  cron.schedule('0 10 * * *', async () => {
    await sendMorningReportJob();
  });

  // Job 5: Send evening report at 6:00 PM daily
  cron.schedule('0 18 * * *', async () => {
    await sendEveningReportJob();
  });

  // Job 6: Auto-generate cutoff periods at 2:00 AM daily
  // Ensures each department always has at least 2 open future periods ahead.
  cron.schedule('0 2 * * *', async () => {
    await autoGenerateCutoffPeriodsJob();
  });
}

module.exports = { initializeCronJobs };