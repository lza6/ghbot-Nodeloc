import assert from "node:assert/strict";
import test from "node:test";
import { isRetryableError, withRetry } from "../src/retry.js";

class HttpLikeError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

test("returns immediately when the first attempt succeeds", async () => {
  let attempts = 0;
  const result = await withRetry(
    "probe.first",
    async () => {
      attempts += 1;
      return "ok";
    },
    { baseDelayMs: 1 }
  );
  assert.equal(result, "ok");
  assert.equal(attempts, 1);
});

test("retries transient failures and eventually succeeds", async () => {
  let attempts = 0;
  const result = await withRetry(
    "probe.transient",
    async () => {
      attempts += 1;
      if (attempts < 3) {
        throw new HttpLikeError(502, "bad gateway");
      }
      return "done";
    },
    { baseDelayMs: 1 }
  );
  assert.equal(result, "done");
  assert.equal(attempts, 3);
});

test("throws the last error after exhausting attempts", async () => {
  let attempts = 0;
  await assert.rejects(
    withRetry(
      "probe.exhausted",
      async () => {
        attempts += 1;
        throw new HttpLikeError(503, `boom ${attempts}`);
      },
      { maxAttempts: 3, baseDelayMs: 1 }
    ),
      /boom 3$/
    );
  assert.equal(attempts, 3);
});

test("4xx errors are not retried by default", async () => {
  let attempts = 0;
  await assert.rejects(
    withRetry(
      "probe.client-error",
      async () => {
        attempts += 1;
        throw new HttpLikeError(404, "not found");
      })
  );
  assert.equal(attempts, 1);
});

test("429 rate limits are retried by default", async () => {
  let attempts = 0;
  await assert.rejects(
    withRetry(
      "probe.rate-limit",
      async () => {
        attempts += 1;
        throw new HttpLikeError(429, "slow down");
      },
      { maxAttempts: 2, baseDelayMs: 1 }
    )
  );
  assert.equal(attempts, 2);
});

test("network-shaped failures are retried", async () => {
  let attempts = 0;
  await assert.rejects(
    withRetry(
      "probe.network",
      async () => {
        attempts += 1;
        throw Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
      },
      { maxAttempts: 2, baseDelayMs: 1 }
    )
  );
  assert.equal(attempts, 2);
});

test("isRetryableError classifies statuses and codes explicitly", () => {
  assert.equal(isRetryableError(new HttpLikeError(500, "oops")), true);
  assert.equal(isRetryableError(new HttpLikeError(503, "oops")), true);
  assert.equal(isRetryableError(new HttpLikeError(429, "oops")), true);
  assert.equal(isRetryableError(new HttpLikeError(404, "nope")), false);
  assert.equal(isRetryableError(new HttpLikeError(401, "denied")), false);
  assert.equal(isRetryableError(Object.assign(new Error("x"), { code: "ETIMEDOUT" })), true);
  assert.equal(isRetryableError(Object.assign(new Error("x"), { code: "EAI_AGAIN" })), true);
  assert.equal(isRetryableError(new Error("plain")), false);
});
