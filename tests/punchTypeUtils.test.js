"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  punchTypeFromReason,
  resolvePunchType,
} = require("../src/utils/punchTypeUtils");

describe("punchTypeUtils", () => {
  it("maps reason Training to TRAINING (case-insensitive)", () => {
    assert.equal(punchTypeFromReason("Training"), "TRAINING");
    assert.equal(punchTypeFromReason("training"), "TRAINING");
    assert.equal(punchTypeFromReason("  Training  "), "TRAINING");
  });

  it("returns null for non-training reasons", () => {
    assert.equal(punchTypeFromReason("Sick"), null);
    assert.equal(punchTypeFromReason(""), null);
    assert.equal(punchTypeFromReason(null), null);
  });

  it("prefers explicit punchType over reason", () => {
    assert.equal(
      resolvePunchType({ punchType: "REGULAR", reason: "Training" }),
      "REGULAR",
    );
  });

  it("falls back to TRAINING from reason when punchType omitted", () => {
    assert.equal(resolvePunchType({ reason: "Training" }), "TRAINING");
  });

  it("defaults to REGULAR when neither punchType nor training reason", () => {
    assert.equal(resolvePunchType({}), "REGULAR");
    assert.equal(resolvePunchType({ reason: "Forgot to clock" }), "REGULAR");
  });
});
