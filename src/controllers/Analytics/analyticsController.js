// src/controllers/Analytics/analyticsController.js

const analyticsService = require("@services/Analytics/analyticsService");
const { getLoggerStats } = require("@middlewares/requestLogger");

class AnalyticsController {
  /**
   * GET /api/analytics/system/overview
   * Dashboard overview statistics
   */
  async getOverview(req, res, next) {
    try {
      const { timeRange = "24h" } = req.query;

      const overview = await analyticsService.getOverview(timeRange);

      res.status(200).json({
        success: true,
        data: overview,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/system/performance
   * Performance metrics by endpoint
   */
  async getPerformance(req, res, next) {
    try {
      const { limit = 20, timeRange = "24h" } = req.query;

      const [metrics, slowest] = await Promise.all([
        analyticsService.getPerformanceMetrics(parseInt(limit), timeRange),
        analyticsService.getSlowestEndpoints(10, timeRange),
      ]);

      res.status(200).json({
        success: true,
        data: {
          endpoints: metrics,
          slowestEndpoints: slowest,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/system/errors
   * Error tracking and analysis
   */
  async getErrors(req, res, next) {
    try {
      const { timeRange = "24h" } = req.query;

      const errorStats = await analyticsService.getErrorStats(timeRange);

      res.status(200).json({
        success: true,
        data: errorStats,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/system/users
   * User activity metrics (API usage)
   */
  async getUserActivity(req, res, next) {
    try {
      const { limit = 20, timeRange = "24h" } = req.query;

      const userActivity = await analyticsService.getUserActivity(parseInt(limit), timeRange);

      res.status(200).json({
        success: true,
        data: userActivity,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/system/companies
   * Company-level metrics (API usage)
   */
  async getCompanyMetrics(req, res, next) {
    try {
      const { limit = 20, timeRange = "24h" } = req.query;

      const companyMetrics = await analyticsService.getCompanyMetrics(parseInt(limit), timeRange);

      res.status(200).json({
        success: true,
        data: companyMetrics,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/system/trends
   * Hourly trends
   */
  async getTrends(req, res, next) {
    try {
      const { timeRange = "24h" } = req.query;

      const trends = await analyticsService.getHourlyTrends(timeRange);

      res.status(200).json({
        success: true,
        data: trends,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/system/security
   * Security monitoring and alerts
   */
  async getSecurityAlerts(req, res, next) {
    try {
      const { timeRange = "24h" } = req.query;

      const alerts = await analyticsService.getSecurityAlerts(timeRange);

      res.status(200).json({
        success: true,
        data: alerts,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/system/requests
   * Raw request logs (paginated, filterable)
   */
  async getRequestLogs(req, res, next) {
    try {
      const { page = 1, limit = 50, ...filters } = req.query;

      const result = await analyticsService.getRequestLogs(
        filters,
        parseInt(page),
        parseInt(limit)
      );

      res.status(200).json({
        success: true,
        data: result.logs,
        pagination: result.pagination,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/system/logger-health
   * Logger system health check
   */
  async getLoggerHealth(req, res, next) {
    try {
      const stats = getLoggerStats();

      res.status(200).json({
        success: true,
        data: {
          status: parseFloat(stats.successRate) > 90 ? "healthy" : "degraded",
          ...stats,
        },
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new AnalyticsController();