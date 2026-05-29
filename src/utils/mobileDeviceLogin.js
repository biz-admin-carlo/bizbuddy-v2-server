/**
 * Mobile-only single-device login helpers.
 * Web sign-in/sign-out omits deviceId and bypasses these checks.
 */

const DEVICE_SWITCH_COOLDOWN_MS = 24 * 60 * 60 * 1000;

function getNormalizedDeviceId(deviceId) {
  if (deviceId == null || deviceId === "") {
    return "";
  }
  return String(deviceId).trim();
}

function parseReplaceDevice(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function getDeviceSwitchCooldownEndsAt(registeredDeviceAt) {
  if (!registeredDeviceAt) {
    return null;
  }
  const at =
    registeredDeviceAt instanceof Date
      ? registeredDeviceAt
      : new Date(registeredDeviceAt);
  if (Number.isNaN(at.getTime())) {
    return null;
  }
  return new Date(at.getTime() + DEVICE_SWITCH_COOLDOWN_MS);
}

function isDifferentRegisteredDevice(user, normalizedDeviceId) {
  return (
    normalizedDeviceId &&
    user.registeredDeviceId &&
    user.registeredDeviceId !== normalizedDeviceId
  );
}

function isWithinDeviceSwitchCooldown(registeredDeviceAt, now = new Date()) {
  const endsAt = getDeviceSwitchCooldownEndsAt(registeredDeviceAt);
  if (!endsAt) {
    return false;
  }
  return now < endsAt;
}

function getRegisteredDeviceConflict(user, normalizedDeviceId) {
  if (!normalizedDeviceId || !isDifferentRegisteredDevice(user, normalizedDeviceId)) {
    return null;
  }

  if (!isWithinDeviceSwitchCooldown(user.registeredDeviceAt)) {
    // Cooldown expired — allow login and update registered device.
    return null;
  }

  const switchAllowedAt = getDeviceSwitchCooldownEndsAt(user.registeredDeviceAt);
  return {
    status: 403,
    message:
      "This account was recently signed in on another device. You can sign in here after the 24-hour waiting period.",
    code: "DEVICE_SWITCH_COOLDOWN",
    switchAllowedAt: switchAllowedAt.toISOString(),
  };
}

function shouldBumpTokenVersionOnDeviceSwitch(user, normalizedDeviceId) {
  return isDifferentRegisteredDevice(user, normalizedDeviceId);
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
  DEVICE_SWITCH_COOLDOWN_MS,
  getNormalizedDeviceId,
  parseReplaceDevice,
  getDeviceSwitchCooldownEndsAt,
  isDifferentRegisteredDevice,
  isWithinDeviceSwitchCooldown,
  getRegisteredDeviceConflict,
  shouldBumpTokenVersionOnDeviceSwitch,
  buildSignInUpdateData,
  isMobileSignOut,
};
