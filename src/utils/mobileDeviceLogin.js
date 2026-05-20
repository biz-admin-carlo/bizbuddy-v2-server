/**
 * Mobile-only single-device login helpers.
 * Web sign-in/sign-out omits deviceId and bypasses these checks.
 */

function getNormalizedDeviceId(deviceId) {
  if (deviceId == null || deviceId === "") {
    return "";
  }
  return String(deviceId).trim();
}

function getRegisteredDeviceConflict(user, normalizedDeviceId) {
  if (!normalizedDeviceId) {
    return null;
  }
  if (user.registeredDeviceId && user.registeredDeviceId !== normalizedDeviceId) {
    return {
      status: 403,
      message:
        "This account is already signed in on another device. Sign out there first or contact your administrator.",
      code: "DEVICE_ALREADY_REGISTERED",
    };
  }
  return null;
}

function buildSignInUpdateData(normalizedDeviceId) {
  const data = { lastLoginAt: new Date() };
  if (normalizedDeviceId) {
    data.registeredDeviceId = normalizedDeviceId;
    data.registeredDeviceAt = new Date();
  }
  return data;
}

function isMobileSignOut(normalizedDeviceId) {
  return normalizedDeviceId.length > 0;
}

module.exports = {
  getNormalizedDeviceId,
  getRegisteredDeviceConflict,
  buildSignInUpdateData,
  isMobileSignOut,
};
