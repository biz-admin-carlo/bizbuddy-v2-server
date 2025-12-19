// src/controllers/Account/companySettingsController.js
const { prisma } = require("@config/connection");

exports.getSettings = async (req, res) => {
  try {
    const company = await prisma.company.findFirst({
      where: { id: req.user.companyId },
      select: {
        id: true,
        name: true,
        defaultShiftHours: true,
        minimumLunchMinutes: true,
        country: true,
        currency: true,
        language: true,
        timeZone: true,
      },
    });
    const formatted = {
      ...company,
      timezone: company.timeZone, 
    };

    delete formatted.timeZone;

    return res.json({ data: formatted });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};

exports.updateSettings = async (req, res) => {
  try {
    if (!["admin", "superadmin"].includes(req.user.role))
      return res.status(403).json({ error: "Forbidden" });

    if (req.body.timezone && !req.body.timeZone) {
      req.body.timeZone = req.body.timezone;
    }

    const {
      defaultShiftHours,
      minimumLunchMinutes,
      gracePeriodMinutes,
      country,
      currency,
      language,
      timeZone,
    } = req.body;

    const updated = await prisma.company.update({
      where: { id: req.user.companyId },
      data: {
        ...(defaultShiftHours !== undefined && {
          defaultShiftHours:
            defaultShiftHours === null ? null : Number(defaultShiftHours) || null,
        }),
        ...(minimumLunchMinutes !== undefined && {
          minimumLunchMinutes:
            minimumLunchMinutes === null
              ? null
              : Number(minimumLunchMinutes) || 0,
        }),
        // ✅ NEW: Grace period update logic
        ...(gracePeriodMinutes !== undefined && {
          gracePeriodMinutes:
            gracePeriodMinutes === null
              ? 15  // Default to 15 if set to null
              : Number(gracePeriodMinutes) || 15,
        }),
        ...(timeZone !== undefined && { timeZone }),
        country,
        currency,
        language,
      },
      select: {
        id: true,
        defaultShiftHours: true,
        minimumLunchMinutes: true,
        gracePeriodMinutes: true,  
        country: true,
        currency: true,
        language: true,
        timeZone: true,
      },
    });
    
    console.log('[✅ Company settings updated]', updated);
    res.json({ data: updated });
  } catch (e) {
    console.error("updateSettings error:", e);
    res.status(400).json({ error: e.message });
  }
};