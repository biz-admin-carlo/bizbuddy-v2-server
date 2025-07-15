// src/routes/Features/locationRoutes.js

const express = require("express");
const router = express.Router();
const authenticate = require("@middlewares/authMiddleware");
const { authorizeRoles } = require("@middlewares/roleMiddleware");
const {
  createLocation,
  getAllLocations,
  getLocationById,
  updateLocation,
  deleteLocation,
  assignUsersToLocation,
  removeUsersFromLocation,
  getUsersForLocation,
  getAssignedLocationsForUser,
} = require("@controllers/Features/locationController");

router.post(
  "/create",
  authenticate,
  authorizeRoles("admin", "superadmin"),
  createLocation
);
router.get(
  "/",
  authenticate,
  authorizeRoles("admin", "superadmin", "supervisor"),
  getAllLocations
);
router.get("/assigned", authenticate, getAssignedLocationsForUser);
router.get(
  "/:id",
  authenticate,
  authorizeRoles("admin", "superadmin", "supervisor"),
  getLocationById
);
router.put(
  "/update/:id",
  authenticate,
  authorizeRoles("admin", "superadmin"),
  updateLocation
);
router.delete(
  "/delete/:id",
  authenticate,
  authorizeRoles("admin", "superadmin"),
  deleteLocation
);
router.put(
  "/:id/assign-users",
  authenticate,
  authorizeRoles("admin", "superadmin"),
  assignUsersToLocation
);
router.put(
  "/:id/remove-users",
  authenticate,
  authorizeRoles("admin", "superadmin"),
  removeUsersFromLocation
);
router.get(
  "/:id/users",
  authenticate,
  authorizeRoles("admin", "superadmin", "supervisor"),
  getUsersForLocation
);

module.exports = router;
