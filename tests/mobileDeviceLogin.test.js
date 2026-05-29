"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  DEVICE_SWITCH_COOLDOWN_MS,
  getNormalizedDeviceId,
  getDeviceSwitchCooldownEndsAt,
  isWithinDeviceSwitchCooldown,
  getRegisteredDeviceConflict,
  shouldBumpTokenVersionOnDeviceSwitch,
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
    const registeredAt = new Date();
    assert.equal(
      getRegisteredDeviceConflict(
        { registeredDeviceId: DEVICE_A, registeredDeviceAt: registeredAt },
        DEVICE_A
      ),
      null
    );
  });

  it("blocks a different device within the 24-hour cooldown", () => {
    const registeredAt = new Date();
    const conflict = getRegisteredDeviceConflict(
      { registeredDeviceId: DEVICE_A, registeredDeviceAt: registeredAt },
      DEVICE_B
    );
    assert.equal(conflict.status, 403);
    assert.equal(conflict.code, "DEVICE_SWITCH_COOLDOWN");
    assert.ok(conflict.switchAllowedAt);
    const endsAt = new Date(conflict.switchAllowedAt);
    assert.equal(
      endsAt.getTime() - registeredAt.getTime(),
      DEVICE_SWITCH_COOLDOWN_MS
    );
  });

  it("requires confirmation after cooldown before switching devices", () => {
    const registeredAt = new Date(Date.now() - DEVICE_SWITCH_COOLDOWN_MS - 1000);
    const conflict = getRegisteredDeviceConflict(
      { registeredDeviceId: DEVICE_A, registeredDeviceAt: registeredAt },
      DEVICE_B
    );
    assert.equal(conflict.code, "DEVICE_ALREADY_REGISTERED");
    assert.equal(
      getRegisteredDeviceConflict(
        { registeredDeviceId: DEVICE_A, registeredDeviceAt: registeredAt },
        DEVICE_B,
        true
      ),
      null
    );
    assert.equal(
      shouldBumpTokenVersionOnDeviceSwitch(
        { registeredDeviceId: DEVICE_A, registeredDeviceAt: registeredAt },
        DEVICE_B,
        true
      ),
      true
    );
    assert.equal(
      shouldBumpTokenVersionOnDeviceSwitch(
        { registeredDeviceId: DEVICE_A, registeredDeviceAt: registeredAt },
        DEVICE_B,
        false
      ),
      false
    );
  });

  it("does not allow replaceDevice to bypass the cooldown", () => {
    const registeredAt = new Date();
    const conflict = getRegisteredDeviceConflict(
      { registeredDeviceId: DEVICE_A, registeredDeviceAt: registeredAt },
      DEVICE_B,
      true
    );
    assert.equal(conflict.code, "DEVICE_SWITCH_COOLDOWN");
  });

  it("bumps tokenVersion when switching devices after cooldown", () => {
    const update = buildSignInUpdateData(DEVICE_B, { bumpTokenVersion: true });
    assert.equal(update.registeredDeviceId, DEVICE_B);
    assert.deepEqual(update.tokenVersion, { increment: 1 });
  });

  it("does not bump tokenVersion on same-device login", () => {
    assert.equal(
      shouldBumpTokenVersionOnDeviceSwitch({ registeredDeviceId: DEVICE_A }, DEVICE_A),
      false
    );
  });

  it("detects cooldown window from registeredDeviceAt", () => {
    const now = new Date("2026-05-29T12:00:00.000Z");
    const registeredAt = new Date("2026-05-29T10:00:00.000Z");
    assert.equal(isWithinDeviceSwitchCooldown(registeredAt, now), true);
    const endsAt = getDeviceSwitchCooldownEndsAt(registeredAt);
    assert.equal(endsAt.toISOString(), "2026-05-30T10:00:00.000Z");
  });

  it("treats mobile sign-out as mobile when deviceId is present", () => {
    assert.equal(isMobileSignOut(DEVICE_A), true);
    assert.equal(isMobileSignOut(""), false);
  });
});
