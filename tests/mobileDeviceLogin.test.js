"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  getNormalizedDeviceId,
  getRegisteredDeviceConflict,
  buildSignInUpdateData,
  isMobileSignOut,
} = require("../src/utils/mobileDeviceLogin");

const DEVICE_A = "550e8400-e29b-41d4-a716-446655440000";
const DEVICE_B = "660e8400-e29b-41d4-a716-446655440001";

describe("mobileDeviceLogin", () => {
  it("treats missing deviceId as web login (no conflict, no registration)", () => {
    assert.equal(getNormalizedDeviceId(undefined), "");
    assert.equal(getRegisteredDeviceConflict({ registeredDeviceId: DEVICE_A }, ""), null);
    const update = buildSignInUpdateData("");
    assert.ok(update.lastLoginAt);
    assert.equal(update.registeredDeviceId, undefined);
    assert.equal(update.registeredDeviceAt, undefined);
  });

  it("allows first mobile login when no device is registered", () => {
    assert.equal(getRegisteredDeviceConflict({ registeredDeviceId: null }, DEVICE_A), null);
    const update = buildSignInUpdateData(DEVICE_A);
    assert.equal(update.registeredDeviceId, DEVICE_A);
    assert.ok(update.registeredDeviceAt);
  });

  it("allows same-device mobile re-login", () => {
    assert.equal(
      getRegisteredDeviceConflict({ registeredDeviceId: DEVICE_A }, DEVICE_A),
      null
    );
  });

  it("blocks login from a second device while another is registered", () => {
    const conflict = getRegisteredDeviceConflict(
      { registeredDeviceId: DEVICE_A },
      DEVICE_B
    );
    assert.equal(conflict.status, 403);
    assert.equal(conflict.code, "DEVICE_ALREADY_REGISTERED");
    assert.match(conflict.message, /another device/i);
  });

  it("clears device slot only on mobile sign-out", () => {
    assert.equal(isMobileSignOut(DEVICE_A), true);
    assert.equal(isMobileSignOut(""), false);
  });
});
