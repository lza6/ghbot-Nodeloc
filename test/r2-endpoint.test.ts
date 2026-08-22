import assert from "node:assert/strict";
import test from "node:test";
import { isR2Configured, normalizeEndpoint } from "../src/storage/r2.js";

test("normalizeEndpoint accepts credential-free https URLs and trims trailing slashes", () => {
  assert.equal(
    normalizeEndpoint("https://account.r2.cloudflarestorage.com"),
    "https://account.r2.cloudflarestorage.com"
  );
  assert.equal(
    normalizeEndpoint("https://account.r2.cloudflarestorage.com/"),
    "https://account.r2.cloudflarestorage.com"
  );
});

test("normalizeEndpoint rejects non-https, credentialed, or decorated URLs", () => {
  assert.throws(() => normalizeEndpoint("http://insecure.example"), /credential-free HTTPS/);
  assert.throws(() => normalizeEndpoint("https://user:pass@host"), /credential-free HTTPS/);
  assert.throws(() => normalizeEndpoint("https://host/path?query=1"), /credential-free HTTPS/);
  assert.throws(() => normalizeEndpoint("not a url"), /valid HTTPS URL/);
});

test("isR2Configured reflects ambient configuration without throwing", () => {
  // The test environment has no R2_* env vars set; the helper must not throw.
  assert.equal(typeof isR2Configured(), "boolean");
});
