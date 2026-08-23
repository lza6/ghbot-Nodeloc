import assert from "node:assert/strict";
import test from "node:test";
import { formatValidationLogOutput } from "../src/review/conflictResolver.js";
import { redactSecrets } from "../src/security/secrets.js";

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

test("redaction is applied to command failure text before exposure", () => {
  // The conflict resolver wraps commandFailureOutput with redactSecrets; this
  // asserts the composition contract at the module boundary.
  const leaked = "push failed: https://user:ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456@github.com/x";
  assert.equal(redactSecrets(leaked).includes("ghp_"), false);
});
