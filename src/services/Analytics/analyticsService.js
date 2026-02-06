// src/services/Analytics/analyticsService.js

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

class AnalyticsService {
  /**
   * Get overview statistics
   */
  async getOverview(timeRange = "24h") {
    const { startDate, endDate } = this.getTimeRange(timeRange);

    const [totalRequests, failedRequests, slowRequests, avgResponseTime, uniqueCounts] =
      await Promise.all([
        prisma.requestLog.count({
          where: { createdAt: { gte: startDate, lte: endDate } },
        }),
        prisma.requestLog.count({
          where: {
            createdAt: { gte: startDate, lte: endDate },
            isFailed: true,
          },
        }),
        prisma.requestLog.count({
          where: {
            createdAt: { gte: startDate, lte: endDate },
            isSlowRequest: true,
          },
        }),
        prisma.requestLog.aggregate({
          where: { createdAt: { gte: startDate, lte: endDate } },
          _avg: { responseTime: true },
        }),
        prisma.requestLog.findMany({
          where: { createdAt: { gte: startDate, lte: endDate } },
          select: { userId: true, companyId: true },
          distinct: ["userId", "companyId"],
        }),
      ]);

    const successfulRequests = totalRequests - failedRequests;
    const errorRate = totalRequests > 0 ? ((failedRequests / totalRequests) * 100).toFixed(2) : "0.00";
    const slowRequestRate = totalRequests > 0 ? ((slowRequests / totalRequests) * 100).toFixed(2) : "0.00";

    const uniqueUsers = new Set(uniqueCounts.filter((r) => r.userId).map((r) => r.userId)).size;
    const uniqueCompanies = new Set(uniqueCounts.filter((r) => r.companyId).map((r) => r.companyId)).size;

    return {
      totalRequests,
      failedRequests,
      slowRequests,
      successfulRequests,
      errorRate,
      slowRequestRate,
      avgResponseTime: Math.round(avgResponseTime._avg.responseTime || 0),
      uniqueUsers,
      uniqueCompanies,
      timeRange,
      startDate,
      endDate,
    };
  }

  /**
   * Get performance metrics per endpoint
   */
  async getPerformanceMetrics(limit = 20, timeRange = "24h") {
    const { startDate, endDate } = this.getTimeRange(timeRange);

    // Use Prisma queries instead of raw SQL to avoid column name issues
    const allRequests = await prisma.requestLog.findMany({
      where: {
        createdAt: { gte: startDate, lte: endDate }
      },
      select: {
        endpoint: true,
        method: true,
        responseTime: true,
        isFailed: true,
        isSlowRequest: true,
      }
    });

    // Group by endpoint and method
    const grouped = {};
    
    allRequests.forEach(req => {
      const key = `${req.endpoint}|${req.method}`;
      
      if (!grouped[key]) {
        grouped[key] = {
          endpoint: req.endpoint,
          method: req.method,
          requestCount: 0,
          totalResponseTime: 0,
          minResponseTime: Infinity,
          maxResponseTime: 0,
          responseTimes: [],
          errorCount: 0,
          slowCount: 0,
        };
      }
      
      grouped[key].requestCount++;
      grouped[key].totalResponseTime += req.responseTime;
      grouped[key].minResponseTime = Math.min(grouped[key].minResponseTime, req.responseTime);
      grouped[key].maxResponseTime = Math.max(grouped[key].maxResponseTime, req.responseTime);
      grouped[key].responseTimes.push(req.responseTime);
      
      if (req.isFailed) grouped[key].errorCount++;
      if (req.isSlowRequest) grouped[key].slowCount++;
    });

    // Calculate percentiles and format
    const endpoints = Object.values(grouped)
      .map(group => {
        const sorted = group.responseTimes.sort((a, b) => a - b);
        const p50Index = Math.floor(sorted.length * 0.5);
        const p95Index = Math.floor(sorted.length * 0.95);
        const p99Index = Math.floor(sorted.length * 0.99);

        return {
          endpoint: group.endpoint,
          method: group.method,
          requestCount: group.requestCount,
          avgResponseTime: Math.round(group.totalResponseTime / group.requestCount),
          minResponseTime: group.minResponseTime,
          maxResponseTime: group.maxResponseTime,
          p50ResponseTime: sorted[p50Index] || 0,
          p95ResponseTime: sorted[p95Index] || 0,
          p99ResponseTime: sorted[p99Index] || 0,
          errorCount: group.errorCount,
          slowCount: group.slowCount,
          errorRate: group.requestCount > 0
            ? ((group.errorCount / group.requestCount) * 100).toFixed(2)
            : "0.00",
        };
      })
      .sort((a, b) => b.requestCount - a.requestCount)
      .slice(0, limit);

    // Get slowest endpoints
    const slowestEndpoints = Object.values(grouped)
      .filter(group => group.requestCount >= 5)
      .map(group => ({
        endpoint: group.endpoint,
        method: group.method,
        request_count: group.requestCount,
        avg_response_time: Math.round(group.totalResponseTime / group.requestCount),
        max_response_time: group.maxResponseTime,
      }))
      .sort((a, b) => b.avg_response_time - a.avg_response_time)
      .slice(0, 10);

    return {
      endpoints,
      slowestEndpoints,
    };
  }

  /**
   * Get slowest endpoints
   */
  async getSlowestEndpoints(limit = 10, timeRange = "24h") {
    const { startDate, endDate } = this.getTimeRange(timeRange);

    const allRequests = await prisma.requestLog.findMany({
      where: {
        createdAt: { gte: startDate, lte: endDate }
      },
      select: {
        endpoint: true,
        method: true,
        responseTime: true,
      }
    });

    const grouped = {};
    
    allRequests.forEach(req => {
      const key = `${req.endpoint}|${req.method}`;
      
      if (!grouped[key]) {
        grouped[key] = {
          endpoint: req.endpoint,
          method: req.method,
          count: 0,
          totalResponseTime: 0,
          maxResponseTime: 0,
        };
      }
      
      grouped[key].count++;
      grouped[key].totalResponseTime += req.responseTime;
      grouped[key].maxResponseTime = Math.max(grouped[key].maxResponseTime, req.responseTime);
    });

    const slowest = Object.values(grouped)
      .filter(group => group.count >= 5)
      .map(group => ({
        endpoint: group.endpoint,
        method: group.method,
        request_count: group.count,
        avg_response_time: Math.round(group.totalResponseTime / group.count),
        max_response_time: group.maxResponseTime,
      }))
      .sort((a, b) => b.avg_response_time - a.avg_response_time)
      .slice(0, limit);

    return slowest;
  }

  /**
   * Get error statistics
   */
  async getErrorStats(timeRange = "24h") {
    const { startDate, endDate } = this.getTimeRange(timeRange);

    const failedRequests = await prisma.requestLog.findMany({
      where: {
        createdAt: { gte: startDate, lte: endDate },
        isFailed: true,
      },
      select: {
        endpoint: true,
        method: true,
        statusCode: true,
        errorType: true,
      }
    });

    // Group by endpoint
    const byEndpoint = {};
    failedRequests.forEach(req => {
      const key = `${req.endpoint}|${req.method}|${req.statusCode}`;
      if (!byEndpoint[key]) {
        byEndpoint[key] = {
          endpoint: req.endpoint,
          method: req.method,
          status_code: req.statusCode,
          error_count: 0,
        };
      }
      byEndpoint[key].error_count++;
    });

    const errorsByEndpoint = Object.values(byEndpoint)
      .sort((a, b) => b.error_count - a.error_count)
      .slice(0, 20);

    // Group by error type
    const byType = {};
    failedRequests.forEach(req => {
      if (req.errorType) {
        if (!byType[req.errorType]) {
          byType[req.errorType] = { errorType: req.errorType, count: 0 };
        }
        byType[req.errorType].count++;
      }
    });

    const errorsByType = Object.values(byType)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Group by status code
    const byStatusCode = {};
    failedRequests.forEach(req => {
      if (!byStatusCode[req.statusCode]) {
        byStatusCode[req.statusCode] = { statusCode: req.statusCode, count: 0 };
      }
      byStatusCode[req.statusCode].count++;
    });

    const errorsByStatusCode = Object.values(byStatusCode)
      .sort((a, b) => b.count - a.count);

    return {
      errorsByEndpoint,
      errorsByType,
      errorsByStatusCode,
    };
  }

  /**
   * Get user activity statistics
   */
  async getUserActivity(limit = 20, timeRange = "24h") {
    const { startDate, endDate } = this.getTimeRange(timeRange);

    const requests = await prisma.requestLog.findMany({
      where: {
        createdAt: { gte: startDate, lte: endDate },
        userId: { not: null },
      },
      include: {
        user: {
          select: { username: true, email: true, role: true }
        },
        company: {
          select: { name: true }
        }
      }
    });

    const grouped = {};
    requests.forEach(req => {
      if (!grouped[req.userId]) {
        grouped[req.userId] = {
          user_id: req.userId,
          username: req.user?.username,
          email: req.user?.email,
          role: req.user?.role,
          company_name: req.company?.name,
          request_count: 0,
          failed_count: 0,
          totalResponseTime: 0,
        };
      }
      
      grouped[req.userId].request_count++;
      grouped[req.userId].totalResponseTime += req.responseTime;
      if (req.isFailed) grouped[req.userId].failed_count++;
    });

    const userActivity = Object.values(grouped)
      .map(user => ({
        ...user,
        avg_response_time: Math.round(user.totalResponseTime / user.request_count),
      }))
      .sort((a, b) => b.request_count - a.request_count)
      .slice(0, limit);

    return userActivity;
  }

  /**
   * Get company metrics
   */
  async getCompanyMetrics(limit = 20, timeRange = "24h") {
    const { startDate, endDate } = this.getTimeRange(timeRange);

    const requests = await prisma.requestLog.findMany({
      where: {
        createdAt: { gte: startDate, lte: endDate },
        companyId: { not: null },
      },
      include: {
        company: {
          select: { name: true }
        }
      },
      select: {
        companyId: true,
        userId: true,
        responseTime: true,
        isFailed: true,
        company: true,
      }
    });

    const grouped = {};
    requests.forEach(req => {
      if (!grouped[req.companyId]) {
        grouped[req.companyId] = {
          company_id: req.companyId,
          company_name: req.company?.name,
          request_count: 0,
          unique_users: new Set(),
          failed_count: 0,
          totalResponseTime: 0,
        };
      }
      
      grouped[req.companyId].request_count++;
      grouped[req.companyId].totalResponseTime += req.responseTime;
      if (req.userId) grouped[req.companyId].unique_users.add(req.userId);
      if (req.isFailed) grouped[req.companyId].failed_count++;
    });

    const companyMetrics = Object.values(grouped)
      .map(company => ({
        company_id: company.company_id,
        company_name: company.company_name,
        request_count: company.request_count,
        active_users: company.unique_users.size,
        failed_count: company.failed_count,
        avg_response_time: Math.round(company.totalResponseTime / company.request_count),
      }))
      .sort((a, b) => b.request_count - a.request_count)
      .slice(0, limit);

    return companyMetrics;
  }

  /**
   * Get hourly trends
   */
  async getHourlyTrends(timeRange = "24h") {
    const { startDate, endDate } = this.getTimeRange(timeRange);

    const requests = await prisma.requestLog.findMany({
      where: {
        createdAt: { gte: startDate, lte: endDate }
      },
      select: {
        createdAt: true,
        responseTime: true,
        isFailed: true,
        isSlowRequest: true,
      },
      orderBy: {
        createdAt: 'asc'
      }
    });

    // Group by hour
    const grouped = {};
    requests.forEach(req => {
      const hour = new Date(req.createdAt);
      hour.setMinutes(0, 0, 0);
      const hourKey = hour.toISOString();
      
      if (!grouped[hourKey]) {
        grouped[hourKey] = {
          hour: hour,
          request_count: 0,
          totalResponseTime: 0,
          error_count: 0,
          slow_count: 0,
        };
      }
      
      grouped[hourKey].request_count++;
      grouped[hourKey].totalResponseTime += req.responseTime;
      if (req.isFailed) grouped[hourKey].error_count++;
      if (req.isSlowRequest) grouped[hourKey].slow_count++;
    });

    const trends = Object.values(grouped)
      .map(group => ({
        hour: group.hour,
        request_count: group.request_count,
        avg_response_time: Math.round(group.totalResponseTime / group.request_count),
        error_count: group.error_count,
        slow_count: group.slow_count,
      }))
      .sort((a, b) => a.hour - b.hour);

    return trends;
  }

  /**
   * Get security alerts
   */
  async getSecurityAlerts(timeRange = "24h") {
    const { startDate, endDate } = this.getTimeRange(timeRange);

    const allRequests = await prisma.requestLog.findMany({
      where: {
        createdAt: { gte: startDate, lte: endDate }
      },
      select: {
        ipAddress: true,
        statusCode: true,
        endpoint: true,
        method: true,
        userId: true,
        createdAt: true,
      }
    });

    // Failed logins (401 on login/auth endpoints)
    const loginAttempts = {};
    allRequests
      .filter(req => req.statusCode === 401 && (req.endpoint.includes('login') || req.endpoint.includes('auth')))
      .forEach(req => {
        if (!loginAttempts[req.ipAddress]) {
          loginAttempts[req.ipAddress] = {
            ip_address: req.ipAddress,
            failed_attempts: 0,
            last_attempt: req.createdAt,
          };
        }
        loginAttempts[req.ipAddress].failed_attempts++;
        if (req.createdAt > loginAttempts[req.ipAddress].last_attempt) {
          loginAttempts[req.ipAddress].last_attempt = req.createdAt;
        }
      });

    const failedLogins = Object.values(loginAttempts)
      .filter(item => item.failed_attempts > 5)
      .sort((a, b) => b.failed_attempts - a.failed_attempts)
      .slice(0, 20);

    // High request rates
    const ipCounts = {};
    allRequests.forEach(req => {
      if (!ipCounts[req.ipAddress]) {
        ipCounts[req.ipAddress] = {
          ip_address: req.ipAddress,
          request_count: 0,
          unique_endpoints: new Set(),
        };
      }
      ipCounts[req.ipAddress].request_count++;
      ipCounts[req.ipAddress].unique_endpoints.add(req.endpoint);
    });

    const highRequestRates = Object.values(ipCounts)
      .map(item => ({
        ip_address: item.ip_address,
        request_count: item.request_count,
        unique_endpoints: item.unique_endpoints.size,
      }))
      .filter(item => item.request_count > 1000)
      .sort((a, b) => b.request_count - a.request_count)
      .slice(0, 20);

    // Unauthorized access (403)
    const unauthorizedAttempts = {};
    allRequests
      .filter(req => req.statusCode === 403)
      .forEach(req => {
        const key = `${req.endpoint}|${req.method}|${req.ipAddress}|${req.userId}`;
        if (!unauthorizedAttempts[key]) {
          unauthorizedAttempts[key] = {
            endpoint: req.endpoint,
            method: req.method,
            ip_address: req.ipAddress,
            user_id: req.userId,
            attempt_count: 0,
          };
        }
        unauthorizedAttempts[key].attempt_count++;
      });

    const unauthorizedAccess = Object.values(unauthorizedAttempts)
      .sort((a, b) => b.attempt_count - a.attempt_count)
      .slice(0, 20);

    return {
      failedLogins,
      highRequestRates,
      unauthorizedAccess,
    };
  }

  /**
   * Get raw request logs with filters
   */
  async getRequestLogs(filters = {}, page = 1, limit = 50) {
    const skip = (page - 1) * limit;

    const where = {
      ...(filters.startDate && filters.endDate
        ? { createdAt: { gte: new Date(filters.startDate), lte: new Date(filters.endDate) } }
        : {}),
      ...(filters.userId ? { userId: filters.userId } : {}),
      ...(filters.companyId ? { companyId: filters.companyId } : {}),
      ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
      ...(filters.endpoint ? { endpoint: { contains: filters.endpoint } } : {}),
      ...(filters.method ? { method: filters.method } : {}),
      ...(filters.statusCode ? { statusCode: parseInt(filters.statusCode) } : {}),
      ...(filters.isFailed === "true" ? { isFailed: true } : {}),
      ...(filters.isSlowRequest === "true" ? { isSlowRequest: true } : {}),
    };

    const [logs, total] = await Promise.all([
      prisma.requestLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        include: {
          user: {
            select: { username: true, email: true, role: true },
          },
          company: {
            select: { name: true },
          },
        },
      }),
      prisma.requestLog.count({ where }),
    ]);

    return {
      logs,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Helper: Convert time range to start/end dates
   */
  getTimeRange(range) {
    const now = new Date();
    let startDate;

    switch (range) {
      case "1h":
        startDate = new Date(now.getTime() - 1 * 60 * 60 * 1000);
        break;
      case "6h":
        startDate = new Date(now.getTime() - 6 * 60 * 60 * 1000);
        break;
      case "24h":
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case "7d":
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case "30d":
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    }

    return { startDate, endDate: now };
  }
}

module.exports = new AnalyticsService();