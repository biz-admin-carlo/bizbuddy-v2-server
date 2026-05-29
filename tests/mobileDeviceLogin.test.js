"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  getNormalizedDeviceId,
  parseReplaceDevice,
  getRegisteredDeviceConflict,
  shouldBumpTokenVersionOnReplace,
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

  it("allows replacing the registered device when replaceDevice is true", () => {
    assert.equal(
      getRegisteredDeviceConflict({ registeredDeviceId: DEVICE_A }, DEVICE_B, true),
      null
    );
    assert.equal(parseReplaceDevice(true), true);
    assert.equal(parseReplaceDevice("true"), true);
    assert.equal(parseReplaceDevice(false), false);
    assert.equal(
      shouldBumpTokenVersionOnReplace(
        { registeredDeviceId: DEVICE_A },
        DEVICE_B,
        true
      ),
      true
    );
    const update = buildSignInUpdateData(DEVICE_B, { bumpTokenVersion: true });
    assert.equal(update.registeredDeviceId, DEVICE_B);
    assert.deepEqual(update.tokenVersion, { increment: 1 });
  });

  it("does not bump tokenVersion when replaceDevice is true on same device", () => {
    assert.equal(
      shouldBumpTokenVersionOnReplace(
        { registeredDeviceId: DEVICE_A },
        DEVICE_A,
        true
      ),
      false
    );
  });

  it("clears device slot only on mobile sign-out", () => {
    assert.equal(isMobileSignOut(DEVICE_A), true);
    assert.equal(isMobileSignOut(""), false);
  });
});
