import assert from "node:assert/strict";
import test from "node:test";
import { categorizeFailure, formatFailureMessage } from "../src/ai/failureMessages.js";

/* ---------- categorizeFailure ---------- */

test("categorizeFailure: timeout by error code", () => {
  const err = Object.assign(new Error("timed out"), { code: "ETIMEDOUT" });
  assert.equal(categorizeFailure(err), "timeout");
});

test("categorizeFailure: timeout by message", () => {
  const err = new Error("the operation timed out after 30s");
  assert.equal(categorizeFailure(err), "timeout");
});

test("categorizeFailure: auth by status code 401", () => {
  const err = Object.assign(new Error("unauthorized"), { status: 401 });
  assert.equal(categorizeFailure(err), "auth");
});

test("categorizeFailure: auth by status code 403", () => {
  const err = Object.assign(new Error("forbidden"), { status: 403 });
  assert.equal(categorizeFailure(err), "auth");
});

test("categorizeFailure: auth by message", () => {
  const err = new Error("API key is invalid");
  assert.equal(categorizeFailure(err), "auth");
});

test("categorizeFailure: rate_limit by status code 429", () => {
  const err = Object.assign(new Error("too many"), { status: 429 });
  assert.equal(categorizeFailure(err), "rate_limit");
});

test("categorizeFailure: rate_limit by message", () => {
  const err = new Error("rate limit exceeded, retry later");
  assert.equal(categorizeFailure(err), "rate_limit");
});

test("categorizeFailure: network by error code ECONNRESET", () => {
  const err = Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
  assert.equal(categorizeFailure(err), "network");
});

test("categorizeFailure: network by error code ECONNREFUSED", () => {
  const err = Object.assign(new Error("refused"), { code: "ECONNREFUSED" });
  assert.equal(categorizeFailure(err), "network");
});

test("categorizeFailure: network by error code EAI_AGAIN", () => {
  const err = Object.assign(new Error("again"), { code: "EAI_AGAIN" });
  assert.equal(categorizeFailure(err), "network");
});

test("categorizeFailure: network by message", () => {
  const err = new Error("network error: unable to reach host");
  assert.equal(categorizeFailure(err), "network");
});

test("categorizeFailure: model by status 502", () => {
  const err = Object.assign(new Error("upstream error"), { status: 502 });
  assert.equal(categorizeFailure(err), "model");
});

test("categorizeFailure: model by message", () => {
  const err = new Error("model completion failed: context length exceeded");
  assert.equal(categorizeFailure(err), "model");
});

test("categorizeFailure: validation by status 422", () => {
  const err = Object.assign(new Error("invalid"), { status: 422 });
  assert.equal(categorizeFailure(err), "validation");
});

test("categorizeFailure: validation by message", () => {
  const err = new Error("validation error: invalid schema");
  assert.equal(categorizeFailure(err), "validation");
});

test("categorizeFailure: null input returns unknown", () => {
  assert.equal(categorizeFailure(null), "unknown");
});

test("categorizeFailure: string input returns unknown", () => {
  assert.equal(categorizeFailure("some error"), "unknown");
});

test("categorizeFailure: plain error with no recognizable pattern returns unknown", () => {
  const err = new Error("something unexpected happened");
  assert.equal(categorizeFailure(err), "unknown");
});

/* ---------- formatFailureMessage ---------- */

test("formatFailureMessage: timeout includes action and attempts", () => {
  const msg = formatFailureMessage("timeout", { action: "runReview", attempts: 3 });
  assert.ok(msg.includes("runReview"));
  assert.ok(msg.includes("3"));
  assert.ok(msg.includes("timed out"));
});

test("formatFailureMessage: auth includes action and attempts", () => {
  const msg = formatFailureMessage("auth", { action: "createComment", attempts: 2 });
  assert.ok(msg.includes("createComment"));
  assert.ok(msg.includes("2"));
  assert.ok(msg.includes("authentication error"));
});

test("formatFailureMessage: rate_limit mentions backing off", () => {
  const msg = formatFailureMessage("rate_limit", { action: "listReviews", attempts: 5 });
  assert.ok(msg.includes("rate-limited"));
  assert.ok(msg.includes("backing off"));
});

test("formatFailureMessage: network mentions service unreachable", () => {
  const msg = formatFailureMessage("network", { action: "fetchData", attempts: 1 });
  assert.ok(msg.includes("network error"));
  assert.ok(msg.includes("unreachable"));
});

test("formatFailureMessage: model mentions model error", () => {
  const msg = formatFailureMessage("model", { action: "runReview", attempts: 3 });
  assert.ok(msg.includes("model error"));
});

test("formatFailureMessage: validation mentions validation check", () => {
  const msg = formatFailureMessage("validation", { action: "parseResponse", attempts: 2 });
  assert.ok(msg.includes("validation check"));
});

test("formatFailureMessage: unknown mentions unknown error", () => {
  const msg = formatFailureMessage("unknown", { action: "someAction", attempts: 4 });
  assert.ok(msg.includes("unknown error"));
  assert.ok(msg.includes("Check the logs") || msg.includes("check the logs"));
});
