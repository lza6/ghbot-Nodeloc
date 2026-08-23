import assert from "node:assert/strict";
import test from "node:test";
import {
  formatValidationLogOutput,
  formatValidationResult
} from "../src/review/conflictResolver.js";

test("validation log output keeps the useful tail within bounds", () => {
  const longOutput = "x".repeat(30_000) + "\nfinal error line";
  const formatted = formatValidationLogOutput(longOutput);
  assert.ok(formatted.length <= 12_100, `length ${formatted.length}`);
  assert.match(formatted, /truncated \d+ leading characters/);
  assert.match(formatted, /final error line/);
});

test("validation log output strips ANSI escapes and normalizes newlines", () => {
  const formatted = formatValidationLogOutput("[31merror[0m\r\nline2");
  assert.equal(formatted, "error\nline2");
});

test("validation result redacts credentials before prompt or log exposure", () => {
  const formatted = formatValidationResult("npm test", {
    code: 1,
    stdout: "",
    stderr: "fatal: https://user:ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456@github.com/x"
  });
  assert.equal(formatted.includes("ghp_"), false);
  assert.match(formatted, /REDACTED|Exit code: 1/);
});
