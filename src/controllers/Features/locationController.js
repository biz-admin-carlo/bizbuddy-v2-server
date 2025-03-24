// src/controllers/Features/locationController.js

const { prisma } = require("@config/connection");

/**
 * POST /api/location/create
 * Creates a new location for the current company.
 */
exports.createLocation = async (req, res) => {
  try {
    const { name, latitude, longitude, radius } = req.body;
    const companyId = req.user.companyId;

    if (!companyId) {
      return res.status(400).json({ error: "No company associated with the user." });
    }
    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({ error: "Latitude and longitude are required." });
    }
    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Location name is required." });
    }

    const finalName = name.trim();
    const finalRadius = radius ? Number(radius) : 500;

    const newLocation = await prisma.location.create({
      data: {
        companyId,
        name: finalName,
        latitude: Number(latitude),
        longitude: Number(longitude),
        radius: finalRadius,
      },
    });

    return res.status(201).json({
      data: newLocation,
      message: "Location created successfully.",
    });
  } catch (error) {
    console.error("Error in createLocation:", error);
    return res.status(500).json({ error: "Internal server error." });
  }
};

/**
 * GET /api/location
 * Retrieves all locations for the current company.
 */
exports.getAllLocations = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    if (!companyId) {
      return res.status(400).json({ error: "No company associated with the user." });
    }

    const locations = await prisma.location.findMany({
      where: { companyId },
      include: {
        LocationRestriction: {
          select: { userId: true, restrictionStatus: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return res.status(200).json({
      data: locations,
      message: "Locations retrieved successfully.",
    });
  } catch (error) {
    console.error("Error in getAllLocations:", error);
    return res.status(500).json({ error: "Internal server error." });
  }
};

/**
 * GET /api/location/assigned
 * Returns all locations that the current user is assigned to via LocationRestriction.
 */
exports.getAssignedLocationsForUser = async (req, res) => {
  try {
    const userId = req.user.id;
    if (!userId) {
      return res.status(401).json({ error: "User not found in request." });
    }

    // Find all location restrictions for this user that are active => restrictionStatus: true
    const restrictions = await prisma.locationRestriction.findMany({
      where: {
        userId,
        restrictionStatus: true,
      },
      include: {
        location: true, // get the location data
      },
    });

    // Build an array of assigned locations
    const assignedLocations = restrictions.map((r) => {
      const loc = r.location;
      return {
        id: loc.id,
        name: loc.name,
        latitude: loc.latitude,
        longitude: loc.longitude,
        radius: loc.radius,
      };
    });

    return res.status(200).json({
      data: assignedLocations,
      message: "Assigned locations retrieved successfully.",
    });
  } catch (error) {
    console.error("Error in getAssignedLocationsForUser:", error);
    return res.status(500).json({ error: "Internal server error." });
  }
};

/**
 * GET /api/location/:id
 * Retrieves a location by its ID (within the current company).
 */
exports.getLocationById = async (req, res) => {
  try {
    const locationId = req.params.id;
    const companyId = req.user.companyId;

    if (!locationId) {
      return res.status(400).json({ error: "Invalid location ID." });
    }

    const location = await prisma.location.findFirst({
      where: { id: locationId, companyId },
      include: {
        LocationRestriction: true,
      },
    });
    if (!location) {
      return res.status(404).json({ error: "Location not found." });
    }

    return res.status(200).json({
      data: location,
      message: "Location retrieved successfully.",
    });
  } catch (error) {
    console.error("Error in getLocationById:", error);
    return res.status(500).json({ error: "Internal server error." });
  }
};

/**
 * PUT /api/location/update/:id
 * Updates an existing location's name, coordinates, or radius.
 */
exports.updateLocation = async (req, res) => {
  try {
    const locationId = req.params.id;
    const companyId = req.user.companyId;
    let { name, latitude, longitude, radius } = req.body;

    // Check if location belongs to user's company
    const location = await prisma.location.findFirst({
      where: { id: locationId, companyId },
    });
    if (!location) {
      return res.status(404).json({ error: "Location not found." });
    }

    // Name must not be empty
    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Location name is required." });
    }

    const finalName = name.trim();
    const finalLat = latitude !== undefined ? Number(latitude) : location.latitude;
    const finalLng = longitude !== undefined ? Number(longitude) : location.longitude;
    const finalRadius = radius !== undefined ? Number(radius) : location.radius;

    const updatedLocation = await prisma.location.update({
      where: { id: locationId },
      data: {
        name: finalName,
        latitude: finalLat,
        longitude: finalLng,
        radius: finalRadius,
        updatedAt: new Date(),
      },
    });

    return res.status(200).json({
      data: updatedLocation,
      message: "Location updated successfully.",
    });
  } catch (error) {
    console.error("Error in updateLocation:", error);
    return res.status(500).json({ error: "Internal server error." });
  }
};

/**
 * DELETE /api/location/delete/:id
 * Deletes a location (and its restrictions).
 */
exports.deleteLocation = async (req, res) => {
  try {
    const locationId = req.params.id;
    const companyId = req.user.companyId;

    if (!locationId) {
      return res.status(400).json({ error: "Invalid location ID." });
    }

    // Check if the location belongs to the user's company
    const location = await prisma.location.findFirst({
      where: { id: locationId, companyId },
    });
    if (!location) {
      return res.status(404).json({ error: "Location not found." });
    }

    // Delete locationRestrictions first
    await prisma.locationRestriction.deleteMany({
      where: { locationId },
    });

    // Then delete the location
    await prisma.location.delete({ where: { id: locationId } });

    return res.status(200).json({ message: "Location and its restrictions deleted successfully." });
  } catch (error) {
    console.error("Error in deleteLocation:", error);
    return res.status(500).json({ error: "Internal server error." });
  }
};

/**
 * PUT /api/location/:id/assign-users
 * Upserts a list of users for a location.
 */
exports.assignUsersToLocation = async (req, res) => {
  try {
    const locationId = req.params.id;
    const { userIds } = req.body;
    const companyId = req.user.companyId;

    if (!locationId) {
      return res.status(400).json({ error: "Invalid location ID." });
    }
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ error: "A non-empty array of user IDs is required." });
    }

    // Check the location
    const location = await prisma.location.findFirst({
      where: { id: locationId, companyId },
    });
    if (!location) {
      return res.status(404).json({ error: "Location not found." });
    }

    // Validate user IDs
    const validUsers = await prisma.user.findMany({
      where: {
        id: { in: userIds },
        companyId,
        role: { not: "superadmin" },
      },
      select: { id: true },
    });
    const validUserIds = validUsers.map((u) => u.id);
    const invalidUserIds = userIds.filter((id) => !validUserIds.includes(id));
    if (invalidUserIds.length > 0) {
      return res.status(400).json({
        error: `Some user IDs invalid or not in your company: ${invalidUserIds.join(", ")}.`,
      });
    }

    // Upsert restrictions
    for (const userId of validUserIds) {
      await prisma.locationRestriction.upsert({
        where: {
          userId_locationId: { userId, locationId },
        },
        update: {
          restrictionStatus: true,
          updatedAt: new Date(),
        },
        create: {
          userId,
          locationId,
          restrictionStatus: true,
        },
      });
    }

    return res.status(200).json({
      message: "Users assigned to location successfully.",
      data: { assignedUserIds: validUserIds },
    });
  } catch (error) {
    console.error("Error in assignUsersToLocation:", error);
    return res.status(500).json({ error: "Internal server error." });
  }
};

/**
 * PUT /api/location/:id/remove-users
 * Removes a list of users from a location.
 */
exports.removeUsersFromLocation = async (req, res) => {
  try {
    const locationId = req.params.id;
    const { userIds } = req.body;
    const companyId = req.user.companyId;

    if (!locationId) {
      return res.status(400).json({ error: "Invalid location ID." });
    }
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ error: "A non-empty array of user IDs is required." });
    }

    // Check location
    const location = await prisma.location.findFirst({
      where: { id: locationId, companyId },
    });
    if (!location) {
      return res.status(404).json({ error: "Location not found." });
    }

    // Delete the restrictions
    await prisma.locationRestriction.deleteMany({
      where: {
        userId: { in: userIds },
        locationId,
      },
    });

    return res.status(200).json({
      message: "Users removed from location successfully.",
      data: { removedUserIds: userIds },
    });
  } catch (error) {
    console.error("Error in removeUsersFromLocation:", error);
    return res.status(500).json({ error: "Internal server error." });
  }
};

/**
 * GET /api/location/:id/users
 * Retrieves all users assigned to a location.
 */
exports.getUsersForLocation = async (req, res) => {
  try {
    const locationId = req.params.id;
    const companyId = req.user.companyId;

    if (!locationId) {
      return res.status(400).json({ error: "Invalid location ID." });
    }
    const location = await prisma.location.findFirst({
      where: { id: locationId, companyId },
    });
    if (!location) {
      return res.status(404).json({ error: "Location not found." });
    }

    const restrictions = await prisma.locationRestriction.findMany({
      where: { locationId, restrictionStatus: true },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            username: true,
            profile: { select: { firstName: true, lastName: true } },
          },
        },
      },
    });

    const assignedUsers = restrictions.map((r) => r.user);
    return res.status(200).json({
      data: assignedUsers,
      message: "Users for location retrieved successfully.",
    });
  } catch (error) {
    console.error("Error in getUsersForLocation:", error);
    return res.status(500).json({ error: "Internal server error." });
  }
};
