/**
 * Shared GitHub API error utilities.
 */

export function isNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "status" in error && error.status === 404;
}

export function isAlreadyMergedError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return false;
  }
  const candidate = error as { status?: unknown; message?: unknown };
  if (candidate.status !== 405 && candidate.status !== 409) {
    return false;
  }
  return (
    typeof candidate.message === "string" &&
    /already.{0,20}merged|Pull Request is not mergeable/i.test(candidate.message)
  );
}

export function isRetryableGitHubError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const candidate = error as { status?: unknown };
  if (typeof candidate.status === "number") {
    if (candidate.status === 429) return true;
    if (candidate.status >= 500 && candidate.status < 600) return true;
    return false;
  }
  return false;
}