import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { cacheRootDirectory, runtimeDirectory, tempRootDirectory } from "../src/runtimePaths.js";

test("runtime paths default to the process working directory", () => {
  delete process.env.GHBOT_RUNTIME_DIR;
  assert.equal(runtimeDirectory(), process.cwd());
  assert.match(tempRootDirectory(), /[\\/.]\.ghbot-tmp$/);
  assert.match(cacheRootDirectory(), /[\\/.]\.ghbot-cache$/);
});

test("GHBOT_RUNTIME_DIR relocates scratch and cache roots", () => {
  const root = path.join(os.tmpdir(), `ghbot-runtime-${Date.now()}`);
  process.env.GHBOT_RUNTIME_DIR = root;
  try {
    assert.equal(runtimeDirectory(), root);
    assert.equal(tempRootDirectory(), path.join(root, ".ghbot-tmp"));
    assert.equal(cacheRootDirectory(), path.join(root, ".ghbot-cache"));
  } finally {
    delete process.env.GHBOT_RUNTIME_DIR;
  }
});

test("whitespace-only GHBOT_RUNTIME_DIR falls back to cwd", () => {
  process.env.GHBOT_RUNTIME_DIR = "   ";
  try {
    assert.equal(runtimeDirectory(), process.cwd());
  } finally {
    delete process.env.GHBOT_RUNTIME_DIR;
  }
});
