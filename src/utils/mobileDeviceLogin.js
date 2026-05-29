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

function parseReplaceDevice(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function getRegisteredDeviceConflict(user, normalizedDeviceId, replaceDevice = false) {
  if (!normalizedDeviceId || replaceDevice) {
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

function shouldBumpTokenVersionOnReplace(user, normalizedDeviceId, replaceDevice) {
  return (
    replaceDevice &&
    normalizedDeviceId &&
    user.registeredDeviceId &&
    user.registeredDeviceId !== normalizedDeviceId
  );
}

function buildSignInUpdateData(normalizedDeviceId, { bumpTokenVersion = false } = {}) {
  const data = { lastLoginAt: new Date() };
  if (normalizedDeviceId) {
    data.registeredDeviceId = normalizedDeviceId;
    data.registeredDeviceAt = new Date();
  }
  if (bumpTokenVersion) {
    data.tokenVersion = { increment: 1 };
  }
  return data;
}

function isMobileSignOut(normalizedDeviceId) {
  return normalizedDeviceId.length > 0;
}

module.exports = {
  getNormalizedDeviceId,
  parseReplaceDevice,
  getRegisteredDeviceConflict,
  shouldBumpTokenVersionOnReplace,
  buildSignInUpdateData,
  isMobileSignOut,
};
