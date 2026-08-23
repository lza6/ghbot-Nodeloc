import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

function loadConfigWith(overrides: Record<string, string | undefined>) {
  const env = { ...process.env };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }
  return spawnSync(process.execPath, ["--import", "tsx", "--eval", "import('./src/config.ts')"], {
    cwd: path.resolve(process.cwd()),
    env,
    encoding: "utf8"
  });
}

test("config rejects enabled webhook without a secret", () => {
  const result = loadConfigWith({ WEBHOOK_ENABLED: "true", WEBHOOK_SECRET: "" });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /WEBHOOK_SECRET/);
});

test("config rejects partially configured R2 settings", () => {
  const result = loadConfigWith({
    WEBHOOK_ENABLED: "false",
    R2_ENDPOINT: "https://example.r2.cloudflarestorage.com",
    R2_BUCKET_NAME: "bucket",
    R2_ACCESS_KEY_ID: "",
    R2_SECRET_ACCESS_KEY: ""
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /R2_ENDPOINT/);
});

test("config defaults the provider base URL explicitly", () => {
  const result = loadConfigWith({
    WEBHOOK_ENABLED: "false",
    GOOSE_BASE_URL: ""
  });
  assert.equal(result.status, 0, result.stderr);
});
