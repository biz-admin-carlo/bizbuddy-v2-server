// src/controllers/Features/feedbackController.js

const { prisma } = require("@config/connection");
const https = require("https");
const http = require("http");
const { URL } = require("url");

const VALID_CATEGORIES = ["bug", "suggestion", "question", "other"];

const CATEGORY_LABELS = {
  bug:        "Bug Report",
  suggestion: "Suggestion",
  question:   "Question",
  other:      "Other",
};

// ── UA Parser (no external dependencies) ────────────────────────────────────

const parseUserAgent = (ua) => {
  if (!ua) return { browser: null, os: null, device: null };

  // Browser
  let browser = "Unknown";
  if (/Edg\/(\d+)/.test(ua))                          browser = `Edge ${ua.match(/Edg\/(\d+)/)[1]}`;
  else if (/OPR\/(\d+)/.test(ua))                     browser = `Opera ${ua.match(/OPR\/(\d+)/)[1]}`;
  else if (/Chrome\/(\d+)/.test(ua))                  browser = `Chrome ${ua.match(/Chrome\/(\d+)/)[1]}`;
  else if (/Firefox\/(\d+)/.test(ua))                 browser = `Firefox ${ua.match(/Firefox\/(\d+)/)[1]}`;
  else if (/Version\/(\d+).*Safari/.test(ua))         browser = `Safari ${ua.match(/Version\/(\d+)/)[1]}`;
  else if (/Safari/.test(ua))                         browser = "Safari";
  else if (/MSIE (\d+)|Trident.*rv:(\d+)/.test(ua))  browser = `IE ${ua.match(/MSIE (\d+)|rv:(\d+)/)[1] || ua.match(/MSIE (\d+)|rv:(\d+)/)[2]}`;

  // OS
  let os = "Unknown";
  if (/iPhone OS ([\d_]+)/.test(ua))       os = `iOS ${ua.match(/iPhone OS ([\d_]+)/)[1].replace(/_/g, ".")}`;
  else if (/iPad.*OS ([\d_]+)/.test(ua))   os = `iPadOS ${ua.match(/OS ([\d_]+)/)[1].replace(/_/g, ".")}`;
  else if (/Android ([\d.]+)/.test(ua))    os = `Android ${ua.match(/Android ([\d.]+)/)[1]}`;
  else if (/Windows NT 10/.test(ua))       os = "Windows 10/11";
  else if (/Windows NT 6\.3/.test(ua))     os = "Windows 8.1";
  else if (/Windows NT 6\.1/.test(ua))     os = "Windows 7";
  else if (/Mac OS X ([\d_]+)/.test(ua))   os = `macOS ${ua.match(/Mac OS X ([\d_]+)/)[1].replace(/_/g, ".")}`;
  else if (/Linux/.test(ua))               os = "Linux";

  // Device
  let device = "Desktop";
  if (/iPad/.test(ua))                             device = "Tablet";
  else if (/Mobi|Android|iPhone|iPod/.test(ua))   device = "Mobile";

  return { browser, os, device };
};

// ── Webhook (redirect-aware) ─────────────────────────────────────────────────

const doRequest = (urlString, payload, redirectCount = 0) => {
  if (redirectCount > 5) {
    console.error("[feedback] Webhook: too many redirects.");
    return;
  }

  const parsed = new URL(urlString);
  const transport = parsed.protocol === "https:" ? https : http;

  const reqOptions = {
    hostname: parsed.hostname,
    port:     parsed.port || (parsed.protocol === "https:" ? 443 : 80),
    path:     parsed.pathname + parsed.search,
    method:   "POST",
    headers: {
      "Content-Type":   "application/json",
      "Content-Length": Buffer.byteLength(payload),
    },
  };

  const req = transport.request(reqOptions, (res) => {
    let body = "";
    res.on("data", (chunk) => { body += chunk; });
    res.on("end", () => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        doRequest(res.headers.location, payload, redirectCount + 1);
      } else if (res.statusCode < 200 || res.statusCode >= 300) {
        const preview = body.replace(/<[^>]+>/g, "").trim().slice(0, 120);
        console.error(`[feedback] Webhook rejected — ${res.statusCode}${preview ? `: ${preview}` : ""}`);
      } else {
        console.log(`[feedback] Webhook delivered — ${res.statusCode}`);
      }
    });
  });

  req.on("error", (err) => {
    console.error("[feedback] Webhook error:", err.message);
  });

  req.write(payload);
  req.end();
};

const fireWebhook = (feedback, resolvedSubmittedBy) => {
  const webhookUrl = process.env.FEEDBACK_WEBHOOK_URL;
  if (!webhookUrl) return;

  try {
    const payload = JSON.stringify({
      logNumber:     feedback.logNumber,
      id:            feedback.id,
      category:      CATEGORY_LABELS[feedback.category] || feedback.category,
      title:         feedback.title,
      description:   feedback.description,
      page:          feedback.page || "",
      submittedAt:   feedback.submittedAt
        ? feedback.submittedAt.toISOString()
        : feedback.createdAt.toISOString(),
      status:        "Open",
      employeeName:  resolvedSubmittedBy.name,
      employeeEmail: resolvedSubmittedBy.email,
      employeeRole:  resolvedSubmittedBy.role,
      browser:       feedback.browser  || "",
      os:            feedback.os       || "",
      device:        feedback.device   || "",
      resolution:    feedback.screenResolution || "",
    });

    doRequest(webhookUrl, payload);
  } catch (err) {
    console.error("[feedback] Failed to fire webhook:", err.message);
  }
};

// ── POST /api/feedback ───────────────────────────────────────────────────────

exports.submitFeedback = async (req, res) => {
  try {
    const {
      category, title, description, page,
      submittedAt, submittedBy, userAgent, screenResolution,
    } = req.body;
    const { id: userId, companyId } = req.user;

    if (!category || !title || !description) {
      return res.status(400).json({ error: "category, title, and description are required." });
    }

    if (!VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: `category must be one of: ${VALID_CATEGORIES.join(", ")}.` });
    }

    if (title.trim().length < 3) {
      return res.status(400).json({ error: "title must be at least 3 characters." });
    }

    const { browser, os, device } = parseUserAgent(userAgent || req.headers["user-agent"]);

    const feedback = await prisma.feedback.create({
      data: {
        companyId,
        userId,
        category,
        title:           title.trim(),
        description:     description.trim(),
        page:            page        || null,
        submittedAt:     submittedAt ? new Date(submittedAt) : null,
        userAgent:       userAgent   || req.headers["user-agent"] || null,
        screenResolution: screenResolution || null,
        browser,
        os,
        device,
      },
    });

    // Resolve submitter info
    let fullName = submittedBy?.name || "";
    if (!fullName) {
      const profile = await prisma.userProfile.findUnique({
        where: { userId },
        select: { firstName: true, lastName: true },
      });
      if (profile) {
        fullName = `${profile.firstName || ""} ${profile.lastName || ""}`.trim();
      }
    }

    const resolvedSubmittedBy = {
      name:  fullName,
      email: submittedBy?.email || req.user.email || "",
      role:  submittedBy?.role  || req.user.role  || "",
    };

    fireWebhook(feedback, resolvedSubmittedBy);

    return res.status(201).json({
      message: "Feedback submitted successfully.",
      data: { id: feedback.id, logNumber: feedback.logNumber },
    });
  } catch (err) {
    console.error("[feedback] submitFeedback error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
};
