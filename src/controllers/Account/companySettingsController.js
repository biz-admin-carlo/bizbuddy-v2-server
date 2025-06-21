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
      },
    });
    if (!company) return res.status(404).json({ error: "Company not found" });
    res.json({ data: company });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};

exports.updateSettings = async (req, res) => {
  try {
    if (!["admin", "superadmin"].includes(req.user.role)) return res.status(403).json({ error: "Forbidden" });

    const { defaultShiftHours, minimumLunchMinutes, country, currency, language } = req.body;

    const updated = await prisma.company.update({
      where: { id: req.user.companyId },
      data: {
        ...(defaultShiftHours !== undefined && {
          defaultShiftHours: defaultShiftHours === null ? null : Number(defaultShiftHours) || null,
        }),
        ...(minimumLunchMinutes !== undefined && {
          minimumLunchMinutes: minimumLunchMinutes === null ? null : Number(minimumLunchMinutes) || 0,
        }),
        country,
        currency,
        language,
      },
      select: {
        id: true,
        defaultShiftHours: true,
        minimumLunchMinutes: true,
        country: true,
        currency: true,
        language: true,
      },
    });

    res.json({ data: updated });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};
