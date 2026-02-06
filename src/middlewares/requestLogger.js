// src/middlewares/requestLogger.js

const { PrismaClient } = require("@prisma/client");
const jwt = require("jsonwebtoken");
const logger = require("@config/logger");

const prisma = new PrismaClient();

// Sensitive fields to exclude from logging
const SENSITIVE_FIELDS = [
  "password",
  "token",
  "apiKey",
  "secret",
  "creditCard",
  "ssn",
  "ssnItin",
  "accessToken",
  "refreshToken",
  "authorization",
];

/**
 * Sanitize request body by removing sensitive fields
 */
function sanitizeObject(obj) {
  if (!obj || typeof obj !== "object") return obj;

  const sanitized = Array.isArray(obj) ? [...obj] : { ...obj };

  for (const key in sanitized) {
    if (SENSITIVE_FIELDS.some((field) => key.toLowerCase().includes(field))) {
      sanitized[key] = "[REDACTED]";
    } else if (typeof sanitized[key] === "object") {
      sanitized[key] = sanitizeObject(sanitized[key]);
    }
  }

  return sanitized;
}

/**
 * Extract user context from JWT token
 */
function extractUserContext(req) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return { userId: null, companyId: null, departmentId: null, userRole: null };
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    return {
      userId: decoded.userId || decoded.id || null,
      companyId: decoded.companyId || null,
      departmentId: decoded.departmentId || null,
      userRole: decoded.role || null,
    };
  } catch (error) {
    // Token invalid or expired - not an error, just anonymous request
    return { userId: null, companyId: null, departmentId: null, userRole: null };
  }
}

/**
 * Normalize endpoint by replacing IDs with placeholders
 * Example: /api/employee/cuid123 -> /api/employee/:id
 */
function normalizeEndpoint(url) {
  if (!url) return null;

  // Remove query parameters
  const path = url.split("?")[0];

  // Replace common ID patterns
  return path
    .replace(/\/[a-z0-9]{20,}/gi, "/:id") // CUID (20-25 chars)
    .replace(/\/[0-9]+/g, "/:id") // Numeric IDs
    .replace(/\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi, "/:uuid"); // UUIDs
}

/**
 * Get client IP address (supports proxies)
 */
function getClientIp(req) {
  return (
    req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
    req.headers["x-real-ip"] ||
    req.connection.remoteAddress ||
    req.socket.remoteAddress ||
    null
  );
}

/**
 * Main request logger middleware
 * Captures request start time and attaches cleanup function
 */
function requestLogger(req, res, next) {
  const startTime = Date.now();

  // Extract user context from JWT
  const userContext = extractUserContext(req);
  req.userContext = userContext; // Attach to request for use in other middleware

  // Capture original end function
  const originalEnd = res.end;

  // Override res.end to log after response is sent
  res.end = function (chunk, encoding) {
    // Restore original end
    res.end = originalEnd;

    // Call original end
    res.end(chunk, encoding);

    // Calculate response time
    const responseTime = Date.now() - startTime;

    // Log to database asynchronously (non-blocking)
    setImmediate(() => {
      saveRequestLog({
        req,
        res,
        responseTime,
        userContext,
      });
    });
  };

  next();
}

/**
 * Save request log to database (async, non-blocking)
 */
async function saveRequestLog({ req, res, responseTime, userContext }) {
  try {
    const statusCode = res.statusCode;
    const isError = statusCode >= 400;
    const isSlowRequest = responseTime > 1000; // Slow if > 1 second

    // Prepare log data
    const logData = {
      method: req.method,
      url: req.originalUrl || req.url,
      endpoint: normalizeEndpoint(req.originalUrl || req.url),
      statusCode,
      responseTime,
      userId: userContext.userId,
      companyId: userContext.companyId,
      departmentId: userContext.departmentId,
      userRole: userContext.userRole,
      ipAddress: getClientIp(req),
      userAgent: req.headers["user-agent"] || null,
      queryParams: Object.keys(req.query || {}).length > 0 ? req.query : null,
      requestBody:
        req.method === "POST" || req.method === "PUT" || req.method === "PATCH"
          ? sanitizeObject(req.body)
          : null,
      isSlowRequest,
      isFailed: isError,
      environment: process.env.NODE_ENV || "development",
      serverInstance: process.env.SERVER_INSTANCE || "server-1",
    };

    // Add error details if request failed
    if (isError && req.error) {
      logData.errorMessage = req.error.message || null;
      logData.errorStack = req.error.stack || null;
      logData.errorType = req.error.name || "Error";
    }

    // Save to database
    await prisma.requestLog.create({
      data: logData,
    });

    // Log slow requests to console for immediate attention
    if (isSlowRequest) {
      logger.warn(
        `🐌 Slow Request: ${req.method} ${logData.endpoint} - ${responseTime}ms`
      );
    }

    // Log errors to console
    if (isError) {
      logger.error(
        `❌ Failed Request: ${req.method} ${logData.endpoint} - Status ${statusCode}`
      );
    }
  } catch (error) {
    // Don't fail the request if logging fails
    logger.error(`Failed to save request log: ${error.message}`);
  }
}

/**
 * Error logger middleware - captures error details
 * Should be placed BEFORE your error handler
 */
function errorLogger(err, req, res, next) {
  // Attach error to request for logging
  req.error = {
    message: err.message,
    stack: err.stack,
    name: err.name || "Error",
  };

  // Log error to Winston
  logger.error(`${err.name}: ${err.message}`);
  if (process.env.NODE_ENV === "development") {
    logger.error(err.stack);
  }

  next(err);
}

// Add this at the top of the file
let failedLogCount = 0;
let totalLogCount = 0;
let lastAlertTime = 0;

// Modify saveRequestLog function to track failures
async function saveRequestLog({ req, res, responseTime, userContext }) {
  totalLogCount++;
  
  try {
    const statusCode = res.statusCode;
    const isError = statusCode >= 400;
    const isSlowRequest = responseTime > 1000;

    const logData = {
      method: req.method,
      url: req.originalUrl || req.url,
      endpoint: normalizeEndpoint(req.originalUrl || req.url),
      statusCode,
      responseTime,
      userId: userContext.userId,
      companyId: userContext.companyId,
      departmentId: userContext.departmentId,
      userRole: userContext.userRole,
      ipAddress: getClientIp(req),
      userAgent: req.headers["user-agent"] || null,
      queryParams: Object.keys(req.query || {}).length > 0 ? req.query : null,
      requestBody:
        req.method === "POST" || req.method === "PUT" || req.method === "PATCH"
          ? sanitizeObject(req.body)
          : null,
      isSlowRequest,
      isFailed: isError,
      environment: process.env.NODE_ENV || "development",
      serverInstance: process.env.SERVER_INSTANCE || "server-1",
    };

    if (isError && req.error) {
      logData.errorMessage = req.error.message || null;
      logData.errorStack = req.error.stack || null;
      logData.errorType = req.error.name || "Error";
    }

    await prisma.requestLog.create({
      data: logData,
    });

    // Log slow requests to console
    if (isSlowRequest) {
      logger.warn(
        `🐌 Slow Request: ${req.method} ${logData.endpoint} - ${responseTime}ms`
      );
    }

    // Log errors to console
    if (isError) {
      logger.error(
        `❌ Failed Request: ${req.method} ${logData.endpoint} - Status ${statusCode}`
      );
    }
  } catch (error) {
    failedLogCount++;
    
    // Calculate failure rate
    const failureRate = (failedLogCount / totalLogCount) * 100;
    
    // Alert if failure rate > 10% and we haven't alerted in last 5 minutes
    const now = Date.now();
    if (failureRate > 10 && now - lastAlertTime > 300000) {
      logger.error(
        `⚠️  HIGH LOG FAILURE RATE: ${failureRate.toFixed(2)}% (${failedLogCount}/${totalLogCount}) - Check database connection!`
      );
      lastAlertTime = now;
    }
    
    // Don't fail the request if logging fails
    logger.error(`Failed to save request log: ${error.message}`);
  }
}

// Export stats endpoint function (we'll use this in analytics)
function getLoggerStats() {
  return {
    totalLogs: totalLogCount,
    failedLogs: failedLogCount,
    successRate: totalLogCount > 0 ? ((totalLogCount - failedLogCount) / totalLogCount * 100).toFixed(2) : 100,
    lastAlertTime: lastAlertTime ? new Date(lastAlertTime).toISOString() : null,
  };
}

module.exports = {
  requestLogger,
  errorLogger,
  getLoggerStats,
};