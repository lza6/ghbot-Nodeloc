import { logger } from "./logger.js";

const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 1_000;

const RETRYABLE_ERROR_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENOTFOUND",
  "EPIPE",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT"
]);

/**
 * Decide whether an error is worth retrying: server-side faults, rate limits,
 * and transport failures are transient; ordinary 4xx responses are not.
 */
export function isRetryableError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const candidate = error as { status?: unknown; code?: unknown };
  if (typeof candidate.status === "number") {
    if (candidate.status === 429) {
      return true;
    }
    if (candidate.status >= 500 && candidate.status < 600) {
      return true;
    }
    return false;
  }

  if (typeof candidate.code === "string" && RETRYABLE_ERROR_CODES.has(candidate.code)) {
    return true;
  }

  return false;
}

export async function withRetry<T>(
  label: string,
  operation: () => Promise<T>,
  options?: {
    maxAttempts?: number;
    baseDelayMs?: number;
    retryable?: (error: unknown) => boolean;
    maxTotalTimeoutMs?: number;
  }
): Promise<T> {
  const maxAttempts = options?.maxAttempts ?? MAX_ATTEMPTS;
  const baseDelayMs = options?.baseDelayMs ?? BASE_DELAY_MS;
  const retryableCheck = options?.retryable ?? isRetryableError;
  const maxTotalTimeoutMs = options?.maxTotalTimeoutMs;
  const startTime = Date.now();
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (maxTotalTimeoutMs !== undefined) {
        const elapsed = Date.now() - startTime;
        if (elapsed >= maxTotalTimeoutMs) {
          logger.warn(
            { error, label, attempt, maxAttempts, elapsed, maxTotalTimeoutMs },
            "Request failed; maxTotalTimeout exceeded."
          );
          break;
        }
      }

      logger.warn(
        {
          error,
          label,
          attempt,
          maxAttempts,
          retryable: retryableCheck(error)
        },
        "Request failed."
      );

      if (attempt === maxAttempts || !retryableCheck(error)) {
        break;
      }

      const jitter = 0.5 + Math.random() * 0.5;
      await delay(baseDelayMs * attempt * jitter);
    }
  }

  throw lastError;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
