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

// CREATE a new location
router.post("/create", authenticate, authorizeRoles("admin", "superadmin"), createLocation);

// GET all locations for current company
router.get("/", authenticate, authorizeRoles("admin", "superadmin", "supervisor"), getAllLocations);

// **NEW** route => get assigned locations for the current user
// Must be placed BEFORE any route with /:id
router.get("/assigned", authenticate, getAssignedLocationsForUser);

// GET a location by ID
router.get("/:id", authenticate, authorizeRoles("admin", "superadmin", "supervisor"), getLocationById);

// UPDATE a location
router.put("/update/:id", authenticate, authorizeRoles("admin", "superadmin"), updateLocation);

// DELETE a location
router.delete("/delete/:id", authenticate, authorizeRoles("admin", "superadmin"), deleteLocation);

// ASSIGN users to location
router.put("/:id/assign-users", authenticate, authorizeRoles("admin", "superadmin"), assignUsersToLocation);

// REMOVE users from location
router.put("/:id/remove-users", authenticate, authorizeRoles("admin", "superadmin"), removeUsersFromLocation);

// GET all users assigned to a location
router.get("/:id/users", authenticate, authorizeRoles("admin", "superadmin", "supervisor"), getUsersForLocation);

module.exports = router;
