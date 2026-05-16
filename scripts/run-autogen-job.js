require("module-alias/register");
require("dotenv").config();

const autoGenerateCutoffPeriodsJob = require("../src/jobs/autoGenerateCutoffPeriodsJob");

autoGenerateCutoffPeriodsJob()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
