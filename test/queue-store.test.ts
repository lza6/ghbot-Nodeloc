import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { QueueStore } from "../src/webhook/queueStore.js";

test("QueueStore writes and restores tasks", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "ghbot-queue-test-"));
  try {
    const store = new QueueStore(base);
    const task = {
      deliveryId: "abc123",
      eventName: "issue_comment",
      payload: { action: "created" },
      enqueuedAt: Date.now()
    };
    await store.write(task);
    assert.equal(await store.exists("abc123"), true);
    const restored = await store.restore();
    assert.equal(restored.length, 1);
    assert.equal(restored[0]!.deliveryId, "abc123");
    assert.equal(restored[0]!.eventName, "issue_comment");
    assert.deepEqual(restored[0]!.payload, { action: "created" });
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});

test("QueueStore removes tasks by delivery id", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "ghbot-queue-rm-"));
  try {
    const store = new QueueStore(base);
    await store.write({
      deliveryId: "x1",
      eventName: "pull_request",
      payload: { action: "opened" },
      enqueuedAt: Date.now()
    });
    await store.remove("x1");
    assert.equal(await store.exists("x1"), false);
    assert.equal((await store.restore()).length, 0);
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});

test("QueueStore restore handles missing directory and corrupted files", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "ghbot-queue-empty-"));
  try {
    const store = new QueueStore(base);
    // No directory yet
    assert.deepEqual(await store.restore(), []);
    // Write a valid task + a corrupted file
    await store.write({
      deliveryId: "ok1",
      eventName: "schedule",
      payload: {},
      enqueuedAt: Date.now()
    });
    await fs.writeFile(path.join(base, ".ghbot-webhook-queue", "corrupt.json"), "not-json", "utf8");
    const restored = await store.restore();
    assert.equal(restored.length, 1);
    assert.equal(restored[0]!.deliveryId, "ok1");
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});
