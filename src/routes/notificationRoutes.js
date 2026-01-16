const express = require('express');
const router = express.Router();
const authenticate = require("@middlewares/authMiddleware");
const notificationController = require('@controllers/notificationController');

router.get('/', authenticate, notificationController.getNotifications);
router.get('/unread-count', authenticate, notificationController.getUnreadCount);
router.put('/:id/seen', authenticate, notificationController.markAsSeen);
router.put('/mark-all-seen', authenticate, notificationController.markAllAsSeen);
router.delete('/:id', authenticate, notificationController.deleteNotification);
router.delete('/', authenticate, notificationController.clearAllNotifications);

module.exports = router;