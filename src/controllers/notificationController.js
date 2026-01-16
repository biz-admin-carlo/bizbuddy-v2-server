const { prisma } = require('@config/connection');

/**
 * Get user's notifications (paginated)
 */
exports.getNotifications = async (req, res) => {
  try {
    const { id: userId } = req.user;
    const { page = 1, limit = 20, seen } = req.query;

    const skip = (page - 1) * limit;
    const where = { userId };

    if (seen !== undefined) {
      where.seen = seen === 'true';
    }

    const [notifications, total] = await Promise.all([
      prisma.notificationLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: parseInt(skip),
        take: parseInt(limit),
      }),
      prisma.notificationLog.count({ where }),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        notifications,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    console.error('❌ Error fetching notifications:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch notifications',
    });
  }
};

/**
 * Get unread notification count
 */
exports.getUnreadCount = async (req, res) => {
  try {
    const { id: userId } = req.user;

    const count = await prisma.notificationLog.count({
      where: {
        userId,
        seen: false,
      },
    });

    return res.status(200).json({
      success: true,
      data: { count },
    });
  } catch (error) {
    console.error('❌ Error getting unread count:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get unread count',
    });
  }
};

/**
 * Mark notification as seen
 */
exports.markAsSeen = async (req, res) => {
  try {
    const { id: userId } = req.user;
    const { id: notificationId } = req.params;

    const notification = await prisma.notificationLog.findFirst({
      where: {
        id: notificationId,
        userId,
      },
    });

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found',
      });
    }

    const updated = await prisma.notificationLog.update({
      where: { id: notificationId },
      data: {
        seen: true,
        seenAt: new Date(),
      },
    });

    return res.status(200).json({
      success: true,
      data: updated,
    });
  } catch (error) {
    console.error('❌ Error marking notification as seen:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to mark notification as seen',
    });
  }
};

/**
 * Mark all notifications as seen
 */
exports.markAllAsSeen = async (req, res) => {
  try {
    const { id: userId } = req.user;

    const result = await prisma.notificationLog.updateMany({
      where: {
        userId,
        seen: false,
      },
      data: {
        seen: true,
        seenAt: new Date(),
      },
    });

    return res.status(200).json({
      success: true,
      message: `${result.count} notifications marked as seen`,
      data: { count: result.count },
    });
  } catch (error) {
    console.error('❌ Error marking all as seen:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to mark all notifications as seen',
    });
  }
};

/**
 * Delete notification
 */
exports.deleteNotification = async (req, res) => {
  try {
    const { id: userId } = req.user;
    const { id: notificationId } = req.params;

    const notification = await prisma.notificationLog.findFirst({
      where: {
        id: notificationId,
        userId,
      },
    });

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found',
      });
    }

    await prisma.notificationLog.delete({
      where: { id: notificationId },
    });

    return res.status(200).json({
      success: true,
      message: 'Notification deleted',
    });
  } catch (error) {
    console.error('❌ Error deleting notification:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete notification',
    });
  }
};

/**
 * Clear all notifications
 */
exports.clearAllNotifications = async (req, res) => {
  try {
    const { id: userId } = req.user;

    const result = await prisma.notificationLog.deleteMany({
      where: { userId },
    });

    return res.status(200).json({
      success: true,
      message: `${result.count} notifications cleared`,
      data: { count: result.count },
    });
  } catch (error) {
    console.error('❌ Error clearing notifications:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to clear notifications',
    });
  }
};