import assert from "node:assert/strict";
import test from "node:test";
import {
  hasProtectedSegment,
  isProtectedBasename,
  PROTECTED_DIRECTORIES,
  PROTECTED_FILE_NAMES
} from "../src/security/sanitization.js";
import { containsSecret, redactSecrets } from "../src/security/secrets.js";

test("protected basenames cover env files, agent configs, and deploy configs", () => {
  for (const name of [".env", ".env.local", ".ENV", "AGENTS.MD", "opencode.json", "wrangler.toml"]) {
    assert.equal(isProtectedBasename(name), true, `${name} should be protected`);
  }
  assert.equal(isProtectedBasename("environment.ts"), false);
  assert.equal(isProtectedBasename("src"), false);
});

test("protected directory segments are matched case-insensitively", () => {
  assert.equal(hasProtectedSegment(["src", ".Git", "config"]), true);
  assert.equal(hasProtectedSegment([".claude"]), true);
  assert.equal(hasProtectedSegment(["src", "lib"]), false);
  assert.equal(hasProtectedSegment([""]), false);
});

test("directory and file sets are non-trivial and stable", () => {
  assert.ok(PROTECTED_DIRECTORIES.has(".git"));
  assert.ok(PROTECTED_FILE_NAMES.has("agents.md"));
});

test("redactSecrets masks tokens and private keys in free text", () => {
  const input = [
    "token=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456",
    "key=sk-abcdefghijklmnopqrstuvwxyz012345",
    "auth: Bearer abcdefghijklmnopqrstuvwxyz0123456789",
    "-----BEGIN RSA PRIVATE KEY-----",
    "MIIEow...",
    "-----END RSA PRIVATE KEY-----"
  ].join("\n");
  const redacted = redactSecrets(input);
  assert.equal(containsSecret(redacted), false);
  assert.ok(redacted.includes("[REDACTED]"));
});

test("containsSecret detects credential shapes", () => {
  assert.equal(containsSecret("github_pat_ABCDEFGHIJKLMNOPQRSTUVWXYZ12"), true);
  assert.equal(containsSecret("nothing to see here"), false);
});
