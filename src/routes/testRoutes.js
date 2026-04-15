// routes/testRoutes.js (or add to your existing admin routes)
const express = require('express');
const router = express.Router();
const sendEveningReportTestJob = require('../jobs/sendEveningReportTestJob');
const { sendEmail } = require('../services/emailService');

// POST /api/test/trigger-evening-report
router.post('/trigger-evening-report', async (req, res) => {
  try {
    console.log('[TEST] Manually triggering evening report...');
    await sendEveningReportTestJob();
    res.json({ success: true, message: 'Evening report test triggered successfully!' });
  } catch (error) {
    console.error('[TEST] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/test/clock-out-warning-email
// Sends a sample clockOutWarning email to the address in the request body (or default).
router.post('/clock-out-warning-email', async (req, res) => {
  const to = req.body?.to || 'webdev@bizsolutions.us';
  try {
    const result = await sendEmail({
      to,
      subject: '[TEST] Clock-Out Reminder',
      templateName: 'clockOutWarning',
      context: {
        employeeName:     'Jane Doe',
        companyName:      'BizBuddy Demo Co.',
        scheduledEndTime: '2:45 PM',
        clockInTime:      '6:30 AM',
        appUrl:           process.env.CLIENT_URL || 'https://app.mybizbuddy.co',
        currentYear:      new Date().getFullYear(),
      },
    });
    res.json({ success: result.success, to, template: 'clockOutWarning' });
  } catch (error) {
    console.error('[TEST] clock-out-warning-email error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/test/auto-clock-out-sv-email
// Sends a sample autoClockOutSv email to the address in the request body (or default).
router.post('/auto-clock-out-sv-email', async (req, res) => {
  const to = req.body?.to || 'webdev@bizsolutions.us';
  try {
    const result = await sendEmail({
      to,
      subject: '[TEST] [Auto Clock-Out] Jane Doe — BizBuddy Demo Co.',
      templateName: 'autoClockOutSv',
      context: {
        employeeName:     'Jane Doe',
        companyName:      'BizBuddy Demo Co.',
        clockInTime:      'Apr 12, 2026, 6:30 AM',
        clockOutTime:     'Apr 12, 2026, 2:45 PM',
        scheduledEndTime: 'Apr 12, 2026, 2:45 PM',
        appUrl:           process.env.CLIENT_URL || 'https://app.mybizbuddy.co',
        currentYear:      new Date().getFullYear(),
      },
    });
    res.json({ success: result.success, to, template: 'autoClockOutSv' });
  } catch (error) {
    console.error('[TEST] auto-clock-out-sv-email error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/test/missed-clock-in-email
router.post('/missed-clock-in-email', async (req, res) => {
  const to = req.body?.to || 'webdev@bizsolutions.us';
  try {
    const result = await sendEmail({
      to,
      subject: '[TEST] Missed Clock-In',
      templateName: 'missedClockIn',
      context: {
        employeeName:  'Jane Doe',
        shiftName:     'Regular Shift',
        scheduledStart: '8:00 AM',
        currentTime:   '8:42 AM',
        department:    'Classroom A',
        appUrl:        process.env.CLIENT_URL || 'https://app.mybizbuddy.co',
        currentYear:   new Date().getFullYear(),
      },
    });
    res.json({ success: result.success, to, template: 'missedClockIn' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/test/missed-clock-out-email
router.post('/missed-clock-out-email', async (req, res) => {
  const to = req.body?.to || 'webdev@bizsolutions.us';
  try {
    const result = await sendEmail({
      to,
      subject: '[TEST] Missed Clock-Out',
      templateName: 'missedClockOut',
      context: {
        employeeName:    'Jane Doe',
        clockInTime:     '8:00 AM',
        expectedClockOut: '4:00 PM',
        hoursWorked:     '8.00',
        appUrl:          process.env.CLIENT_URL || 'https://app.mybizbuddy.co',
        currentYear:     new Date().getFullYear(),
      },
    });
    res.json({ success: result.success, to, template: 'missedClockOut' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/test/auto-clock-out-email
router.post('/auto-clock-out-email', async (req, res) => {
  const to = req.body?.to || 'webdev@bizsolutions.us';
  try {
    const result = await sendEmail({
      to,
      subject: '[TEST] Automatic Clock-Out',
      templateName: 'autoClockOut',
      context: {
        employeeName: 'Jane Doe',
        companyName:  'BizBuddy Demo Co.',
        clockInTime:  'Apr 12, 2026, 6:30 AM',
        clockOutTime: 'Apr 12, 2026, 2:45 PM',
        hoursWorked:  '8.25',
        appUrl:       process.env.CLIENT_URL || 'https://app.mybizbuddy.co',
        currentYear:  new Date().getFullYear(),
      },
    });
    res.json({ success: result.success, to, template: 'autoClockOut' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/test/auto-clock-out-corrected-email
router.post('/auto-clock-out-corrected-email', async (req, res) => {
  const to = req.body?.to || 'webdev@bizsolutions.us';
  try {
    const result = await sendEmail({
      to,
      subject: '[TEST] Time Log Correction',
      templateName: 'autoClockOutCorrected',
      context: {
        employeeName:          'Jane Doe',
        companyName:           'BizBuddy Demo Co.',
        originalDate:          'Apr 12, 2026',
        clockInTime:           'Apr 12, 2026, 6:30 AM',
        incorrectClockOutTime: 'Apr 12, 2026, 11:30 AM',
        appUrl:                process.env.CLIENT_URL || 'https://app.mybizbuddy.co',
        currentYear:           new Date().getFullYear(),
      },
    });
    res.json({ success: result.success, to, template: 'autoClockOutCorrected' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/test/morning-report-email
router.post('/morning-report-email', async (req, res) => {
  const to = req.body?.to || 'webdev@bizsolutions.us';
  try {
    const result = await sendEmail({
      to,
      subject: '[TEST] Morning Attendance Report',
      templateName: 'morningReport',
      context: {
        managerName:  'Admin',
        companyName:  'BizBuddy Demo Co.',
        reportDate:   'Saturday, April 12, 2026',
        showAllClear: false,
        missedCount:  2,
        clockedInCount: 3,
        missedClockIns: [
          { employeeName: 'Jane Doe',  department: 'Classroom A', scheduledTime: '8:00 AM', minutesLate: 42, supervisor: 'John Smith' },
          { employeeName: 'Bob Reyes', department: 'Classroom B', scheduledTime: '8:00 AM', minutesLate: 15, supervisor: 'John Smith' },
        ],
        currentlyClockedIn: [
          { employeeName: 'Maria Cruz',   department: 'Classroom A', clockInTime: '7:58 AM', hoursWorked: '0.5' },
          { employeeName: 'Carlos Tan',   department: 'Classroom B', clockInTime: '8:01 AM', hoursWorked: '0.4' },
          { employeeName: 'Ana Gonzalez', department: 'Office',      clockInTime: '7:45 AM', hoursWorked: '0.7' },
        ],
        appUrl:      process.env.CLIENT_URL || 'https://app.mybizbuddy.co',
        currentYear: new Date().getFullYear(),
      },
    });
    res.json({ success: result.success, to, template: 'morningReport' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/test/evening-report-email
router.post('/evening-report-email', async (req, res) => {
  const to = req.body?.to || 'webdev@bizsolutions.us';
  try {
    const result = await sendEmail({
      to,
      subject: '[TEST] Evening Attendance Report',
      templateName: 'eveningReport',
      context: {
        managerName:       'Admin',
        companyName:       'BizBuddy Demo Co.',
        reportDate:        'Saturday, April 12, 2026',
        showAllClear:      false,
        missedCount:       1,
        stillClockedInCount: 2,
        missedClockOuts: [
          { employeeName: 'Jane Doe', department: 'Classroom A', clockInTime: '8:00 AM', expectedClockOut: '4:00 PM', minutesOverdue: 35 },
        ],
        stillClockedIn: [
          { employeeName: 'Carlos Tan',   department: 'Classroom B', clockInTime: '8:01 AM', hoursWorked: '8.1', expectedClockOut: '4:00 PM' },
          { employeeName: 'Ana Gonzalez', department: 'Office',      clockInTime: '7:45 AM', hoursWorked: '8.4', expectedClockOut: null },
        ],
        appUrl:      process.env.CLIENT_URL || 'https://app.mybizbuddy.co',
        currentYear: new Date().getFullYear(),
      },
    });
    res.json({ success: result.success, to, template: 'eveningReport' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;