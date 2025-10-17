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
const { init: initSocket } = require("@config/socket");
initSocket(server);
const { initFirebase } = require("@config/firebase");
initFirebase();
const { scheduleLeaveAccrual } = require("@workers/leaveAccrualWorker");
scheduleLeaveAccrual();
const {
  scheduleClockOutReminders,
} = require("@workers/clockOutReminderWorker");
scheduleClockOutReminders();
const { scheduleClockInReminders } = require("@workers/clockInReminderWorker");
scheduleClockInReminders();

connect()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Unable to connect to the database:", error);
  });
