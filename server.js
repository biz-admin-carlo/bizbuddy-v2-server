// server.js
require("module-alias/register");
const dotenv = require("dotenv");
dotenv.config();

const app = require("./app.js");
const { connect } = require("@config/connection");
const router = require("@routes/index.js");
const errorHandler = require("@middlewares/errorHandler");
const http = require("http");

const PORT = process.env.PORT || 5000;

app.use("/api", router);
app.use(errorHandler);

const server = http.createServer(app);

// ================== INITIALIZE SERVICES ==================

// Socket.io
const { init: initSocket } = require("@config/socket");
initSocket(server);

// Firebase
const { initFirebase } = require("@config/firebase");
initFirebase();

// ================== INITIALIZE WORKERS/CRON JOBS ==================

// Leave accrual worker
const { scheduleLeaveAccrual } = require("@workers/leaveAccrualWorker");
scheduleLeaveAccrual();

// EXISTING: Proactive reminders (30 min BEFORE shift)
const { scheduleClockOutReminders } = require("@workers/clockOutReminderWorker");
scheduleClockOutReminders();
const { scheduleClockInReminders } = require("@workers/clockInReminderWorker");
scheduleClockInReminders();

// NEW: Reactive alerts (30 min AFTER missed clock-in/out) + Daily reports
const { initializeCronJobs } = require("@utils/cronScheduler");
initializeCronJobs();

// ================== START SERVER ==================

connect()
  .then(() => {
    server.listen(PORT, () => {
      console.log('\n' + '='.repeat(60));
      console.log('🚀 BizBuddy Server Started Successfully!');
      console.log('='.repeat(60));
      console.log(`📡 Port: ${PORT}`);
      console.log(`📧 Notifications: ${process.env.NOTIFICATION_SMTP_USER || 'Not configured'}`);
      console.log(`🌐 Client: ${process.env.CLIENT_URL || 'Not configured'}`);
      console.log(`🔥 Firebase: Initialized`);
      console.log(`\n📋 Active Workers:`);
      console.log(`   ✅ Leave Accrual`);
      console.log(`   ✅ Clock-In Reminders (30 min before shift)`);
      console.log(`   ✅ Clock-Out Reminders (30 min before shift end)`);
      console.log(`   ✅ Missed Clock-In Alerts (every 5 min)`);
      console.log(`   ✅ Missed Clock-Out Alerts (every 5 min)`);
      console.log(`   ✅ Morning Reports (10:00 AM daily)`);
      console.log(`   ✅ Evening Reports (6:00 PM daily)`);
      console.log('='.repeat(60) + '\n');
    });
  })
  .catch((error) => {
    console.error("❌ Unable to connect to the database:", error);
    process.exit(1);
  });