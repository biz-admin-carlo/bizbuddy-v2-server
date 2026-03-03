// routes/testRoutes.js (or add to your existing admin routes)
const express = require('express');
const router = express.Router();
const sendEveningReportTestJob = require('../jobs/sendEveningReportTestJob');

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

module.exports = router;