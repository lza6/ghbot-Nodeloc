export type FailureCategory =
  "timeout" | "auth" | "rate_limit" | "network" | "model" | "validation" | "unknown";

/**
 * Categorize a caught error into a FailureCategory based on its message, status, or code.
 */
export function categorizeFailure(error: unknown): FailureCategory {
  if (typeof error !== "object" || error === null) {
    return "unknown";
  }

  const err = error as { message?: string; status?: number; code?: string };

  // Check by status code first
  if (typeof err.status === "number") {
    if (err.status === 401 || err.status === 403) {
      return "auth";
    }
    if (err.status === 429) {
      return "rate_limit";
    }
    if (err.status === 422) {
      return "validation";
    }
    if (err.status >= 500 && err.status < 600) {
      return "model";
    }
  }

  // Check by error code (Node.js system errors)
  if (typeof err.code === "string") {
    const timeoutCodes = new Set(["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT"]);
    const networkCodes = new Set([
      "ECONNRESET",
      "ECONNREFUSED",
      "EAI_AGAIN",
      "ENOTFOUND",
      "EPIPE",
      "UND_ERR_SOCKET"
    ]);

    if (timeoutCodes.has(err.code)) {
      return "timeout";
    }
    if (networkCodes.has(err.code)) {
      return "network";
    }
  }

  // Check by message content
  if (typeof err.message === "string") {
    const msg = err.message.toLowerCase();

    if (/timeout|timed?\s*out/i.test(msg)) {
      return "timeout";
    }
    if (/unauthorized|forbidden|auth|api key|invalid token|credentials?/i.test(msg)) {
      return "auth";
    }
    if (/rate limit|too many requests|quota/i.test(msg)) {
      return "rate_limit";
    }
    if (/network|econnreset|econnrefused|eai_again|enotfound|epipe|dns/i.test(msg)) {
      return "network";
    }
    if (/model|completion|generation|token limit|context length/i.test(msg)) {
      return "model";
    }
    if (/validation|parse|schema|invalid|malformed/i.test(msg)) {
      return "validation";
    }
  }

  return "unknown";
}

/**
 * Format a human-readable failure message for a given category.
 */
export function formatFailureMessage(
  category: FailureCategory,
  context: { action: string; attempts: number }
): string {
  const { action, attempts } = context;

  const messages: Record<FailureCategory, string> = {
    timeout: `Action "${action}" timed out after ${attempts} attempt(s). The upstream service did not respond in time.`,
    auth: `Action "${action}" failed due to an authentication error after ${attempts} attempt(s). Check that credentials are valid and have not expired.`,
    rate_limit: `Action "${action}" was rate-limited after ${attempts} attempt(s). Consider backing off or checking your quota.`,
    network: `Action "${action}" encountered a network error after ${attempts} attempt(s). The service may be unreachable or experiencing connectivity issues.`,
    model: `Action "${action}" failed due to an AI model error after ${attempts} attempt(s). The model may be overloaded or returned an unexpected response.`,
    validation: `Action "${action}" failed a validation check after ${attempts} attempt(s). The input data or response format may be invalid.`,
    unknown: `Action "${action}" failed after ${attempts} attempt(s) with an unknown error. Check the logs for more details.`
  };

  return messages[category];
}
