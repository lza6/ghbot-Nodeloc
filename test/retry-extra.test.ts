import assert from "node:assert/strict";
import test from "node:test";
import { withRetry } from "../src/retry.js";

class HttpLikeError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

test("custom retryable predicate treats specific errors as retryable", async () => {
  let attempts = 0;
  const result = await withRetry(
    "custom-retryable",
    async () => {
      attempts += 1;
      if (attempts < 3) {
        throw new HttpLikeError(403, "forbidden but transient per our rule");
      }
      return "done";
    },
    {
      baseDelayMs: 1,
      retryable: (error) => {
        if (typeof error === "object" && error !== null && "status" in error) {
          const e = error as { status: number };
          return e.status === 403;
        }
        return false;
      }
    }
  );
  assert.equal(result, "done");
  assert.equal(attempts, 3);
});

test("custom retryable predicate prevents retry when it returns false", async () => {
  let attempts = 0;
  await assert.rejects(
    withRetry(
      "custom-non-retryable",
      async () => {
        attempts += 1;
        throw new HttpLikeError(500, "always fatal per our rule");
      },
      {
        baseDelayMs: 1,
        retryable: () => false
      }
    ),
    /always fatal/
  );
  assert.equal(attempts, 1);
});

test("default behavior unchanged when no custom retryable provided", async () => {
  let attempts = 0;
  const result = await withRetry(
    "default-behavior",
    async () => {
      attempts += 1;
      if (attempts < 3) {
        throw new HttpLikeError(502, "bad gateway");
      }
      return "ok";
    },
    { baseDelayMs: 1 }
  );
  assert.equal(result, "ok");
  assert.equal(attempts, 3);
});

test("default behavior still rejects non-retryable errors", async () => {
  let attempts = 0;
  await assert.rejects(
    withRetry("default-non-retryable", async () => {
      attempts += 1;
      throw new HttpLikeError(404, "not found");
    })
  );
  assert.equal(attempts, 1);
});

test("maxTotalTimeoutMs stops retries when elapsed time exceeds limit", async () => {
  const startTime = Date.now();
  let attempts = 0;
  await assert.rejects(
    withRetry(
      "timeout-limit",
      async () => {
        attempts += 1;
        // Simulate a brief operation that takes some time
        throw new HttpLikeError(502, "timeout test");
      },
      { maxAttempts: 5, baseDelayMs: 100, maxTotalTimeoutMs: 50 }
    )
  );
  const elapsed = Date.now() - startTime;
  assert.ok(attempts > 0, "at least one attempt was made");
  assert.ok(attempts < 5, "should not reach max attempts due to total timeout");
  assert.ok(elapsed < 500, "should complete within reasonable time given the short timeout");
});
