/* ---------------------------------------------------------------------
   SUPER-ADMIN ANALYTICS CONTROLLER
   ------------------------------------------------------------------ */
const { prisma } = require("@config/connection");

// helper → "YYYY-MM"
const ym = (d) => new Date(d).toISOString().slice(0, 7);

module.exports.getSuperAdminAnalytics = async (req, res) => {
  try {
    /*---------------------------------------------------------------
      1. BASIC LOOK-UPS
    ----------------------------------------------------------------*/
    const [companies, users, timelogs, payments] = await Promise.all([
      prisma.company.findMany({
        select: {
          id: true,
          name: true,
          createdAt: true,
          Subscription: {
            where: { active: true },
            select: { plan: { select: { name: true } } },
            take: 1,
          },
        },
      }),
      prisma.user.findMany({ select: { id: true, companyId: true, createdAt: true } }),
      prisma.timeLog.findMany({
        select: {
          userId: true,
          timeIn: true,
          deviceInfo: true, // { platform, … }
          location: true, // { start:{country,city,…}, end:{…} }
        },
      }),
      prisma.payment.findMany({
        where: { paymentDate: { gte: new Date(new Date().setDate(new Date().getDate() - 30)) } },
        select: { amount: true },
      }),
    ]);

    /*---------------------------------------------------------------
      2. PLAN MIX  •  NEW COMPANIES  •  NEW EMPLOYEES
    ----------------------------------------------------------------*/
    const planMix = {};
    const companiesPerMonth = {};
    companies.forEach((c) => {
      const plan = c.Subscription?.[0]?.plan?.name || "None";
      planMix[plan] = (planMix[plan] || 0) + 1;

      const m = ym(c.createdAt);
      companiesPerMonth[m] = (companiesPerMonth[m] || 0) + 1;
    });

    const hiresPerMonth = {};
    users.forEach((u) => {
      const m = ym(u.createdAt);
      hiresPerMonth[m] = (hiresPerMonth[m] || 0) + 1;
    });

    /*---------------------------------------------------------------
      3. LOCATION  •  DEVICE
    ----------------------------------------------------------------*/
    const sessionsCountry = {};
    const sessionsCity = {};
    const deviceUsage = {};

    timelogs.forEach((log) => {
      const loc = log.location?.start || log.location?.end || {};
      if (loc.country) sessionsCountry[loc.country] = (sessionsCountry[loc.country] || 0) + 1;
      if (loc.city) sessionsCity[loc.city] = (sessionsCity[loc.city] || 0) + 1;

      const dev = (log.deviceInfo?.start?.platform || log.deviceInfo?.end?.platform || "Unknown").toLowerCase();
      let bucket = "web";
      if (dev.includes("android") || dev.includes("ios")) bucket = "mobile";
      else if (dev.includes("tablet")) bucket = "tablet";
      deviceUsage[bucket] = (deviceUsage[bucket] || 0) + 1;
    });

    /*---------------------------------------------------------------
      4. EXECUTIVE KPIs
    ----------------------------------------------------------------*/
    const THIRTY_DAYS = new Date(new Date().setDate(new Date().getDate() - 30));
    const activeUsersSet = new Set(timelogs.filter((t) => new Date(t.timeIn) >= THIRTY_DAYS).map((t) => t.userId));

    const totalActiveUsers = activeUsersSet.size;
    const mrr = payments.reduce((s, p) => s + Number(p.amount), 0).toFixed(2);
    const serverUptime = 99.95; // <-- replace with real monitoring source if available.

    /* -- Top 5 active clients (by distinct active staff in 30 d) --- */
    const activeByCompany = {};
    activeUsersSet.forEach((uid) => {
      const compId = users.find((u) => u.id === uid)?.companyId;
      if (compId) activeByCompany[compId] = (activeByCompany[compId] || 0) + 1;
    });
    const topClients = Object.entries(activeByCompany)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([cid, cnt]) => ({
        company: companies.find((c) => c.id === cid)?.name || cid,
        activeUsers: cnt,
      }));

    /* -- Support tickets per month – returns empty if table absent -- */
    let ticketsPerMonth = [];
    try {
      const tickets = await prisma.supportTicket.findMany({
        select: { createdAt: true },
      });
      const map = {};
      tickets.forEach((t) => {
        const m = ym(t.createdAt);
        map[m] = (map[m] || 0) + 1;
      });
      ticketsPerMonth = Object.entries(map)
        .sort()
        .map(([month, count]) => ({ month, count }));
    } catch (_) {
      /* table not present – ignore */
    }

    /*---------------------------------------------------------------
      5. BUILD RESPONSE
    ----------------------------------------------------------------*/
    const toArr = (obj, k1 = "name", k2 = "value") => Object.entries(obj).map(([a, b]) => ({ [k1]: a, [k2]: b }));

    return res.status(200).json({
      data: {
        planMix: toArr(planMix),
        newCompanies: toArr(companiesPerMonth, "month", "count").sort((a, b) => a.month.localeCompare(b.month)),
        newEmployees: toArr(hiresPerMonth, "month", "count").sort((a, b) => a.month.localeCompare(b.month)),
        sessionsCountry: toArr(sessionsCountry, "country", "count"),
        sessionsCity: toArr(sessionsCity, "city", "count"),
        deviceUsage: toArr(deviceUsage),
        totalActiveUsers,
        mrr: Number(mrr),
        serverUptime,
        topClients,
        ticketsPerMonth,
        totals: {
          companies: companies.length,
          employees: users.length,
          plans: Object.keys(planMix).length,
        },
      },
    });
  } catch (err) {
    console.error("SuperAdminAnalytics error:", err);
    return res.status(500).json({ message: "Internal server error." });
  }
};
